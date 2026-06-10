"""
End-to-end API tests against an in-memory SQLite database.

The shared session fixture overrides `get_db` so every route handler in
the request talks to the same connection — letting us assert on state
after the response in the same test.
"""

from datetime import date

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from badminton_rating.api.app import create_app
from badminton_rating.db.models import Base
from badminton_rating.db.session import get_db


@pytest_asyncio.fixture
async def client():
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

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    await engine.dispose()


async def _make_player(client, name):
    r = await client.post("/players", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# POST /players, GET /players/{id}
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_and_get_player(client):
    created = await _make_player(client, "Andrew")
    assert created["name"] == "Andrew"
    assert created["singles"]["display"] == 5.0
    assert created["singles"]["tier"].startswith("Platinum") or \
           created["singles"]["tier"].startswith("Gold")
    assert created["singles"]["calibrating"] is True
    assert created["singles"]["match_count"] == 0

    r = await client.get(f"/players/{created['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


@pytest.mark.asyncio
async def test_get_unknown_player_404(client):
    r = await client.get("/players/9999")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_create_player_duplicate_email_conflict(client):
    r1 = await client.post("/players", json={"name": "A", "email": "x@y.com"})
    assert r1.status_code == 201
    r2 = await client.post("/players", json={"name": "B", "email": "x@y.com"})
    assert r2.status_code == 409


# ---------------------------------------------------------------------------
# POST /matches
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_submit_singles_match_updates_ratings(client):
    a = await _make_player(client, "Alice")
    b = await _make_player(client, "Bob")

    r = await client.post("/matches", json={
        "mode": "singles",
        "match_type": "club",
        "played_at": "2026-04-20",
        "team_a_player_ids": [a["id"]],
        "team_b_player_ids": [b["id"]],
        "team_a_score": 21,
        "team_b_score": 15,
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["winner_team"] == "A"
    assert len(body["participants"]) == 2

    a_after = (await client.get(f"/players/{a['id']}")).json()
    b_after = (await client.get(f"/players/{b['id']}")).json()
    assert a_after["singles"]["r"] > 1500.0
    assert b_after["singles"]["r"] < 1500.0


@pytest.mark.asyncio
async def test_submit_invalid_match_returns_400(client):
    a = await _make_player(client, "A")
    b = await _make_player(client, "B")
    r = await client.post("/matches", json={
        "mode": "singles",
        "match_type": "club",
        "played_at": "2026-04-20",
        "team_a_player_ids": [a["id"]],
        "team_b_player_ids": [b["id"]],
        "team_a_score": 21,
        "team_b_score": 21,  # tie
    })
    assert r.status_code == 400
    assert "winner" in r.json()["detail"]


@pytest.mark.asyncio
async def test_submit_match_unknown_player_returns_400(client):
    a = await _make_player(client, "A")
    r = await client.post("/matches", json={
        "mode": "singles",
        "match_type": "club",
        "played_at": "2026-04-20",
        "team_a_player_ids": [a["id"]],
        "team_b_player_ids": [9999],
        "team_a_score": 21,
        "team_b_score": 15,
    })
    assert r.status_code == 400
    assert "not found" in r.json()["detail"]


# ---------------------------------------------------------------------------
# GET /players/{id}/forecast
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_forecast_equal_players_is_half(client):
    a = await _make_player(client, "A")
    b = await _make_player(client, "B")
    r = await client.get(f"/players/{a['id']}/forecast", params={"opponent_id": b["id"]})
    assert r.status_code == 200
    body = r.json()
    assert abs(body["win_probability"] - 0.5) < 0.01
    assert body["mode"] == "singles"
    assert body["player_calibrating"] is True


@pytest.mark.asyncio
async def test_forecast_self_rejected(client):
    a = await _make_player(client, "A")
    r = await client.get(f"/players/{a['id']}/forecast", params={"opponent_id": a["id"]})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_forecast_after_matches_favors_winner(client):
    a = await _make_player(client, "Alice")
    b = await _make_player(client, "Bob")
    # Alice beats Bob 5 times decisively
    for _ in range(5):
        await client.post("/matches", json={
            "mode": "singles",
            "match_type": "tournament",
            "played_at": "2026-04-20",
            "team_a_player_ids": [a["id"]],
            "team_b_player_ids": [b["id"]],
            "team_a_score": 21,
            "team_b_score": 8,
        })
    r = await client.get(f"/players/{a['id']}/forecast", params={"opponent_id": b["id"]})
    assert r.json()["win_probability"] > 0.6


# ---------------------------------------------------------------------------
# GET /players/{id}/matches
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_player_match_history_returns_deltas(client):
    a = await _make_player(client, "Alice")
    b = await _make_player(client, "Bob")
    await client.post("/matches", json={
        "mode": "singles",
        "match_type": "club",
        "played_at": "2026-04-20",
        "team_a_player_ids": [a["id"]],
        "team_b_player_ids": [b["id"]],
        "team_a_score": 21,
        "team_b_score": 15,
    })
    r = await client.get(f"/players/{a['id']}/matches")
    assert r.status_code == 200
    history = r.json()
    assert len(history) == 1
    a_row = next(p for p in history[0]["participants"] if p["player_id"] == a["id"])
    assert a_row["delta_r"] > 0


@pytest.mark.asyncio
async def test_player_match_history_empty_for_new_player(client):
    a = await _make_player(client, "Alice")
    r = await client.get(f"/players/{a['id']}/matches")
    assert r.status_code == 200
    assert r.json() == []


# ---------------------------------------------------------------------------
# GET /leaderboard
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_leaderboard_orders_by_rating(client):
    alice = await _make_player(client, "Alice")
    bob = await _make_player(client, "Bob")
    # Alice wins → her rating > Bob's
    await client.post("/matches", json={
        "mode": "singles",
        "match_type": "tournament",
        "played_at": "2026-04-20",
        "team_a_player_ids": [alice["id"]],
        "team_b_player_ids": [bob["id"]],
        "team_a_score": 21,
        "team_b_score": 10,
    })

    r = await client.get("/leaderboard", params={"mode": "singles"})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    assert body["entries"][0]["player_id"] == alice["id"]
    assert body["entries"][0]["rank"] == 1
    assert body["entries"][1]["player_id"] == bob["id"]
    assert body["entries"][1]["rank"] == 2


@pytest.mark.asyncio
async def test_leaderboard_filters_by_min_matches(client):
    alice = await _make_player(client, "Alice")
    bob = await _make_player(client, "Bob")
    chris = await _make_player(client, "Chris")  # never plays
    await client.post("/matches", json={
        "mode": "singles",
        "match_type": "club",
        "played_at": "2026-04-20",
        "team_a_player_ids": [alice["id"]],
        "team_b_player_ids": [bob["id"]],
        "team_a_score": 21, "team_b_score": 15,
    })

    r = await client.get("/leaderboard", params={"mode": "singles", "min_matches": 1})
    body = r.json()
    ids = [e["player_id"] for e in body["entries"]]
    assert chris["id"] not in ids
    assert body["total"] == 2


@pytest.mark.asyncio
async def test_leaderboard_pagination(client):
    for i in range(5):
        await _make_player(client, f"P{i}")
    r = await client.get("/leaderboard", params={"limit": 2, "offset": 2})
    body = r.json()
    assert len(body["entries"]) == 2
    assert body["entries"][0]["rank"] == 3
    assert body["entries"][1]["rank"] == 4


@pytest.mark.asyncio
async def test_leaderboard_doubles_independent_from_singles(client):
    a, b, c, d = [await _make_player(client, n) for n in ["A", "B", "C", "D"]]
    # Doubles match only
    await client.post("/matches", json={
        "mode": "doubles",
        "match_type": "club",
        "played_at": "2026-04-20",
        "team_a_player_ids": [a["id"], b["id"]],
        "team_b_player_ids": [c["id"], d["id"]],
        "team_a_score": 21, "team_b_score": 15,
    })
    singles_lb = (await client.get("/leaderboard", params={"mode": "singles", "min_matches": 1})).json()
    doubles_lb = (await client.get("/leaderboard", params={"mode": "doubles", "min_matches": 1})).json()
    assert singles_lb["total"] == 0
    assert doubles_lb["total"] == 4
