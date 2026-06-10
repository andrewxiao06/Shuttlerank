"""
Tournament pairing — pure functions, zero framework dependencies.

Same architectural discipline as engine/glicko.py: takes inputs, returns
outputs, no I/O. The service layer is responsible for persisting the
resulting matches; this module never touches the DB.

Three formats supported (per `TournamentFormat` in db/models.py):
- SINGLE_ELIM:  standard seeded bracket (1 vs N, 2 vs N-1, ...)
- ROUND_ROBIN: circle method — every entrant plays every other entrant once
- SWISS:       round 1 pairs by rating; subsequent rounds need standings,
               so this module only emits round 1. Later rounds re-run
               `pair_swiss_round(standings, prior_pairings)` separately.

Skill-based matchmaking principle: entries are sorted by display rating
*descending* before any format-specific logic. This is the "similar-skill"
property the user asked for — adjacent seeds are nearest in rating.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Sequence, Set, Tuple


# ---------------------------------------------------------------------------
# Format enum — mirrors db/models.TournamentFormat by name on purpose so the
# service layer can pass either through interchangeably.
# ---------------------------------------------------------------------------

class PairingFormat(str, Enum):
    SINGLE_ELIM = "single_elim"
    ROUND_ROBIN = "round_robin"
    SWISS = "swiss"


# ---------------------------------------------------------------------------
# Inputs / outputs
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PairingEntry:
    """One entrant fed into the pairing algorithm.

    `rating` is the *display* rating (2.0–8.0). Using display-scale here
    keeps this module decoupled from Glicko internals — callers convert
    once and pass clean numbers in.
    """
    player_id: int
    rating: float


@dataclass(frozen=True)
class ProposedMatch:
    """A single match proposed by the pairing algorithm.

    Either `player_b_id` or `player_a_id` may be `None` to represent a bye
    (used in round-robin and Swiss when the entry count is odd). The
    service layer interprets a bye as an auto-win for the present player
    with no rating impact.
    """
    round: int
    player_a_id: Optional[int]
    player_b_id: Optional[int]

    @property
    def is_bye(self) -> bool:
        return self.player_a_id is None or self.player_b_id is None


# ---------------------------------------------------------------------------
# Main dispatcher
# ---------------------------------------------------------------------------

def pair_by_skill(
    entries: Sequence[PairingEntry],
    format: PairingFormat,
) -> List[ProposedMatch]:
    """
    Generate pairings for the given format.

    For SWISS, only round 1 is emitted — subsequent rounds depend on
    standings and must call `pair_swiss_round` directly with the latest
    standings.
    """
    if len(entries) < 2:
        raise ValueError("at least 2 entries required to pair")

    seeded = _seed_by_rating(entries)

    if format is PairingFormat.SINGLE_ELIM:
        return _pair_single_elim(seeded)
    if format is PairingFormat.ROUND_ROBIN:
        return _pair_round_robin(seeded)
    if format is PairingFormat.SWISS:
        return _pair_swiss_round_one(seeded)
    raise ValueError(f"unknown pairing format: {format}")


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------

def _seed_by_rating(entries: Sequence[PairingEntry]) -> List[PairingEntry]:
    """Sort descending by rating. Tie-break by player_id for determinism."""
    return sorted(entries, key=lambda e: (-e.rating, e.player_id))


# ---------------------------------------------------------------------------
# Single elimination — standard seeded bracket
# ---------------------------------------------------------------------------

def _pair_single_elim(seeded: List[PairingEntry]) -> List[ProposedMatch]:
    """
    Standard bracket pairing: 1 vs N, 2 vs N-1, etc.

    If the entry count isn't a power of two, the top seeds get byes in
    round 1 (modeled as ProposedMatch with player_b_id=None). The bracket
    size is the next power of 2 ≥ len(seeded).
    """
    n = len(seeded)
    bracket_size = 1
    while bracket_size < n:
        bracket_size *= 2

    # Fill the bracket with player_ids, padding with None for byes.
    slots: List[Optional[int]] = [e.player_id for e in seeded]
    slots.extend([None] * (bracket_size - n))

    matches: List[ProposedMatch] = []
    for i in range(bracket_size // 2):
        high_seed = slots[i]
        low_seed = slots[bracket_size - 1 - i]
        matches.append(
            ProposedMatch(round=1, player_a_id=high_seed, player_b_id=low_seed)
        )
    return matches


# ---------------------------------------------------------------------------
# Round robin — circle method
# ---------------------------------------------------------------------------

def _pair_round_robin(seeded: List[PairingEntry]) -> List[ProposedMatch]:
    """
    Classic circle method: n-1 rounds for n players (n rounds with one bye
    each if n is odd). Player 1 is fixed; everyone else rotates one slot
    clockwise per round.

    Reference: https://en.wikipedia.org/wiki/Round-robin_tournament#Scheduling_algorithm
    """
    ids: List[Optional[int]] = [e.player_id for e in seeded]
    if len(ids) % 2 == 1:
        ids.append(None)  # sentinel — opponent is "bye"

    n = len(ids)
    rounds = n - 1
    half = n // 2

    matches: List[ProposedMatch] = []
    rotating = ids[1:]  # everyone except the fixed first slot
    fixed = ids[0]

    for r in range(rounds):
        # Build this round's lineup: [fixed, rotating...]
        lineup: List[Optional[int]] = [fixed] + rotating
        for i in range(half):
            a = lineup[i]
            b = lineup[n - 1 - i]
            matches.append(
                ProposedMatch(round=r + 1, player_a_id=a, player_b_id=b)
            )
        # Rotate clockwise: last -> front of `rotating`
        rotating = [rotating[-1]] + rotating[:-1]

    return matches


# ---------------------------------------------------------------------------
# Swiss — round 1 only here; round N uses pair_swiss_round below.
# ---------------------------------------------------------------------------

def _pair_swiss_round_one(seeded: List[PairingEntry]) -> List[ProposedMatch]:
    """
    Round-1 Swiss pairing splits the field in half by rating and pairs
    top-half[i] vs bottom-half[i] — accelerated Swiss, standard in
    skill-stratified tournaments.

    For example, with 8 entries (sorted by rating desc, ids A-H):
        A B C D | E F G H
        A-E, B-F, C-G, D-H

    Odd entry count gives the lowest-rated player a bye.
    """
    n = len(seeded)
    bye_match: List[ProposedMatch] = []
    working = list(seeded)
    if n % 2 == 1:
        bye_player = working.pop()  # already sorted desc → lowest rated
        bye_match.append(
            ProposedMatch(round=1, player_a_id=bye_player.player_id, player_b_id=None)
        )
        n -= 1

    half = n // 2
    top, bottom = working[:half], working[half:]
    matches = [
        ProposedMatch(round=1, player_a_id=t.player_id, player_b_id=b.player_id)
        for t, b in zip(top, bottom)
    ]
    return matches + bye_match


@dataclass(frozen=True)
class SwissStanding:
    """Aggregate state needed to pair round N (N > 1) of a Swiss event."""
    player_id: int
    rating: float
    score: float  # total wins (1.0) + draws (0.5) so far


def pair_swiss_round(
    standings: Sequence[SwissStanding],
    prior_pairings: Sequence[Tuple[int, int]],
    round_number: int,
) -> List[ProposedMatch]:
    """
    Greedy Swiss pairing for round N > 1.

    Algorithm:
    1. Sort entries by (score desc, rating desc).
    2. For each entry top-down, pair with the highest-ranked remaining
       opponent they haven't faced yet.
    3. If no valid opponent exists (rare, only with high collision), fall
       back to the next-best by rating regardless of repeat — pragmatic
       and matches how small clubs run Swiss.
    4. Odd count → lowest-ranked unpaired entry gets a bye.

    This is intentionally simple (no Dutch/accelerated pairings, no
    color balance — irrelevant in badminton). Sufficient for ≤32-entry
    club events, which is the V1 target.
    """
    if round_number < 2:
        raise ValueError("pair_swiss_round is for rounds 2+; use pair_by_skill for round 1")

    played: Set[frozenset[int]] = {frozenset(p) for p in prior_pairings}
    pool = sorted(standings, key=lambda s: (-s.score, -s.rating, s.player_id))

    matches: List[ProposedMatch] = []
    paired: Set[int] = set()

    for i, entry in enumerate(pool):
        if entry.player_id in paired:
            continue
        opponent: Optional[SwissStanding] = None
        for candidate in pool[i + 1:]:
            if candidate.player_id in paired:
                continue
            if frozenset({entry.player_id, candidate.player_id}) in played:
                continue
            opponent = candidate
            break
        if opponent is None:
            # Fallback: pair with next unpaired, repeat allowed
            for candidate in pool[i + 1:]:
                if candidate.player_id not in paired:
                    opponent = candidate
                    break
        if opponent is None:
            # Last unpaired entry → bye
            matches.append(
                ProposedMatch(
                    round=round_number,
                    player_a_id=entry.player_id,
                    player_b_id=None,
                )
            )
            paired.add(entry.player_id)
            continue
        matches.append(
            ProposedMatch(
                round=round_number,
                player_a_id=entry.player_id,
                player_b_id=opponent.player_id,
            )
        )
        paired.add(entry.player_id)
        paired.add(opponent.player_id)

    return matches
