"""
Alembic environment — async-aware.

Reads DATABASE_URL from the environment so the same migration scripts
run against dev, CI, and prod without editing alembic.ini.

Run:
    alembic upgrade head
    alembic revision --autogenerate -m "add foo column"
"""

from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

# Bring the package onto sys.path before importing models.
from badminton_rating.db.models import Base  # noqa: E402


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Inject DATABASE_URL from env. Fall back to a local default so `alembic
# current` etc. still work without env wiring.
db_url = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://brs:brs@localhost:5432/brs",
)
config.set_main_option("sqlalchemy.url", db_url)

target_metadata = Base.metadata


# ---------------------------------------------------------------------------
# Offline — emit raw SQL to stdout. Used for review and for environments
# where the migrator can't connect directly to the DB.
# ---------------------------------------------------------------------------

def run_migrations_offline() -> None:
    context.configure(
        url=db_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


# ---------------------------------------------------------------------------
# Online — connect and apply migrations via async engine.
# ---------------------------------------------------------------------------

def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,            # detect column type changes
        compare_server_default=True,  # detect default changes
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
