"""
Unit tests for the rating engine.

These test the pure math functions — no database, no API, no network.
Run with: pytest tests/test_engine.py -v
"""

import math
from datetime import date, timedelta

import pytest

from badminton_rating.engine.glicko import (
    MatchType,
    PlayerRating,
    apply_inactivity_decay,
    g,
    expected_score,
    get_tier,
    process_match,
    score_differential_factor,
    to_display_rating,
    to_mu,
    to_phi,
    win_probability,
)


# ---------------------------------------------------------------------------
# Scale conversion
# ---------------------------------------------------------------------------

def test_to_display_rating_midpoint():
    """r=1500 should map to middle of display range (~5.0)."""
    display = to_display_rating(1500)
    assert 4.0 <= display <= 6.0


def test_to_display_rating_clamps_low():
    assert to_display_rating(0) == 2.0


def test_to_display_rating_clamps_high():
    assert to_display_rating(9999) == 8.0


# ---------------------------------------------------------------------------
# Tier labels
# ---------------------------------------------------------------------------

def test_tier_bronze():
    assert "Bronze" in get_tier(2.3)


def test_tier_gold():
    assert "Gold" in get_tier(4.5)


def test_tier_master():
    assert "Master" in get_tier(7.8)


# ---------------------------------------------------------------------------
# g function
# ---------------------------------------------------------------------------

def test_g_zero_phi():
    """g(0) should be 1.0."""
    assert abs(g(0) - 1.0) < 1e-6


def test_g_decreasing():
    """g should decrease as phi increases."""
    assert g(0.5) > g(1.0) > g(2.0)


# ---------------------------------------------------------------------------
# Expected score
# ---------------------------------------------------------------------------

def test_expected_score_even():
    """Equal ratings should give 50% win probability."""
    prob = expected_score(0, 0, 1.0)
    assert abs(prob - 0.5) < 0.01


def test_expected_score_higher_rated_wins_more():
    """Higher rated player should have >50% win probability."""
    prob = expected_score(1.0, 0.0, 1.0)
    assert prob > 0.5


# ---------------------------------------------------------------------------
# Score differential factor
# ---------------------------------------------------------------------------

def test_sdf_close_game():
    """Close game should give SDF close to 0.5."""
    sdf = score_differential_factor(21, 19)
    assert 0.5 < sdf < 0.65


def test_sdf_blowout():
    """Blowout should give high SDF."""
    sdf = score_differential_factor(21, 3)
    assert sdf > 0.9


def test_sdf_ordering():
    """Larger margin should give higher SDF."""
    assert (score_differential_factor(21, 10) >
            score_differential_factor(21, 15) >
            score_differential_factor(21, 19))


def test_sdf_caps_below_1():
    """SDF should never reach 1.0."""
    sdf = score_differential_factor(21, 0)
    assert sdf < 1.0


def test_sdf_invalid_scores():
    """Should raise when loser score >= winner score."""
    with pytest.raises(ValueError):
        score_differential_factor(15, 21)


# ---------------------------------------------------------------------------
# Inactivity decay
# ---------------------------------------------------------------------------

def test_decay_no_inactivity():
    """Active player should have minimal decay."""
    today = date.today()
    new_rd = apply_inactivity_decay(200.0, today, today)
    assert new_rd == pytest.approx(200.0, abs=1.0)


def test_decay_6_months():
    """6 months inactive should increase RD."""
    today = date.today()
    six_months_ago = today - timedelta(days=180)
    new_rd = apply_inactivity_decay(100.0, six_months_ago, today)
    assert new_rd > 100.0


def test_decay_caps_at_max():
    """Very long inactivity should cap at RD_MAX."""
    from badminton_rating.engine.glicko import RD_MAX
    today = date.today()
    ten_years_ago = today - timedelta(days=3650)
    new_rd = apply_inactivity_decay(50.0, ten_years_ago, today)
    assert new_rd == pytest.approx(RD_MAX, abs=1.0)


# ---------------------------------------------------------------------------
# process_match — full integration of pure engine
# ---------------------------------------------------------------------------

def test_winner_gains_rating():
    """Winner should gain rating."""
    a = PlayerRating()
    b = PlayerRating()
    today = date.today()
    updated_a, updated_b = process_match(a, b, 21, 15, MatchType.CLUB, today)
    assert updated_a.r > a.r


def test_loser_loses_rating():
    """Loser should lose rating."""
    a = PlayerRating()
    b = PlayerRating()
    today = date.today()
    updated_a, updated_b = process_match(a, b, 21, 15, MatchType.CLUB, today)
    assert updated_b.r < b.r


def test_rd_decreases_after_match():
    """Uncertainty should decrease after playing."""
    a = PlayerRating()
    b = PlayerRating()
    today = date.today()
    updated_a, updated_b = process_match(a, b, 21, 15, MatchType.CLUB, today)
    assert updated_a.rd < a.rd
    assert updated_b.rd < b.rd


def test_upset_win_gives_more_rating():
    """Beating a higher-rated player should give more rating than beating a lower-rated one."""
    today = date.today()

    weak = PlayerRating(r=1300)
    mid = PlayerRating(r=1500)
    strong = PlayerRating(r=1700)

    # weak beats mid (upset)
    updated_weak_1, _ = process_match(weak, mid, 21, 15, MatchType.CLUB, today)
    gain_vs_mid = updated_weak_1.r - weak.r

    # weak beats strong (bigger upset)
    updated_weak_2, _ = process_match(weak, strong, 21, 15, MatchType.CLUB, today)
    gain_vs_strong = updated_weak_2.r - weak.r

    assert gain_vs_strong > gain_vs_mid


def test_tournament_match_moves_rating_more_than_casual():
    """Tournament matches should have larger rating impact than casual."""
    today = date.today()
    a = PlayerRating()
    b = PlayerRating()

    updated_a_casual, _ = process_match(a, b, 21, 15, MatchType.CASUAL, today)
    updated_a_tourney, _ = process_match(a, b, 21, 15, MatchType.TOURNAMENT, today)

    gain_casual = updated_a_casual.r - a.r
    gain_tourney = updated_a_tourney.r - a.r

    assert gain_tourney > gain_casual


def test_blowout_win_gives_more_than_close_win():
    """21-3 win should give more rating than 21-19 win."""
    today = date.today()
    a = PlayerRating()
    b = PlayerRating()

    updated_blowout, _ = process_match(a, b, 21, 3, MatchType.CLUB, today)
    updated_close, _ = process_match(a, b, 21, 19, MatchType.CLUB, today)

    assert updated_blowout.r > updated_close.r


def test_invalid_match_raises():
    """Should raise if winner score <= loser score."""
    a = PlayerRating()
    b = PlayerRating()
    with pytest.raises(ValueError):
        process_match(a, b, 15, 21, MatchType.CLUB, date.today())


# ---------------------------------------------------------------------------
# Win probability
# ---------------------------------------------------------------------------

def test_win_probability_even():
    a = PlayerRating()
    b = PlayerRating()
    prob = win_probability(a, b)
    assert abs(prob - 0.5) < 0.01


def test_win_probability_higher_rated_favored():
    strong = PlayerRating(r=1700)
    weak = PlayerRating(r=1300)
    prob = win_probability(strong, weak)
    assert prob > 0.7


def test_win_probability_range():
    a = PlayerRating(r=1600)
    b = PlayerRating(r=1400)
    prob = win_probability(a, b)
    assert 0.0 < prob < 1.0
