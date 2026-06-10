"""initial schema — players, matches, match_players

Revision ID: a1b2c3d4e5f6
Revises:
Create Date: 2026-05-15 00:01:00.000000

The Team enum is referenced from two tables (matches.winner_team and
match_players.team). We create the Postgres type once up front and bind
the *same* enum instance to both columns so SQLAlchemy doesn't try to
re-emit CREATE TYPE on the second use.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Enum types. `team` is shared between two tables — we use the postgresql
# dialect's ENUM with create_type=False so the table DDL won't emit a
# duplicate CREATE TYPE in offline mode.
match_mode = sa.Enum("singles", "doubles", name="matchmode")
match_type = sa.Enum("casual", "club", "tournament", name="matchtypedb")
team_enum = postgresql.ENUM("A", "B", name="team", create_type=False)


def upgrade() -> None:
    # Create the shared team type first.
    op.execute("CREATE TYPE team AS ENUM ('A', 'B')")

    op.create_table(
        "players",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("singles_r", sa.Float(), server_default="1500.0", nullable=False),
        sa.Column("singles_rd", sa.Float(), server_default="350.0", nullable=False),
        sa.Column("singles_sigma", sa.Float(), server_default="0.06", nullable=False),
        sa.Column("singles_last_active", sa.Date(), nullable=True),
        sa.Column("singles_match_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("doubles_r", sa.Float(), server_default="1500.0", nullable=False),
        sa.Column("doubles_rd", sa.Float(), server_default="350.0", nullable=False),
        sa.Column("doubles_sigma", sa.Float(), server_default="0.06", nullable=False),
        sa.Column("doubles_last_active", sa.Date(), nullable=True),
        sa.Column("doubles_match_count", sa.Integer(), server_default="0", nullable=False),
        sa.UniqueConstraint("email", name="uq_players_email"),
    )
    op.create_index("ix_players_name", "players", ["name"])

    op.create_table(
        "matches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("played_at", sa.Date(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("mode", match_mode, nullable=False),
        sa.Column("match_type", match_type, nullable=False),
        sa.Column("team_a_score", sa.Integer(), nullable=False),
        sa.Column("team_b_score", sa.Integer(), nullable=False),
        sa.Column("winner_team", team_enum, nullable=False),
    )
    op.create_index("ix_matches_played_at", "matches", ["played_at"])

    op.create_table(
        "match_players",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("match_id", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Integer(), nullable=False),
        sa.Column("team", team_enum, nullable=False),
        sa.Column("pre_r", sa.Float(), nullable=False),
        sa.Column("pre_rd", sa.Float(), nullable=False),
        sa.Column("pre_sigma", sa.Float(), nullable=False),
        sa.Column("post_r", sa.Float(), nullable=False),
        sa.Column("post_rd", sa.Float(), nullable=False),
        sa.Column("post_sigma", sa.Float(), nullable=False),
        sa.Column("delta_r", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(
            ["match_id"], ["matches.id"], ondelete="CASCADE",
            name="fk_match_players_match_id",
        ),
        sa.ForeignKeyConstraint(
            ["player_id"], ["players.id"], ondelete="CASCADE",
            name="fk_match_players_player_id",
        ),
        sa.UniqueConstraint("match_id", "player_id", name="uq_match_player"),
    )
    op.create_index("ix_match_players_match_id", "match_players", ["match_id"])
    op.create_index("ix_match_players_player_id", "match_players", ["player_id"])


def downgrade() -> None:
    op.drop_index("ix_match_players_player_id", table_name="match_players")
    op.drop_index("ix_match_players_match_id", table_name="match_players")
    op.drop_table("match_players")

    op.drop_index("ix_matches_played_at", table_name="matches")
    op.drop_table("matches")

    op.drop_index("ix_players_name", table_name="players")
    op.drop_table("players")

    # Drop enum types last — only after all referring columns are gone.
    op.execute("DROP TYPE IF EXISTS team")
    op.execute("DROP TYPE IF EXISTS matchtypedb")
    op.execute("DROP TYPE IF EXISTS matchmode")
