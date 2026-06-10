"""
Pydantic schemas for match-related endpoints.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import List

from pydantic import BaseModel, ConfigDict, Field, field_validator

from badminton_rating.db.models import MatchMode, MatchTypeDB, Team


class MatchCreate(BaseModel):
    mode: MatchMode
    match_type: MatchTypeDB
    played_at: date
    team_a_player_ids: List[int] = Field(min_length=1, max_length=2)
    team_b_player_ids: List[int] = Field(min_length=1, max_length=2)
    team_a_score: int = Field(ge=0, le=99)
    team_b_score: int = Field(ge=0, le=99)

    @field_validator("team_a_score", "team_b_score")
    @classmethod
    def _scores_are_ints(cls, v: int) -> int:
        return v


class MatchPlayerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    player_id: int
    team: Team
    pre_r: float
    post_r: float
    pre_rd: float
    post_rd: float
    delta_r: float


class MatchOut(BaseModel):
    """Match record + per-participant audit rows."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    played_at: date
    created_at: datetime
    mode: MatchMode
    match_type: MatchTypeDB
    team_a_score: int
    team_b_score: int
    winner_team: Team
    participants: List[MatchPlayerOut]
