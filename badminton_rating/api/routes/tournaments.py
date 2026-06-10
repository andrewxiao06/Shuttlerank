"""
Tournament routes — create, browse, sign up, generate pairings, complete.

The organizer is the Clerk user who created the tournament (stored in
`organizer_user_id`). They're the only one who can transition state via
generate-pairings / complete.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from badminton_rating.api.auth import current_player
from badminton_rating.api.routes.admin import is_admin_user
from badminton_rating.api.models.v1 import (
    PairingsOut,
    TournamentCreate,
    TournamentEntryOut,
    TournamentOut,
)
from badminton_rating.api.routes.v1_matches import _match_to_out
from badminton_rating.db.models import (
    Match,
    MatchPlayer,
    MatchStatus,
    MatchTypeDB,
    Player,
    PlayerCategoryRating,
    RatingCategory,
    Team,
    Tournament,
    TournamentEntry,
    TournamentStatus,
)
from badminton_rating.db.session import get_db
from badminton_rating.engine.ceiling import (
    CeilingInput,
    TournamentStrength,
    update_ceilings,
)
from badminton_rating.engine.glicko import to_display_rating
from badminton_rating.engine.pairing import (
    PairingEntry,
    PairingFormat,
    pair_by_skill,
)


router = APIRouter(prefix="/tournaments", tags=["tournaments"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _load_tournament_or_404(
    session: AsyncSession, tournament_id: int
) -> Tournament:
    t = await session.get(Tournament, tournament_id)
    if t is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"tournament {tournament_id} not found",
        )
    await session.refresh(t, attribute_names=["entries"])
    return t


def _to_out(t: Tournament) -> TournamentOut:
    return TournamentOut(
        id=t.id,
        name=t.name,
        format=t.format,
        ranked=t.ranked,
        starts_at=t.starts_at,
        ends_at=t.ends_at,
        status=t.status,
        organizer_user_id=t.organizer_user_id,
        entries=[TournamentEntryOut.model_validate(e) for e in t.entries],
    )


def _assert_organizer(t: Tournament, player: Player) -> None:
    if t.organizer_user_id is None or t.organizer_user_id != player.clerk_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="only the organizer can perform this action",
        )


# ---------------------------------------------------------------------------
# GET /tournaments — browse upcoming + in-progress
# ---------------------------------------------------------------------------

@router.get("", response_model=List[TournamentOut])
async def list_tournaments(
    session: AsyncSession = Depends(get_db),
) -> List[TournamentOut]:
    rows = (await session.execute(
        select(Tournament).order_by(Tournament.starts_at)
    )).scalars().all()
    out: List[TournamentOut] = []
    for t in rows:
        await session.refresh(t, attribute_names=["entries"])
        out.append(_to_out(t))
    return out


# ---------------------------------------------------------------------------
# POST /tournaments — create
# ---------------------------------------------------------------------------

@router.post("", response_model=TournamentOut, status_code=status.HTTP_201_CREATED)
async def create_tournament(
    payload: TournamentCreate,
    player: Player = Depends(current_player),
    session: AsyncSession = Depends(get_db),
) -> TournamentOut:
    # Anyone can host a casual tournament; ranked (officially weighted,
    # ceiling-unlocking) tournaments are admin-only.
    if payload.ranked and not is_admin_user(player.clerk_user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="only administrators can host ranked tournaments",
        )
    t = Tournament(
        name=payload.name,
        format=payload.format,
        ranked=payload.ranked,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        status=TournamentStatus.DRAFT,
        organizer_user_id=player.clerk_user_id,
    )
    session.add(t)
    await session.commit()
    await session.refresh(t, attribute_names=["entries"])
    return _to_out(t)


# ---------------------------------------------------------------------------
# GET /tournaments/{id}
# ---------------------------------------------------------------------------

@router.get("/{tournament_id}", response_model=TournamentOut)
async def get_tournament(
    tournament_id: int,
    session: AsyncSession = Depends(get_db),
) -> TournamentOut:
    t = await _load_tournament_or_404(session, tournament_id)
    return _to_out(t)


# ---------------------------------------------------------------------------
# POST /tournaments/{id}/entries — sign up current player
# ---------------------------------------------------------------------------

@router.post(
    "/{tournament_id}/entries",
    response_model=TournamentEntryOut,
    status_code=status.HTTP_201_CREATED,
)
async def signup(
    tournament_id: int,
    player: Player = Depends(current_player),
    session: AsyncSession = Depends(get_db),
) -> TournamentEntryOut:
    t = await _load_tournament_or_404(session, tournament_id)
    if t.status not in (TournamentStatus.DRAFT, TournamentStatus.OPEN):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="registration is closed",
        )
    existing = next(
        (e for e in t.entries if e.player_id == player.id and not e.withdrawn),
        None,
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="already entered",
        )
    entry = TournamentEntry(tournament_id=t.id, player_id=player.id)
    session.add(entry)
    await session.commit()
    await session.refresh(entry)
    return TournamentEntryOut.model_validate(entry)


# ---------------------------------------------------------------------------
# DELETE /tournaments/{id}/entries/me — withdraw
# ---------------------------------------------------------------------------

@router.delete(
    "/{tournament_id}/entries/me",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def withdraw(
    tournament_id: int,
    player: Player = Depends(current_player),
    session: AsyncSession = Depends(get_db),
) -> None:
    t = await _load_tournament_or_404(session, tournament_id)
    entry = next(
        (e for e in t.entries if e.player_id == player.id and not e.withdrawn),
        None,
    )
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="not entered in this tournament",
        )
    entry.withdrawn = True
    await session.commit()


# ---------------------------------------------------------------------------
# POST /tournaments/{id}/generate-pairings — organizer only
# ---------------------------------------------------------------------------

@router.post("/{tournament_id}/generate-pairings", response_model=PairingsOut)
async def generate_pairings(
    tournament_id: int,
    player: Player = Depends(current_player),
    session: AsyncSession = Depends(get_db),
) -> PairingsOut:
    t = await _load_tournament_or_404(session, tournament_id)
    _assert_organizer(t, player)
    if t.status is TournamentStatus.COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="tournament already completed",
        )

    active_entries = [e for e in t.entries if not e.withdrawn]
    if len(active_entries) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="need at least 2 active entries to pair",
        )

    # Build PairingEntry list from each entrant's current display rating.
    pids = [e.player_id for e in active_entries]
    rating_rows = (await session.execute(
        select(PlayerCategoryRating).where(
            PlayerCategoryRating.player_id.in_(pids),
            PlayerCategoryRating.category == RatingCategory.OVERALL,
        )
    )).scalars().all()
    ratings_by_pid = {r.player_id: r for r in rating_rows}

    pairing_entries = []
    for e in active_entries:
        r = ratings_by_pid.get(e.player_id)
        # Players who haven't played in this category yet seed at display 4.0
        # (matches the new-PlayerCategoryRating default).
        display = to_display_rating(r.r) if r else 4.0
        pairing_entries.append(
            PairingEntry(player_id=e.player_id, rating=display)
        )

    proposed = pair_by_skill(pairing_entries, PairingFormat(t.format.value))

    # Persist non-bye proposed matches as Match rows with status=PENDING
    # and tournament_id set. Singles only for now — doubles tournament
    # pairing is post-MVP (would need a separate pair-into-teams pass).
    created: List[Match] = []
    for prop in proposed:
        if prop.is_bye:
            continue
        match = Match(
            played_at=t.starts_at.date(),
            mode=__import__(
                "badminton_rating.db.models", fromlist=["MatchMode"]
            ).MatchMode.SINGLES,
            match_type=MatchTypeDB.TOURNAMENT,
            team_a_score=0,
            team_b_score=0,
            winner_team=Team.A,  # placeholder — overwritten when result is recorded
            category=RatingCategory.OVERALL,
            status=MatchStatus.PENDING,
            tournament_id=t.id,
            round=prop.round,
        )
        # Stash pre-rating snapshot
        a_row = ratings_by_pid.get(prop.player_a_id)
        b_row = ratings_by_pid.get(prop.player_b_id)
        # When pre-rating row doesn't exist, default to model starting r —
        # but the engine never runs without a rating row, so it's safe to
        # leave delta_r=0 here as a placeholder. The result-recording step
        # (Phase 2.6.1, not in this slice) populates real pre/post.
        session.add(match)
        await session.flush()
        for pid, team in (
            (prop.player_a_id, Team.A),
            (prop.player_b_id, Team.B),
        ):
            row = ratings_by_pid.get(pid)
            placeholder_r = row.r if row else 1333.34
            session.add(MatchPlayer(
                match_id=match.id,
                player_id=pid,
                team=team,
                pre_r=placeholder_r,
                pre_rd=row.rd if row else 350.0,
                pre_sigma=row.sigma if row else 0.06,
                post_r=placeholder_r,
                post_rd=row.rd if row else 350.0,
                post_sigma=row.sigma if row else 0.06,
                delta_r=0.0,
            ))
        created.append(match)

    if t.status is TournamentStatus.DRAFT or t.status is TournamentStatus.OPEN:
        t.status = TournamentStatus.IN_PROGRESS

    await session.commit()
    for m in created:
        await session.refresh(m, attribute_names=["participants"])
    return PairingsOut(matches=[_match_to_out(m) for m in created])


# ---------------------------------------------------------------------------
# POST /tournaments/{id}/complete — finalize ceilings
# ---------------------------------------------------------------------------

@router.post("/{tournament_id}/complete", response_model=TournamentOut)
async def complete_tournament(
    tournament_id: int,
    player: Player = Depends(current_player),
    session: AsyncSession = Depends(get_db),
    strength: TournamentStrength = TournamentStrength.CLUB,
) -> TournamentOut:
    t = await _load_tournament_or_404(session, tournament_id)
    _assert_organizer(t, player)
    if t.status is TournamentStatus.COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="already completed",
        )

    # Ceiling unlocks are the integrity story for *ranked* tournaments only.
    # Casual tournaments complete without touching anyone's cap.
    active_entries = [e for e in t.entries if not e.withdrawn]
    pids = [e.player_id for e in active_entries]
    if pids and t.ranked:
        rating_rows = (await session.execute(
            select(PlayerCategoryRating).where(
                PlayerCategoryRating.player_id.in_(pids),
                PlayerCategoryRating.category == RatingCategory.OVERALL,
            )
        )).scalars().all()
        rating_by_pid = {r.player_id: r for r in rating_rows}

        ceiling_inputs = []
        for e in active_entries:
            r = rating_by_pid.get(e.player_id)
            if r is None:
                continue
            ceiling_inputs.append(CeilingInput(
                player_id=e.player_id,
                old_ceiling=r.ceiling,
                achieved_display=to_display_rating(r.r),
            ))
        updates = update_ceilings(ceiling_inputs, strength)
        now = datetime.now(timezone.utc)
        for u in updates:
            row = rating_by_pid[u.player_id]
            if u.new_ceiling != u.old_ceiling:
                row.ceiling = u.new_ceiling
                row.ceiling_updated_at = now

    t.status = TournamentStatus.COMPLETED
    if t.ends_at is None:
        t.ends_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(t, attribute_names=["entries"])
    return _to_out(t)
