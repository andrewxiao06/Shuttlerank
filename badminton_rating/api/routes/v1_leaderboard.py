"""
V1 leaderboard + forecast — category-aware versions.
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
    Player,
    PlayerCategoryRating,
    RatingCategory,
)
from badminton_rating.db.session import get_db
from badminton_rating.engine.glicko import (
    GLICKO_SCALE,
    INITIAL_R,
    expected_score,
    get_tier,
    to_display_rating,
)


router = APIRouter(prefix="/v1", tags=["v1-leaderboard"])


@router.get("/leaderboard", response_model=CategoryLeaderboardOut)
async def category_leaderboard(
    category: RatingCategory = Query(...),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    min_matches: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_db),
) -> CategoryLeaderboardOut:
    base = (
        select(PlayerCategoryRating, Player)
        .join(Player, PlayerCategoryRating.player_id == Player.id)
        .where(PlayerCategoryRating.category == category)
        .where(PlayerCategoryRating.match_count >= min_matches)
    )

    total_stmt = (
        select(func.count())
        .select_from(PlayerCategoryRating)
        .where(PlayerCategoryRating.category == category)
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
        ))
    return CategoryLeaderboardOut(
        category=category,
        total=total,
        limit=limit,
        offset=offset,
        entries=entries,
    )


@router.get(
    "/players/{player_id}/forecast",
    response_model=CategoryForecastOut,
)
async def category_forecast(
    player_id: int,
    opponent_id: int = Query(...),
    category: RatingCategory = Query(...),
    session: AsyncSession = Depends(get_db),
) -> CategoryForecastOut:
    if player_id == opponent_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="player and opponent must be different",
        )

    rows = (await session.execute(
        select(PlayerCategoryRating).where(
            PlayerCategoryRating.player_id.in_([player_id, opponent_id]),
            PlayerCategoryRating.category == category,
        )
    )).scalars().all()
    by_pid = {r.player_id: r for r in rows}

    p_row = by_pid.get(player_id)
    o_row = by_pid.get(opponent_id)
    if p_row is None or o_row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="one or both players have no rating in this category",
        )

    mu_p = (p_row.r - INITIAL_R) / GLICKO_SCALE
    mu_o = (o_row.r - INITIAL_R) / GLICKO_SCALE
    phi_o = o_row.rd / GLICKO_SCALE
    win_p = expected_score(mu_p, mu_o, phi_o)

    return CategoryForecastOut(
        player_id=player_id,
        opponent_id=opponent_id,
        category=category,
        player_display=to_display_rating(p_row.r),
        opponent_display=to_display_rating(o_row.r),
        win_probability=round(win_p, 4),
        player_calibrating=p_row.rd > 150.0,
        opponent_calibrating=o_row.rd > 150.0,
    )
