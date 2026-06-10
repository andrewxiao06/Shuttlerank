"""
Async SQLAlchemy engine + session factory.

The engine is created once at import time from DATABASE_URL. The session
factory yields scoped AsyncSessions for request handlers; transactions are
managed by the caller (commit on success, rollback on exception).
"""

from __future__ import annotations

import os
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://brs:brs@localhost:5432/brs",
)

engine = create_async_engine(
    DATABASE_URL,
    echo=os.getenv("SQL_ECHO") == "1",
    pool_pre_ping=True,
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
