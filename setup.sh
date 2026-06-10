#!/bin/bash

# =============================================================================
# Badminton Rating System — Claude Code Bootstrap
# =============================================================================
# Run this script to set up the project scaffold and drop in the full
# algorithm context so Claude Code has everything it needs.
#
# Usage: bash setup.sh
# =============================================================================

set -e  # exit on any error

echo "=== Badminton Rating System — Project Bootstrap ==="
echo ""

# -----------------------------------------------------------------------------
# 1. Project structure
# -----------------------------------------------------------------------------
echo "[1/6] Creating project structure..."

mkdir -p badminton_rating/engine
mkdir -p badminton_rating/api/routes
mkdir -p badminton_rating/api/models
mkdir -p badminton_rating/db/migrations
mkdir -p tests
mkdir -p scripts

touch badminton_rating/__init__.py
touch badminton_rating/engine/__init__.py
touch badminton_rating/api/__init__.py
touch badminton_rating/api/routes/__init__.py
touch badminton_rating/api/models/__init__.py
touch badminton_rating/db/__init__.py
touch tests/__init__.py

echo "    Done."

# -----------------------------------------------------------------------------
# 2. CLAUDE.md — full algorithm context for Claude Code
# -----------------------------------------------------------------------------
echo "[2/6] Writing CLAUDE.md context file..."

cat > CLAUDE.md << 'CLAUDE_MD_EOF'
# Badminton Rating System — Claude Code Context

## Project Overview

Building a badminton rating system targeting **casual recreational players** — not tournament-only like BWF rankings.
Inspired by DUPR (pickleball) and UBR (Universal Badminton Rating).

**Resume goal:** Demonstrate algorithm design depth and backend engineering maturity for recruiting season (August).
**Product goal:** Get real clubs using it — starting with personal NJ badminton club contacts.

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | Python 3.11+ | Primary language |
| API Framework | FastAPI | Async, OpenAPI docs auto-generated |
| ORM | SQLAlchemy 2.0 (async) | With asyncpg driver |
| Database | PostgreSQL | Industry standard |
| Migrations | Alembic | Non-negotiable |
| Caching | Redis | Leaderboard via sorted sets |
| Containerization | Docker + Docker Compose | Full local dev |
| Testing | pytest + httpx | Unit tests on engine, integration on API |
| Frontend | Next.js + shadcn | Minimal — match submission, leaderboard, profile, forecast |
| Deployment | AWS EC2 | Already on resume |

---

## Architecture Principle

The rating engine is a **pure Python module with zero framework dependencies**.

```
badminton_rating/
├── engine/
│   ├── __init__.py
│   ├── glicko.py        # pure math, no dependencies
│   ├── weights.py       # match type weights, tuning constants
│   └── simulator.py     # synthetic validation script
├── api/
│   ├── routes/
│   └── models/
├── db/
│   ├── models.py
│   └── migrations/
└── tests/
    ├── test_engine.py
    └── test_api.py
```

---

## Rating Scale

**DUPR-style: 2.0 to 8.0**
- 2.0 = most beginner, 8.0 = near-professional
- Higher number = better player (same direction as DUPR)
- Internally computed on Glicko-2 scale, then mapped to 2.0–8.0 for display

### Tier Labels

| Rating | Tier | Sub-tiers |
|---|---|---|
| 2.0 – 3.0 | Bronze | Bronze I, II, III |
| 3.0 – 4.0 | Silver | Silver I, II, III |
| 4.0 – 5.0 | Gold | Gold I, II, III |
| 5.0 – 6.0 | Platinum | Platinum I, II, III |
| 6.0 – 7.0 | Diamond | Diamond I, II, III |
| 7.0 – 8.0 | Master | Master I, II, III |

---

## Algorithm — Glicko-2 Hybrid

### Three numbers per player

```python
@dataclass
class PlayerRating:
    r: float = 1500.0      # internal Glicko-2 rating
    rd: float = 350.0      # rating deviation (uncertainty)
    sigma: float = 0.06    # volatility (consistency)
    last_active: date      # for inactivity decay
```

### Why Glicko-2 over Elo

Glicko-2 tracks uncertainty (RD) — a player with 5 games at rating 4.0 is treated
differently from a player with 80 games at 4.0. Elo treats them identically.

### Why not just copy DUPR

Reverse-engineering analysis (1,604 match records, 6 players) found:
- DUPR score margin correlation = **-0.076** (essentially ignored)
- DUPR R² = **0.096** — 90%+ of variance unexplained by known factors
- DUPR current rating correlation = **-0.806** — rating distribution management
  is the primary goal, not performance accuracy
- DUPR has an opaque "favorite penalty" confusing for casual players

### Step-by-step math

**Step 1: Convert to Glicko-2 internal scale**
```python
mu  = (r - 1500) / 173.7178
phi = rd / 173.7178
```

**Step 2: g function — reliability dampener**
```python
def g(phi):
    return 1 / math.sqrt(1 + 3 * phi**2 / math.pi**2)
```
Discounts results against uncertain opponents. g → 0 when phi is large.

**Step 3: Expected outcome**
```python
def E(mu, mu_j, phi_j):
    return 1 / (1 + math.exp(-g(phi_j) * (mu - mu_j)))
```
Returns win probability 0.0–1.0. Used as pre-match forecast shown to players.

**Step 4: Score Differential Factor (original addition — not in base Glicko-2)**
```python
def score_differential_factor(winner_score: int, loser_score: int) -> float:
    margin = winner_score - loser_score
    total = winner_score + loser_score
    return 0.5 + 0.5 * math.tanh(margin / total * 3.5)
```
Output: 21-19 → ~0.58 | 21-15 → ~0.72 | 21-10 → ~0.88 | 21-3 → ~0.98
Winner uses SDF as actual score. Loser uses 1 - SDF.
tanh caps the value — prevents sandbagging via blowouts.

**Step 5: Variance estimate**
```python
def compute_v(mu, opponents):
    total = 0
    for mu_j, phi_j in opponents:
        e = E(mu, mu_j, phi_j)
        total += g(phi_j)**2 * e * (1 - e)
    return 1 / total
```
e*(1-e) maximized at 0.5 — even matchups give most information.

**Step 6: Delta — performance vs expectation**
```python
def compute_delta(mu, opponents, actual_scores, v):
    total = 0
    for (mu_j, phi_j), s in zip(opponents, actual_scores):
        e = E(mu, mu_j, phi_j)
        total += g(phi_j) * (s - e)
    return v * total
```

**Step 7: Match type weight**
```python
class MatchType(Enum):
    CASUAL = 0.6       # self-reported
    CLUB = 1.0         # organizer submitted
    TOURNAMENT = 1.4   # sanctioned tournament

weighted_delta = delta * match_type.value
```

**Step 8: Update volatility sigma (Illinois algorithm)**
```python
def update_sigma(phi, sigma, delta, v, tau=0.5):
    a = math.log(sigma**2)

    def f(x):
        ex = math.exp(x)
        num = ex * (delta**2 - phi**2 - v - ex)
        den = 2 * (phi**2 + v + ex)**2
        return num/den - (x - a) / tau**2

    A = a
    B = (math.log(delta**2 - phi**2 - v)
         if delta**2 > phi**2 + v
         else a - tau)

    fA, fB = f(A), f(B)
    while abs(B - A) > 0.000001:
        C = A + (A - B) * fA / (fB - fA)
        fC = f(C)
        if fC * fB < 0:
            A, fA = B, fB
        else:
            fA = fA / 2
        B, fB = C, fC

    return math.exp(A / 2)
```

**Step 9: Update phi and mu**
```python
def update_rating(phi, sigma_new, mu, delta, v):
    phi_star = math.sqrt(phi**2 + sigma_new**2)  # pre-period uncertainty
    phi_new = 1 / math.sqrt(1/phi_star**2 + 1/v)
    mu_new = mu + phi_new**2 * (delta / v)
    return mu_new, phi_new
```

**Step 10: Convert back to display scale (2.0–8.0)**
```python
def to_display_rating(mu: float) -> float:
    r = 173.7178 * mu + 1500
    display = 2.0 + (r - 1000) / 166.67
    return round(max(2.0, min(8.0, display)), 3)
```

**Inactivity decay (applied before each match)**
```python
DECAY_CONSTANT = 15.0  # RD points per month

def apply_inactivity_decay(rd: float, last_active: date, today: date) -> float:
    months = (today - last_active).days / 30.0
    new_rd = math.sqrt(rd**2 + (DECAY_CONSTANT * months)**2)
    return min(new_rd, 350.0)
```

### Full match example

```
Player A (r=1500, rd=200, sigma=0.06) beats Player B (r=1400, rd=150, sigma=0.06)
Score: 21-15, match_type: CLUB

1. Apply inactivity decay to both rd values
2. Convert to mu/phi scale
3. g(phi_B) ≈ 0.854
4. E(mu_A, mu_B, phi_B) ≈ 0.638  ← A is 63.8% expected to win
5. SDF(21, 15) ≈ 0.72             ← decisive win
6. A actual = 0.72, expected = 0.638 → outperformed by 0.082
7. B actual = 0.28, expected = 0.362 → underperformed
8. compute_v and compute_delta for both
9. Apply CLUB weight (1.0) to delta
10. update_sigma for both
11. update phi and mu for both
12. Convert back to 2.0–8.0 display scale
```

---

## API Endpoints

```
POST   /matches                              # submit match, triggers update
GET    /players/{id}                         # rating, tier, uncertainty, history
GET    /players/{id}/forecast?opponent_id=X  # pre-match win probability
GET    /leaderboard                          # paginated, filter by singles/doubles
GET    /players/{id}/matches                 # history with per-match deltas
```

---

## Engagement Layer (what players see)

- Tier + sub-tier (e.g. "Gold II")
- Confidence indicator: "Still calibrating — play 8 more matches" (when rd > 150)
- Pre-match forecast: "You have a 63% chance of winning"
- Post-match breakdown: "You won but underperformed expectations — rating: -0.041"
- Match history with per-match delta and reason

---

## Validation — Simulation Script

`engine/simulator.py` must:
1. Generate 200 synthetic players, true skill from Normal(1500, 200)
2. Simulate 5,000 matches — probabilistic outcomes (better player wins ~70% of time)
3. Run through algorithm
4. Assert: Pearson correlation(computed, true_skill) > 0.85
5. Assert: Rating distribution approximates bell curve

This is the difference between "I built an API" and "I validated a system."

---

## Doubles

- Separate singles and doubles ratings per player (same as DUPR)
- Team strength = average of partner ratings
- Credit split: 50/50 between partners
- Both partners update by same delta

---

## Key Research

- Glicko-2 paper: Glickman (2012) — glicko.net/glicko/glicko2.pdf (public domain)
- DUPR reverse engineering: github.com/DaRubberDuckieee/pickleball-dupr-predictor
- UBR: universalbadmintonrating.com — closest competitor, minimal traction outside Pacific Northwest
- China CBA official system: 9-level test-based certification (not match-result based)

---

## Interview Talking Points

> "I designed the rating engine as a pure function with no framework dependencies —
> independently testable, algorithm separated from delivery mechanism."

> "The core innovation over base Glicko-2 is the score differential factor using tanh,
> which explicitly weights match margin — something DUPR's reverse-engineered algorithm
> shows they ignore entirely (correlation -0.076)."

> "I validated the algorithm with a synthetic simulation of 5,000 matches across 200
> players, checking that computed ratings correlate with true skill at r > 0.85."

CLAUDE_MD_EOF

echo "    Done."

# -----------------------------------------------------------------------------
# 3. Starter engine file
# -----------------------------------------------------------------------------
echo "[3/6] Writing engine/glicko.py starter..."

cat > badminton_rating/engine/glicko.py << 'ENGINE_EOF'
"""
Badminton Rating System — Glicko-2 Hybrid Engine

Pure Python, zero framework dependencies.
All rating logic lives here. No FastAPI, no SQLAlchemy.

Algorithm: Modified Glicko-2 with:
  - Score differential factor (tanh-based) — original addition
  - Match type weighting (casual/club/tournament)
  - Inactivity decay on RD
  - Display scale mapping (2.0–8.0, DUPR-style)

Reference: Glickman (2012) — glicko.net/glicko/glicko2.pdf
"""

import math
from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import List, Tuple


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GLICKO_SCALE = 173.7178
INITIAL_R = 1500.0
INITIAL_RD = 350.0
INITIAL_SIGMA = 0.06
RD_MIN = 30.0
RD_MAX = 350.0
TAU = 0.5             # system constant — controls max volatility change
DECAY_PER_MONTH = 15  # RD points added per month of inactivity

DISPLAY_MIN = 2.0
DISPLAY_MAX = 8.0


# ---------------------------------------------------------------------------
# Match type weights
# ---------------------------------------------------------------------------

class MatchType(Enum):
    CASUAL = 0.6       # self-reported rec play
    CLUB = 1.0         # organizer/club submitted
    TOURNAMENT = 1.4   # sanctioned tournament


# ---------------------------------------------------------------------------
# Player rating dataclass
# ---------------------------------------------------------------------------

@dataclass
class PlayerRating:
    r: float = INITIAL_R
    rd: float = INITIAL_RD
    sigma: float = INITIAL_SIGMA
    last_active: date = field(default_factory=date.today)

    def display_rating(self) -> float:
        """Convert internal r to 2.0–8.0 display scale."""
        return to_display_rating(self.r)

    def tier(self) -> str:
        """Return tier label based on display rating."""
        return get_tier(self.display_rating())

    def is_calibrating(self) -> bool:
        """True if RD is still high — rating not yet reliable."""
        return self.rd > 150.0

    def matches_needed(self) -> int:
        """Rough estimate of matches needed to stabilize."""
        if not self.is_calibrating():
            return 0
        return max(0, int((self.rd - 150) / 20))


# ---------------------------------------------------------------------------
# Scale conversion
# ---------------------------------------------------------------------------

def to_mu(r: float) -> float:
    return (r - INITIAL_R) / GLICKO_SCALE


def to_phi(rd: float) -> float:
    return rd / GLICKO_SCALE


def from_mu(mu: float) -> float:
    return GLICKO_SCALE * mu + INITIAL_R


def from_phi(phi: float) -> float:
    return GLICKO_SCALE * phi


def to_display_rating(r: float) -> float:
    """Map internal Glicko r (roughly 1000–2000) to 2.0–8.0."""
    display = DISPLAY_MIN + (r - 1000) / 166.67
    return round(max(DISPLAY_MIN, min(DISPLAY_MAX, display)), 3)


def get_tier(display: float) -> str:
    if display < 3.0:
        sub = int((display - 2.0) / (1.0 / 3)) + 1
        return f"Bronze {['I', 'II', 'III'][min(sub - 1, 2)]}"
    elif display < 4.0:
        sub = int((display - 3.0) / (1.0 / 3)) + 1
        return f"Silver {['I', 'II', 'III'][min(sub - 1, 2)]}"
    elif display < 5.0:
        sub = int((display - 4.0) / (1.0 / 3)) + 1
        return f"Gold {['I', 'II', 'III'][min(sub - 1, 2)]}"
    elif display < 6.0:
        sub = int((display - 5.0) / (1.0 / 3)) + 1
        return f"Platinum {['I', 'II', 'III'][min(sub - 1, 2)]}"
    elif display < 7.0:
        sub = int((display - 6.0) / (1.0 / 3)) + 1
        return f"Diamond {['I', 'II', 'III'][min(sub - 1, 2)]}"
    else:
        sub = int((display - 7.0) / (1.0 / 3)) + 1
        return f"Master {['I', 'II', 'III'][min(sub - 1, 2)]}"


# ---------------------------------------------------------------------------
# Core math functions
# ---------------------------------------------------------------------------

def g(phi: float) -> float:
    """
    Reliability dampener. Discounts results against uncertain opponents.
    g -> 0 when phi is large (very uncertain opponent).
    g = 1.0 when phi = 0 (perfectly known).
    """
    return 1 / math.sqrt(1 + 3 * phi ** 2 / math.pi ** 2)


def expected_score(mu: float, mu_j: float, phi_j: float) -> float:
    """
    Win probability for player with rating mu against opponent (mu_j, phi_j).
    Returns 0.0–1.0. Used as pre-match forecast.
    """
    return 1 / (1 + math.exp(-g(phi_j) * (mu - mu_j)))


def score_differential_factor(winner_score: int, loser_score: int) -> float:
    """
    Original addition — not in base Glicko-2.

    Converts score margin to a continuous actual score using tanh.
    Winner gets SDF, loser gets 1 - SDF.

    tanh caps the value — prevents sandbagging via blowouts.
    A 21-3 win is much better than 21-19, but not infinitely so.

    21-19 -> ~0.58  (barely decisive)
    21-15 -> ~0.72
    21-10 -> ~0.88
    21-3  -> ~0.98
    """
    if winner_score <= loser_score:
        raise ValueError("winner_score must be greater than loser_score")
    margin = winner_score - loser_score
    total = winner_score + loser_score
    return 0.5 + 0.5 * math.tanh(margin / total * 3.5)


def apply_inactivity_decay(rd: float, last_active: date, today: date) -> float:
    """
    Widen RD for inactive players before updating.
    A player who hasn't played in 6 months should have higher uncertainty.
    """
    days = (today - last_active).days
    months = days / 30.0
    new_rd = math.sqrt(rd ** 2 + (DECAY_PER_MONTH * months) ** 2)
    return min(new_rd, RD_MAX)


def compute_v(mu: float, opponents: List[Tuple[float, float]]) -> float:
    """
    Estimated variance of player's rating based on match outcomes.
    e*(1-e) is maximized at 0.5 — evenly matched games give most information.
    """
    total = 0.0
    for mu_j, phi_j in opponents:
        e = expected_score(mu, mu_j, phi_j)
        total += g(phi_j) ** 2 * e * (1 - e)
    return 1 / total


def compute_delta(
    mu: float,
    opponents: List[Tuple[float, float]],
    actual_scores: List[float],
    v: float,
) -> float:
    """
    Performance vs expectation.
    s - e = surprise. Large positive = beat someone you were expected to lose to.
    """
    total = 0.0
    for (mu_j, phi_j), s in zip(opponents, actual_scores):
        e = expected_score(mu, mu_j, phi_j)
        total += g(phi_j) * (s - e)
    return v * total


def update_sigma(
    phi: float,
    sigma: float,
    delta: float,
    v: float,
    tau: float = TAU,
) -> float:
    """
    Update volatility via Illinois algorithm (modified regula falsi).
    Volatility measures how erratic results are — rises with unexpected swings.
    """
    a = math.log(sigma ** 2)

    def f(x: float) -> float:
        ex = math.exp(x)
        num = ex * (delta ** 2 - phi ** 2 - v - ex)
        den = 2 * (phi ** 2 + v + ex) ** 2
        return num / den - (x - a) / tau ** 2

    A = a
    if delta ** 2 > phi ** 2 + v:
        B = math.log(delta ** 2 - phi ** 2 - v)
    else:
        k = 1
        while f(a - k * tau) < 0:
            k += 1
        B = a - k * tau

    fA, fB = f(A), f(B)

    iterations = 0
    while abs(B - A) > 1e-6:
        C = A + (A - B) * fA / (fB - fA)
        fC = f(C)
        if fC * fB < 0:
            A, fA = B, fB
        else:
            fA = fA / 2
        B, fB = C, fC
        iterations += 1
        if iterations > 1000:
            break  # safety — should never hit this

    return math.exp(A / 2)


def update_player(
    phi: float,
    sigma_new: float,
    mu: float,
    delta: float,
    v: float,
) -> Tuple[float, float]:
    """
    Update phi and mu after a rating period.
    phi_star grows before update (inactivity uncertainty).
    phi_new shrinks based on information gained.
    """
    phi_star = math.sqrt(phi ** 2 + sigma_new ** 2)
    phi_new = 1 / math.sqrt(1 / phi_star ** 2 + 1 / v)
    mu_new = mu + phi_new ** 2 * (delta / v)
    return mu_new, phi_new


# ---------------------------------------------------------------------------
# Main entry point — update two players from a single match
# ---------------------------------------------------------------------------

def process_match(
    player_a: PlayerRating,
    player_b: PlayerRating,
    score_a: int,
    score_b: int,
    match_type: MatchType,
    played_at: date,
) -> Tuple[PlayerRating, PlayerRating]:
    """
    Pure function. Takes two ratings + match result, returns two updated ratings.
    No side effects. No database calls. This is what you unit test.

    Args:
        player_a:   Winner's current rating
        player_b:   Loser's current rating
        score_a:    Winner's score (e.g. 21)
        score_b:    Loser's score  (e.g. 15)
        match_type: CASUAL, CLUB, or TOURNAMENT
        played_at:  Date the match was played

    Returns:
        (updated_a, updated_b)
    """
    if score_a <= score_b:
        raise ValueError(
            f"score_a ({score_a}) must be greater than score_b ({score_b}). "
            "player_a is assumed to be the winner."
        )

    # --- Apply inactivity decay ---
    rd_a = apply_inactivity_decay(player_a.rd, player_a.last_active, played_at)
    rd_b = apply_inactivity_decay(player_b.rd, player_b.last_active, played_at)

    # --- Convert to Glicko-2 internal scale ---
    mu_a, phi_a = to_mu(player_a.r), to_phi(rd_a)
    mu_b, phi_b = to_mu(player_b.r), to_phi(rd_b)

    # --- Score differential factor ---
    sdf = score_differential_factor(score_a, score_b)
    actual_a = sdf          # winner's actual score
    actual_b = 1.0 - sdf   # loser's actual score

    # --- Apply match type weight to effective actual scores ---
    weight = match_type.value
    # Weight shifts actual score toward 0.5 (neutral) for casual matches
    # and amplifies signal for tournament matches
    weighted_actual_a = 0.5 + (actual_a - 0.5) * weight
    weighted_actual_b = 0.5 + (actual_b - 0.5) * weight

    # --- Process Player A ---
    v_a = compute_v(mu_a, [(mu_b, phi_b)])
    delta_a = compute_delta(mu_a, [(mu_b, phi_b)], [weighted_actual_a], v_a)
    sigma_a_new = update_sigma(phi_a, player_a.sigma, delta_a, v_a)
    mu_a_new, phi_a_new = update_player(phi_a, sigma_a_new, mu_a, delta_a, v_a)

    # --- Process Player B ---
    v_b = compute_v(mu_b, [(mu_a, phi_a)])
    delta_b = compute_delta(mu_b, [(mu_a, phi_a)], [weighted_actual_b], v_b)
    sigma_b_new = update_sigma(phi_b, player_b.sigma, delta_b, v_b)
    mu_b_new, phi_b_new = update_player(phi_b, sigma_b_new, mu_b, delta_b, v_b)

    # --- Clamp RD ---
    rd_a_new = max(RD_MIN, min(RD_MAX, from_phi(phi_a_new)))
    rd_b_new = max(RD_MIN, min(RD_MAX, from_phi(phi_b_new)))

    # --- Build updated ratings ---
    updated_a = PlayerRating(
        r=from_mu(mu_a_new),
        rd=rd_a_new,
        sigma=sigma_a_new,
        last_active=played_at,
    )
    updated_b = PlayerRating(
        r=from_mu(mu_b_new),
        rd=rd_b_new,
        sigma=sigma_b_new,
        last_active=played_at,
    )

    return updated_a, updated_b


def win_probability(player_a: PlayerRating, player_b: PlayerRating) -> float:
    """
    Pre-match win probability for player_a against player_b.
    Used for the forecast endpoint.
    """
    mu_a = to_mu(player_a.r)
    mu_b = to_mu(player_b.r)
    phi_b = to_phi(player_b.rd)
    return round(expected_score(mu_a, mu_b, phi_b), 4)
ENGINE_EOF

echo "    Done."

# -----------------------------------------------------------------------------
# 4. Weights / constants file
# -----------------------------------------------------------------------------
echo "[4/6] Writing engine/weights.py..."

cat > badminton_rating/engine/weights.py << 'WEIGHTS_EOF'
"""
Tuning constants for the BRS (Badminton Rating System) algorithm.

These are the knobs. Change them to tune algorithm behavior.
Document why you changed each one.
"""

# Glicko-2 system constant.
# Controls how much volatility can change per rating period.
# Lower = more stable ratings, slower to reflect real changes.
# Higher = more responsive, but noisier.
# Typical range: 0.3 – 1.2
TAU = 0.5

# RD decay per month of inactivity (in internal Glicko units before scaling).
# A player inactive for 6 months will have their RD grown by ~90 points.
# This models uncertainty growing when we haven't seen someone play.
DECAY_PER_MONTH = 15.0

# Score differential tanh scaling constant.
# Higher k = steeper curve, score margin matters more.
# Lower k = flatter curve, score margin matters less.
# At k=3.5: 21-15 gives ~0.72, 21-19 gives ~0.58
SDF_K = 3.5

# Match type weights — how much each match type scales the rating update.
MATCH_WEIGHTS = {
    "casual": 0.6,
    "club": 1.0,
    "tournament": 1.4,
}

# Minimum matches before a rating is considered "stable".
# Below this, show "Still calibrating" to the player.
CALIBRATION_MATCH_COUNT = 15

# RD threshold for "calibrating" display to player.
RD_CALIBRATING_THRESHOLD = 150.0
WEIGHTS_EOF

echo "    Done."

# -----------------------------------------------------------------------------
# 5. Starter test file
# -----------------------------------------------------------------------------
echo "[5/6] Writing tests/test_engine.py starter..."

cat > tests/test_engine.py << 'TEST_EOF'
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
TEST_EOF

echo "    Done."

# -----------------------------------------------------------------------------
# 6. requirements.txt and README stub
# -----------------------------------------------------------------------------
echo "[6/6] Writing requirements.txt and README..."

cat > requirements.txt << 'REQ_EOF'
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
sqlalchemy[asyncio]>=2.0.0
asyncpg>=0.29.0
alembic>=1.13.0
pydantic>=2.0.0
pydantic-settings>=2.0.0
redis>=5.0.0
python-jose[cryptography]>=3.3.0
passlib[bcrypt]>=1.7.4
python-multipart>=0.0.9
httpx>=0.27.0
pytest>=8.0.0
pytest-asyncio>=0.23.0
REQ_EOF

cat > README.md << 'README_EOF'
# Badminton Rating System (BRS)

A dynamic rating system for casual recreational badminton players.
Built as a backend-focused portfolio project demonstrating algorithm design depth.

## Algorithm

Modified Glicko-2 with four original extensions:
1. **Score differential factor** (tanh-based) — explicitly weights match margin, unlike DUPR
2. **Match type weighting** — casual/club/tournament submit different rating impact
3. **Inactivity decay** — RD widens when player goes inactive
4. **Display scale mapping** — internal Glicko scale mapped to 2.0–8.0 (DUPR-style)

See `CLAUDE.md` for full algorithm documentation and design rationale.

## Stack

Python · FastAPI · PostgreSQL · SQLAlchemy (async) · Alembic · Redis · Docker

## Running locally

```bash
docker compose up
uvicorn badminton_rating.api.main:app --reload
```

## Running tests

```bash
pytest tests/test_engine.py -v
```

## Validation

The simulation script (`engine/simulator.py`) generates 200 synthetic players,
runs 5,000 matches through the algorithm, and validates that computed ratings
correlate with true skill at r > 0.85.
README_EOF

echo "    Done."

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "=== Bootstrap complete ==="
echo ""
echo "Files created:"
echo "  CLAUDE.md                              ← full algorithm context for Claude Code"
echo "  badminton_rating/engine/glicko.py      ← pure Python engine (start here)"
echo "  badminton_rating/engine/weights.py     ← tuning constants"
echo "  tests/test_engine.py                   ← 18 unit tests"
echo "  requirements.txt"
echo "  README.md"
echo ""
echo "Next steps in Claude Code:"
echo "  1. Read CLAUDE.md — all algorithm context is there"
echo "  2. Run: pytest tests/test_engine.py -v  (all tests should pass)"
echo "  3. Build: engine/simulator.py           (synthetic validation)"
echo "  4. Build: db/models.py                  (SQLAlchemy models + Alembic)"
echo "  5. Build: api/routes/                   (FastAPI endpoints)"
echo "  6. Build: docker-compose.yml            (Postgres + Redis + app)"
echo ""
echo "Key files to show interviewers:"
echo "  - engine/glicko.py    (algorithm design)"
echo "  - tests/test_engine.py (engineering rigor)"
echo "  - CLAUDE.md            (documentation depth)"
echo ""