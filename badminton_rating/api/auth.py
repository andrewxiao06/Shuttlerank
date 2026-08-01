"""
Authentication dependencies.

Clerk owns identity. This module bridges Clerk session tokens to local
`Player` rows. The principal extracted from the token is a Clerk user id
(string), which maps to `Player.clerk_user_id`.

Production path
---------------
The `Authorization: Bearer <session-jwt>` header is verified against
Clerk's JWKS (RS256 signature + `exp`/`nbf` + issuer + optional authorized
party). The verified `sub` claim is the Clerk user id. Configure via env:

    CLERK_ISSUER              e.g. https://your-app.clerk.accounts.dev
                              (production: https://clerk.yourdomain.com)
    CLERK_JWKS_URL            optional override; defaults to
                              {CLERK_ISSUER}/.well-known/jwks.json
    CLERK_AUTHORIZED_PARTIES  optional CSV of allowed `azp` origins, e.g.
                              https://yourdomain.com,https://www.yourdomain.com

Dev / test path
---------------
The plain `X-Clerk-User-Id` header is an UNVERIFIED impersonation vector and
is therefore rejected unless `CLERK_DEV_ALLOW_HEADER=1` is explicitly set.
NEVER set that env var in production. The test suite sets it (see
`tests/test_api_v1.py`).
"""

from __future__ import annotations

import os
import time
from typing import Optional

import httpx
from fastapi import Depends, Header, HTTPException, status
from jose import jwt
from jose.exceptions import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from badminton_rating.db.models import Player
from badminton_rating.db.session import get_db


# ---------------------------------------------------------------------------
# Config helpers (read on every call so tests/deploys can flip env freely)
# ---------------------------------------------------------------------------

def _dev_header_allowed() -> bool:
    return os.environ.get("CLERK_DEV_ALLOW_HEADER") == "1"


def _clerk_issuers() -> list[str]:
    """Configured issuers. CLERK_ISSUER may be a comma-separated list so a
    dev→prod cutover can trust both instances at once (zero downtime)."""
    raw = os.environ.get("CLERK_ISSUER", "")
    return [x.strip().rstrip("/") for x in raw.split(",") if x.strip()]


def _jwks_url_for(issuer: str) -> str:
    """JWKS endpoint for an issuer. A single explicit CLERK_JWKS_URL still
    overrides (legacy single-issuer setups)."""
    explicit = os.environ.get("CLERK_JWKS_URL")
    if explicit:
        return explicit
    return f"{issuer}/.well-known/jwks.json"


def _authorized_parties() -> set[str]:
    raw = os.environ.get("CLERK_AUTHORIZED_PARTIES", "")
    return {x.strip() for x in raw.split(",") if x.strip()}


# ---------------------------------------------------------------------------
# JWKS fetch + cache (Clerk rotates signing keys; cache with TTL + refetch)
# ---------------------------------------------------------------------------

_JWKS_TTL_SECONDS = 3600.0
# Cache per JWKS URL so multiple issuers (dev + prod) don't clobber each other.
_jwks_cache: dict[str, dict] = {}


async def _fetch_jwks(url: str, *, force: bool = False) -> list[dict]:
    now = time.time()
    entry = _jwks_cache.get(url)
    cached = entry["keys"] if entry else None
    if (
        not force
        and cached is not None
        and now - float(entry["fetched_at"]) < _JWKS_TTL_SECONDS
    ):
        return cached  # type: ignore[return-value]

    try:
        async with httpx.AsyncClient(timeout=5.0) as http:
            resp = await http.get(url)
            resp.raise_for_status()
            keys = resp.json().get("keys", [])
    except Exception as e:  # network, JSON, HTTP status
        # Fall back to a stale cache rather than locking everyone out.
        if cached is not None:
            return cached  # type: ignore[return-value]
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"could not fetch Clerk JWKS: {e}",
        )
    _jwks_cache[url] = {"keys": keys, "fetched_at": now}
    return keys


async def _signing_key_for(kid: Optional[str], url: str) -> dict:
    keys = await _fetch_jwks(url)
    key = next((k for k in keys if k.get("kid") == kid), None)
    if key is None:
        # kid not in cache — likely a rotation; refetch once before failing.
        keys = await _fetch_jwks(url, force=True)
        key = next((k for k in keys if k.get("kid") == kid), None)
    if key is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token signing key not found in Clerk JWKS",
        )
    return key


async def _verify_clerk_jwt(token: str) -> str:
    """Verify a Clerk session JWT and return its `sub` (Clerk user id)."""
    try:
        header = jwt.get_unverified_header(token)
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"malformed token: {e}",
        )

    issuers = _clerk_issuers()
    # Pick the configured issuer that matches the token's own `iss` claim, so
    # the right instance's JWKS is used. With none configured (e.g. dev-header
    # mode) issuer validation is skipped.
    token_iss = None
    try:
        token_iss = jwt.get_unverified_claims(token).get("iss")
    except JWTError:
        pass
    if token_iss:
        token_iss = token_iss.rstrip("/")

    if issuers:
        issuer = token_iss if token_iss in issuers else None
        if issuer is None:
            print(
                f"AUTH401 issuer-not-allowed token_iss={token_iss!r} "
                f"configured={issuers}",
                flush=True,
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="token issuer not allowed",
            )
    else:
        issuer = None  # unconfigured — skip issuer check

    jwks_url = _jwks_url_for(issuer) if issuer else os.environ.get("CLERK_JWKS_URL")
    if not jwks_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CLERK_ISSUER (or CLERK_JWKS_URL) is not configured",
        )
    key = await _signing_key_for(header.get("kid"), jwks_url)
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            issuer=issuer,  # validated only when set
            options={
                "verify_aud": False,  # Clerk session tokens have no `aud`
                "verify_iss": issuer is not None,
                # Clerk session tokens live only ~60s. Allow 60s of leeway on
                # exp/nbf so a token that expires in-flight or during a refresh
                # gap isn't spuriously rejected (the intermittent 401s).
                "leeway": 60,
            },
        )
    except JWTError as e:
        print(f"AUTH401 invalid-token reason={e} token_iss={token_iss!r}", flush=True)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"invalid token: {e}",
        )

    allowed = _authorized_parties()
    # `azp` is the authorized party — a browser *origin*. Native clients
    # (the Expo mobile app) legitimately have no azp claim, so only enforce
    # the allow-list when the claim is actually present. A web token whose
    # azp is set-but-not-listed is still rejected; a native token with no
    # azp passes.
    azp = claims.get("azp")
    if allowed and azp is not None and azp not in allowed:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token authorized party (azp) not allowed",
        )

    sub = claims.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token missing `sub` claim",
        )
    return sub


# ---------------------------------------------------------------------------
# Principal resolution
# ---------------------------------------------------------------------------

async def _resolve_clerk_user_id(
    authorization: Optional[str],
    x_clerk_user_id: Optional[str],
    *,
    required: bool,
) -> Optional[str]:
    """
    Resolve the Clerk user id from the request, or None if unauthenticated.

    When `required` is False (optional dependency), a present-but-invalid
    token resolves to None instead of raising — anonymous access is allowed.
    """
    # Dev/test escape hatch — must be explicitly enabled, never in prod.
    if _dev_header_allowed() and x_clerk_user_id:
        return x_clerk_user_id

    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(None, 1)[1]
        try:
            return await _verify_clerk_jwt(token)
        except HTTPException:
            if required:
                raise
            return None
    return None


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------

async def current_player(
    session: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(None),
    x_clerk_user_id: Optional[str] = Header(None),
) -> Player:
    """
    Resolve the request's authenticated Player.

    401 if no valid token is present, 403 if the token verifies but doesn't
    match a Player row (the Clerk webhook / bootstrap should have created
    one — investigate if this fires in prod).
    """
    user_id = await _resolve_clerk_user_id(
        authorization, x_clerk_user_id, required=True
    )
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing or invalid Clerk session token",
        )
    stmt = select(Player).where(Player.clerk_user_id == user_id)
    player = (await session.execute(stmt)).scalar_one_or_none()
    if player is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"no Player row for clerk_user_id={user_id} — webhook may have missed",
        )
    return player


async def current_player_optional(
    session: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(None),
    x_clerk_user_id: Optional[str] = Header(None),
) -> Optional[Player]:
    """Same as current_player but returns None instead of raising."""
    user_id = await _resolve_clerk_user_id(
        authorization, x_clerk_user_id, required=False
    )
    if not user_id:
        return None
    stmt = select(Player).where(Player.clerk_user_id == user_id)
    return (await session.execute(stmt)).scalar_one_or_none()


# ---------------------------------------------------------------------------
# Clerk webhook signature verification
# ---------------------------------------------------------------------------

def verify_clerk_webhook(
    body: bytes,
    headers: dict[str, str],
) -> None:
    """
    Verify a Clerk webhook signature via svix.

    Raises HTTPException(401) on any failure. Bypassed entirely when
    `CLERK_WEBHOOK_SKIP_VERIFY=1` — used by the test suite to inject
    payloads without a real Clerk account. NEVER set that env var in prod.

    Env vars are read on every call (not cached at import time) so tests
    can flip the bypass on/off without re-importing the module.
    """
    if os.environ.get("CLERK_WEBHOOK_SKIP_VERIFY") == "1":
        return
    secret = os.environ.get("CLERK_WEBHOOK_SECRET")
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CLERK_WEBHOOK_SECRET is not configured",
        )
    try:
        from svix.webhooks import Webhook, WebhookVerificationError  # type: ignore  # noqa: F401
    except ImportError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="svix package is required for webhook verification",
        ) from e
    try:
        Webhook(secret).verify(body, headers)
    except Exception as e:  # WebhookVerificationError + anything svix raises
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"invalid Clerk webhook signature: {e}",
        )
