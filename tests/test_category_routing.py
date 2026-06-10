"""
Integration tests for services/categories.py.

In-memory SQLite, same pattern as test_match_service.py.

The invariants under test:
1. Casual matches verify instantly and apply rating immediately.
2. Ranked matches go to PENDING and DO NOT move ratings until verified.
3. verify_pending_match flips status and applies the rating update.
4. Gender eligibility is enforced per category (mens/womens/mixed_doubles).
5. PlayerCategoryRating rows are created on demand for new (player, category).
6. The ceiling clamps the post-match display rating.
"""

from datetime import date

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from badminton_rating.db.models import (
    Base,
    INITIAL_CEILING,
    MatchStatus,
    Player,
    PlayerCategoryRating,
    PlayerGender,
    RatingCategory,
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


async def _bump_ceiling(session, player_id, category, new_ceiling=8.0):
    """Raise a player's ceiling so we can observe free rating movement
    without the clamp interfering. Used by tests that aren't about the cap."""
    from sqlalchemy import select as _select
    row = (await session.execute(
        _select(PlayerCategoryRating).where(
            PlayerCategoryRating.player_id == player_id,
            PlayerCategoryRating.category == category,
        )
    )).scalar_one_or_none()
    if row is None:
        row = PlayerCategoryRating(
            player_id=player_id, category=category, ceiling=new_ceiling
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


async def _seed(session, name, gender=None):
    p = Player(name=name, gender=gender)
    session.add(p)
    await session.flush()
    return p


async def _get_rating_row(session, player_id, category):
    return (await session.execute(
        select(PlayerCategoryRating).where(
            PlayerCategoryRating.player_id == player_id,
            PlayerCategoryRating.category == category,
        )
    )).scalar_one_or_none()


# ---------------------------------------------------------------------------
# Casual — instant verify + rating update
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_casual_match_verifies_immediately(session):
    alice = await _seed(session, "Alice", PlayerGender.W)
    bob = await _seed(session, "Bob", PlayerGender.M)
    # Bump ceilings so the rating movement we're testing isn't clamped.
    await _bump_ceiling(session, alice.id, RatingCategory.CASUAL)
    await _bump_ceiling(session, bob.id, RatingCategory.CASUAL)

    match = await submit_category_match(session, CategoryMatchSubmission(
        category=RatingCategory.CASUAL,
        played_at=date(2026, 4, 20),
        team_a_player_ids=[alice.id],
        team_b_player_ids=[bob.id],
        team_a_score=21, team_b_score=15,
    ))
    await session.commit()

    assert match.status is MatchStatus.VERIFIED
    assert match.verified_at is not None

    alice_row = await _get_rating_row(session, alice.id, RatingCategory.CASUAL)
    bob_row = await _get_rating_row(session, bob.id, RatingCategory.CASUAL)
    assert alice_row.r > START_R   # winner gained relative to starting point
    assert bob_row.r < START_R     # loser dropped
    assert alice_row.match_count == 1


@pytest.mark.asyncio
async def test_casual_allows_mixed_genders(session):
    """Casual ignores gender entirely — that's the whole point."""
    a = await _seed(session, "A", PlayerGender.M)
    b = await _seed(session, "B", PlayerGender.W)
    c = await _seed(session, "C", PlayerGender.M)
    d = await _seed(session, "D", PlayerGender.M)
    # Mixed (M+W) vs same-gender (M+M) — fine in casual
    await submit_category_match(session, CategoryMatchSubmission(
        category=RatingCategory.CASUAL,
        played_at=date(2026, 4, 20),
        team_a_player_ids=[a.id, b.id],
        team_b_player_ids=[c.id, d.id],
        team_a_score=21, team_b_score=15,
    ))
    await session.commit()


# ---------------------------------------------------------------------------
# Ranked — pending state machine
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ranked_match_starts_pending_no_rating_change(session):
    alice = await _seed(session, "Alice", PlayerGender.W)
    beth = await _seed(session, "Beth", PlayerGender.W)

    match = await submit_category_match(session, CategoryMatchSubmission(
        category=RatingCategory.WOMENS_SINGLES,
        played_at=date(2026, 4, 20),
        team_a_player_ids=[alice.id],
        team_b_player_ids=[beth.id],
        team_a_score=21, team_b_score=15,
    ))
    await session.commit()

    assert match.status is MatchStatus.PENDING
    assert match.verified_at is None
    assert match.expires_at is not None

    # Ratings must NOT have moved yet — both players still at the starting r.
    alice_row = await _get_rating_row(session, alice.id, RatingCategory.WOMENS_SINGLES)
    beth_row = await _get_rating_row(session, beth.id, RatingCategory.WOMENS_SINGLES)
    assert alice_row.r == pytest.approx(START_R)
    assert beth_row.r == pytest.approx(START_R)
    assert alice_row.match_count == 0
    assert beth_row.match_count == 0


@pytest.mark.asyncio
async def test_verify_pending_match_applies_rating(session):
    alice = await _seed(session, "Alice", PlayerGender.W)
    beth = await _seed(session, "Beth", PlayerGender.W)
    await _bump_ceiling(session, alice.id, RatingCategory.WOMENS_SINGLES)
    await _bump_ceiling(session, beth.id, RatingCategory.WOMENS_SINGLES)

    match = await submit_category_match(session, CategoryMatchSubmission(
        category=RatingCategory.WOMENS_SINGLES,
        played_at=date(2026, 4, 20),
        team_a_player_ids=[alice.id],
        team_b_player_ids=[beth.id],
        team_a_score=21, team_b_score=10,
    ))
    await verify_pending_match(session, match)
    await session.commit()

    assert match.status is MatchStatus.VERIFIED
    alice_row = await _get_rating_row(session, alice.id, RatingCategory.WOMENS_SINGLES)
    beth_row = await _get_rating_row(session, beth.id, RatingCategory.WOMENS_SINGLES)
    assert alice_row.r > START_R
    assert beth_row.r < START_R


@pytest.mark.asyncio
async def test_verify_already_verified_match_raises(session):
    a = await _seed(session, "A", PlayerGender.M)
    b = await _seed(session, "B", PlayerGender.M)
    match = await submit_category_match(session, CategoryMatchSubmission(
        category=RatingCategory.CASUAL,  # casual → already VERIFIED
        played_at=date(2026, 4, 20),
        team_a_player_ids=[a.id],
        team_b_player_ids=[b.id],
        team_a_score=21, team_b_score=15,
    ))
    with pytest.raises(CategorySubmissionError, match="PENDING"):
        await verify_pending_match(session, match)


# ---------------------------------------------------------------------------
# Eligibility
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_mens_singles_rejects_female_player(session):
    male = await _seed(session, "Male", PlayerGender.M)
    female = await _seed(session, "Female", PlayerGender.W)
    with pytest.raises(CategorySubmissionError, match="male"):
        await submit_category_match(session, CategoryMatchSubmission(
            category=RatingCategory.MENS_SINGLES,
            played_at=date(2026, 4, 20),
            team_a_player_ids=[male.id],
            team_b_player_ids=[female.id],
            team_a_score=21, team_b_score=15,
        ))


@pytest.mark.asyncio
async def test_mixed_doubles_requires_1m_1w_per_team(session):
    m1 = await _seed(session, "M1", PlayerGender.M)
    m2 = await _seed(session, "M2", PlayerGender.M)
    w1 = await _seed(session, "W1", PlayerGender.W)
    w2 = await _seed(session, "W2", PlayerGender.W)
    # 2 males vs 2 females — not mixed-per-team
    with pytest.raises(CategorySubmissionError, match="one male and one female"):
        await submit_category_match(session, CategoryMatchSubmission(
            category=RatingCategory.MIXED_DOUBLES,
            played_at=date(2026, 4, 20),
            team_a_player_ids=[m1.id, m2.id],
            team_b_player_ids=[w1.id, w2.id],
            team_a_score=21, team_b_score=15,
        ))


@pytest.mark.asyncio
async def test_mixed_doubles_happy_path(session):
    m1 = await _seed(session, "M1", PlayerGender.M)
    m2 = await _seed(session, "M2", PlayerGender.M)
    w1 = await _seed(session, "W1", PlayerGender.W)
    w2 = await _seed(session, "W2", PlayerGender.W)
    match = await submit_category_match(session, CategoryMatchSubmission(
        category=RatingCategory.MIXED_DOUBLES,
        played_at=date(2026, 4, 20),
        team_a_player_ids=[m1.id, w1.id],
        team_b_player_ids=[m2.id, w2.id],
        team_a_score=21, team_b_score=15,
    ))
    assert match.status is MatchStatus.PENDING


# ---------------------------------------------------------------------------
# Ceiling clamp
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_casual_match_respects_ceiling(session):
    """A capped player should never end up above their ceiling."""
    a = await _seed(session, "A", PlayerGender.M)
    b = await _seed(session, "B", PlayerGender.M)

    # Seed A's casual rating high but cap them at 4.0
    await submit_category_match(session, CategoryMatchSubmission(
        category=RatingCategory.CASUAL,
        played_at=date(2026, 4, 20),
        team_a_player_ids=[a.id],
        team_b_player_ids=[b.id],
        team_a_score=21, team_b_score=3,
    ))
    await session.commit()
    a_row = await _get_rating_row(session, a.id, RatingCategory.CASUAL)
    # Force the ceiling extremely low and the internal r very high
    a_row.ceiling = 4.0
    a_row.r = 1700.0  # ~5.2 display
    await session.commit()

    # Another lopsided win → would push display higher, but ceiling clamps it
    c = await _seed(session, "C", PlayerGender.M)
    await submit_category_match(session, CategoryMatchSubmission(
        category=RatingCategory.CASUAL,
        played_at=date(2026, 4, 20),
        team_a_player_ids=[a.id],
        team_b_player_ids=[c.id],
        team_a_score=21, team_b_score=3,
    ))
    await session.commit()

    a_row_after = await _get_rating_row(session, a.id, RatingCategory.CASUAL)
    from badminton_rating.engine.glicko import to_display_rating
    assert to_display_rating(a_row_after.r) <= 4.001  # tiny rounding slack


# ---------------------------------------------------------------------------
# Auto-creation of PlayerCategoryRating row
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_category_rating_row_created_on_first_match(session):
    a = await _seed(session, "A", PlayerGender.M)
    b = await _seed(session, "B", PlayerGender.M)
    # No PlayerCategoryRating rows exist yet
    pre = await _get_rating_row(session, a.id, RatingCategory.MENS_SINGLES)
    assert pre is None

    await submit_category_match(session, CategoryMatchSubmission(
        category=RatingCategory.MENS_SINGLES,
        played_at=date(2026, 4, 20),
        team_a_player_ids=[a.id],
        team_b_player_ids=[b.id],
        team_a_score=21, team_b_score=15,
    ))
    await session.commit()
    post = await _get_rating_row(session, a.id, RatingCategory.MENS_SINGLES)
    assert post is not None
    assert post.ceiling == INITIAL_CEILING
