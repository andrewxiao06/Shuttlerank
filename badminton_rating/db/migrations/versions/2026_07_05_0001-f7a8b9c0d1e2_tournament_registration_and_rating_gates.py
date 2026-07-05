"""tournament registration deadline + rating gates

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-07-05 00:01:00.000000

Adds registration_closes_at (auto-close signups at a set time) and the
optional min_rating / max_rating entry gates to tournaments.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f7a8b9c0d1e2"
down_revision: Union[str, Sequence[str], None] = "e6f7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tournaments",
        sa.Column("registration_closes_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("tournaments", sa.Column("min_rating", sa.Float(), nullable=True))
    op.add_column("tournaments", sa.Column("max_rating", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("tournaments", "max_rating")
    op.drop_column("tournaments", "min_rating")
    op.drop_column("tournaments", "registration_closes_at")
