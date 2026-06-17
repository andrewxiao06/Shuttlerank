"""
V1 player search + lookup.

The submit-match flow on the frontend needs to look up other players by
name (and filter by eligible genders per category). Existing /players
endpoints don't expose that, so we add a thin search here that returns
the same PlayerMeOut shape used by /players/me.
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from pydantic import BaseModel, Field

from badminton_rating.api.auth import _resolve_clerk_user_id
from badminton_rating.api.models.v1 import (
    CategoryMatchOut,
    PlayerMeOut,
)
from badminton_rating.api.routes.admin import is_admin_user
from badminton_rating.api.routes.me import _category_ratings
from badminton_rating.api.routes.v1_matches import _participant_out
from badminton_rating.db.models import (
    Match,
    MatchPlayer,
    Player,
    PlayerGender,
    RatingCategory,
)
from badminton_rating.db.session import get_db
from fastapi import Header


router = APIRouter(prefix="/v1/players", tags=["v1-players"])


class BootstrapBody(BaseModel):
    """
    Minimal profile data the client gathers from Clerk's `useUser()` and
    posts when /players/me returns 403 (no Player row yet). Gender is
    optional — users can fill it later via PATCH /players/me.
    """
    name: str = Field(..., min_length=1, max_length=120)
    display_name: str | None = Field(None, max_length=120)
    email: str | None = Field(None, max_length=320)
    gender: PlayerGender | None = None


@router.post(
    "/bootstrap",
    response_model=PlayerMeOut,
    status_code=status.HTTP_200_OK,
)
async def bootstrap_current_player(
    body: BootstrapBody,
    session: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(None),
    x_clerk_user_id: Optional[str] = Header(None),
) -> PlayerMeOut:
    """
    Idempotent create-or-return for the authenticated Clerk user.

    Path 1 (production) — Clerk webhook creates the Player row on
    user.created. Bootstrap is a no-op (returns existing row).

    Path 2 (local dev or webhook miss) — no row exists yet, bootstrap
    creates one from the body the client supplies. The frontend already
    has name/email via Clerk's `useUser()`, so no Clerk SDK call needed.

    Returns the same shape as /players/me so the frontend can swap one
    for the other without re-mapping.
    """
    user_id = await _resolve_clerk_user_id(
        authorization, x_clerk_user_id, required=True
    )
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing or invalid Clerk session token",
        )

    existing = (await session.execute(
        select(Player).where(Player.clerk_user_id == user_id)
    )).scalar_one_or_none()
    if existing is None:
        existing = Player(
            clerk_user_id=user_id,
            name=body.name,
            display_name=body.display_name or body.name,
            email=body.email,
            gender=body.gender,
        )
        session.add(existing)
        await session.commit()
        await session.refresh(existing)

    return PlayerMeOut(
        id=existing.id,
        clerk_user_id=existing.clerk_user_id,
        name=existing.name,
        display_name=existing.display_name,
        email=existing.email,
        gender=existing.gender,
        created_at=existing.created_at,
        ratings=await _category_ratings(session, existing.id),
        is_admin=is_admin_user(existing.clerk_user_id),
    )


@router.get("", response_model=List[PlayerMeOut])
async def search_players(
    session: AsyncSession = Depends(get_db),
    q: Optional[str] = Query(None, max_length=120),
    limit: int = Query(10, ge=1, le=50),
) -> List[PlayerMeOut]:
    """
    Search players by partial name (case-insensitive). Anyone can play
    anyone — no gender filtering.
    """
    stmt = select(Player)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                Player.name.ilike(like),
                Player.display_name.ilike(like),
            )
        )
    stmt = stmt.order_by(Player.name).limit(limit)

    players = (await session.execute(stmt)).scalars().all()
    return [
        PlayerMeOut(
            id=p.id,
            clerk_user_id=p.clerk_user_id,
            name=p.name,
            display_name=p.display_name,
            email=p.email,
            gender=p.gender,
            created_at=p.created_at,
            ratings=await _category_ratings(session, p.id),
        )
        for p in players
    ]


@router.get("/{player_id}/matches", response_model=List[CategoryMatchOut])
async def list_player_matches(
    player_id: int,
    session: AsyncSession = Depends(get_db),
    category: Optional[RatingCategory] = Query(None),
    limit: int = Query(50, ge=1, le=200),
) -> List[CategoryMatchOut]:
    """
    Matches involving a given player, returned in the v1 CategoryMatch
    shape (status, category, per-participant pre/post/delta). Powers the
    profile screen's match list + history chart.
    """
    stmt = (
        select(Match)
        .join(MatchPlayer, MatchPlayer.match_id == Match.id)
        .where(MatchPlayer.player_id == player_id)
        .options(selectinload(Match.participants))
        .order_by(Match.played_at.desc(), Match.id.desc())
        .limit(limit)
    )
    if category is not None:
        stmt = stmt.where(Match.category == category)

    matches = (await session.execute(stmt)).scalars().unique().all()
    return [
        CategoryMatchOut(
            id=m.id,
            category=m.category,
            status=m.status,
            played_at=m.played_at,
            team_a_score=m.team_a_score,
            team_b_score=m.team_b_score,
            winner_team=m.winner_team.value if hasattr(m.winner_team, "value") else m.winner_team,
            submitted_by_user_id=m.submitted_by_user_id,
            verified_at=m.verified_at,
            expires_at=m.expires_at,
            tournament_id=m.tournament_id,
            participants=[_participant_out(p) for p in m.participants],
        )
        for m in matches
    ]


@router.get("/{player_id}", response_model=PlayerMeOut)
async def get_v1_player(
    player_id: int,
    session: AsyncSession = Depends(get_db),
) -> PlayerMeOut:
    """Public profile lookup — same shape as /players/me, but for any id."""
    player = (await session.execute(
        select(Player).where(Player.id == player_id)
    )).scalar_one_or_none()
    if player is None:
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"player {player_id} not found",
        )
    return PlayerMeOut(
        id=player.id,
        clerk_user_id=player.clerk_user_id,
        name=player.name,
        display_name=player.display_name,
        email=player.email,
        gender=player.gender,
        created_at=player.created_at,
        ratings=await _category_ratings(session, player.id),
    )
