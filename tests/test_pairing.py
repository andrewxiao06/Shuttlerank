"""
Unit tests for engine/pairing.py.

Pure functions in / out — no DB, no fixtures.
"""

import pytest

from badminton_rating.engine.pairing import (
    PairingEntry,
    PairingFormat,
    SwissStanding,
    pair_by_skill,
    pair_swiss_round,
)


def _entries(*ratings):
    """Build entries from (player_id, rating) tuples or bare ratings."""
    out = []
    for i, r in enumerate(ratings, start=1):
        if isinstance(r, tuple):
            out.append(PairingEntry(player_id=r[0], rating=r[1]))
        else:
            out.append(PairingEntry(player_id=i, rating=r))
    return out


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------

def test_pair_by_skill_requires_two_entries():
    with pytest.raises(ValueError):
        pair_by_skill(_entries(4.0), PairingFormat.SINGLE_ELIM)


# ---------------------------------------------------------------------------
# Single elimination
# ---------------------------------------------------------------------------

def test_single_elim_power_of_two_pairs_high_vs_low():
    # 8 entries: ratings 6.0 down to 4.5 — ids 1..8 by descending rating
    entries = _entries(6.0, 5.7, 5.5, 5.2, 5.0, 4.8, 4.6, 4.5)
    pairings = pair_by_skill(entries, PairingFormat.SINGLE_ELIM)
    assert len(pairings) == 4
    # Top seed (id=1, 6.0) vs bottom seed (id=8, 4.5)
    assert (pairings[0].player_a_id, pairings[0].player_b_id) == (1, 8)
    assert (pairings[1].player_a_id, pairings[1].player_b_id) == (2, 7)
    assert (pairings[2].player_a_id, pairings[2].player_b_id) == (3, 6)
    assert (pairings[3].player_a_id, pairings[3].player_b_id) == (4, 5)


def test_single_elim_non_power_of_two_gives_byes_to_top_seeds():
    # 5 entries → bracket size 8 → top 3 seeds get byes.
    entries = _entries(6.0, 5.5, 5.0, 4.5, 4.0)
    pairings = pair_by_skill(entries, PairingFormat.SINGLE_ELIM)
    assert len(pairings) == 4
    # Top seed (id=1) bracketed against nothing (bye)
    assert pairings[0].player_a_id == 1
    assert pairings[0].player_b_id is None
    assert pairings[0].is_bye
    # Lowest-seed match should be id=4 vs id=5
    real_match = next(p for p in pairings if not p.is_bye)
    assert {real_match.player_a_id, real_match.player_b_id} == {4, 5}


# ---------------------------------------------------------------------------
# Round robin — circle method
# ---------------------------------------------------------------------------

def test_round_robin_4_players_3_rounds_6_matches():
    entries = _entries(6.0, 5.5, 5.0, 4.5)
    pairings = pair_by_skill(entries, PairingFormat.ROUND_ROBIN)
    assert len(pairings) == 6  # C(4,2)
    # 3 rounds, 2 matches per round
    rounds = sorted({p.round for p in pairings})
    assert rounds == [1, 2, 3]
    # Every pair meets exactly once
    pair_set = {frozenset({p.player_a_id, p.player_b_id}) for p in pairings}
    assert len(pair_set) == 6


def test_round_robin_odd_count_uses_byes():
    # 5 players → 5 rounds, each round has one bye
    entries = _entries(6.0, 5.5, 5.0, 4.5, 4.0)
    pairings = pair_by_skill(entries, PairingFormat.ROUND_ROBIN)
    # Every player should play exactly 4 real matches (everyone else once)
    real = [p for p in pairings if not p.is_bye]
    counts = {pid: 0 for pid in range(1, 6)}
    for p in real:
        counts[p.player_a_id] += 1
        counts[p.player_b_id] += 1
    assert all(c == 4 for c in counts.values())
    # Exactly one bye per round
    byes_per_round = {}
    for p in pairings:
        if p.is_bye:
            byes_per_round.setdefault(p.round, 0)
            byes_per_round[p.round] += 1
    assert all(v == 1 for v in byes_per_round.values())


# ---------------------------------------------------------------------------
# Swiss — round 1
# ---------------------------------------------------------------------------

def test_swiss_round_1_splits_top_vs_bottom_half():
    # 8 entries, ratings descending → top 4 paired with bottom 4
    entries = _entries(6.0, 5.7, 5.5, 5.2, 5.0, 4.8, 4.6, 4.5)
    pairings = pair_by_skill(entries, PairingFormat.SWISS)
    assert len(pairings) == 4
    # First match is top-of-top vs top-of-bottom: id 1 vs id 5
    assert (pairings[0].player_a_id, pairings[0].player_b_id) == (1, 5)
    assert (pairings[1].player_a_id, pairings[1].player_b_id) == (2, 6)
    assert (pairings[2].player_a_id, pairings[2].player_b_id) == (3, 7)
    assert (pairings[3].player_a_id, pairings[3].player_b_id) == (4, 8)


def test_swiss_round_1_odd_count_byes_lowest_rated():
    entries = _entries(6.0, 5.5, 5.0, 4.5, 4.0)
    pairings = pair_by_skill(entries, PairingFormat.SWISS)
    bye = next(p for p in pairings if p.is_bye)
    # Lowest-rated (id=5, rating=4.0) takes the bye
    assert bye.player_a_id == 5


# ---------------------------------------------------------------------------
# Swiss — round 2
# ---------------------------------------------------------------------------

def test_swiss_round_2_avoids_rematches_when_possible():
    standings = [
        SwissStanding(player_id=1, rating=6.0, score=1.0),
        SwissStanding(player_id=2, rating=5.5, score=1.0),
        SwissStanding(player_id=3, rating=5.0, score=0.0),
        SwissStanding(player_id=4, rating=4.5, score=0.0),
    ]
    # In round 1, 1 played 3 and 2 played 4.
    prior = [(1, 3), (2, 4)]
    pairings = pair_swiss_round(standings, prior, round_number=2)
    pair_sets = {frozenset({p.player_a_id, p.player_b_id}) for p in pairings}
    # Should pair 1-2 (top scores) and 3-4 (bottom) — no rematches.
    assert frozenset({1, 2}) in pair_sets
    assert frozenset({3, 4}) in pair_sets


def test_swiss_round_2_rejects_round_below_2():
    with pytest.raises(ValueError):
        pair_swiss_round([], [], round_number=1)
