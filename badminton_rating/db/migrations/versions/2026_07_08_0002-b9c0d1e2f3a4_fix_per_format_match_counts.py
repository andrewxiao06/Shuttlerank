"""recompute per-format match counts

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-07-08 00:02:00.000000

The singles/doubles split backfill copied each player's *total* match count
into both formats. Recompute each from actual verified match participation so
Singles and Doubles show their real per-format game counts (e.g. a player with
one recorded doubles game shows 1 there, not the combined total).
"""

from typing import Sequence, Union

from alembic import op


revision: str = "b9c0d1e2f3a4"
down_revision: Union[str, Sequence[str], None] = "a8b9c0d1e2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Source of truth: verified matches the player took part in, by mode.
    op.execute(
        """
        UPDATE player_ratings pr
        SET match_count = COALESCE((
            SELECT count(*)
            FROM match_players mp
            JOIN matches m ON m.id = mp.match_id
            WHERE mp.player_id = pr.player_id
              AND m.status::text = 'verified'
              AND m.mode::text = pr.category::text
        ), 0)
        WHERE pr.category IN ('singles', 'doubles')
        """
    )


def downgrade() -> None:
    # No-op: the previous per-format counts were themselves derived, not stored.
    pass
