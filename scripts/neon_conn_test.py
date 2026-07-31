"""Throwaway: find the asyncpg connect config that works against Neon.

Run inside the api image (has asyncpg + DATABASE_URL from .env.prod):
  docker compose -f docker-compose.prod.yml --env-file .env.prod \
    run --rm --entrypoint python api scripts/neon_conn_test.py

Read-only — each variant just does SELECT 1. Prints OK/FAIL per variant so we
know which connect_args to bake into session.py. Delete after.
"""
import asyncio
import os
import ssl as ssllib
from urllib.parse import urlsplit

raw = os.environ["DATABASE_URL"].replace("+asyncpg", "").split("?", 1)[0]
u = urlsplit(raw)
host = u.hostname or ""
epid = host.split(".")[0]  # e.g. ep-proud-hall-awb5dn42
dsn = f"postgresql://{u.username}:{u.password}@{host}:{u.port or 5432}{u.path}"
ctx = ssllib.create_default_context()


async def attempt(label, **kw):
    try:
        conn = await asyncpg.connect(dsn, timeout=15, **kw)
        val = await conn.fetchval("SELECT 1")
        await conn.close()
        print(f"{label}: OK ({val})")
    except Exception as e:  # noqa: BLE001
        print(f"{label}: FAIL {type(e).__name__}: {str(e)[:90]}")


async def via_sqlalchemy():
    """Replicate the real app path: helper -> create_async_engine."""
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine
    from badminton_rating.db.session import _prepare_url_and_connect_args

    prepared_url, connect_args = _prepare_url_and_connect_args(
        os.environ["DATABASE_URL"]
    )
    print(f"prepared_url={prepared_url}")
    print(f"connect_args={connect_args}")
    try:
        eng = create_async_engine(prepared_url, connect_args=connect_args)
        async with eng.connect() as conn:
            val = await conn.scalar(text("SELECT 1"))
        await eng.dispose()
        print(f"5 sqlalchemy+helper: OK ({val})")
    except Exception as e:  # noqa: BLE001
        print(f"5 sqlalchemy+helper: FAIL {type(e).__name__}: {str(e)[:120]}")


async def main():
    print(f"host={host}  endpoint_id={epid}")
    await attempt("1 ssl=ctx", ssl=ctx)
    await via_sqlalchemy()


import asyncpg  # noqa: E402

asyncio.run(main())
