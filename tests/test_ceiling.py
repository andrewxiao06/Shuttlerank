"""
Unit tests for the ceiling subsystem:
  - engine.glicko.apply_ceiling — pure clamp
  - engine.ceiling.update_ceilings — post-tournament unlock formula
"""

from datetime import date

import pytest

from badminton_rating.engine.glicko import (
    PlayerRating,
    apply_ceiling,
    from_display_rating,
    to_display_rating,
)
from badminton_rating.engine.ceiling import (
    CeilingInput,
    TournamentStrength,
    update_ceilings,
)


# ---------------------------------------------------------------------------
# apply_ceiling
# ---------------------------------------------------------------------------

def test_apply_ceiling_noop_when_under_cap():
    rating = PlayerRating(r=1500.0, rd=200.0, sigma=0.06, last_active=date.today())
    capped = apply_ceiling(rating, ceiling=8.0)
    assert capped is rating  # no copy needed when no-op


def test_apply_ceiling_clamps_when_over_cap():
    # r=1700 → display ~5.2 — well above a 4.0 cap.
    rating = PlayerRating(r=1700.0, rd=120.0, sigma=0.05, last_active=date(2026, 4, 1))
    capped = apply_ceiling(rating, ceiling=4.0)
    assert capped.display_rating() == pytest.approx(4.0, abs=0.001)


def test_apply_ceiling_preserves_rd_sigma_last_active():
    rating = PlayerRating(r=1700.0, rd=120.0, sigma=0.05, last_active=date(2026, 4, 1))
    capped = apply_ceiling(rating, ceiling=4.0)
    assert capped.rd == 120.0
    assert capped.sigma == 0.05
    assert capped.last_active == date(2026, 4, 1)


def test_apply_ceiling_round_trip_inverse():
    """from_display_rating should be the inverse of to_display_rating."""
    for d in [2.0, 3.5, 4.0, 5.7, 8.0]:
        r = from_display_rating(d)
        assert to_display_rating(r) == pytest.approx(d, abs=0.01)


def test_apply_ceiling_is_pure():
    """Calling apply_ceiling must not mutate the input rating."""
    rating = PlayerRating(r=1700.0, rd=120.0, sigma=0.05, last_active=date(2026, 4, 1))
    _ = apply_ceiling(rating, ceiling=4.0)
    assert rating.r == 1700.0
    assert rating.rd == 120.0


# ---------------------------------------------------------------------------
# update_ceilings
# ---------------------------------------------------------------------------

def test_update_ceilings_club_strength_no_bonus():
    inputs = [CeilingInput(player_id=1, old_ceiling=4.0, achieved_display=4.5)]
    [update] = update_ceilings(inputs, TournamentStrength.CLUB)
    assert update.new_ceiling == 4.5
    assert update.old_ceiling == 4.0


def test_update_ceilings_regional_adds_quarter_point():
    inputs = [CeilingInput(player_id=1, old_ceiling=4.0, achieved_display=4.5)]
    [update] = update_ceilings(inputs, TournamentStrength.REGIONAL)
    assert update.new_ceiling == pytest.approx(4.75)


def test_update_ceilings_national_adds_half_point():
    inputs = [CeilingInput(player_id=1, old_ceiling=4.0, achieved_display=4.5)]
    [update] = update_ceilings(inputs, TournamentStrength.NATIONAL)
    assert update.new_ceiling == pytest.approx(5.0)


def test_update_ceilings_never_lowers():
    """A poor performance must not drop the ceiling."""
    inputs = [CeilingInput(player_id=1, old_ceiling=6.0, achieved_display=3.0)]
    [update] = update_ceilings(inputs, TournamentStrength.NATIONAL)
    assert update.new_ceiling == 6.0
    assert update.unchanged


def test_update_ceilings_caps_at_display_max():
    """Ceiling cannot exceed display_max even with a big bonus."""
    inputs = [CeilingInput(player_id=1, old_ceiling=7.5, achieved_display=7.9)]
    [update] = update_ceilings(inputs, TournamentStrength.NATIONAL)
    assert update.new_ceiling == 8.0


def test_update_ceilings_preserves_order():
    inputs = [
        CeilingInput(player_id=1, old_ceiling=4.0, achieved_display=4.2),
        CeilingInput(player_id=2, old_ceiling=5.0, achieved_display=5.5),
        CeilingInput(player_id=3, old_ceiling=6.0, achieved_display=5.0),
    ]
    updates = update_ceilings(inputs, TournamentStrength.CLUB)
    assert [u.player_id for u in updates] == [1, 2, 3]


def test_update_ceilings_unchanged_flag():
    inputs = [
        CeilingInput(player_id=1, old_ceiling=5.0, achieved_display=4.0),
        CeilingInput(player_id=2, old_ceiling=4.0, achieved_display=5.0),
    ]
    updates = update_ceilings(inputs, TournamentStrength.CLUB)
    assert updates[0].unchanged
    assert not updates[1].unchanged
