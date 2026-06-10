"""
Leaderboard route — paginated ranking by display rating, filtered by mode.

Calibrating players are included by default but flagged so the UI can
deprioritize them visually.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from badminton_rating.api.models.leaderboard import (
    LeaderboardEntry,
    LeaderboardOut,
)
from badminton_rating.db.models import MatchMode, Player
from badminton_rating.db.session import get_db
from badminton_rating.engine.glicko import get_tier, to_display_rating


router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])


@router.get("", response_model=LeaderboardOut)
async def leaderboard(
    mode: MatchMode = Query(MatchMode.SINGLES),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    min_matches: int = Query(0, ge=0, description="Exclude players below this match count"),
    session: AsyncSession = Depends(get_db),
) -> LeaderboardOut:
    if mode is MatchMode.SINGLES:
        rating_col = Player.singles_r
        rd_col = Player.singles_rd
        count_col = Player.singles_match_count
    else:
        rating_col = Player.doubles_r
        rd_col = Player.doubles_rd
        count_col = Player.doubles_match_count

    base = select(Player).where(count_col >= min_matches)

    total = (await session.execute(
        select(func.count()).select_from(base.subquery())
    )).scalar_one()

    stmt = (
        base.order_by(desc(rating_col), desc(count_col))
        .limit(limit)
        .offset(offset)
    )
    players = (await session.execute(stmt)).scalars().all()

    entries = []
    for i, p in enumerate(players):
        r = p.singles_r if mode is MatchMode.SINGLES else p.doubles_r
        rd = p.singles_rd if mode is MatchMode.SINGLES else p.doubles_rd
        mc = p.singles_match_count if mode is MatchMode.SINGLES else p.doubles_match_count
        display = to_display_rating(r)
        entries.append(LeaderboardEntry(
            rank=offset + i + 1,
            player_id=p.id,
            name=p.name,
            display=display,
            tier=get_tier(display),
            rd=rd,
            calibrating=rd > 150.0,
            match_count=mc,
        ))

    return LeaderboardOut(
        mode=mode.value,
        total=total,
        limit=limit,
        offset=offset,
        entries=entries,
    )
