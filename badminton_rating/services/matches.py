"""
Match submission service — the bridge between the pure engine and the DB.

Responsibilities
----------------
1. Validate the submission against business rules (team sizes, distinct
   players, decisive scores, players exist).
2. Load the participating Player rows with FOR UPDATE so two concurrent
   submissions for the same player can't clobber each other.
3. Snapshot pre-match ratings.
4. Drive the rating update — process_match for singles, an aggregated
   team-level update for doubles (per CLAUDE.md: same delta to both
   partners, 50/50 credit split).
5. Persist the Match record and one MatchPlayer audit row per participant.
6. Flush so IDs materialize; commit is the caller's call.

The service deliberately knows nothing about FastAPI. A CLI script or a
background job could call submit_match() the same way a route handler does.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import List, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from badminton_rating.engine.glicko import (
    MatchType,
    PlayerRating,
    process_match,
)
from badminton_rating.db.models import (
    Match,
    MatchMode,
    MatchPlayer,
    MatchTypeDB,
    Player,
    Team,
)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class MatchSubmissionError(ValueError):
    """Raised for any business-rule violation in a match submission."""


# ---------------------------------------------------------------------------
# Input payload
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class MatchSubmission:
    mode: MatchMode
    match_type: MatchTypeDB
    played_at: date
    team_a_player_ids: List[int]
    team_b_player_ids: List[int]
    team_a_score: int
    team_b_score: int


# ---------------------------------------------------------------------------
# Engine <-> DB enum bridge
# ---------------------------------------------------------------------------

_MATCH_TYPE_MAP = {
    MatchTypeDB.CASUAL: MatchType.CASUAL,
    MatchTypeDB.CLUB: MatchType.CLUB,
    MatchTypeDB.TOURNAMENT: MatchType.TOURNAMENT,
}


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _validate_submission(sub: MatchSubmission) -> None:
    expected = 1 if sub.mode is MatchMode.SINGLES else 2
    if len(sub.team_a_player_ids) != expected or len(sub.team_b_player_ids) != expected:
        raise MatchSubmissionError(
            f"{sub.mode.value} match requires exactly {expected} player(s) per team"
        )

    all_ids = sub.team_a_player_ids + sub.team_b_player_ids
    if len(set(all_ids)) != len(all_ids):
        raise MatchSubmissionError("a player cannot appear more than once in a match")

    if sub.team_a_score < 0 or sub.team_b_score < 0:
        raise MatchSubmissionError("scores must be non-negative")
    if sub.team_a_score == sub.team_b_score:
        raise MatchSubmissionError("matches must have a winner — scores cannot be tied")


# ---------------------------------------------------------------------------
# Doubles helpers
# ---------------------------------------------------------------------------

def _aggregate_team(ratings: List[PlayerRating]) -> PlayerRating:
    """Mean-of-partners team rating (per CLAUDE.md doubles spec)."""
    n = len(ratings)
    return PlayerRating(
        r=sum(p.r for p in ratings) / n,
        rd=sum(p.rd for p in ratings) / n,
        sigma=sum(p.sigma for p in ratings) / n,
        last_active=max(p.last_active for p in ratings),
    )


def _apply_team_delta(
    pre_individuals: List[PlayerRating],
    pre_team: PlayerRating,
    post_team: PlayerRating,
) -> List[PlayerRating]:
    """
    Both partners receive the same delta_r. Each partner's new rd/sigma
    follow the team's new values (since they shared an information event).
    """
    delta_r = post_team.r - pre_team.r
    return [
        PlayerRating(
            r=p.r + delta_r,
            rd=post_team.rd,
            sigma=post_team.sigma,
            last_active=post_team.last_active,
        )
        for p in pre_individuals
    ]


# ---------------------------------------------------------------------------
# Player loading
# ---------------------------------------------------------------------------

async def _load_players_locked(
    session: AsyncSession,
    player_ids: List[int],
) -> List[Player]:
    """
    Load players in a stable order and lock the rows for update.

    Stable id-ordered locking prevents deadlocks when two concurrent matches
    touch overlapping players.
    """
    sorted_ids = sorted(set(player_ids))
    stmt = (
        select(Player)
        .where(Player.id.in_(sorted_ids))
        .order_by(Player.id)
        .with_for_update()
    )
    result = await session.execute(stmt)
    players = result.scalars().all()

    if len(players) != len(sorted_ids):
        found = {p.id for p in players}
        missing = [pid for pid in sorted_ids if pid not in found]
        raise MatchSubmissionError(f"player(s) not found: {missing}")
    return list(players)


# ---------------------------------------------------------------------------
# Singles and doubles updates
# ---------------------------------------------------------------------------

def _run_singles(
    a: Player,
    b: Player,
    sub: MatchSubmission,
    winner_team: Team,
) -> Tuple[List[PlayerRating], List[PlayerRating]]:
    """Returns (team_a_post_list, team_b_post_list) of size 1 each."""
    pre_a = a.to_rating(MatchMode.SINGLES)
    pre_b = b.to_rating(MatchMode.SINGLES)

    engine_match_type = _MATCH_TYPE_MAP[sub.match_type]

    if winner_team is Team.A:
        winner_pre, loser_pre = pre_a, pre_b
        winner_score, loser_score = sub.team_a_score, sub.team_b_score
    else:
        winner_pre, loser_pre = pre_b, pre_a
        winner_score, loser_score = sub.team_b_score, sub.team_a_score

    winner_post, loser_post = process_match(
        winner_pre, loser_pre, winner_score, loser_score, engine_match_type, sub.played_at
    )

    if winner_team is Team.A:
        return [winner_post], [loser_post]
    return [loser_post], [winner_post]


def _run_doubles(
    team_a_players: List[Player],
    team_b_players: List[Player],
    sub: MatchSubmission,
    winner_team: Team,
) -> Tuple[List[PlayerRating], List[PlayerRating]]:
    pre_a_list = [p.to_rating(MatchMode.DOUBLES) for p in team_a_players]
    pre_b_list = [p.to_rating(MatchMode.DOUBLES) for p in team_b_players]
    team_a_pre = _aggregate_team(pre_a_list)
    team_b_pre = _aggregate_team(pre_b_list)

    engine_match_type = _MATCH_TYPE_MAP[sub.match_type]

    if winner_team is Team.A:
        team_winner_post, team_loser_post = process_match(
            team_a_pre, team_b_pre,
            sub.team_a_score, sub.team_b_score,
            engine_match_type, sub.played_at,
        )
        team_a_post, team_b_post = team_winner_post, team_loser_post
    else:
        team_winner_post, team_loser_post = process_match(
            team_b_pre, team_a_pre,
            sub.team_b_score, sub.team_a_score,
            engine_match_type, sub.played_at,
        )
        team_a_post, team_b_post = team_loser_post, team_winner_post

    post_a = _apply_team_delta(pre_a_list, team_a_pre, team_a_post)
    post_b = _apply_team_delta(pre_b_list, team_b_pre, team_b_post)
    return post_a, post_b


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def submit_match(
    session: AsyncSession,
    sub: MatchSubmission,
) -> Match:
    """
    Process a match submission end-to-end.

    On success, the session contains:
      - one new Match row (flushed, so .id is populated)
      - one MatchPlayer audit row per participant
      - updated Player rows for every participant

    The caller commits the session.
    """
    _validate_submission(sub)

    winner_team = Team.A if sub.team_a_score > sub.team_b_score else Team.B

    all_ids = sub.team_a_player_ids + sub.team_b_player_ids
    players_by_id = {p.id: p for p in await _load_players_locked(session, all_ids)}
    team_a_players = [players_by_id[pid] for pid in sub.team_a_player_ids]
    team_b_players = [players_by_id[pid] for pid in sub.team_b_player_ids]

    # Snapshot pre-ratings BEFORE any in-place updates.
    mode = sub.mode
    pre_a = [p.to_rating(mode) for p in team_a_players]
    pre_b = [p.to_rating(mode) for p in team_b_players]

    if mode is MatchMode.SINGLES:
        post_a, post_b = _run_singles(team_a_players[0], team_b_players[0], sub, winner_team)
    else:
        post_a, post_b = _run_doubles(team_a_players, team_b_players, sub, winner_team)

    match = Match(
        played_at=sub.played_at,
        mode=mode,
        match_type=sub.match_type,
        team_a_score=sub.team_a_score,
        team_b_score=sub.team_b_score,
        winner_team=winner_team,
    )
    session.add(match)

    for player, pre, post in zip(team_a_players, pre_a, post_a):
        player.apply_rating(mode, post)
        match.participants.append(
            MatchPlayer.from_update(player_id=player.id, team=Team.A, pre=pre, post=post)
        )
    for player, pre, post in zip(team_b_players, pre_b, post_b):
        player.apply_rating(mode, post)
        match.participants.append(
            MatchPlayer.from_update(player_id=player.id, team=Team.B, pre=pre, post=post)
        )

    await session.flush()
    return match
