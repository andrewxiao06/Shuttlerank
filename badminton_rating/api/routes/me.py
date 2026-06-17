"""
Current-player routes: GET /players/me and PATCH /players/me.

Identity comes from the Clerk session token (see api/auth.py). The
category ratings sub-resource is hydrated lazily — we load every
PlayerCategoryRating row for the player and project each through the
engine's display-rating helpers.
"""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from badminton_rating.api.auth import current_player
from badminton_rating.api.models.v1 import (
    CategoryRatingOut,
    PlayerMeOut,
    PlayerMePatch,
)
from fastapi import HTTPException, status

from badminton_rating.api.routes.admin import is_admin_user
from badminton_rating.db.models import (
    DEFAULT_START_DISPLAY,
    INITIAL_CEILING,
    SELF_PICK_MAX,
    SELF_PICK_MIN,
    Player,
    PlayerCategoryRating,
    RatingCategory,
)
from badminton_rating.db.session import get_db
from badminton_rating.engine.glicko import (
    INITIAL_RD,
    from_display_rating,
    get_tier,
    to_display_rating,
)


router = APIRouter(prefix="/players", tags=["players"])


async def _category_ratings(
    session: AsyncSession, player_id: int
) -> List[CategoryRatingOut]:
    """The player's single OVERALL rating, as a one-element list.

    Players who haven't played yet get the same defaults a fresh rating row
    would have, so every profile (and forecast) always shows a rating.
    """
    row = (await session.execute(
        select(PlayerCategoryRating).where(
            PlayerCategoryRating.player_id == player_id,
            PlayerCategoryRating.category == RatingCategory.OVERALL,
        )
    )).scalar_one_or_none()
    if row is None:
        # Unplaced player — show the beginner default; onboarding nudges them
        # to self-pick their real level before they start playing.
        display = DEFAULT_START_DISPLAY
        return [CategoryRatingOut(
            category=RatingCategory.OVERALL,
            r=from_display_rating(display),
            rd=INITIAL_RD,
            display=display,
            tier=get_tier(display),
            calibrating=True,
            ceiling=INITIAL_CEILING,
            match_count=0,
            last_active=None,
        )]
    display = to_display_rating(row.r)
    return [CategoryRatingOut(
        category=row.category,
        r=row.r,
        rd=row.rd,
        display=display,
        tier=get_tier(display),
        calibrating=row.rd > 150.0,
        ceiling=row.ceiling,
        match_count=row.match_count,
        last_active=row.last_active,
    )]


async def _set_starting_rating(
    session: AsyncSession, player_id: int, display: float
) -> None:
    """Set the player's self-selected starting level.

    Only allowed before any rated play (match_count == 0) so it can't be used
    to reset a rating mid-season. Capped at the casual ceiling — 5.0+ comes
    only from ranked tournaments / admin.
    """
    if display < SELF_PICK_MIN or display > SELF_PICK_MAX:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"starting rating must be between {SELF_PICK_MIN} and {SELF_PICK_MAX}",
        )
    row = (await session.execute(
        select(PlayerCategoryRating).where(
            PlayerCategoryRating.player_id == player_id,
            PlayerCategoryRating.category == RatingCategory.OVERALL,
        )
    )).scalar_one_or_none()
    if row is not None and row.match_count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="starting rating can only be set before your first match",
        )
    if row is None:
        row = PlayerCategoryRating(
            player_id=player_id, category=RatingCategory.OVERALL
        )
        session.add(row)
    row.r = from_display_rating(display)
    # Keep uncertainty high so match results still move the rating quickly —
    # the self-pick is a starting point, not a locked value.
    row.rd = INITIAL_RD
    row.ceiling = INITIAL_CEILING
    await session.flush()


@router.get("/me", response_model=PlayerMeOut)
async def get_me(
    player: Player = Depends(current_player),
    session: AsyncSession = Depends(get_db),
) -> PlayerMeOut:
    return PlayerMeOut(
        id=player.id,
        clerk_user_id=player.clerk_user_id,
        name=player.name,
        display_name=player.display_name,
        email=player.email,
        gender=player.gender,
        created_at=player.created_at,
        ratings=await _category_ratings(session, player.id),
        is_admin=is_admin_user(player.clerk_user_id),
    )


@router.patch("/me", response_model=PlayerMeOut)
async def patch_me(
    payload: PlayerMePatch,
    player: Player = Depends(current_player),
    session: AsyncSession = Depends(get_db),
) -> PlayerMeOut:
    if payload.display_name is not None:
        player.display_name = payload.display_name
    if payload.gender is not None:
        player.gender = payload.gender
    if payload.starting_rating is not None:
        await _set_starting_rating(session, player.id, payload.starting_rating)
    await session.commit()
    await session.refresh(player)
    return PlayerMeOut(
        id=player.id,
        clerk_user_id=player.clerk_user_id,
        name=player.name,
        display_name=player.display_name,
        email=player.email,
        gender=player.gender,
        created_at=player.created_at,
        ratings=await _category_ratings(session, player.id),
        is_admin=is_admin_user(player.clerk_user_id),
    )
