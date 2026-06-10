"""
Pydantic schemas for player-facing endpoints.

Two-layer design:
  - ModeRating: the bundle we show per mode (singles or doubles)
  - PlayerOut: a player's identity + both mode ratings

Keeps the response shape symmetric and lets the frontend render either
rating with the same component.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class PlayerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: Optional[EmailStr] = None


class ModeRating(BaseModel):
    """Everything the UI needs to render one player's rating for one mode."""
    r: float                      # internal Glicko r (debug / audit)
    rd: float                     # rating deviation
    sigma: float                  # volatility
    display: float                # 2.0–8.0 scale
    tier: str                     # e.g. "Gold II"
    calibrating: bool             # rd > 150
    matches_needed: int           # heuristic estimate to stabilize
    match_count: int
    last_active: Optional[date]


class PlayerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    created_at: datetime
    singles: ModeRating
    doubles: ModeRating


class ForecastOut(BaseModel):
    """Pre-match win-probability response."""
    player_id: int
    opponent_id: int
    mode: str
    player_display: float
    opponent_display: float
    win_probability: float        # 0.0–1.0, from player's perspective
    player_calibrating: bool
    opponent_calibrating: bool
