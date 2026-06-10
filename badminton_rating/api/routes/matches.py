"""
Match submission route — thin wrapper around services.matches.submit_match.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from badminton_rating.api.models.matches import (
    MatchCreate,
    MatchOut,
    MatchPlayerOut,
)
from badminton_rating.db.session import get_db
from badminton_rating.services.matches import (
    MatchSubmission,
    MatchSubmissionError,
    submit_match,
)


router = APIRouter(prefix="/matches", tags=["matches"])


@router.post("", response_model=MatchOut, status_code=status.HTTP_201_CREATED)
async def create_match(
    payload: MatchCreate,
    session: AsyncSession = Depends(get_db),
) -> MatchOut:
    sub = MatchSubmission(
        mode=payload.mode,
        match_type=payload.match_type,
        played_at=payload.played_at,
        team_a_player_ids=payload.team_a_player_ids,
        team_b_player_ids=payload.team_b_player_ids,
        team_a_score=payload.team_a_score,
        team_b_score=payload.team_b_score,
    )

    try:
        match = await submit_match(session, sub)
    except MatchSubmissionError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    await session.commit()
    await session.refresh(match, attribute_names=["participants"])

    return MatchOut(
        id=match.id,
        played_at=match.played_at,
        created_at=match.created_at,
        mode=match.mode,
        match_type=match.match_type,
        team_a_score=match.team_a_score,
        team_b_score=match.team_b_score,
        winner_team=match.winner_team,
        participants=[MatchPlayerOut.model_validate(p) for p in match.participants],
    )
