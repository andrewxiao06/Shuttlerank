"""
Email notification tests. The transport (services/email.send_email) is
monkeypatched so nothing hits the network — we assert on who would be emailed.
"""

from datetime import date

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from badminton_rating.db.models import Base, Match, Player
from badminton_rating.services import notifications
from badminton_rating.services.categories import (
    CategoryMatchSubmission,
    submit_category_match,
)


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        yield s
    await engine.dispose()


async def _seed(session, name, clerk_id, email):
    p = Player(name=name, clerk_user_id=clerk_id, email=email)
    session.add(p)
    await session.flush()
    return p


async def _pending_match(session, submitter, opponent):
    match = await submit_category_match(
        session,
        CategoryMatchSubmission(
            played_at=date(2026, 6, 25),
            team_a_player_ids=[submitter.id],
            team_b_player_ids=[opponent.id],
            team_a_score=21,
            team_b_score=15,
            submitted_by_user_id=submitter.clerk_user_id,
        ),
    )
    await session.flush()
    await session.refresh(match, attribute_names=["participants"])
    return match


@pytest.mark.asyncio
async def test_disabled_without_key_is_noop(session, monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    a = await _seed(session, "A", "clerk_a", "a@example.com")
    b = await _seed(session, "B", "clerk_b", "b@example.com")
    match = await _pending_match(session, a, b)

    sent = await notifications.notify_pending_match(session, match)
    assert sent == 0  # email disabled → nothing attempted, no crash


@pytest.mark.asyncio
async def test_notifies_opponent_not_submitter(session, monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "test_key")
    captured: list[str] = []

    async def fake_send(*, to, subject, html):
        captured.append(to)
        return True

    monkeypatch.setattr(notifications, "send_email", fake_send)

    a = await _seed(session, "Alice", "clerk_a", "alice@example.com")
    b = await _seed(session, "Bob", "clerk_b", "bob@example.com")
    match = await _pending_match(session, a, b)  # Alice submits

    sent = await notifications.notify_pending_match(session, match)
    assert sent == 1
    # Only the opponent (Bob) is emailed; the submitter (Alice) is not.
    assert captured == ["bob@example.com"]


@pytest.mark.asyncio
async def test_skips_participants_without_email(session, monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "test_key")
    captured: list[str] = []

    async def fake_send(*, to, subject, html):
        captured.append(to)
        return True

    monkeypatch.setattr(notifications, "send_email", fake_send)

    a = await _seed(session, "Alice", "clerk_a", "alice@example.com")
    b = await _seed(session, "Bob", "clerk_b", None)  # no email on file
    match = await _pending_match(session, a, b)

    sent = await notifications.notify_pending_match(session, match)
    assert sent == 0
    assert captured == []
