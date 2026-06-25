"""player profile fields: avatar_url, age, location

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-06-25 00:01:00.000000

Adds optional profile metadata to players — all nullable, no backfill.
avatar_url is typically the Google profile photo from Clerk.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d5e6f7a8b9c0"
down_revision: Union[str, Sequence[str], None] = "c4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("players", sa.Column("avatar_url", sa.String(length=512), nullable=True))
    op.add_column("players", sa.Column("age", sa.Integer(), nullable=True))
    op.add_column("players", sa.Column("location", sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column("players", "location")
    op.drop_column("players", "age")
    op.drop_column("players", "avatar_url")
