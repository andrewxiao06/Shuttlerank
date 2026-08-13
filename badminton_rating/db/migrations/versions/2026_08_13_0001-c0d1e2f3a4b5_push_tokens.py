"""push_tokens table for Expo push notifications

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
Create Date: 2026-08-13 00:01:00.000000

Stores each device's Expo push token so the backend can notify a player's
phone when a match needs their approval. Keyed by the token (unique) with a
FK to players; ON DELETE CASCADE so a deleted player's tokens go too.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c0d1e2f3a4b5"
down_revision: Union[str, Sequence[str], None] = "b9c0d1e2f3a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "push_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "player_id",
            sa.Integer(),
            sa.ForeignKey("players.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token", sa.String(length=256), nullable=False),
        sa.Column("platform", sa.String(length=16), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_push_tokens_player_id", "push_tokens", ["player_id"])
    op.create_unique_constraint("uq_push_tokens_token", "push_tokens", ["token"])


def downgrade() -> None:
    op.drop_constraint("uq_push_tokens_token", "push_tokens", type_="unique")
    op.drop_index("ix_push_tokens_player_id", table_name="push_tokens")
    op.drop_table("push_tokens")
