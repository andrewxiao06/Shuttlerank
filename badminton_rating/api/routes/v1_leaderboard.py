"""
V1 leaderboard + forecast — per-format (Singles / Doubles) ratings.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from badminton_rating.api.models.v1 import (
    CategoryForecastOut,
    CategoryLeaderboardEntry,
    CategoryLeaderboardOut,
)
from badminton_rating.db.models import (
    INITIAL_CEILING,
    Player,
    PlayerCategoryRating,
    RatingCategory,
)
from badminton_rating.db.session import get_db
from badminton_rating.services.categories import effective_rating
from badminton_rating.engine.glicko import (
    GLICKO_SCALE,
    INITIAL_R,
    INITIAL_RD,
    expected_score,
    from_display_rating,
    get_tier,
    to_display_rating,
)


router = APIRouter(prefix="/v1", tags=["v1-leaderboard"])


def _parse_category(value: str) -> RatingCategory:
    """Resolve the ?category= query param to a played category."""
    try:
        cat = RatingCategory(value)
    except ValueError:
        cat = None
    if cat not in (RatingCategory.SINGLES, RatingCategory.DOUBLES):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="category must be 'singles' or 'doubles'",
        )
    return cat


@router.get("/leaderboard", response_model=CategoryLeaderboardOut)
async def overall_leaderboard(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    min_matches: int = Query(0, ge=0),
    category: str = Query("singles"),
    session: AsyncSession = Depends(get_db),
) -> CategoryLeaderboardOut:
    cat = _parse_category(category)
    base = (
        select(PlayerCategoryRating, Player)
        .join(Player, PlayerCategoryRating.player_id == Player.id)
        .where(PlayerCategoryRating.category == cat)
        .where(PlayerCategoryRating.match_count >= min_matches)
    )

    total_stmt = (
        select(func.count())
        .select_from(PlayerCategoryRating)
        .where(PlayerCategoryRating.category == cat)
        .where(PlayerCategoryRating.match_count >= min_matches)
    )
    total = (await session.execute(total_stmt)).scalar_one()

    stmt = (
        base.order_by(
            desc(PlayerCategoryRating.r),
            desc(PlayerCategoryRating.match_count),
        )
        .limit(limit)
        .offset(offset)
    )
    rows = (await session.execute(stmt)).all()

    entries = []
    for i, (rating, player) in enumerate(rows):
        display = to_display_rating(rating.r)
        entries.append(CategoryLeaderboardEntry(
            rank=offset + i + 1,
            player_id=player.id,
            name=player.display_name or player.name,
            display=display,
            tier=get_tier(display),
            rd=rating.rd,
            calibrating=rating.rd > 150.0,
            ceiling=rating.ceiling,
            match_count=rating.match_count,
            avatar_url=player.avatar_url,
            age=player.age,
            location=player.location,
        ))
    return CategoryLeaderboardOut(
        category=cat,
        total=total,
        limit=limit,
        offset=offset,
        entries=entries,
    )


# Players who haven't played yet forecast from the same defaults a fresh
# rating row would get — display = INITIAL_CEILING, fully uncertain.
_DEFAULT_R = from_display_rating(INITIAL_CEILING)


@router.get(
    "/players/{player_id}/forecast",
    response_model=CategoryForecastOut,
)
async def overall_forecast(
    player_id: int,
    opponent_id: int = Query(...),
    category: str = Query("singles"),
    session: AsyncSession = Depends(get_db),
) -> CategoryForecastOut:
    if player_id == opponent_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="player and opponent must be different",
        )
    cat = _parse_category(category)

    # Both players must exist — but missing rating rows are fine; any two
    # players can be forecast against each other (seeded values are used).
    players = (await session.execute(
        select(Player.id).where(Player.id.in_([player_id, opponent_id]))
    )).scalars().all()
    missing = {player_id, opponent_id} - set(players)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"player(s) not found: {sorted(missing)}",
        )

    p_eff = await effective_rating(session, player_id, cat)
    o_eff = await effective_rating(session, opponent_id, cat)
    p_r, p_rd = p_eff.r, p_eff.rd
    o_r, o_rd = o_eff.r, o_eff.rd

    mu_p = (p_r - INITIAL_R) / GLICKO_SCALE
    mu_o = (o_r - INITIAL_R) / GLICKO_SCALE
    phi_o = o_rd / GLICKO_SCALE
    win_p = expected_score(mu_p, mu_o, phi_o)

    return CategoryForecastOut(
        player_id=player_id,
        opponent_id=opponent_id,
        player_display=to_display_rating(p_r),
        opponent_display=to_display_rating(o_r),
        win_probability=round(win_p, 4),
        player_calibrating=p_rd > 150.0,
        opponent_calibrating=o_rd > 150.0,
    )
