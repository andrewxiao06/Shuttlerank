"""
End-to-end tests for the V1 (category-routed) API surface.

Covers:
- Clerk webhook (with CLERK_WEBHOOK_SKIP_VERIFY=1)
- /players/me GET + PATCH
- POST /v1/matches (casual + ranked)
- /v1/matches/{id}/validate + state machine (PENDING → VERIFIED)
- /v1/matches/{id}/report
- /v1/matches/inbox/pending
- /v1/leaderboard
- Tournament create / sign-up / generate-pairings / complete
- /admin/tournaments/import returns 501
"""

from __future__ import annotations

import os
from datetime import date, datetime, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Set BEFORE importing the app so admin.require_admin sees the test admins.
os.environ["CLERK_WEBHOOK_SKIP_VERIFY"] = "1"
os.environ["BRS_ADMIN_USER_IDS"] = "clerk_admin"
# Allow the unverified X-Clerk-User-Id header — tests authenticate with it.
# In production this stays unset, so the header is rejected (see api/auth.py).
os.environ["CLERK_DEV_ALLOW_HEADER"] = "1"

from badminton_rating.api.app import create_app  # noqa: E402
from badminton_rating.api.auth import current_player  # noqa: E402
from badminton_rating.db.models import (  # noqa: E402
    Base,
    Player,
    PlayerGender,
)
from badminton_rating.db.session import get_db  # noqa: E402


@pytest_asyncio.fixture
async def factory_app():
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
async def client(factory_app):
    app, _ = factory_app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def _seed_player(factory, *, name, clerk_id, gender=None):
    async with factory() as session:
        p = Player(
            name=name,
            display_name=name,
            clerk_user_id=clerk_id,
            gender=gender,
        )
        session.add(p)
        await session.commit()
        await session.refresh(p)
        return p.id


def _h(clerk_id: str) -> dict:
    return {"X-Clerk-User-Id": clerk_id}


# ---------------------------------------------------------------------------
# Clerk webhook
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_clerk_webhook_creates_player(factory_app, client):
    app, factory = factory_app
    payload = {
        "type": "user.created",
        "data": {
            "id": "clerk_alice",
            "first_name": "Alice",
            "last_name": "Tan",
            "email_addresses": [{"email_address": "alice@example.com"}],
        },
    }
    r = await client.post("/webhooks/clerk", json=payload)
    assert r.status_code == 200

    async with factory() as s:
        row = (await s.execute(
            select(Player).where(Player.clerk_user_id == "clerk_alice")
        )).scalar_one()
        assert row.name == "Alice Tan"
        assert row.email == "alice@example.com"


@pytest.mark.asyncio
async def test_clerk_webhook_anonymizes_on_delete(factory_app, client):
    app, factory = factory_app
    pid = await _seed_player(factory, name="X", clerk_id="clerk_x")
    payload = {"type": "user.deleted", "data": {"id": "clerk_x"}}
    r = await client.post("/webhooks/clerk", json=payload)
    assert r.status_code == 200
    async with factory() as s:
        p = await s.get(Player, pid)
        assert p.clerk_user_id is None
        assert p.email is None
        assert p.name.startswith("deleted-")


# ---------------------------------------------------------------------------
# /players/me
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_me_requires_auth(client):
    r = await client.get("/players/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_me_unknown_clerk_id_is_403(client):
    r = await client.get("/players/me", headers=_h("clerk_ghost"))
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_get_me_returns_profile_with_default_rating(factory_app, client):
    _, factory = factory_app
    await _seed_player(factory, name="Alice", clerk_id="clerk_alice")
    r = await client.get("/players/me", headers=_h("clerk_alice"))
    assert r.status_code == 200
    body = r.json()
    assert body["clerk_user_id"] == "clerk_alice"
    # Players who haven't played yet still get the single default rating.
    assert len(body["ratings"]) == 1
    rating = body["ratings"][0]
    assert rating["category"] == "overall"
    assert rating["match_count"] == 0
    assert rating["calibrating"] is True


@pytest.mark.asyncio
async def test_patch_me_updates_display_name_and_gender(factory_app, client):
    _, factory = factory_app
    await _seed_player(factory, name="A", clerk_id="clerk_a")
    r = await client.patch(
        "/players/me",
        headers=_h("clerk_a"),
        json={"display_name": "Andy", "gender": "M"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["display_name"] == "Andy"
    assert body["gender"] == "M"


# ---------------------------------------------------------------------------
# /v1/matches — casual + ranked submission
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_post_v1_match_starts_pending_with_overall_category(factory_app, client):
    _, factory = factory_app
    a = await _seed_player(factory, name="A", clerk_id="clerk_a", gender=PlayerGender.M)
    b = await _seed_player(factory, name="B", clerk_id="clerk_b", gender=PlayerGender.M)
    r = await client.post(
        "/v1/matches",
        headers=_h("clerk_a"),
        json={
            "played_at": str(date(2026, 4, 20)),
            "team_a_player_ids": [a],
            "team_b_player_ids": [b],
            "team_a_score": 21,
            "team_b_score": 15,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["category"] == "overall"
    assert body["verified_at"] is None


@pytest.mark.asyncio
async def test_post_v1_match_ranked_starts_pending(factory_app, client):
    _, factory = factory_app
    a = await _seed_player(factory, name="A", clerk_id="clerk_a", gender=PlayerGender.M)
    b = await _seed_player(factory, name="B", clerk_id="clerk_b", gender=PlayerGender.M)
    r = await client.post(
        "/v1/matches",
        headers=_h("clerk_a"),
        json={
            "category": "mens_singles",
            "played_at": str(date(2026, 4, 20)),
            "team_a_player_ids": [a],
            "team_b_player_ids": [b],
            "team_a_score": 21,
            "team_b_score": 15,
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "pending"


@pytest.mark.asyncio
async def test_post_v1_match_allows_any_gender_matchup(factory_app, client):
    """Anyone can play anyone — gender is profile metadata only."""
    _, factory = factory_app
    m = await _seed_player(factory, name="M", clerk_id="clerk_m", gender=PlayerGender.M)
    w = await _seed_player(factory, name="W", clerk_id="clerk_w", gender=PlayerGender.W)
    r = await client.post(
        "/v1/matches",
        headers=_h("clerk_m"),
        json={
            "played_at": str(date(2026, 4, 20)),
            "team_a_player_ids": [m],
            "team_b_player_ids": [w],
            "team_a_score": 21, "team_b_score": 15,
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "pending"


# ---------------------------------------------------------------------------
# Validation flow
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_opponent_approval_flips_match_to_verified(factory_app, client):
    _, factory = factory_app
    a = await _seed_player(factory, name="A", clerk_id="clerk_a", gender=PlayerGender.M)
    b = await _seed_player(factory, name="B", clerk_id="clerk_b", gender=PlayerGender.M)

    # Submit → PENDING; the submitter (A) auto-approves.
    r = await client.post(
        "/v1/matches",
        headers=_h("clerk_a"),
        json={
            "played_at": str(date(2026, 4, 20)),
            "team_a_player_ids": [a],
            "team_b_player_ids": [b],
            "team_a_score": 21, "team_b_score": 10,
        },
    )
    match_id = r.json()["id"]

    # A approving again is a conflict — their submission already counted.
    r1 = await client.post(
        f"/v1/matches/{match_id}/validate",
        headers=_h("clerk_a"),
        json={"action": "approved"},
    )
    assert r1.status_code == 409

    # B approves → all participants approved → match verifies
    r2 = await client.post(
        f"/v1/matches/{match_id}/validate",
        headers=_h("clerk_b"),
        json={"action": "approved"},
    )
    assert r2.status_code == 201, r2.text

    # Fetch state
    detail = await client.get(f"/v1/matches/{match_id}")
    assert detail.json()["status"] == "verified"


@pytest.mark.asyncio
async def test_dispute_marks_match_disputed(factory_app, client):
    _, factory = factory_app
    a = await _seed_player(factory, name="A", clerk_id="clerk_a", gender=PlayerGender.M)
    b = await _seed_player(factory, name="B", clerk_id="clerk_b", gender=PlayerGender.M)
    r = await client.post(
        "/v1/matches",
        headers=_h("clerk_a"),
        json={
            "category": "mens_singles",
            "played_at": str(date(2026, 4, 20)),
            "team_a_player_ids": [a],
            "team_b_player_ids": [b],
            "team_a_score": 21, "team_b_score": 15,
        },
    )
    match_id = r.json()["id"]
    rd = await client.post(
        f"/v1/matches/{match_id}/validate",
        headers=_h("clerk_b"),
        json={"action": "disputed", "note": "score was 21-18"},
    )
    assert rd.status_code == 201
    detail = await client.get(f"/v1/matches/{match_id}")
    assert detail.json()["status"] == "disputed"


@pytest.mark.asyncio
async def test_non_participant_cannot_validate(factory_app, client):
    _, factory = factory_app
    a = await _seed_player(factory, name="A", clerk_id="clerk_a", gender=PlayerGender.M)
    b = await _seed_player(factory, name="B", clerk_id="clerk_b", gender=PlayerGender.M)
    c = await _seed_player(factory, name="C", clerk_id="clerk_c", gender=PlayerGender.M)
    r = await client.post(
        "/v1/matches",
        headers=_h("clerk_a"),
        json={
            "category": "mens_singles",
            "played_at": str(date(2026, 4, 20)),
            "team_a_player_ids": [a],
            "team_b_player_ids": [b],
            "team_a_score": 21, "team_b_score": 15,
        },
    )
    rv = await client.post(
        f"/v1/matches/{r.json()['id']}/validate",
        headers=_h("clerk_c"),
        json={"action": "approved"},
    )
    assert rv.status_code == 403


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_report_creates_open_report(factory_app, client):
    _, factory = factory_app
    a = await _seed_player(factory, name="A", clerk_id="clerk_a", gender=PlayerGender.M)
    b = await _seed_player(factory, name="B", clerk_id="clerk_b", gender=PlayerGender.M)
    m = await client.post(
        "/v1/matches",
        headers=_h("clerk_a"),
        json={
            "category": "casual",
            "played_at": str(date(2026, 4, 20)),
            "team_a_player_ids": [a],
            "team_b_player_ids": [b],
            "team_a_score": 21, "team_b_score": 15,
        },
    )
    r = await client.post(
        f"/v1/matches/{m.json()['id']}/report",
        headers=_h("clerk_b"),
        json={"reason": "wrong_score", "description": "actually 21-18"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "open"


# ---------------------------------------------------------------------------
# Pending inbox
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pending_inbox_lists_only_my_pending_matches(factory_app, client):
    _, factory = factory_app
    a = await _seed_player(factory, name="A", clerk_id="clerk_a", gender=PlayerGender.M)
    b = await _seed_player(factory, name="B", clerk_id="clerk_b", gender=PlayerGender.M)
    await client.post(
        "/v1/matches",
        headers=_h("clerk_a"),
        json={
            "category": "mens_singles",
            "played_at": str(date(2026, 4, 20)),
            "team_a_player_ids": [a],
            "team_b_player_ids": [b],
            "team_a_score": 21, "team_b_score": 15,
        },
    )
    r = await client.get("/v1/matches/inbox/pending", headers=_h("clerk_b"))
    assert r.status_code == 200
    assert len(r.json()) == 1


# ---------------------------------------------------------------------------
# Leaderboard
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_category_leaderboard_returns_entries_in_order(factory_app, client):
    _, factory = factory_app
    a = await _seed_player(factory, name="Aaron", clerk_id="clerk_a", gender=PlayerGender.M)
    b = await _seed_player(factory, name="Bob", clerk_id="clerk_b", gender=PlayerGender.M)
    # Casual match — verifies immediately, creates rating rows.
    await client.post(
        "/v1/matches",
        headers=_h("clerk_a"),
        json={
            "category": "casual",
            "played_at": str(date(2026, 4, 20)),
            "team_a_player_ids": [a],
            "team_b_player_ids": [b],
            "team_a_score": 21, "team_b_score": 10,
        },
    )
    r = await client.get("/v1/leaderboard?category=casual")
    assert r.status_code == 200
    body = r.json()
    # Both should appear; A (winner) ranked above B
    assert body["total"] == 2
    names = [e["name"] for e in body["entries"]]
    assert names == ["Aaron", "Bob"]


# ---------------------------------------------------------------------------
# Tournaments
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_tournament_lifecycle(factory_app, client):
    _, factory = factory_app
    organizer = await _seed_player(factory, name="Org", clerk_id="clerk_org", gender=PlayerGender.M)
    p1 = await _seed_player(factory, name="P1", clerk_id="clerk_p1", gender=PlayerGender.M)
    p2 = await _seed_player(factory, name="P2", clerk_id="clerk_p2", gender=PlayerGender.M)
    p3 = await _seed_player(factory, name="P3", clerk_id="clerk_p3", gender=PlayerGender.M)
    p4 = await _seed_player(factory, name="P4", clerk_id="clerk_p4", gender=PlayerGender.M)

    # Organizer creates
    create = await client.post(
        "/tournaments",
        headers=_h("clerk_org"),
        json={
            "name": "Spring Slam",
            "format": "single_elim",
            "category": "mens_singles",
            "starts_at": "2026-05-01T10:00:00Z",
        },
    )
    assert create.status_code == 201, create.text
    tid = create.json()["id"]
    assert create.json()["status"] == "draft"

    # 4 players sign up
    for clerk_id in ("clerk_p1", "clerk_p2", "clerk_p3", "clerk_p4"):
        r = await client.post(f"/tournaments/{tid}/entries", headers=_h(clerk_id))
        assert r.status_code == 201, r.text

    # Generate pairings
    pair = await client.post(
        f"/tournaments/{tid}/generate-pairings",
        headers=_h("clerk_org"),
    )
    assert pair.status_code == 200, pair.text
    assert len(pair.json()["matches"]) == 2  # 4 players → 2 first-round matches

    # Tournament now IN_PROGRESS
    detail = await client.get(f"/tournaments/{tid}")
    assert detail.json()["status"] == "in_progress"

    # Complete
    finish = await client.post(
        f"/tournaments/{tid}/complete",
        headers=_h("clerk_org"),
    )
    assert finish.status_code == 200
    assert finish.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_non_organizer_cannot_generate_pairings(factory_app, client):
    _, factory = factory_app
    org = await _seed_player(factory, name="O", clerk_id="clerk_org", gender=PlayerGender.M)
    p1 = await _seed_player(factory, name="P1", clerk_id="clerk_p1", gender=PlayerGender.M)
    p2 = await _seed_player(factory, name="P2", clerk_id="clerk_p2", gender=PlayerGender.M)
    create = await client.post(
        "/tournaments",
        headers=_h("clerk_org"),
        json={
            "name": "X",
            "format": "round_robin",
            "category": "mens_singles",
            "starts_at": "2026-05-01T10:00:00Z",
        },
    )
    tid = create.json()["id"]
    await client.post(f"/tournaments/{tid}/entries", headers=_h("clerk_p1"))
    await client.post(f"/tournaments/{tid}/entries", headers=_h("clerk_p2"))
    r = await client.post(
        f"/tournaments/{tid}/generate-pairings",
        headers=_h("clerk_p1"),
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_ranked_tournament_requires_admin(factory_app, client):
    _, factory = factory_app
    await _seed_player(factory, name="Rando", clerk_id="clerk_rando")
    await _seed_player(factory, name="Admin", clerk_id="clerk_admin")
    body = {
        "name": "Official Open",
        "format": "single_elim",
        "ranked": True,
        "starts_at": "2026-05-01T10:00:00Z",
    }
    denied = await client.post("/tournaments", headers=_h("clerk_rando"), json=body)
    assert denied.status_code == 403

    allowed = await client.post("/tournaments", headers=_h("clerk_admin"), json=body)
    assert allowed.status_code == 201, allowed.text
    assert allowed.json()["ranked"] is True


@pytest.mark.asyncio
async def test_anyone_can_create_casual_tournament(factory_app, client):
    _, factory = factory_app
    await _seed_player(factory, name="Rando", clerk_id="clerk_rando")
    r = await client.post(
        "/tournaments",
        headers=_h("clerk_rando"),
        json={
            "name": "Friday Night Smash",
            "format": "round_robin",
            "starts_at": "2026-05-01T10:00:00Z",
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["ranked"] is False


# ---------------------------------------------------------------------------
# Forecast — works for any two players, rated or not
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_forecast_works_for_unrated_players(factory_app, client):
    _, factory = factory_app
    a = await _seed_player(factory, name="A", clerk_id="clerk_a")
    b = await _seed_player(factory, name="B", clerk_id="clerk_b")
    r = await client.get(f"/v1/players/{a}/forecast?opponent_id={b}")
    assert r.status_code == 200, r.text
    body = r.json()
    # Two fresh players are an even matchup.
    assert body["win_probability"] == pytest.approx(0.5, abs=0.01)
    assert body["player_calibrating"] is True


@pytest.mark.asyncio
async def test_forecast_404_for_unknown_player(factory_app, client):
    _, factory = factory_app
    a = await _seed_player(factory, name="A", clerk_id="clerk_a")
    r = await client.get(f"/v1/players/{a}/forecast?opponent_id=99999")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_tournament_import_returns_501(factory_app, client):
    _, factory = factory_app
    await _seed_player(factory, name="Admin", clerk_id="clerk_admin")
    r = await client.post(
        "/admin/tournaments/import",
        headers=_h("clerk_admin"),
        json={},
    )
    assert r.status_code == 501


@pytest.mark.asyncio
async def test_admin_required_for_import(factory_app, client):
    _, factory = factory_app
    await _seed_player(factory, name="Random", clerk_id="clerk_random")
    r = await client.post(
        "/admin/tournaments/import",
        headers=_h("clerk_random"),
        json={},
    )
    assert r.status_code == 403
