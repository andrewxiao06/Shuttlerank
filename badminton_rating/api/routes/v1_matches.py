"""
V1 match routes — category-routed submission, validation, reports, inbox.

Mounted at /v1/matches so the v0 /matches endpoint keeps working during
the additive-migration window.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from badminton_rating.api.auth import current_player
from badminton_rating.api.models.v1 import (
    CategoryMatchCreate,
    CategoryMatchOut,
    MatchParticipantOut,
    ReportCreate,
    ReportOut,
    ValidationCreate,
    ValidationOut,
)
from badminton_rating.db.models import (
    Match,
    MatchPlayer,
    MatchReport,
    MatchStatus,
    MatchValidation,
    Player,
    ReportStatus,
    Team,
    ValidationAction,
)
from badminton_rating.db.session import get_db
from badminton_rating.engine.glicko import to_display_rating
from badminton_rating.services.categories import (
    CategoryMatchSubmission,
    CategorySubmissionError,
    submit_category_match,
    verify_pending_match,
)
from badminton_rating.services.notifications import notify_pending_match


router = APIRouter(prefix="/v1/matches", tags=["v1-matches"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _match_to_out(match: Match) -> CategoryMatchOut:
    return CategoryMatchOut(
        id=match.id,
        category=match.category,
        status=match.status,
        played_at=match.played_at,
        team_a_score=match.team_a_score,
        team_b_score=match.team_b_score,
        winner_team=match.winner_team.value,
        submitted_by_user_id=match.submitted_by_user_id,
        verified_at=match.verified_at,
        expires_at=match.expires_at,
        tournament_id=match.tournament_id,
        participants=[_participant_out(p) for p in match.participants],
    )


def _participant_out(p: MatchPlayer) -> MatchParticipantOut:
    pre_display = to_display_rating(p.pre_r)
    post_display = to_display_rating(p.post_r)
    return MatchParticipantOut(
        player_id=p.player_id,
        team=p.team.value,
        pre_r=p.pre_r,
        post_r=p.post_r,
        delta_r=p.delta_r,
        pre_display=pre_display,
        post_display=post_display,
        delta_display=round(post_display - pre_display, 3),
    )


async def _load_match_or_404(session: AsyncSession, match_id: int) -> Match:
    match = await session.get(Match, match_id)
    if match is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"match {match_id} not found",
        )
    await session.refresh(match, attribute_names=["participants"])
    return match


def _assert_participant(match: Match, player: Player) -> None:
    if not any(p.player_id == player.id for p in match.participants):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="only match participants can act on this match",
        )


# ---------------------------------------------------------------------------
# POST /v1/matches — submit
# ---------------------------------------------------------------------------

@router.post("", response_model=CategoryMatchOut, status_code=status.HTTP_201_CREATED)
async def create_v1_match(
    payload: CategoryMatchCreate,
    player: Player = Depends(current_player),
    session: AsyncSession = Depends(get_db),
) -> CategoryMatchOut:
    sub = CategoryMatchSubmission(
        played_at=payload.played_at,
        team_a_player_ids=payload.team_a_player_ids,
        team_b_player_ids=payload.team_b_player_ids,
        team_a_score=payload.team_a_score,
        team_b_score=payload.team_b_score,
        submitted_by_user_id=player.clerk_user_id,
    )
    try:
        match = await submit_category_match(session, sub)
    except CategorySubmissionError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    await session.commit()
    await session.refresh(match, attribute_names=["participants"])
    # Email the other participants that a match awaits their approval.
    # Best-effort — never blocks or fails the submission.
    await notify_pending_match(session, match)
    return _match_to_out(match)


# ---------------------------------------------------------------------------
# GET /v1/matches/{id}
# ---------------------------------------------------------------------------

@router.get("/{match_id}", response_model=CategoryMatchOut)
async def get_v1_match(
    match_id: int,
    session: AsyncSession = Depends(get_db),
) -> CategoryMatchOut:
    match = await _load_match_or_404(session, match_id)
    return _match_to_out(match)


# ---------------------------------------------------------------------------
# GET /v1/matches/pending — current player's inbox
# ---------------------------------------------------------------------------

@router.get("/inbox/pending", response_model=List[CategoryMatchOut])
async def pending_inbox(
    player: Player = Depends(current_player),
    session: AsyncSession = Depends(get_db),
) -> List[CategoryMatchOut]:
    # Matches where the current player is a participant, status is PENDING,
    # and they haven't already approved/disputed (submitters auto-approve,
    # so their own submissions don't clutter the inbox).
    mp_subq = select(MatchPlayer.match_id).where(MatchPlayer.player_id == player.id)
    acted_subq = select(MatchValidation.match_id).where(
        MatchValidation.user_id == player.clerk_user_id
    )
    stmt = (
        select(Match)
        .where(Match.id.in_(mp_subq))
        .where(Match.id.not_in(acted_subq))
        .where(Match.status == MatchStatus.PENDING)
        .order_by(Match.created_at.desc())
    )
    matches = (await session.execute(stmt)).scalars().all()
    out: List[CategoryMatchOut] = []
    for m in matches:
        await session.refresh(m, attribute_names=["participants"])
        out.append(_match_to_out(m))
    return out


# ---------------------------------------------------------------------------
# POST /v1/matches/{id}/validate — approve or dispute
# ---------------------------------------------------------------------------

@router.post(
    "/{match_id}/validate",
    response_model=ValidationOut,
    status_code=status.HTTP_201_CREATED,
)
async def validate_match(
    match_id: int,
    payload: ValidationCreate,
    player: Player = Depends(current_player),
    session: AsyncSession = Depends(get_db),
) -> ValidationOut:
    match = await _load_match_or_404(session, match_id)
    _assert_participant(match, player)
    if match.status is not MatchStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"match is {match.status}; only PENDING matches can be validated",
        )
    if player.clerk_user_id is None:
        # Defensive: the auth dep populates this; a missing clerk_user_id
        # means the Player row exists but was anonymized.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="player is missing a Clerk identity",
        )

    # One validation per (match, user) — enforce on insert via lookup.
    existing = (await session.execute(
        select(MatchValidation).where(
            MatchValidation.match_id == match.id,
            MatchValidation.user_id == player.clerk_user_id,
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="already validated this match",
        )

    validation = MatchValidation(
        match_id=match.id,
        user_id=player.clerk_user_id,
        action=payload.action,
        note=payload.note,
    )
    session.add(validation)
    await session.flush()

    # State transitions:
    # - any DISPUTED validation → match status DISPUTED, no rating update.
    # - if every participant has APPROVED → call verify_pending_match.
    if payload.action is ValidationAction.DISPUTED:
        match.status = MatchStatus.DISPUTED
    else:
        all_approved = await _all_participants_approved(session, match)
        if all_approved:
            # Re-load participants: the flush above may have expired the
            # relationship, and async lazy-loads raise instead of loading.
            await session.refresh(match, attribute_names=["participants"])
            try:
                await verify_pending_match(session, match)
            except CategorySubmissionError as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=str(e),
                )

    await session.commit()
    await session.refresh(validation)
    return ValidationOut.model_validate(validation)


async def _all_participants_approved(
    session: AsyncSession, match: Match
) -> bool:
    """True iff every participating Player has an APPROVED validation row."""
    # Build set of approving clerk_user_ids
    rows = (await session.execute(
        select(MatchValidation.user_id).where(
            MatchValidation.match_id == match.id,
            MatchValidation.action == ValidationAction.APPROVED,
        )
    )).scalars().all()
    approving_ids = set(rows)

    # Look up clerk_user_id for each participating player
    player_ids = [p.player_id for p in match.participants]
    players = (await session.execute(
        select(Player).where(Player.id.in_(player_ids))
    )).scalars().all()
    needed = {p.clerk_user_id for p in players if p.clerk_user_id}
    if not needed:
        return False  # no clerk-linked participants — never auto-verifies
    return needed.issubset(approving_ids)


# ---------------------------------------------------------------------------
# POST /v1/matches/{id}/report — falsification report
# ---------------------------------------------------------------------------

@router.post(
    "/{match_id}/report",
    response_model=ReportOut,
    status_code=status.HTTP_201_CREATED,
)
async def report_match(
    match_id: int,
    payload: ReportCreate,
    player: Player = Depends(current_player),
    session: AsyncSession = Depends(get_db),
) -> ReportOut:
    match = await _load_match_or_404(session, match_id)
    _assert_participant(match, player)
    if player.clerk_user_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="player is missing a Clerk identity",
        )
    report = MatchReport(
        match_id=match.id,
        reporter_user_id=player.clerk_user_id,
        reason=payload.reason,
        description=payload.description,
        status=ReportStatus.OPEN,
    )
    session.add(report)
    await session.commit()
    await session.refresh(report)
    return ReportOut.model_validate(report)
