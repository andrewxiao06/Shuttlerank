"""raise casual ceiling to 5.0

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-06-29 00:01:00.000000

The casual rating cap moved from 4.5 to 5.0 (5.0 = Diamond). Bump existing
rating rows still sitting at an old casual cap (≤ 4.5) up to 5.0 so current
players can reach the new top. Tournament-unlocked ceilings above 5.0 (none
yet) are left untouched.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "e6f7a8b9c0d1"
down_revision: Union[str, Sequence[str], None] = "d5e6f7a8b9c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE player_ratings SET ceiling = 5.0 WHERE ceiling < 5.0")


def downgrade() -> None:
    # Lossy (we don't know prior per-row caps); no-op.
    pass
