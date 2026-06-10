"""
Integration tests for services/categories.py — single universal rating.

In-memory SQLite, same pattern as test_match_service.py.

The invariants under test:
1. Every submission goes to PENDING and does NOT move ratings until verified.
2. The submitter's approval is recorded automatically on submission.
3. verify_pending_match flips status and applies the rating update.
4. Anyone can play anyone — no gender or category eligibility rules.
5. The single OVERALL rating row is created on demand.
6. The ceiling clamps the post-match display rating.
7. Match weight depends on the tournament: none → CASUAL, unranked → CLUB,
   ranked → TOURNAMENT.
"""

from datetime import date, datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from badminton_rating.db.models import (
    Base,
    INITIAL_CEILING,
    MatchStatus,
    MatchValidation,
    Player,
    PlayerCategoryRating,
    PlayerGender,
    RatingCategory,
    Tournament,
    TournamentFormat,
    TournamentStatus,
    ValidationAction,
)
from badminton_rating.engine.glicko import from_display_rating, to_display_rating
from badminton_rating.services.categories import (
    CategoryMatchSubmission,
    CategorySubmissionError,
    submit_category_match,
    verify_pending_match,
)


# Internal r value corresponding to the default ceiling — new players start here.
START_R = from_display_rating(INITIAL_CEILING)


async def _bump_ceiling(session, player_id, new_ceiling=8.0):
    """Raise a player's ceiling so we can observe free rating movement
    without the clamp interfering. Used by tests that aren't about the cap."""
    row = (await session.execute(
        select(PlayerCategoryRating).where(
            PlayerCategoryRating.player_id == player_id,
            PlayerCategoryRating.category == RatingCategory.OVERALL,
        )
    )).scalar_one_or_none()
    if row is None:
        row = PlayerCategoryRating(
            player_id=player_id,
            category=RatingCategory.OVERALL,
            ceiling=new_ceiling,
        )
        session.add(row)
    else:
        row.ceiling = new_ceiling
    await session.flush()


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


async def _seed(session, name, gender=None, clerk_id=None):
    p = Player(name=name, gender=gender, clerk_user_id=clerk_id)
    session.add(p)
    await session.flush()
    return p


async def _get_rating_row(session, player_id):
    return (await session.execute(
        select(PlayerCategoryRating).where(
            PlayerCategoryRating.player_id == player_id,
            PlayerCategoryRating.category == RatingCategory.OVERALL,
        )
    )).scalar_one_or_none()


def _sub(team_a, team_b, score_a=21, score_b=15, submitted_by=None):
    return CategoryMatchSubmission(
        played_at=date(2026, 4, 20),
        team_a_player_ids=team_a,
        team_b_player_ids=team_b,
        team_a_score=score_a,
        team_b_score=score_b,
        submitted_by_user_id=submitted_by,
    )


# ---------------------------------------------------------------------------
# Pending state machine
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_match_starts_pending_no_rating_change(session):
    alice = await _seed(session, "Alice")
    beth = await _seed(session, "Beth")

    match = await submit_category_match(session, _sub([alice.id], [beth.id]))
    await session.commit()

    assert match.status is MatchStatus.PENDING
    assert match.verified_at is None
    assert match.expires_at is not None
    assert match.category is RatingCategory.OVERALL

    # Ratings must NOT have moved yet — both players still at the starting r.
    alice_row = await _get_rating_row(session, alice.id)
    beth_row = await _get_rating_row(session, beth.id)
    assert alice_row.r == pytest.approx(START_R)
    assert beth_row.r == pytest.approx(START_R)
    assert alice_row.match_count == 0
    assert beth_row.match_count == 0


@pytest.mark.asyncio
async def test_submitter_auto_approves(session):
    alice = await _seed(session, "Alice", clerk_id="clerk_alice")
    beth = await _seed(session, "Beth", clerk_id="clerk_beth")

    match = await submit_category_match(
        session, _sub([alice.id], [beth.id], submitted_by="clerk_alice")
    )
    await session.commit()

    validations = (await session.execute(
        select(MatchValidation).where(MatchValidation.match_id == match.id)
    )).scalars().all()
    assert len(validations) == 1
    assert validations[0].user_id == "clerk_alice"
    assert validations[0].action is ValidationAction.APPROVED


@pytest.mark.asyncio
async def test_verify_pending_match_applies_rating(session):
    alice = await _seed(session, "Alice")
    beth = await _seed(session, "Beth")
    await _bump_ceiling(session, alice.id)
    await _bump_ceiling(session, beth.id)

    match = await submit_category_match(
        session, _sub([alice.id], [beth.id], 21, 10)
    )
    await verify_pending_match(session, match)
    await session.commit()

    assert match.status is MatchStatus.VERIFIED
    alice_row = await _get_rating_row(session, alice.id)
    beth_row = await _get_rating_row(session, beth.id)
    assert alice_row.r > START_R
    assert beth_row.r < START_R
    assert alice_row.match_count == 1


@pytest.mark.asyncio
async def test_verify_already_verified_match_raises(session):
    a = await _seed(session, "A")
    b = await _seed(session, "B")
    match = await submit_category_match(session, _sub([a.id], [b.id]))
    await verify_pending_match(session, match)
    with pytest.raises(CategorySubmissionError, match="PENDING"):
        await verify_pending_match(session, match)


# ---------------------------------------------------------------------------
# Anyone plays anyone — no gender rules
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_any_gender_combination_allowed(session):
    a = await _seed(session, "A", PlayerGender.M)
    b = await _seed(session, "B", PlayerGender.W)
    c = await _seed(session, "C", PlayerGender.M)
    d = await _seed(session, "D", PlayerGender.X)
    # Mixed (M+W) vs (M+X) — fine; gender is profile metadata only.
    match = await submit_category_match(
        session, _sub([a.id, b.id], [c.id, d.id])
    )
    assert match.status is MatchStatus.PENDING
    await session.commit()


@pytest.mark.asyncio
async def test_shape_validation(session):
    a = await _seed(session, "A")
    b = await _seed(session, "B")
    c = await _seed(session, "C")
    with pytest.raises(CategorySubmissionError, match="same number"):
        await submit_category_match(session, _sub([a.id, b.id], [c.id]))
    with pytest.raises(CategorySubmissionError, match="more than once"):
        await submit_category_match(session, _sub([a.id], [a.id]))
    with pytest.raises(CategorySubmissionError, match="tied"):
        await submit_category_match(session, _sub([a.id], [b.id], 21, 21))


# ---------------------------------------------------------------------------
# Tournament weighting — ranked > unranked > regular
# ---------------------------------------------------------------------------

async def _tournament(session, ranked: bool) -> Tournament:
    t = Tournament(
        name="T",
        format=TournamentFormat.ROUND_ROBIN,
        ranked=ranked,
        starts_at=datetime(2026, 4, 20, tzinfo=timezone.utc),
        status=TournamentStatus.IN_PROGRESS,
    )
    session.add(t)
    await session.flush()
    return t


async def _delta_for_weight(session, names, tournament=None) -> float:
    """Submit + verify a 21-10 win between two fresh players; return the
    winner's rating gain. Ceilings are lifted so the clamp can't mask it."""
    a = await _seed(session, names[0])
    b = await _seed(session, names[1])
    await _bump_ceiling(session, a.id)
    await _bump_ceiling(session, b.id)
    match = await submit_category_match(session, _sub([a.id], [b.id], 21, 10))
    if tournament is not None:
        match.tournament_id = tournament.id
        await session.flush()
    await verify_pending_match(session, match)
    row = await _get_rating_row(session, a.id)
    return row.r - START_R


@pytest.mark.asyncio
async def test_ranked_tournament_outweighs_casual_and_unranked(session):
    regular = await _delta_for_weight(session, ["A1", "B1"])
    unranked_t = await _tournament(session, ranked=False)
    unranked = await _delta_for_weight(session, ["A2", "B2"], unranked_t)
    ranked_t = await _tournament(session, ranked=True)
    ranked = await _delta_for_weight(session, ["A3", "B3"], ranked_t)
    assert regular < unranked < ranked


# ---------------------------------------------------------------------------
# Ceiling clamp
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_match_respects_ceiling(session):
    """A capped player should never end up above their ceiling."""
    a = await _seed(session, "A")
    b = await _seed(session, "B")

    match = await submit_category_match(session, _sub([a.id], [b.id], 21, 3))
    await verify_pending_match(session, match)
    await session.commit()
    a_row = await _get_rating_row(session, a.id)
    # Force the ceiling extremely low and the internal r very high
    a_row.ceiling = 4.0
    a_row.r = 1700.0  # ~5.2 display
    await session.commit()

    # Another lopsided win → would push display higher, but ceiling clamps it
    c = await _seed(session, "C")
    match2 = await submit_category_match(session, _sub([a.id], [c.id], 21, 3))
    await verify_pending_match(session, match2)
    await session.commit()

    a_row_after = await _get_rating_row(session, a.id)
    assert to_display_rating(a_row_after.r) <= 4.001  # tiny rounding slack


# ---------------------------------------------------------------------------
# Auto-creation of the OVERALL rating row
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_overall_rating_row_created_on_first_match(session):
    a = await _seed(session, "A")
    b = await _seed(session, "B")
    # No PlayerCategoryRating rows exist yet
    pre = await _get_rating_row(session, a.id)
    assert pre is None

    await submit_category_match(session, _sub([a.id], [b.id]))
    await session.commit()
    post = await _get_rating_row(session, a.id)
    assert post is not None
    assert post.category is RatingCategory.OVERALL
    assert post.ceiling == INITIAL_CEILING
