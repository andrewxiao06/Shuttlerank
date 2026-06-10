"""
Pydantic schemas for the v1 (category-routed) API surface.

Separate from `api/models/players.py` etc. so the v0 contract is
unchanged during the additive migration window.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from badminton_rating.db.models import (
    MatchStatus,
    PlayerGender,
    RatingCategory,
    ReportReason,
    ReportStatus,
    TournamentFormat,
    TournamentStatus,
    ValidationAction,
)


# ---------------------------------------------------------------------------
# Player profile (v1)
# ---------------------------------------------------------------------------

class CategoryRatingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    category: RatingCategory
    r: float
    rd: float
    display: float
    tier: str
    calibrating: bool
    ceiling: float
    match_count: int
    last_active: Optional[date]


class PlayerMeOut(BaseModel):
    id: int
    clerk_user_id: Optional[str]
    name: str
    display_name: Optional[str]
    email: Optional[str]
    gender: Optional[PlayerGender]
    created_at: datetime
    # Single-element list holding the player's one OVERALL rating. Kept as a
    # list so the response shape survives any future multi-rating revival.
    ratings: List[CategoryRatingOut]
    # True when the player may host ranked tournaments (BRS_ADMIN_USER_IDS).
    is_admin: bool = False


class PlayerMePatch(BaseModel):
    display_name: Optional[str] = Field(None, max_length=120)
    gender: Optional[PlayerGender] = None


# ---------------------------------------------------------------------------
# Clerk webhook payloads (minimal — only the fields we need)
# ---------------------------------------------------------------------------

class ClerkEmailAddress(BaseModel):
    email_address: str


class ClerkUserData(BaseModel):
    id: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email_addresses: List[ClerkEmailAddress] = []


class ClerkWebhookEvent(BaseModel):
    type: str
    data: ClerkUserData


# ---------------------------------------------------------------------------
# Matches (v1)
# ---------------------------------------------------------------------------

class CategoryMatchCreate(BaseModel):
    played_at: date
    team_a_player_ids: List[int] = Field(..., min_length=1, max_length=2)
    team_b_player_ids: List[int] = Field(..., min_length=1, max_length=2)
    team_a_score: int = Field(..., ge=0)
    team_b_score: int = Field(..., ge=0)


class MatchParticipantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    player_id: int
    team: str
    pre_r: float
    post_r: float
    delta_r: float


class CategoryMatchOut(BaseModel):
    id: int
    category: Optional[RatingCategory]
    status: Optional[MatchStatus]
    played_at: date
    team_a_score: int
    team_b_score: int
    winner_team: str
    submitted_by_user_id: Optional[str]
    verified_at: Optional[datetime]
    expires_at: Optional[datetime]
    tournament_id: Optional[int]
    participants: List[MatchParticipantOut]


# ---------------------------------------------------------------------------
# Validation + reports
# ---------------------------------------------------------------------------

class ValidationCreate(BaseModel):
    action: ValidationAction
    note: Optional[str] = Field(None, max_length=500)


class ValidationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: str
    action: ValidationAction
    acted_at: datetime
    note: Optional[str]


class ReportCreate(BaseModel):
    reason: ReportReason
    description: Optional[str] = Field(None, max_length=500)


class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    match_id: int
    reporter_user_id: str
    reason: ReportReason
    description: Optional[str]
    status: ReportStatus
    created_at: datetime


class ReportPatch(BaseModel):
    status: ReportStatus


# ---------------------------------------------------------------------------
# Leaderboard (v1)
# ---------------------------------------------------------------------------

class CategoryLeaderboardEntry(BaseModel):
    rank: int
    player_id: int
    name: str
    display: float
    tier: str
    rd: float
    calibrating: bool
    ceiling: float
    match_count: int


class CategoryLeaderboardOut(BaseModel):
    category: RatingCategory = RatingCategory.OVERALL
    total: int
    limit: int
    offset: int
    entries: List[CategoryLeaderboardEntry]


# ---------------------------------------------------------------------------
# Tournaments
# ---------------------------------------------------------------------------

class TournamentCreate(BaseModel):
    name: str = Field(..., max_length=200)
    format: TournamentFormat
    # Ranked tournaments require admin privileges to create.
    ranked: bool = False
    starts_at: datetime
    ends_at: Optional[datetime] = None


class TournamentEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    player_id: int
    seed: Optional[int]
    withdrawn: bool


class TournamentOut(BaseModel):
    id: int
    name: str
    format: TournamentFormat
    ranked: bool
    starts_at: datetime
    ends_at: Optional[datetime]
    status: TournamentStatus
    organizer_user_id: Optional[str]
    entries: List[TournamentEntryOut]


class PairingsOut(BaseModel):
    matches: List[CategoryMatchOut]


# ---------------------------------------------------------------------------
# Forecast (v1)
# ---------------------------------------------------------------------------

class CategoryForecastOut(BaseModel):
    player_id: int
    opponent_id: int
    player_display: float
    opponent_display: float
    win_probability: float
    player_calibrating: bool
    opponent_calibrating: bool
