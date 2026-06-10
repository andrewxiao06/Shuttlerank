"""v1 additive — categories, validation, reports, tournaments, ceilings

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-05-21 00:01:00.000000

Additive migration — every new column on `players` and `matches` is nullable,
and the new tables are independent. The v0 engine + service code paths still
read the existing singles_*/doubles_* columns and the `mode` column, so this
migration is safe to apply without touching application code.

Schema additions:
  - new enum types: playergender, ratingcategory, matchstatus,
    validationaction, reportreason, reportstatus, tournamentformat,
    tournamentstatus, tournamentsource
  - new tables: tournaments, player_ratings, ceiling_history,
    match_validations, match_reports, tournament_entries
  - new columns on players: clerk_user_id, gender, display_name
  - new columns on matches: category, status, submitted_by_user_id,
    verified_at, expires_at, tournament_id (FK), round

`ratingcategory` is referenced by 4 columns across 4 tables, so we create
that enum once up front and pass create_type=False everywhere it's used.
The single-use enums are emitted inline by their owning table.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Shared-across-tables enum — explicit create, create_type=False on every use.
rating_category = postgresql.ENUM(
    "mens_singles", "womens_singles",
    "mens_doubles", "womens_doubles",
    "mixed_doubles", "casual",
    name="ratingcategory",
    create_type=False,
)


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Shared enum types (created explicitly to avoid duplicate emission)
    # ------------------------------------------------------------------
    op.execute(
        "CREATE TYPE ratingcategory AS ENUM ("
        "'mens_singles', 'womens_singles', "
        "'mens_doubles', 'womens_doubles', "
        "'mixed_doubles', 'casual')"
    )
    # These two types are referenced via ALTER TABLE ... ADD COLUMN below.
    # Alembic auto-creates enums for CREATE TABLE columns but not for
    # ADD COLUMN, so we emit the CREATE TYPE up front explicitly.
    op.execute("CREATE TYPE playergender AS ENUM ('M', 'W', 'X')")
    op.execute(
        "CREATE TYPE matchstatus AS ENUM ("
        "'pending', 'verified', 'disputed', 'expired')"
    )

    # ------------------------------------------------------------------
    # tournaments — must exist before matches.tournament_id and
    # ceiling_history.tournament_id FKs can be added.
    # Single-use enums (tournamentformat/status/source) auto-create here.
    # ------------------------------------------------------------------
    op.create_table(
        "tournaments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column(
            "format",
            sa.Enum("single_elim", "round_robin", "swiss", name="tournamentformat"),
            nullable=False,
        ),
        sa.Column("category", rating_category, nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("organizer_user_id", sa.String(length=64), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "draft", "open", "in_progress", "completed",
                name="tournamentstatus",
            ),
            server_default="draft",
            nullable=False,
        ),
        sa.Column(
            "external_source",
            sa.Enum(
                "manual", "tournamentsoftware",
                name="tournamentsource",
            ),
            nullable=True,
        ),
        sa.Column("external_id", sa.String(length=120), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_tournaments_organizer_user_id", "tournaments", ["organizer_user_id"]
    )

    # ------------------------------------------------------------------
    # player_ratings — child table that will eventually replace
    # players.singles_*/doubles_* columns.
    # ------------------------------------------------------------------
    op.create_table(
        "player_ratings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("player_id", sa.Integer(), nullable=False),
        sa.Column("category", rating_category, nullable=False),
        sa.Column("r", sa.Float(), server_default="1500.0", nullable=False),
        sa.Column("rd", sa.Float(), server_default="350.0", nullable=False),
        sa.Column("sigma", sa.Float(), server_default="0.06", nullable=False),
        sa.Column("last_active", sa.Date(), nullable=True),
        sa.Column("match_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("ceiling", sa.Float(), server_default="4.0", nullable=False),
        sa.Column("ceiling_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["player_id"], ["players.id"], ondelete="CASCADE",
            name="fk_player_ratings_player_id",
        ),
        sa.UniqueConstraint("player_id", "category", name="uq_player_category"),
    )
    op.create_index("ix_player_ratings_player_id", "player_ratings", ["player_id"])

    # ------------------------------------------------------------------
    # match_validations — per-participant approve/dispute actions
    # ------------------------------------------------------------------
    op.create_table(
        "match_validations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("match_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column(
            "action",
            sa.Enum("approved", "disputed", name="validationaction"),
            nullable=False,
        ),
        sa.Column(
            "acted_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["match_id"], ["matches.id"], ondelete="CASCADE",
            name="fk_match_validations_match_id",
        ),
        sa.UniqueConstraint("match_id", "user_id", name="uq_match_validation_user"),
    )
    op.create_index("ix_match_validations_match_id", "match_validations", ["match_id"])
    op.create_index("ix_match_validations_user_id", "match_validations", ["user_id"])

    # ------------------------------------------------------------------
    # match_reports — falsification complaints
    # ------------------------------------------------------------------
    op.create_table(
        "match_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("match_id", sa.Integer(), nullable=False),
        sa.Column("reporter_user_id", sa.String(length=64), nullable=False),
        sa.Column(
            "reason",
            sa.Enum(
                "wrong_score", "wrong_players", "never_happened", "other",
                name="reportreason",
            ),
            nullable=False,
        ),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "open", "resolved_invalid", "resolved_valid",
                name="reportstatus",
            ),
            server_default="open",
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["match_id"], ["matches.id"], ondelete="CASCADE",
            name="fk_match_reports_match_id",
        ),
    )
    op.create_index("ix_match_reports_match_id", "match_reports", ["match_id"])
    op.create_index(
        "ix_match_reports_reporter_user_id", "match_reports", ["reporter_user_id"]
    )

    # ------------------------------------------------------------------
    # tournament_entries
    # ------------------------------------------------------------------
    op.create_table(
        "tournament_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tournament_id", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Integer(), nullable=False),
        sa.Column("seed", sa.Integer(), nullable=True),
        sa.Column("withdrawn", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["tournament_id"], ["tournaments.id"], ondelete="CASCADE",
            name="fk_tournament_entries_tournament_id",
        ),
        sa.ForeignKeyConstraint(
            ["player_id"], ["players.id"], ondelete="CASCADE",
            name="fk_tournament_entries_player_id",
        ),
        sa.UniqueConstraint(
            "tournament_id", "player_id", name="uq_tournament_entry"
        ),
    )
    op.create_index(
        "ix_tournament_entries_tournament_id",
        "tournament_entries",
        ["tournament_id"],
    )
    op.create_index(
        "ix_tournament_entries_player_id",
        "tournament_entries",
        ["player_id"],
    )

    # ------------------------------------------------------------------
    # ceiling_history — DUPR-style cap unlock audit
    # ------------------------------------------------------------------
    op.create_table(
        "ceiling_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("player_id", sa.Integer(), nullable=False),
        sa.Column("category", rating_category, nullable=False),
        sa.Column("old_ceiling", sa.Float(), nullable=False),
        sa.Column("new_ceiling", sa.Float(), nullable=False),
        sa.Column("tournament_id", sa.Integer(), nullable=True),
        sa.Column(
            "changed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["player_id"], ["players.id"], ondelete="CASCADE",
            name="fk_ceiling_history_player_id",
        ),
        sa.ForeignKeyConstraint(
            ["tournament_id"], ["tournaments.id"], ondelete="SET NULL",
            name="fk_ceiling_history_tournament_id",
        ),
    )
    op.create_index("ix_ceiling_history_player_id", "ceiling_history", ["player_id"])
    op.create_index(
        "ix_ceiling_history_tournament_id", "ceiling_history", ["tournament_id"]
    )

    # ------------------------------------------------------------------
    # Additive columns on existing tables — all nullable, no backfill
    # ------------------------------------------------------------------
    op.add_column(
        "players",
        sa.Column("clerk_user_id", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "players",
        sa.Column(
            "gender",
            sa.Enum("M", "W", "X", name="playergender"),
            nullable=True,
        ),
    )
    op.add_column(
        "players",
        sa.Column("display_name", sa.String(length=120), nullable=True),
    )
    op.create_index(
        "ix_players_clerk_user_id", "players", ["clerk_user_id"], unique=True,
    )

    op.add_column("matches", sa.Column("category", rating_category, nullable=True))
    op.add_column(
        "matches",
        sa.Column(
            "status",
            sa.Enum("pending", "verified", "disputed", "expired", name="matchstatus"),
            nullable=True,
        ),
    )
    op.add_column(
        "matches", sa.Column("submitted_by_user_id", sa.String(length=64), nullable=True)
    )
    op.add_column(
        "matches", sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "matches", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("matches", sa.Column("tournament_id", sa.Integer(), nullable=True))
    op.add_column("matches", sa.Column("round", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_matches_tournament_id", "matches", "tournaments",
        ["tournament_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_matches_category", "matches", ["category"])
    op.create_index("ix_matches_status", "matches", ["status"])
    op.create_index("ix_matches_tournament_id", "matches", ["tournament_id"])


def downgrade() -> None:
    # Drop additive columns on existing tables first.
    op.drop_index("ix_matches_tournament_id", table_name="matches")
    op.drop_index("ix_matches_status", table_name="matches")
    op.drop_index("ix_matches_category", table_name="matches")
    op.drop_constraint("fk_matches_tournament_id", "matches", type_="foreignkey")
    op.drop_column("matches", "round")
    op.drop_column("matches", "tournament_id")
    op.drop_column("matches", "expires_at")
    op.drop_column("matches", "verified_at")
    op.drop_column("matches", "submitted_by_user_id")
    op.drop_column("matches", "status")
    op.drop_column("matches", "category")

    op.drop_index("ix_players_clerk_user_id", table_name="players")
    op.drop_column("players", "display_name")
    op.drop_column("players", "gender")
    op.drop_column("players", "clerk_user_id")

    # Drop tables in FK-safe order.
    op.drop_index("ix_ceiling_history_tournament_id", table_name="ceiling_history")
    op.drop_index("ix_ceiling_history_player_id", table_name="ceiling_history")
    op.drop_table("ceiling_history")

    op.drop_index("ix_tournament_entries_player_id", table_name="tournament_entries")
    op.drop_index(
        "ix_tournament_entries_tournament_id", table_name="tournament_entries"
    )
    op.drop_table("tournament_entries")

    op.drop_index("ix_match_reports_reporter_user_id", table_name="match_reports")
    op.drop_index("ix_match_reports_match_id", table_name="match_reports")
    op.drop_table("match_reports")

    op.drop_index("ix_match_validations_user_id", table_name="match_validations")
    op.drop_index("ix_match_validations_match_id", table_name="match_validations")
    op.drop_table("match_validations")

    op.drop_index("ix_player_ratings_player_id", table_name="player_ratings")
    op.drop_table("player_ratings")

    op.drop_index("ix_tournaments_organizer_user_id", table_name="tournaments")
    op.drop_table("tournaments")

    # Drop enum types after the tables/columns that referenced them are gone.
    op.execute("DROP TYPE IF EXISTS reportstatus")
    op.execute("DROP TYPE IF EXISTS reportreason")
    op.execute("DROP TYPE IF EXISTS validationaction")
    op.execute("DROP TYPE IF EXISTS tournamentsource")
    op.execute("DROP TYPE IF EXISTS tournamentstatus")
    op.execute("DROP TYPE IF EXISTS tournamentformat")
    op.execute("DROP TYPE IF EXISTS matchstatus")
    op.execute("DROP TYPE IF EXISTS playergender")
    op.execute("DROP TYPE IF EXISTS ratingcategory")
