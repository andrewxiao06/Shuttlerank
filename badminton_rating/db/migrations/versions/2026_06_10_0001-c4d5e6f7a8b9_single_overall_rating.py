"""single overall rating + ranked tournaments

Revision ID: c4d5e6f7a8b9
Revises: b2c3d4e5f6a7
Create Date: 2026-06-10 00:01:00.000000

Collapses the six per-category rating buckets into one universal rating
per player, and replaces the tournament `category` with a `ranked` flag:

  - adds 'overall' to the ratingcategory enum
  - consolidates player_ratings: each player keeps their most-played row,
    re-labelled 'overall'; the other rows are deleted
  - tournaments gain `ranked` (bool, default false); `category` becomes
    nullable (legacy rows keep their value, new rows leave it NULL)

Match rows keep their historical category values — the enum's old members
remain valid forever.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c4d5e6f7a8b9"
down_revision: Union[str, Sequence[str], None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside the migration's transaction
    # on Postgres < 12-style usage; run it in an autocommit block so the new
    # label is usable by the statements that follow.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE ratingcategory ADD VALUE IF NOT EXISTS 'overall'")

    # Keep one rating row per player: the one with the most matches
    # (ties broken by id). Re-label it 'overall', drop the rest.
    op.execute(
        """
        DELETE FROM player_ratings
        WHERE id NOT IN (
            SELECT DISTINCT ON (player_id) id
            FROM player_ratings
            ORDER BY player_id, match_count DESC, id
        )
        """
    )
    op.execute("UPDATE player_ratings SET category = 'overall'")

    op.add_column(
        "tournaments",
        sa.Column("ranked", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.alter_column("tournaments", "category", nullable=True)


def downgrade() -> None:
    # The player_ratings consolidation is lossy and cannot be reversed.
    op.alter_column("tournaments", "category", nullable=False)
    op.drop_column("tournaments", "ranked")
    # Postgres cannot drop an enum value; 'overall' stays in the type.
