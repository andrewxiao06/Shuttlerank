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


def from_display_rating(display: float) -> float:
    """Inverse of to_display_rating. Recover the internal r that yields `display`."""
    return (display - DISPLAY_MIN) * 166.67 + 1000


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


def apply_ceiling(rating: PlayerRating, ceiling: float) -> PlayerRating:
    """
    DUPR-style rating cap. Clamp the *display* rating to `ceiling` by
    reverse-computing the internal r. RD, sigma, last_active are preserved
    so that the player keeps their uncertainty and recency information.

    Must be called after every rating update for a (player, category)
    whose ceiling is below DISPLAY_MAX. A no-op if the player is already
    under the cap.

    Pure function. Returns a new PlayerRating; does not mutate input.
    """
    if rating.display_rating() <= ceiling:
        return rating
    capped_r = from_display_rating(ceiling)
    return PlayerRating(
        r=capped_r,
        rd=rating.rd,
        sigma=rating.sigma,
        last_active=rating.last_active,
    )


def win_probability(player_a: PlayerRating, player_b: PlayerRating) -> float:
    """
    Pre-match win probability for player_a against player_b.
    Used for the forecast endpoint.
    """
    mu_a = to_mu(player_a.r)
    mu_b = to_mu(player_b.r)
    phi_b = to_phi(player_b.rd)
    return round(expected_score(mu_a, mu_b, phi_b), 4)
