"""
SQLAlchemy 2.0 ORM models for the BRS persistence layer.

Schema philosophy
-----------------
V0 (current MVP):
- `players` denormalizes singles/doubles ratings onto the row for fast reads.
- `matches` stores the immutable match record.
- `match_players` is the per-participant audit row.

V1 (this phase, additive):
- `player_ratings` is a child table keyed by (player_id, category) that will
  eventually replace `players.singles_*` / `doubles_*`. For now both exist;
  the v0 columns stay in use until Phase 2.5 flips the engine.
- `matches` gains validation state (`status`, `verified_at`, `expires_at`) so
  ranked matches can require approval from all participants.
- `match_validations` records per-user approve/dispute actions.
- `match_reports` records falsification complaints.
- `tournaments` + `tournament_entries` model the tournament system.
- `ceiling_history` audits every DUPR-style rating-cap unlock.

All v1 columns and tables are nullable / independent so existing code paths
keep working. See PLAN.md for the migration plan.
"""

from __future__ import annotations

import enum
from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def Enum(*args, **kwargs):  # noqa: N802 — preserve the SQLAlchemy capitalization
    """
    Drop-in replacement for `sqlalchemy.Enum` that uses our Python enum
    *values* (lowercase strings) when serializing to a native Postgres
    enum type.

    Default SQLAlchemy behavior sends the enum *name* (e.g. `MENS_SINGLES`),
    which doesn't match the Postgres enum type our migrations create from
    the lowercase values (e.g. `mens_singles`). On Postgres that produces
    `InvalidTextRepresentationError`; SQLite ignores the mismatch entirely,
    which is why the test suite missed this until the first real-DB run.
    """
    kwargs.setdefault("values_callable", lambda enum_cls: [e.value for e in enum_cls])
    return SAEnum(*args, **kwargs)

from badminton_rating.engine.glicko import (
    INITIAL_R,
    INITIAL_RD,
    INITIAL_SIGMA,
    PlayerRating,
    from_display_rating,
)


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# V0 enums — still in use by the live engine and service layer.
# ---------------------------------------------------------------------------

class MatchMode(str, enum.Enum):
    SINGLES = "singles"
    DOUBLES = "doubles"


class MatchTypeDB(str, enum.Enum):
    CASUAL = "casual"
    CLUB = "club"
    TOURNAMENT = "tournament"


class Team(str, enum.Enum):
    A = "A"
    B = "B"


# ---------------------------------------------------------------------------
# V1 enums — used by new tables and the v1 columns on existing tables.
# ---------------------------------------------------------------------------

class PlayerGender(str, enum.Enum):
    """Competition gender. X = unspecified — eligible for casual only."""
    M = "M"
    W = "W"
    X = "X"


class RatingCategory(str, enum.Enum):
    """
    Rating buckets. OVERALL is the only bucket written today — every player
    has exactly one rating regardless of format or gender. The legacy
    gendered/casual values remain so historical match rows still deserialize.
    """
    OVERALL = "overall"
    # Legacy values — read-only, kept for old rows.
    MENS_SINGLES = "mens_singles"
    WOMENS_SINGLES = "womens_singles"
    MENS_DOUBLES = "mens_doubles"
    WOMENS_DOUBLES = "womens_doubles"
    MIXED_DOUBLES = "mixed_doubles"
    CASUAL = "casual"


class MatchStatus(str, enum.Enum):
    """Validation state machine. Ratings only apply on VERIFIED."""
    PENDING = "pending"
    VERIFIED = "verified"
    DISPUTED = "disputed"
    EXPIRED = "expired"


class ValidationAction(str, enum.Enum):
    APPROVED = "approved"
    DISPUTED = "disputed"


class ReportReason(str, enum.Enum):
    WRONG_SCORE = "wrong_score"
    WRONG_PLAYERS = "wrong_players"
    NEVER_HAPPENED = "never_happened"
    OTHER = "other"


class ReportStatus(str, enum.Enum):
    OPEN = "open"
    RESOLVED_INVALID = "resolved_invalid"
    RESOLVED_VALID = "resolved_valid"


class TournamentFormat(str, enum.Enum):
    SINGLE_ELIM = "single_elim"
    ROUND_ROBIN = "round_robin"
    SWISS = "swiss"


class TournamentStatus(str, enum.Enum):
    DRAFT = "draft"
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class TournamentSource(str, enum.Enum):
    MANUAL = "manual"
    TOURNAMENTSOFTWARE = "tournamentsoftware"


# ---------------------------------------------------------------------------
# Player
# ---------------------------------------------------------------------------

class Player(Base):
    __tablename__ = "players"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    email: Mapped[Optional[str]] = mapped_column(String(254), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # V0 — singles rating (still authoritative)
    singles_r: Mapped[float] = mapped_column(Float, default=INITIAL_R, nullable=False)
    singles_rd: Mapped[float] = mapped_column(Float, default=INITIAL_RD, nullable=False)
    singles_sigma: Mapped[float] = mapped_column(Float, default=INITIAL_SIGMA, nullable=False)
    singles_last_active: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    singles_match_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # V0 — doubles rating
    doubles_r: Mapped[float] = mapped_column(Float, default=INITIAL_R, nullable=False)
    doubles_rd: Mapped[float] = mapped_column(Float, default=INITIAL_RD, nullable=False)
    doubles_sigma: Mapped[float] = mapped_column(Float, default=INITIAL_SIGMA, nullable=False)
    doubles_last_active: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    doubles_match_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # V1 — identity & metadata
    clerk_user_id: Mapped[Optional[str]] = mapped_column(
        String(64), unique=True, index=True, nullable=True
    )
    gender: Mapped[Optional[PlayerGender]] = mapped_column(
        Enum(PlayerGender, name="playergender"), nullable=True
    )
    display_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    # Optional profile metadata. avatar_url is typically the Google photo from
    # Clerk; all three are nullable (profile picture is optional, like DUPR).
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    age: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)

    # Relationships
    match_appearances: Mapped[List["MatchPlayer"]] = relationship(
        back_populates="player", cascade="all, delete-orphan"
    )
    category_ratings: Mapped[List["PlayerCategoryRating"]] = relationship(
        back_populates="player", cascade="all, delete-orphan"
    )
    tournament_entries: Mapped[List["TournamentEntry"]] = relationship(
        back_populates="player", cascade="all, delete-orphan"
    )
    ceiling_history: Mapped[List["CeilingHistory"]] = relationship(
        back_populates="player", cascade="all, delete-orphan"
    )

    # ------------------------------------------------------------------
    # V0 rating round-trip — still the path the live engine uses
    # ------------------------------------------------------------------

    def to_rating(self, mode: MatchMode) -> PlayerRating:
        if mode is MatchMode.SINGLES:
            return PlayerRating(
                r=self.singles_r,
                rd=self.singles_rd,
                sigma=self.singles_sigma,
                last_active=self.singles_last_active or date.today(),
            )
        return PlayerRating(
            r=self.doubles_r,
            rd=self.doubles_rd,
            sigma=self.doubles_sigma,
            last_active=self.doubles_last_active or date.today(),
        )

    def apply_rating(self, mode: MatchMode, rating: PlayerRating) -> None:
        if mode is MatchMode.SINGLES:
            self.singles_r = rating.r
            self.singles_rd = rating.rd
            self.singles_sigma = rating.sigma
            self.singles_last_active = rating.last_active
            self.singles_match_count += 1
        else:
            self.doubles_r = rating.r
            self.doubles_rd = rating.rd
            self.doubles_sigma = rating.sigma
            self.doubles_last_active = rating.last_active
            self.doubles_match_count += 1


# ---------------------------------------------------------------------------
# PlayerCategoryRating — V1 child table that will replace singles_*/doubles_*
# ---------------------------------------------------------------------------

# Casual ceiling: the highest display rating reachable through normal
# (non-tournament) play. 5.0 = Diamond; competitive (above 5.0) comes later.
# Ranked tournaments + admin overrides can raise it above this.
INITIAL_CEILING = 5.0

# Self-pick: new players choose a starting level instead of being dropped at
# the cap. They can pick 1.0–4.5; 5.0+ is gated behind ranked tournaments /
# admin. Until they pick, they sit at the beginner default.
SELF_PICK_MIN = 1.0
SELF_PICK_MAX = 4.5
DEFAULT_START_DISPLAY = 2.0

# Auto-created rows (and unpicked players) start at the beginner default, not
# the ceiling — players earn their way up. Computed once so the model default
# doesn't drift from DEFAULT_START_DISPLAY.
_INITIAL_CATEGORY_R = from_display_rating(DEFAULT_START_DISPLAY)


class PlayerCategoryRating(Base):
    """One row per (player, category). Replaces the v0 denormalized columns."""
    __tablename__ = "player_ratings"
    __table_args__ = (
        UniqueConstraint("player_id", "category", name="uq_player_category"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    player_id: Mapped[int] = mapped_column(
        ForeignKey("players.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    category: Mapped[RatingCategory] = mapped_column(
        Enum(RatingCategory, name="ratingcategory"), nullable=False
    )

    r: Mapped[float] = mapped_column(Float, default=_INITIAL_CATEGORY_R, nullable=False)
    rd: Mapped[float] = mapped_column(Float, default=INITIAL_RD, nullable=False)
    sigma: Mapped[float] = mapped_column(Float, default=INITIAL_SIGMA, nullable=False)
    last_active: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    match_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    ceiling: Mapped[float] = mapped_column(Float, default=INITIAL_CEILING, nullable=False)
    ceiling_updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    player: Mapped[Player] = relationship(back_populates="category_ratings")


# ---------------------------------------------------------------------------
# Match — gains validation state columns in v1
# ---------------------------------------------------------------------------

class Match(Base):
    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    played_at: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # V0 columns — still required by current engine.
    mode: Mapped[MatchMode] = mapped_column(Enum(MatchMode), nullable=False)
    match_type: Mapped[MatchTypeDB] = mapped_column(Enum(MatchTypeDB), nullable=False)
    team_a_score: Mapped[int] = mapped_column(Integer, nullable=False)
    team_b_score: Mapped[int] = mapped_column(Integer, nullable=False)
    winner_team: Mapped[Team] = mapped_column(Enum(Team), nullable=False)

    # V1 — validation state & richer categorization
    category: Mapped[Optional[RatingCategory]] = mapped_column(
        Enum(RatingCategory, name="ratingcategory"), nullable=True, index=True,
    )
    status: Mapped[Optional[MatchStatus]] = mapped_column(
        Enum(MatchStatus, name="matchstatus"), nullable=True, index=True,
    )
    submitted_by_user_id: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True
    )
    verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    tournament_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("tournaments.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    round: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    participants: Mapped[List["MatchPlayer"]] = relationship(
        back_populates="match",
        cascade="all, delete-orphan",
        order_by="MatchPlayer.id",
    )
    validations: Mapped[List["MatchValidation"]] = relationship(
        back_populates="match", cascade="all, delete-orphan"
    )
    reports: Mapped[List["MatchReport"]] = relationship(
        back_populates="match", cascade="all, delete-orphan"
    )
    tournament: Mapped[Optional["Tournament"]] = relationship(back_populates="matches")


# ---------------------------------------------------------------------------
# MatchPlayer — per-participant audit row (unchanged in v1)
# ---------------------------------------------------------------------------

class MatchPlayer(Base):
    __tablename__ = "match_players"
    __table_args__ = (
        UniqueConstraint("match_id", "player_id", name="uq_match_player"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    player_id: Mapped[int] = mapped_column(
        ForeignKey("players.id", ondelete="CASCADE"), nullable=False, index=True
    )
    team: Mapped[Team] = mapped_column(Enum(Team), nullable=False)

    pre_r: Mapped[float] = mapped_column(Float, nullable=False)
    pre_rd: Mapped[float] = mapped_column(Float, nullable=False)
    pre_sigma: Mapped[float] = mapped_column(Float, nullable=False)

    post_r: Mapped[float] = mapped_column(Float, nullable=False)
    post_rd: Mapped[float] = mapped_column(Float, nullable=False)
    post_sigma: Mapped[float] = mapped_column(Float, nullable=False)

    delta_r: Mapped[float] = mapped_column(Float, nullable=False)

    match: Mapped[Match] = relationship(back_populates="participants")
    player: Mapped[Player] = relationship(back_populates="match_appearances")

    @classmethod
    def from_update(
        cls,
        *,
        player_id: int,
        team: Team,
        pre: PlayerRating,
        post: PlayerRating,
    ) -> "MatchPlayer":
        return cls(
            player_id=player_id,
            team=team,
            pre_r=pre.r,
            pre_rd=pre.rd,
            pre_sigma=pre.sigma,
            post_r=post.r,
            post_rd=post.rd,
            post_sigma=post.sigma,
            delta_r=post.r - pre.r,
        )


# ---------------------------------------------------------------------------
# MatchValidation — per-participant approve/dispute decisions
# ---------------------------------------------------------------------------

class MatchValidation(Base):
    """One row per (match, user). Approval is what flips a pending match
    to verified. Dispute opens it for admin review."""
    __tablename__ = "match_validations"
    __table_args__ = (
        UniqueConstraint("match_id", "user_id", name="uq_match_validation_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    action: Mapped[ValidationAction] = mapped_column(
        Enum(ValidationAction, name="validationaction"), nullable=False
    )
    acted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    match: Mapped[Match] = relationship(back_populates="validations")


# ---------------------------------------------------------------------------
# MatchReport — falsification complaints
# ---------------------------------------------------------------------------

class MatchReport(Base):
    __tablename__ = "match_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    reporter_user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    reason: Mapped[ReportReason] = mapped_column(
        Enum(ReportReason, name="reportreason"), nullable=False
    )
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[ReportStatus] = mapped_column(
        Enum(ReportStatus, name="reportstatus"),
        default=ReportStatus.OPEN,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    resolved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    match: Mapped[Match] = relationship(back_populates="reports")


# ---------------------------------------------------------------------------
# Tournaments
# ---------------------------------------------------------------------------

class Tournament(Base):
    __tablename__ = "tournaments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    format: Mapped[TournamentFormat] = mapped_column(
        Enum(TournamentFormat, name="tournamentformat"), nullable=False
    )
    # Ranked tournaments are admin-hosted and carry full TOURNAMENT weight
    # plus ceiling unlocks; anyone can host an unranked (casual) tournament.
    ranked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    category: Mapped[Optional[RatingCategory]] = mapped_column(
        Enum(RatingCategory, name="ratingcategory"), nullable=True
    )
    starts_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    ends_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Registration auto-closes once this passes (null = stays open until the
    # organizer generates pairings). Enforced lazily at sign-up time.
    registration_closes_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Optional entry gates on the 1.0–5.0 display rating (null = no bound).
    min_rating: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    max_rating: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    organizer_user_id: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, index=True
    )
    status: Mapped[TournamentStatus] = mapped_column(
        Enum(TournamentStatus, name="tournamentstatus"),
        default=TournamentStatus.DRAFT,
        nullable=False,
    )
    external_source: Mapped[Optional[TournamentSource]] = mapped_column(
        Enum(TournamentSource, name="tournamentsource"), nullable=True
    )
    external_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    entries: Mapped[List["TournamentEntry"]] = relationship(
        back_populates="tournament", cascade="all, delete-orphan"
    )
    matches: Mapped[List[Match]] = relationship(back_populates="tournament")


class TournamentEntry(Base):
    __tablename__ = "tournament_entries"
    __table_args__ = (
        UniqueConstraint("tournament_id", "player_id", name="uq_tournament_entry"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tournament_id: Mapped[int] = mapped_column(
        ForeignKey("tournaments.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    player_id: Mapped[int] = mapped_column(
        ForeignKey("players.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    seed: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    withdrawn: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    tournament: Mapped[Tournament] = relationship(back_populates="entries")
    player: Mapped[Player] = relationship(back_populates="tournament_entries")


# ---------------------------------------------------------------------------
# CeilingHistory — audit trail for DUPR-style cap unlocks
# ---------------------------------------------------------------------------

class CeilingHistory(Base):
    __tablename__ = "ceiling_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    player_id: Mapped[int] = mapped_column(
        ForeignKey("players.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    category: Mapped[RatingCategory] = mapped_column(
        Enum(RatingCategory, name="ratingcategory"), nullable=False
    )
    old_ceiling: Mapped[float] = mapped_column(Float, nullable=False)
    new_ceiling: Mapped[float] = mapped_column(Float, nullable=False)
    tournament_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("tournaments.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    player: Mapped[Player] = relationship(back_populates="ceiling_history")
