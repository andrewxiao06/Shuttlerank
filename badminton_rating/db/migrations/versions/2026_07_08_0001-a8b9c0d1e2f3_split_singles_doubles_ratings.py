"""split ratings into singles + doubles

Revision ID: a8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-07-08 00:01:00.000000

Players now carry two independent ratings — SINGLES and DOUBLES — instead of
one universal OVERALL rating. OVERALL is kept as the self-pick *seed* bucket.

  - adds 'singles' and 'doubles' to the ratingcategory enum
  - backfills each existing player's SINGLES and DOUBLES rows from their
    current OVERALL rating (both start equal, then diverge with play). Their
    past match rows keep their historical category values.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "a8b9c0d1e2f3"
down_revision: Union[str, Sequence[str], None] = "f7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE must commit before the new labels are usable,
    # so run it in an autocommit block (same pattern as the OVERALL migration).
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE ratingcategory ADD VALUE IF NOT EXISTS 'singles'")
        op.execute("ALTER TYPE ratingcategory ADD VALUE IF NOT EXISTS 'doubles'")

    # Seed both played categories from each player's current OVERALL rating.
    for new_cat in ("singles", "doubles"):
        op.execute(
            f"""
            INSERT INTO player_ratings
                (player_id, category, r, rd, sigma, last_active,
                 match_count, ceiling, ceiling_updated_at)
            SELECT player_id, '{new_cat}', r, rd, sigma, last_active,
                   match_count, ceiling, ceiling_updated_at
            FROM player_ratings o
            WHERE o.category = 'overall'
              AND NOT EXISTS (
                  SELECT 1 FROM player_ratings x
                  WHERE x.player_id = o.player_id
                    AND x.category = '{new_cat}'
              )
            """
        )


def downgrade() -> None:
    # Remove the backfilled rows; Postgres cannot drop the enum values, so
    # 'singles'/'doubles' stay in the type (harmless).
    op.execute("DELETE FROM player_ratings WHERE category IN ('singles', 'doubles')")
