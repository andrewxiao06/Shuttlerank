"""
Tests for the synthetic validation harness.

Two categories:
  1. Statistics helpers — pure math, fully deterministic.
  2. Simulation behavior — seeded, so a fixed seed must produce fixed results.

The end-to-end run uses a reduced scale (50 players / 1,500 matches) so the
suite stays under a second. The full 200 / 5,000 run lives in __main__.
"""

import random

import pytest

from badminton_rating.engine.glicko import PlayerRating, INITIAL_RD
from badminton_rating.engine.simulator import (
    CORRELATION_THRESHOLD,
    SKEW_THRESHOLD,
    SimulationResult,
    generate_players,
    generate_score,
    histogram,
    pearson_correlation,
    run_simulation,
    sample_skew,
    win_probability_from_skill,
)


# ---------------------------------------------------------------------------
# Pearson correlation
# ---------------------------------------------------------------------------

def test_pearson_perfect_positive():
    xs = [1.0, 2.0, 3.0, 4.0, 5.0]
    ys = [2.0, 4.0, 6.0, 8.0, 10.0]
    assert pearson_correlation(xs, ys) == pytest.approx(1.0)


def test_pearson_perfect_negative():
    xs = [1.0, 2.0, 3.0, 4.0, 5.0]
    ys = [5.0, 4.0, 3.0, 2.0, 1.0]
    assert pearson_correlation(xs, ys) == pytest.approx(-1.0)


def test_pearson_zero_variance_returns_zero():
    """Constant series has undefined correlation — we return 0.0 instead of NaN."""
    xs = [1.0, 2.0, 3.0]
    ys = [5.0, 5.0, 5.0]
    assert pearson_correlation(xs, ys) == 0.0


def test_pearson_length_mismatch_raises():
    with pytest.raises(ValueError):
        pearson_correlation([1.0, 2.0], [1.0, 2.0, 3.0])


def test_pearson_too_short_raises():
    with pytest.raises(ValueError):
        pearson_correlation([1.0], [1.0])


# ---------------------------------------------------------------------------
# Sample skew
# ---------------------------------------------------------------------------

def test_skew_symmetric_is_near_zero():
    xs = [-2.0, -1.0, 0.0, 1.0, 2.0]
    assert abs(sample_skew(xs)) < 0.01


def test_skew_right_tailed_is_positive():
    xs = [1.0, 1.0, 1.0, 1.0, 2.0, 10.0]
    assert sample_skew(xs) > 0.5


def test_skew_left_tailed_is_negative():
    xs = [-10.0, -2.0, 1.0, 1.0, 1.0, 1.0]
    assert sample_skew(xs) < -0.5


def test_skew_zero_stdev_returns_zero():
    xs = [3.0, 3.0, 3.0, 3.0]
    assert sample_skew(xs) == 0.0


# ---------------------------------------------------------------------------
# Histogram
# ---------------------------------------------------------------------------

def test_histogram_even_distribution():
    xs = [0.5, 1.5, 2.5, 3.5]  # one per bin
    counts = histogram(xs, bins=4, low=0.0, high=4.0)
    assert counts == [1, 1, 1, 1]


def test_histogram_clamps_below_range():
    xs = [-5.0, 0.5]
    counts = histogram(xs, bins=4, low=0.0, high=4.0)
    assert counts[0] == 2  # both fall into first bin


def test_histogram_clamps_above_range():
    xs = [10.0, 3.5]
    counts = histogram(xs, bins=4, low=0.0, high=4.0)
    assert counts[-1] == 2  # both fall into last bin


# ---------------------------------------------------------------------------
# Ground-truth win model
# ---------------------------------------------------------------------------

def test_win_probability_equal_skill_is_half():
    assert win_probability_from_skill(1500, 1500) == pytest.approx(0.5)


def test_win_probability_higher_skill_favored():
    p = win_probability_from_skill(1700, 1500)
    assert 0.5 < p < 1.0


def test_win_probability_symmetric():
    """P(A beats B) + P(B beats A) == 1."""
    p = win_probability_from_skill(1700, 1400)
    q = win_probability_from_skill(1400, 1700)
    assert p + q == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Score generation
# ---------------------------------------------------------------------------

def test_generate_score_winner_always_21():
    rng = random.Random(0)
    for _ in range(50):
        w, _ = generate_score(1600, 1400, rng)
        assert w == 21


def test_generate_score_loser_in_valid_range():
    rng = random.Random(0)
    for _ in range(100):
        _, l = generate_score(1600, 1400, rng)
        assert 0 <= l <= 19


def test_generate_score_bigger_gap_yields_lower_loser_score_on_average():
    """Average loser score should drop as the skill gap widens."""
    rng1 = random.Random(1)
    rng2 = random.Random(1)
    close = [generate_score(1500, 1480, rng1)[1] for _ in range(500)]
    blowout = [generate_score(1900, 1100, rng2)[1] for _ in range(500)]
    assert sum(close) / len(close) > sum(blowout) / len(blowout) + 5


# ---------------------------------------------------------------------------
# Player generation
# ---------------------------------------------------------------------------

def test_generate_players_count():
    rng = random.Random(0)
    players = generate_players(50, rng)
    assert len(players) == 50


def test_generate_players_ids_are_sequential():
    rng = random.Random(0)
    players = generate_players(10, rng)
    assert [p.player_id for p in players] == list(range(10))


def test_generate_players_start_at_default_rating():
    rng = random.Random(0)
    players = generate_players(10, rng)
    for p in players:
        assert p.rating.r == PlayerRating().r
        assert p.rating.rd == INITIAL_RD


def test_generate_players_deterministic_with_seed():
    skills_a = [p.true_skill for p in generate_players(20, random.Random(7))]
    skills_b = [p.true_skill for p in generate_players(20, random.Random(7))]
    assert skills_a == skills_b


# ---------------------------------------------------------------------------
# End-to-end simulation
# ---------------------------------------------------------------------------

def test_simulation_is_deterministic():
    """Same seed must produce identical final ratings."""
    result_a = run_simulation(num_players=30, num_matches=300, seed=123)
    result_b = run_simulation(num_players=30, num_matches=300, seed=123)
    rs_a = [p.rating.r for p in result_a.players]
    rs_b = [p.rating.r for p in result_b.players]
    assert rs_a == rs_b


def test_simulation_reduces_rd():
    """After playing, every matched player should be less uncertain than the
    initial 350. (Rare players may go unmatched at low N — we check the
    average instead of each individually.)"""
    result = run_simulation(num_players=30, num_matches=500, seed=7)
    avg_rd = sum(p.rating.rd for p in result.players) / len(result.players)
    assert avg_rd < INITIAL_RD - 50


def test_simulation_recovers_skill_at_small_scale():
    """Even at 1/10th scale the correlation should clear the threshold."""
    result = run_simulation(num_players=50, num_matches=1500, seed=42)
    true = [p.true_skill for p in result.players]
    computed = [p.rating.r for p in result.players]
    corr = pearson_correlation(true, computed)
    assert corr > CORRELATION_THRESHOLD


def test_simulation_favorite_win_rate_reasonable():
    """Ground-truth win model should make favorites win ~60–80% of the time."""
    result = run_simulation(num_players=50, num_matches=1500, seed=42)
    rate = result.favorite_win_rate()
    assert 0.60 < rate < 0.80


def test_simulation_display_distribution_not_heavily_skewed():
    """Small samples are noisy; the full-scale SKEW_THRESHOLD is enforced by
    simulator.main(). Here we just catch pathological skew."""
    from badminton_rating.engine.glicko import to_display_rating
    result = run_simulation(num_players=50, num_matches=1500, seed=42)
    displays = [to_display_rating(p.rating.r) for p in result.players]
    assert abs(sample_skew(displays)) < 1.5


def test_simulation_result_structure():
    """SimulationResult exposes the fields the reporter depends on."""
    result = run_simulation(num_players=20, num_matches=100, seed=1)
    assert isinstance(result, SimulationResult)
    assert result.num_matches == 100
    assert len(result.players) == 20
    assert 0 <= result.upsets <= result.num_matches
