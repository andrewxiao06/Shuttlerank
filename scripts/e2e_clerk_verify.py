"""
End-to-end check of the production Clerk JWT path against the REAL Clerk
dev instance. Mints a genuine session token via the Backend API, then runs
it through the exact `_verify_clerk_jwt` the HTTP layer uses (real JWKS
fetch, real RS256 verification). Also exercises tamper/wrong-issuer cases.

Run:  python scripts/e2e_clerk_verify.py
Requires CLERK_SECRET_KEY + the derived issuer (read from frontend/.env.local).
"""

import asyncio
import os
import sys

import httpx

ISSUER = "https://organic-grizzly-1.clerk.accounts.dev"
USER_ID = "user_3E6zsJe01P0CQV1EDtaEmPIi0Dn"


def _secret_key() -> str:
    for line in open("frontend/.env.local"):
        if line.startswith("CLERK_SECRET_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("CLERK_SECRET_KEY not found in frontend/.env.local")


async def mint_token(sk: str) -> str:
    async with httpx.AsyncClient(timeout=10) as c:
        s = await c.post(
            "https://api.clerk.com/v1/sessions",
            headers={"Authorization": f"Bearer {sk}", "Content-Type": "application/json"},
            json={"user_id": USER_ID},
        )
        s.raise_for_status()
        sid = s.json()["id"]
        t = await c.post(
            f"https://api.clerk.com/v1/sessions/{sid}/tokens",
            headers={"Authorization": f"Bearer {sk}", "Content-Type": "application/json"},
            json={},
        )
        t.raise_for_status()
        return t.json()["jwt"]


async def main() -> None:
    os.environ["CLERK_ISSUER"] = ISSUER
    os.environ.pop("CLERK_DEV_ALLOW_HEADER", None)
    # Import AFTER env is set; reset any cached JWKS for a clean fetch.
    from badminton_rating.api import auth
    auth._jwks_cache["keys"] = None
    auth._jwks_cache["fetched_at"] = 0.0

    sk = _secret_key()
    token = await mint_token(sk)
    print(f"minted real Clerk JWT ({len(token)} chars)\n")

    passed = True

    # 1. Genuine token verifies and resolves to the right sub.
    try:
        sub = await auth._verify_clerk_jwt(token)
        ok = sub == USER_ID
        print(f"[{'PASS' if ok else 'FAIL'}] valid token -> sub={sub}")
        passed &= ok
    except Exception as e:
        print(f"[FAIL] valid token raised: {e}")
        passed = False

    # 2. Tampered signature is rejected.
    tampered = token[:-3] + ("xyz" if token[-3:] != "xyz" else "abc")
    try:
        await auth._verify_clerk_jwt(tampered)
        print("[FAIL] tampered token was accepted")
        passed = False
    except Exception as e:
        print(f"[PASS] tampered token rejected ({type(e).__name__})")

    # 3. Wrong expected issuer is rejected.
    os.environ["CLERK_ISSUER"] = "https://evil.example.com"
    try:
        await auth._verify_clerk_jwt(token)
        print("[FAIL] wrong-issuer config accepted the token")
        passed = False
    except Exception as e:
        print(f"[PASS] wrong issuer rejected ({type(e).__name__})")
    finally:
        os.environ["CLERK_ISSUER"] = ISSUER

    print("\n" + ("ALL CHECKS PASSED" if passed else "SOME CHECKS FAILED"))
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    asyncio.run(main())
