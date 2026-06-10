"""
Synthetic validation harness for the BRS rating engine.

The question this script answers:
    Given 200 players with known "true skill", does the Glicko-2 hybrid
    engine recover that skill ordering after a few thousand matches?

Methodology
-----------
1. Generate N synthetic players with true_skill ~ Normal(1500, 200).
2. Simulate M matches. Each match:
     - picks two distinct players uniformly at random
     - resolves the winner probabilistically from true skill (logistic)
     - generates a plausible 21-x score (margin scales with skill gap)
3. Feeds every match through engine.process_match(), updating state.
4. Checks:
     - Pearson r(computed_r, true_skill) > 0.85
     - Final rating distribution is approximately bell-shaped
       (skew within ±0.5, no heavy tails)

Zero external dependencies. stdlib only, so it can ship with the engine
and run anywhere the core module runs.

Run:
    python -m badminton_rating.engine.simulator
"""

from __future__ import annotations

import math
import random
import statistics
from dataclasses import dataclass
from datetime import date
from typing import List, Tuple

from badminton_rating.engine.glicko import (
    MatchType,
    PlayerRating,
    process_match,
    to_display_rating,
)


# ---------------------------------------------------------------------------
# Simulation configuration
# ---------------------------------------------------------------------------

DEFAULT_NUM_PLAYERS = 200
DEFAULT_NUM_MATCHES = 5_000
DEFAULT_SEED = 42

# Logistic temperature for the ground-truth win model.
# P(A beats B) = sigmoid((A_true - B_true) / SKILL_SCALE).
# Tuned so the average "favorite" wins ~70% of the time when pairs are
# drawn uniformly from Normal(1500, 200).
SKILL_SCALE = 250.0

# Correlation floor the simulation must clear to be considered healthy.
CORRELATION_THRESHOLD = 0.85

# Acceptable absolute skew of the final display-rating distribution.
SKEW_THRESHOLD = 0.5


# ---------------------------------------------------------------------------
# Synthetic players
# ---------------------------------------------------------------------------

@dataclass
class SimPlayer:
    player_id: int
    true_skill: float           # ground truth we are trying to recover
    rating: PlayerRating        # engine's current belief


def generate_players(
    n: int,
    rng: random.Random,
    mean: float = 1500.0,
    std: float = 200.0,
) -> List[SimPlayer]:
    """Draw n players from Normal(mean, std)."""
    return [
        SimPlayer(
            player_id=i,
            true_skill=rng.gauss(mean, std),
            rating=PlayerRating(),
        )
        for i in range(n)
    ]


# ---------------------------------------------------------------------------
# Match resolution from true skill
# ---------------------------------------------------------------------------

def win_probability_from_skill(a_skill: float, b_skill: float) -> float:
    """Logistic on the raw skill gap — the 'true' world model."""
    return 1.0 / (1.0 + math.exp(-(a_skill - b_skill) / SKILL_SCALE))


def generate_score(winner_skill: float, loser_skill: float, rng: random.Random) -> Tuple[int, int]:
    """
    Winner always scores 21. Loser score scales inversely with skill gap
    plus a small amount of noise so identical matchups don't produce
    identical scores.

    Big skill gap -> loser score near 5-10.
    Small skill gap -> loser score near 17-19.
    """
    gap = abs(winner_skill - loser_skill)
    # base loser score: 19 when gap=0, drops to ~3 at gap=600
    base_loser = 19.0 - 16.0 * (1.0 - math.exp(-gap / 300.0))
    noisy = base_loser + rng.gauss(0, 2.0)
    loser = max(0, min(19, int(round(noisy))))
    return 21, loser


# ---------------------------------------------------------------------------
# Main simulation loop
# ---------------------------------------------------------------------------

@dataclass
class SimulationResult:
    players: List[SimPlayer]
    num_matches: int
    upsets: int                 # matches where the lower-skilled player won

    def favorite_win_rate(self) -> float:
        return 1.0 - self.upsets / self.num_matches


def run_simulation(
    num_players: int = DEFAULT_NUM_PLAYERS,
    num_matches: int = DEFAULT_NUM_MATCHES,
    seed: int = DEFAULT_SEED,
) -> SimulationResult:
    rng = random.Random(seed)
    players = generate_players(num_players, rng)
    today = date.today()
    upsets = 0

    for _ in range(num_matches):
        a, b = rng.sample(players, 2)
        p_a_wins = win_probability_from_skill(a.true_skill, b.true_skill)

        if rng.random() < p_a_wins:
            winner, loser = a, b
        else:
            winner, loser = b, a

        if winner.true_skill < loser.true_skill:
            upsets += 1

        s_w, s_l = generate_score(winner.true_skill, loser.true_skill, rng)

        new_w, new_l = process_match(
            winner.rating,
            loser.rating,
            s_w,
            s_l,
            MatchType.CLUB,
            today,
        )
        winner.rating = new_w
        loser.rating = new_l

    return SimulationResult(players=players, num_matches=num_matches, upsets=upsets)


# ---------------------------------------------------------------------------
# Statistics (stdlib only)
# ---------------------------------------------------------------------------

def pearson_correlation(xs: List[float], ys: List[float]) -> float:
    """Pure-stdlib Pearson r. Returns 0.0 if either series has zero variance."""
    if len(xs) != len(ys) or len(xs) < 2:
        raise ValueError("Need matching series of length >= 2")
    mx = statistics.fmean(xs)
    my = statistics.fmean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx == 0 or dy == 0:
        return 0.0
    return num / (dx * dy)


def sample_skew(xs: List[float]) -> float:
    """Adjusted Fisher-Pearson skew. 0 = symmetric, + = right tail."""
    n = len(xs)
    m = statistics.fmean(xs)
    s = statistics.stdev(xs)
    if s == 0:
        return 0.0
    g1 = sum((x - m) ** 3 for x in xs) / (n * s ** 3)
    return math.sqrt(n * (n - 1)) / (n - 2) * g1 if n > 2 else g1


def histogram(xs: List[float], bins: int, low: float, high: float) -> List[int]:
    """Simple equal-width histogram."""
    width = (high - low) / bins
    counts = [0] * bins
    for x in xs:
        if x < low or x >= high:
            idx = 0 if x < low else bins - 1
        else:
            idx = int((x - low) / width)
        counts[idx] += 1
    return counts


def ascii_bar(count: int, peak: int, width: int = 40) -> str:
    if peak == 0:
        return ""
    return "#" * max(1, int(count / peak * width)) if count > 0 else ""


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def print_report(result: SimulationResult) -> Tuple[float, float]:
    """Print validation report. Returns (correlation, skew)."""
    true_skills = [p.true_skill for p in result.players]
    computed_rs = [p.rating.r for p in result.players]
    display_rs = [to_display_rating(p.rating.r) for p in result.players]

    corr = pearson_correlation(true_skills, computed_rs)
    skew = sample_skew(display_rs)

    print("=" * 70)
    print("BRS — Synthetic Validation")
    print("=" * 70)
    print(f"Players:            {len(result.players)}")
    print(f"Matches simulated:  {result.num_matches}")
    print(f"Favorite win rate:  {result.favorite_win_rate():.1%}  (target ~70%)")
    print()

    print("-- Recovery of ground-truth skill --")
    print(f"Pearson r(computed, true): {corr:.4f}   threshold: {CORRELATION_THRESHOLD}")
    print()

    print("-- Final display-rating distribution (2.0–8.0) --")
    print(f"mean:   {statistics.fmean(display_rs):.3f}")
    print(f"stdev:  {statistics.stdev(display_rs):.3f}")
    print(f"min:    {min(display_rs):.3f}")
    print(f"max:    {max(display_rs):.3f}")
    print(f"skew:   {skew:+.3f}   threshold: |skew| < {SKEW_THRESHOLD}")
    print()

    bins = 12
    counts = histogram(display_rs, bins, 2.0, 8.0)
    peak = max(counts)
    width = (8.0 - 2.0) / bins
    print("-- Histogram --")
    for i, c in enumerate(counts):
        lo = 2.0 + i * width
        hi = lo + width
        print(f"  {lo:4.2f}–{hi:4.2f} | {c:3d} {ascii_bar(c, peak)}")
    print()

    # Top 5 / bottom 5 for a sanity eyeball
    ranked = sorted(result.players, key=lambda p: p.rating.r, reverse=True)
    print("-- Top 5 by computed rating --")
    for p in ranked[:5]:
        print(f"  id={p.player_id:3d}  display={to_display_rating(p.rating.r):.2f}  "
              f"true_skill={p.true_skill:7.1f}  rd={p.rating.rd:6.2f}")
    print("-- Bottom 5 by computed rating --")
    for p in ranked[-5:]:
        print(f"  id={p.player_id:3d}  display={to_display_rating(p.rating.r):.2f}  "
              f"true_skill={p.true_skill:7.1f}  rd={p.rating.rd:6.2f}")
    print()

    return corr, skew


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    result = run_simulation()
    corr, skew = print_report(result)

    ok = True
    if corr <= CORRELATION_THRESHOLD:
        print(f"FAIL: correlation {corr:.4f} <= {CORRELATION_THRESHOLD}")
        ok = False
    if abs(skew) >= SKEW_THRESHOLD:
        print(f"FAIL: |skew| {abs(skew):.3f} >= {SKEW_THRESHOLD}")
        ok = False

    if ok:
        print("PASS — engine recovers true skill and produces a bell-shaped distribution.")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
