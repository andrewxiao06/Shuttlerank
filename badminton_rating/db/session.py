"""
Async SQLAlchemy engine + session factory.

The engine is created once at import time from DATABASE_URL. The session
factory yields scoped AsyncSessions for request handlers; transactions are
managed by the caller (commit on success, rollback on exception).
"""

from __future__ import annotations

import os
from typing import Any, AsyncIterator

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://brs:brs@localhost:5432/brs",
)


def _prepare_url_and_connect_args(raw_url: str) -> tuple[str, dict[str, Any]]:
    """Normalize a Postgres URL for the asyncpg driver.

    asyncpg does not understand libpq's `sslmode`/`channel_binding` query
    params (managed hosts like Neon put them in the connection string). Strip
    them and translate an SSL requirement into asyncpg's `ssl` connect arg.
    """
    url = make_url(raw_url)
    query = dict(url.query)
    sslmode = query.pop("sslmode", None)
    query.pop("channel_binding", None)
    ssl_flag = query.pop("ssl", None)
    url = url.set(query=query)

    connect_args: dict[str, Any] = {}
    host = url.host or ""
    wants_ssl = (
        (sslmode is not None and sslmode not in ("disable", "allow", "prefer"))
        or ssl_flag in ("true", "require", "1")
        or host.endswith("neon.tech")  # managed host always requires TLS
    )
    if wants_ssl:
        # Neon presents a valid publicly-trusted cert, so a default verifying
        # SSL context (asyncpg's ssl=True) works and stays secure.
        connect_args["ssl"] = True
    return str(url), connect_args


_url, _connect_args = _prepare_url_and_connect_args(DATABASE_URL)

engine = create_async_engine(
    _url,
    echo=os.getenv("SQL_ECHO") == "1",
    pool_pre_ping=True,
    connect_args=_connect_args,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency. One session per request, rolled back on error."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
