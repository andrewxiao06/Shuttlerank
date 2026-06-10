from __future__ import annotations

from typing import List

from pydantic import BaseModel


class LeaderboardEntry(BaseModel):
    rank: int
    player_id: int
    name: str
    display: float
    tier: str
    rd: float
    calibrating: bool
    match_count: int


class LeaderboardOut(BaseModel):
    mode: str
    total: int
    limit: int
    offset: int
    entries: List[LeaderboardEntry]
