"""
Auth-hardening tests — prove the production token path is actually safe.

These cover the Phase 2.6 hardening:
1. The unverified `X-Clerk-User-Id` header is rejected unless the explicit
   dev flag is set (the impersonation vector).
2. A forged / wrongly-signed Bearer token is rejected.
3. A correctly RS256-signed Clerk JWT verifies and resolves to its `sub`,
   end-to-end through the app.
"""

from __future__ import annotations

import os
import time

import pytest
import pytest_asyncio
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import ASGITransport, AsyncClient
from jose import jwk, jwt
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# The app must import with these set; webhook bypass keeps unrelated wiring quiet.
os.environ.setdefault("CLERK_WEBHOOK_SKIP_VERIFY", "1")

from badminton_rating.api import auth  # noqa: E402
from badminton_rating.api.app import create_app  # noqa: E402
from badminton_rating.db.models import Base, Player, PlayerGender  # noqa: E402
from badminton_rating.db.session import get_db  # noqa: E402


KID = "test-key-1"
ISSUER = "https://test-app.clerk.accounts.dev"


# ---------------------------------------------------------------------------
# Key material — one RSA keypair shared across the module
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def keypair():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    from cryptography.hazmat.primitives import serialization

    private_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    public_pem = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    jwk_dict = jwk.construct(public_pem, "RS256").to_dict()
    jwk_dict["kid"] = KID
    jwk_dict["alg"] = "RS256"
    jwk_dict["use"] = "sig"
    return private_pem, jwk_dict


def _make_token(private_pem: str, *, sub="clerk_real", iss=ISSUER, **extra):
    now = int(time.time())
    claims = {"sub": sub, "iss": iss, "iat": now, "nbf": now - 1,
              "exp": now + 600, **extra}
    return jwt.encode(claims, private_pem, algorithm="RS256",
                      headers={"kid": KID})


@pytest.fixture(autouse=True)
def _clean_env_and_cache(monkeypatch, keypair):
    """Each test starts from a known env + a fresh JWKS cache."""
    _, jwk_dict = keypair
    monkeypatch.delenv("CLERK_DEV_ALLOW_HEADER", raising=False)
    monkeypatch.setenv("CLERK_ISSUER", ISSUER)
    monkeypatch.delenv("CLERK_JWKS_URL", raising=False)
    monkeypatch.delenv("CLERK_AUTHORIZED_PARTIES", raising=False)
    auth._jwks_cache["keys"] = None
    auth._jwks_cache["fetched_at"] = 0.0

    # Never hit the network: serve our test JWKS.
    async def fake_fetch(*, force: bool = False):
        return [jwk_dict]

    monkeypatch.setattr(auth, "_fetch_jwks", fake_fetch)


# ---------------------------------------------------------------------------
# App fixture (sqlite, mirrors test_api_v1)
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def app_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _override_get_db():
        async with factory() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    app = create_app()
    app.dependency_overrides[get_db] = _override_get_db
    yield app, factory
    await engine.dispose()


@pytest_asyncio.fixture
async def client(app_factory):
    app, _ = app_factory
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


async def _seed(factory, *, clerk_id, name="Real Player"):
    async with factory() as s:
        p = Player(name=name, display_name=name, clerk_user_id=clerk_id,
                   gender=PlayerGender.M)
        s.add(p)
        await s.commit()
        await s.refresh(p)
        return p.id


# ---------------------------------------------------------------------------
# 1. The unverified header is an impersonation vector — reject by default
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_dev_header_rejected_when_flag_unset(app_factory, client):
    app, factory = app_factory
    await _seed(factory, clerk_id="clerk_real")
    # No CLERK_DEV_ALLOW_HEADER -> the header must NOT authenticate anyone.
    r = await client.get("/players/me", headers={"X-Clerk-User-Id": "clerk_real"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_dev_header_accepted_when_flag_set(app_factory, client, monkeypatch):
    app, factory = app_factory
    await _seed(factory, clerk_id="clerk_real")
    monkeypatch.setenv("CLERK_DEV_ALLOW_HEADER", "1")
    r = await client.get("/players/me", headers={"X-Clerk-User-Id": "clerk_real"})
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# 2. Forged / wrongly-signed Bearer tokens are rejected
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_garbage_bearer_rejected(client):
    r = await client.get(
        "/players/me", headers={"Authorization": "Bearer not.a.jwt"}
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_token_signed_by_wrong_key_rejected(client):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    from cryptography.hazmat.primitives import serialization

    wrong_pem = other.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    forged = _make_token(wrong_pem)  # signed by a key not in our JWKS
    r = await client.get(
        "/players/me", headers={"Authorization": f"Bearer {forged}"}
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_wrong_issuer_rejected(keypair, client):
    private_pem, _ = keypair
    bad_iss = _make_token(private_pem, iss="https://evil.example.com")
    r = await client.get(
        "/players/me", headers={"Authorization": f"Bearer {bad_iss}"}
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_expired_token_rejected(keypair, client):
    private_pem, _ = keypair
    now = int(time.time())
    expired = jwt.encode(
        {"sub": "clerk_real", "iss": ISSUER, "iat": now - 1000,
         "nbf": now - 1000, "exp": now - 500},
        private_pem, algorithm="RS256", headers={"kid": KID},
    )
    r = await client.get(
        "/players/me", headers={"Authorization": f"Bearer {expired}"}
    )
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# 3. A correctly-signed Clerk JWT verifies end-to-end
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_valid_jwt_resolves_player(keypair, app_factory, client):
    app, factory = app_factory
    await _seed(factory, clerk_id="clerk_real", name="Verified User")
    private_pem, _ = keypair
    token = _make_token(private_pem, sub="clerk_real")
    r = await client.get(
        "/players/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Verified User"


@pytest.mark.asyncio
async def test_valid_jwt_unknown_player_is_403(keypair, client):
    # Token verifies, but no Player row exists for this sub.
    private_pem, _ = keypair
    token = _make_token(private_pem, sub="clerk_nobody")
    r = await client.get(
        "/players/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_authorized_party_enforced(keypair, app_factory, client, monkeypatch):
    app, factory = app_factory
    await _seed(factory, clerk_id="clerk_real")
    private_pem, _ = keypair
    monkeypatch.setenv("CLERK_AUTHORIZED_PARTIES", "https://app.dubr.com")

    # azp not in the allowlist -> rejected
    bad = _make_token(private_pem, sub="clerk_real", azp="https://evil.com")
    r = await client.get("/players/me", headers={"Authorization": f"Bearer {bad}"})
    assert r.status_code == 401

    # azp in the allowlist -> accepted
    good = _make_token(private_pem, sub="clerk_real", azp="https://app.dubr.com")
    r = await client.get("/players/me", headers={"Authorization": f"Bearer {good}"})
    assert r.status_code == 200
