# Badminton Rating System — Claude Code Context

## ⚠️ EC2 deploy is Andrew's to do — hands off

Andrew wants to learn the AWS EC2 setup himself. Do NOT perform or automate
any part of it (no provisioning, no SSH commands, no remote docker runs, no
writing setup scripts that do it for him). When he asks for help, give hints
and pointers — nudge toward the next step in `DEPLOY.md`, explain concepts,
review what he's done — but let him drive every command.

## Project Overview

Building a badminton rating system targeting **casual recreational players** — not tournament-only like BWF rankings.
Inspired by DUPR (pickleball) and UBR (Universal Badminton Rating).

**Resume goal:** Demonstrate algorithm design depth and backend engineering maturity for recruiting season (August).
**Product goal:** Get real clubs using it — starting with personal NJ badminton club contacts.

> **📋 V1 production plan lives in `PLAN.md`** — six rating categories (M/W singles + doubles + mixed + casual),
> match validation flow, DUPR-style rating ceilings, tournaments, Clerk auth, Next.js frontend roadmap.
> This file (CLAUDE.md) is the algorithm + foundational architecture spec; PLAN.md is the active roadmap.

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

