"""
Player routes — CRUD + forecast + match history.
"""

from __future__ import annotations

import math
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from badminton_rating.api.models.matches import MatchOut, MatchPlayerOut
from badminton_rating.api.models.players import (
    ForecastOut,
    PlayerCreate,
    PlayerOut,
)
from badminton_rating.api.serializers import mode_fields, player_to_out
from badminton_rating.db.models import (
    Match,
    MatchMode,
    MatchPlayer,
    Player,
)
from badminton_rating.db.session import get_db
from badminton_rating.engine.glicko import (
    GLICKO_SCALE,
    INITIAL_R,
    expected_score,
    to_display_rating,
)


router = APIRouter(prefix="/players", tags=["players"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_or_404(session: AsyncSession, player_id: int) -> Player:
    player = await session.get(Player, player_id)
    if player is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"player {player_id} not found",
        )
    return player


# ---------------------------------------------------------------------------
# POST /players  — create
# ---------------------------------------------------------------------------

@router.post("", response_model=PlayerOut, status_code=status.HTTP_201_CREATED)
async def create_player(
    payload: PlayerCreate,
    session: AsyncSession = Depends(get_db),
) -> PlayerOut:
    player = Player(name=payload.name, email=payload.email)
    session.add(player)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="email already registered",
        )
    await session.refresh(player)
    return player_to_out(player)


# ---------------------------------------------------------------------------
# GET /players/{id}
# ---------------------------------------------------------------------------

@router.get("/{player_id}", response_model=PlayerOut)
async def get_player(
    player_id: int,
    session: AsyncSession = Depends(get_db),
) -> PlayerOut:
    player = await _get_or_404(session, player_id)
    return player_to_out(player)


# ---------------------------------------------------------------------------
# GET /players/{id}/forecast?opponent_id=X&mode=singles
# ---------------------------------------------------------------------------

@router.get("/{player_id}/forecast", response_model=ForecastOut)
async def forecast(
    player_id: int,
    opponent_id: int = Query(..., description="ID of the opponent to forecast against"),
    mode: MatchMode = Query(MatchMode.SINGLES),
    session: AsyncSession = Depends(get_db),
) -> ForecastOut:
    if player_id == opponent_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="player and opponent must be different",
        )

    player = await _get_or_404(session, player_id)
    opponent = await _get_or_404(session, opponent_id)

    p_r, p_rd, _, _, _ = mode_fields(player, mode)
    o_r, o_rd, _, _, _ = mode_fields(opponent, mode)

    mu_p = (p_r - INITIAL_R) / GLICKO_SCALE
    mu_o = (o_r - INITIAL_R) / GLICKO_SCALE
    phi_o = o_rd / GLICKO_SCALE

    win_p = expected_score(mu_p, mu_o, phi_o)

    return ForecastOut(
        player_id=player_id,
        opponent_id=opponent_id,
        mode=mode.value,
        player_display=to_display_rating(p_r),
        opponent_display=to_display_rating(o_r),
        win_probability=round(win_p, 4),
        player_calibrating=p_rd > 150.0,
        opponent_calibrating=o_rd > 150.0,
    )


# ---------------------------------------------------------------------------
# GET /players/{id}/matches?limit=20&offset=0&mode=singles
# ---------------------------------------------------------------------------

@router.get("/{player_id}/matches", response_model=List[MatchOut])
async def player_matches(
    player_id: int,
    mode: MatchMode | None = Query(None, description="Filter by singles/doubles"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_db),
) -> List[MatchOut]:
    await _get_or_404(session, player_id)

    # Find match IDs this player appears in
    mp_stmt = select(MatchPlayer.match_id).where(MatchPlayer.player_id == player_id)
    match_ids = (await session.execute(mp_stmt)).scalars().all()
    if not match_ids:
        return []

    stmt = (
        select(Match)
        .where(Match.id.in_(match_ids))
        .order_by(desc(Match.played_at), desc(Match.id))
        .limit(limit)
        .offset(offset)
    )
    if mode is not None:
        stmt = stmt.where(Match.mode == mode)

    matches = (await session.execute(stmt)).scalars().all()

    out: List[MatchOut] = []
    for m in matches:
        # Eager-load participants
        await session.refresh(m, attribute_names=["participants"])
        out.append(MatchOut(
            id=m.id,
            played_at=m.played_at,
            created_at=m.created_at,
            mode=m.mode,
            match_type=m.match_type,
            team_a_score=m.team_a_score,
            team_b_score=m.team_b_score,
            winner_team=m.winner_team,
            participants=[MatchPlayerOut.model_validate(p) for p in m.participants],
        ))
    return out
