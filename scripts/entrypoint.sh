#!/usr/bin/env bash
set -euo pipefail

# Wait for Postgres before running migrations. The compose healthcheck
# usually handles this, but the loop guards against a slow first start.
echo "Waiting for database..."
python - <<'PY'
import os, time
import asyncio
import asyncpg

raw = os.environ["DATABASE_URL"]
# asyncpg expects no driver prefix
url = raw.replace("postgresql+asyncpg://", "postgresql://", 1)

async def wait():
    for i in range(60):
        try:
            conn = await asyncpg.connect(url)
            await conn.close()
            return
        except Exception as e:
            print(f"  not ready ({e.__class__.__name__}), retrying...")
            time.sleep(1)
    raise SystemExit("database never became ready")

asyncio.run(wait())
PY

echo "Applying migrations..."
alembic upgrade head

echo "Starting uvicorn..."
exec uvicorn main:app --host 0.0.0.0 --port 8000 ${UVICORN_EXTRA_ARGS:-}
