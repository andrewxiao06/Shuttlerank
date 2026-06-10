"""
Integration tests for the match submission service.

Uses an in-memory SQLite database so the suite stays hermetic — no docker,
no Postgres, no fixtures to tear down. SQLite doesn't enforce SELECT FOR
UPDATE the way Postgres does, but that lock is a concurrency safety net
rather than a correctness primitive, so behavior under serial test load
is identical.
"""

from datetime import date

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from badminton_rating.db.models import (
    Base,
    Match,
    MatchMode,
    MatchPlayer,
    MatchTypeDB,
    Player,
    Team,
)
from badminton_rating.services.matches import (
    MatchSubmission,
    MatchSubmissionError,
    submit_match,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        yield s
    await engine.dispose()


async def _seed_players(session, names):
    players = [Player(name=n) for n in names]
    session.add_all(players)
    await session.flush()
    return players


# ---------------------------------------------------------------------------
# Singles — happy path
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_singles_winner_gains_loser_loses(session):
    alice, bob = await _seed_players(session, ["Alice", "Bob"])
    pre_alice_r = alice.singles_r
    pre_bob_r = bob.singles_r

    match = await submit_match(session, MatchSubmission(
        mode=MatchMode.SINGLES,
        match_type=MatchTypeDB.CLUB,
        played_at=date(2026, 4, 20),
        team_a_player_ids=[alice.id],
        team_b_player_ids=[bob.id],
        team_a_score=21,
        team_b_score=15,
    ))
    await session.commit()

    assert match.id is not None
    assert match.winner_team is Team.A
    assert alice.singles_r > pre_alice_r
    assert bob.singles_r < pre_bob_r
    assert alice.singles_match_count == 1
    assert bob.singles_match_count == 1
    assert alice.doubles_match_count == 0  # singles match must not touch doubles


@pytest.mark.asyncio
async def test_singles_writes_audit_rows(session):
    alice, bob = await _seed_players(session, ["Alice", "Bob"])
    match = await submit_match(session, MatchSubmission(
        mode=MatchMode.SINGLES,
        match_type=MatchTypeDB.CLUB,
        played_at=date(2026, 4, 20),
        team_a_player_ids=[alice.id],
        team_b_player_ids=[bob.id],
        team_a_score=21,
        team_b_score=10,
    ))
    await session.commit()

    rows = (await session.execute(
        select(MatchPlayer).where(MatchPlayer.match_id == match.id).order_by(MatchPlayer.team)
    )).scalars().all()

    assert len(rows) == 2
    a_row = next(r for r in rows if r.team is Team.A)
    b_row = next(r for r in rows if r.team is Team.B)
    assert a_row.delta_r > 0
    assert b_row.delta_r < 0
    assert a_row.pre_r == 1500.0
    assert a_row.post_r == alice.singles_r


# ---------------------------------------------------------------------------
# Singles — winner is team B (score reversed)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_singles_team_b_can_win(session):
    alice, bob = await _seed_players(session, ["Alice", "Bob"])
    match = await submit_match(session, MatchSubmission(
        mode=MatchMode.SINGLES,
        match_type=MatchTypeDB.CLUB,
        played_at=date(2026, 4, 20),
        team_a_player_ids=[alice.id],
        team_b_player_ids=[bob.id],
        team_a_score=15,
        team_b_score=21,
    ))
    await session.commit()

    assert match.winner_team is Team.B
    assert bob.singles_r > 1500.0
    assert alice.singles_r < 1500.0


# ---------------------------------------------------------------------------
# Doubles
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_doubles_both_partners_get_equal_delta(session):
    a1, a2, b1, b2 = await _seed_players(session, ["A1", "A2", "B1", "B2"])
    await submit_match(session, MatchSubmission(
        mode=MatchMode.DOUBLES,
        match_type=MatchTypeDB.CLUB,
        played_at=date(2026, 4, 20),
        team_a_player_ids=[a1.id, a2.id],
        team_b_player_ids=[b1.id, b2.id],
        team_a_score=21,
        team_b_score=15,
    ))
    await session.commit()

    delta_a1 = a1.doubles_r - 1500.0
    delta_a2 = a2.doubles_r - 1500.0
    delta_b1 = b1.doubles_r - 1500.0
    delta_b2 = b2.doubles_r - 1500.0

    assert delta_a1 == pytest.approx(delta_a2)
    assert delta_b1 == pytest.approx(delta_b2)
    assert delta_a1 > 0
    assert delta_b1 < 0


@pytest.mark.asyncio
async def test_doubles_does_not_affect_singles_rating(session):
    a1, a2, b1, b2 = await _seed_players(session, ["A1", "A2", "B1", "B2"])
    await submit_match(session, MatchSubmission(
        mode=MatchMode.DOUBLES,
        match_type=MatchTypeDB.CLUB,
        played_at=date(2026, 4, 20),
        team_a_player_ids=[a1.id, a2.id],
        team_b_player_ids=[b1.id, b2.id],
        team_a_score=21,
        team_b_score=10,
    ))
    await session.commit()

    for p in (a1, a2, b1, b2):
        assert p.singles_r == 1500.0
        assert p.singles_match_count == 0
        assert p.doubles_match_count == 1


# ---------------------------------------------------------------------------
# Match type weighting (end-to-end)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_tournament_moves_rating_more_than_casual(session):
    a_c, b_c, a_t, b_t = await _seed_players(session, ["AC", "BC", "AT", "BT"])

    await submit_match(session, MatchSubmission(
        mode=MatchMode.SINGLES,
        match_type=MatchTypeDB.CASUAL,
        played_at=date(2026, 4, 20),
        team_a_player_ids=[a_c.id],
        team_b_player_ids=[b_c.id],
        team_a_score=21, team_b_score=15,
    ))
    await submit_match(session, MatchSubmission(
        mode=MatchMode.SINGLES,
        match_type=MatchTypeDB.TOURNAMENT,
        played_at=date(2026, 4, 20),
        team_a_player_ids=[a_t.id],
        team_b_player_ids=[b_t.id],
        team_a_score=21, team_b_score=15,
    ))
    await session.commit()

    assert (a_t.singles_r - 1500.0) > (a_c.singles_r - 1500.0)


# ---------------------------------------------------------------------------
# Validation errors
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_rejects_tied_score(session):
    a, b = await _seed_players(session, ["A", "B"])
    with pytest.raises(MatchSubmissionError, match="winner"):
        await submit_match(session, MatchSubmission(
            mode=MatchMode.SINGLES,
            match_type=MatchTypeDB.CLUB,
            played_at=date(2026, 4, 20),
            team_a_player_ids=[a.id],
            team_b_player_ids=[b.id],
            team_a_score=21, team_b_score=21,
        ))


@pytest.mark.asyncio
async def test_rejects_wrong_team_size_for_singles(session):
    a, b, c = await _seed_players(session, ["A", "B", "C"])
    with pytest.raises(MatchSubmissionError, match="singles"):
        await submit_match(session, MatchSubmission(
            mode=MatchMode.SINGLES,
            match_type=MatchTypeDB.CLUB,
            played_at=date(2026, 4, 20),
            team_a_player_ids=[a.id, b.id],
            team_b_player_ids=[c.id],
            team_a_score=21, team_b_score=15,
        ))


@pytest.mark.asyncio
async def test_rejects_duplicate_player(session):
    a, b = await _seed_players(session, ["A", "B"])
    with pytest.raises(MatchSubmissionError, match="more than once"):
        await submit_match(session, MatchSubmission(
            mode=MatchMode.DOUBLES,
            match_type=MatchTypeDB.CLUB,
            played_at=date(2026, 4, 20),
            team_a_player_ids=[a.id, b.id],
            team_b_player_ids=[a.id, b.id],
            team_a_score=21, team_b_score=15,
        ))


@pytest.mark.asyncio
async def test_rejects_unknown_player(session):
    a, b = await _seed_players(session, ["A", "B"])
    with pytest.raises(MatchSubmissionError, match="not found"):
        await submit_match(session, MatchSubmission(
            mode=MatchMode.SINGLES,
            match_type=MatchTypeDB.CLUB,
            played_at=date(2026, 4, 20),
            team_a_player_ids=[a.id],
            team_b_player_ids=[9999],
            team_a_score=21, team_b_score=15,
        ))


# ---------------------------------------------------------------------------
# Sequential matches accumulate state
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_repeated_wins_increase_rating_monotonically(session):
    alice, bob = await _seed_players(session, ["Alice", "Bob"])
    snapshots = [alice.singles_r]

    for _ in range(5):
        await submit_match(session, MatchSubmission(
            mode=MatchMode.SINGLES,
            match_type=MatchTypeDB.CLUB,
            played_at=date(2026, 4, 20),
            team_a_player_ids=[alice.id],
            team_b_player_ids=[bob.id],
            team_a_score=21, team_b_score=15,
        ))
        snapshots.append(alice.singles_r)

    assert snapshots == sorted(snapshots)
    assert alice.singles_match_count == 5
    assert alice.singles_r > 1500.0
