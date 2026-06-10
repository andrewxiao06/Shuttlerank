"""
Match submission service — v1 path, single universal rating.

Every player has exactly one rating (RatingCategory.OVERALL) regardless of
format or gender — anyone can play anyone. What varies is the *weight* a
match carries, DUPR-style:

  - regular (self-reported) match ........ MatchType.CASUAL (0.6)
  - unranked tournament match ............ MatchType.CLUB (1.0)
  - ranked (admin-hosted) tournament ..... MatchType.TOURNAMENT (1.4)

All non-tournament submissions persist as PENDING and only move ratings
once every participant approves (the submitter auto-approves on submit)
or the expiry window lapses.

Invariant guarded here: ratings only move when a match is `VERIFIED`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional, Sequence, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from badminton_rating.engine.glicko import (
    MatchType,
    PlayerRating,
    apply_ceiling,
    process_match,
)
from badminton_rating.db.models import (
    Match,
    MatchMode,
    MatchPlayer,
    MatchStatus,
    MatchTypeDB,
    MatchValidation,
    Player,
    PlayerCategoryRating,
    RatingCategory,
    Team,
    Tournament,
    ValidationAction,
)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class CategorySubmissionError(ValueError):
    """Business-rule violation on a match submission."""


# ---------------------------------------------------------------------------
# Input payload
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CategoryMatchSubmission:
    played_at: date
    team_a_player_ids: List[int]
    team_b_player_ids: List[int]
    team_a_score: int
    team_b_score: int
    submitted_by_user_id: Optional[str] = None

    @property
    def is_doubles(self) -> bool:
        return len(self.team_a_player_ids) == 2


# Auto-verify pending matches if no validation action lands within this window.
PENDING_EXPIRY_DAYS = 7


# ---------------------------------------------------------------------------
# Shape validation — team sizes, distinct players, sane scores
# ---------------------------------------------------------------------------

def _validate_shape(sub: CategoryMatchSubmission) -> None:
    a, b = len(sub.team_a_player_ids), len(sub.team_b_player_ids)
    if a != b:
        raise CategorySubmissionError("both teams must have the same number of players")
    if a not in (1, 2):
        raise CategorySubmissionError("matches must be 1v1 or 2v2")
    all_ids = sub.team_a_player_ids + sub.team_b_player_ids
    if len(set(all_ids)) != len(all_ids):
        raise CategorySubmissionError("a player cannot appear more than once in a match")
    if sub.team_a_score < 0 or sub.team_b_score < 0:
        raise CategorySubmissionError("scores must be non-negative")
    if sub.team_a_score == sub.team_b_score:
        raise CategorySubmissionError("matches must have a winner — scores cannot be tied")


# ---------------------------------------------------------------------------
# Player loading & rating row resolution
# ---------------------------------------------------------------------------

async def _load_players_locked(
    session: AsyncSession,
    player_ids: Sequence[int],
) -> List[Player]:
    sorted_ids = sorted(set(player_ids))
    stmt = (
        select(Player)
        .where(Player.id.in_(sorted_ids))
        .order_by(Player.id)
        .with_for_update()
    )
    result = await session.execute(stmt)
    found = list(result.scalars().all())
    if len(found) != len(sorted_ids):
        existing = {p.id for p in found}
        missing = [pid for pid in sorted_ids if pid not in existing]
        raise CategorySubmissionError(f"player(s) not found: {missing}")
    return found


async def get_or_create_overall_rating(
    session: AsyncSession,
    player_id: int,
) -> PlayerCategoryRating:
    """Look up the player's single rating row; create with defaults if missing."""
    stmt = select(PlayerCategoryRating).where(
        PlayerCategoryRating.player_id == player_id,
        PlayerCategoryRating.category == RatingCategory.OVERALL,
    ).with_for_update()
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is not None:
        return row
    # Model defaults handle starting r (= from_display_rating(INITIAL_CEILING))
    # and ceiling — see db/models.PlayerCategoryRating._INITIAL_CATEGORY_R.
    row = PlayerCategoryRating(player_id=player_id, category=RatingCategory.OVERALL)
    session.add(row)
    await session.flush()
    return row


def _rating_from_row(row: PlayerCategoryRating) -> PlayerRating:
    return PlayerRating(
        r=row.r,
        rd=row.rd,
        sigma=row.sigma,
        last_active=row.last_active or date.today(),
    )


def _apply_rating_to_row(row: PlayerCategoryRating, rating: PlayerRating) -> None:
    row.r = rating.r
    row.rd = rating.rd
    row.sigma = rating.sigma
    row.last_active = rating.last_active
    row.match_count += 1


# ---------------------------------------------------------------------------
# Doubles aggregation
# ---------------------------------------------------------------------------

def _aggregate_team(ratings: Sequence[PlayerRating]) -> PlayerRating:
    n = len(ratings)
    return PlayerRating(
        r=sum(p.r for p in ratings) / n,
        rd=sum(p.rd for p in ratings) / n,
        sigma=sum(p.sigma for p in ratings) / n,
        last_active=max(p.last_active for p in ratings),
    )


def _apply_team_delta(
    pre_individuals: Sequence[PlayerRating],
    pre_team: PlayerRating,
    post_team: PlayerRating,
) -> List[PlayerRating]:
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
# Engine driver — runs rating math with an explicit weight
# ---------------------------------------------------------------------------

def _compute_post_ratings(
    pre_a: List[PlayerRating],
    pre_b: List[PlayerRating],
    sub: CategoryMatchSubmission,
    winner_team: Team,
    engine_match_type: MatchType,
) -> Tuple[List[PlayerRating], List[PlayerRating]]:
    if not sub.is_doubles:
        winner_pre, loser_pre = (
            (pre_a[0], pre_b[0]) if winner_team is Team.A else (pre_b[0], pre_a[0])
        )
        winner_score, loser_score = (
            (sub.team_a_score, sub.team_b_score)
            if winner_team is Team.A
            else (sub.team_b_score, sub.team_a_score)
        )
        winner_post, loser_post = process_match(
            winner_pre, loser_pre, winner_score, loser_score,
            engine_match_type, sub.played_at,
        )
        if winner_team is Team.A:
            return [winner_post], [loser_post]
        return [loser_post], [winner_post]

    # Doubles
    team_a_pre = _aggregate_team(pre_a)
    team_b_pre = _aggregate_team(pre_b)
    if winner_team is Team.A:
        post_winner, post_loser = process_match(
            team_a_pre, team_b_pre,
            sub.team_a_score, sub.team_b_score,
            engine_match_type, sub.played_at,
        )
        team_a_post, team_b_post = post_winner, post_loser
    else:
        post_winner, post_loser = process_match(
            team_b_pre, team_a_pre,
            sub.team_b_score, sub.team_a_score,
            engine_match_type, sub.played_at,
        )
        team_a_post, team_b_post = post_loser, post_winner

    return (
        _apply_team_delta(pre_a, team_a_pre, team_a_post),
        _apply_team_delta(pre_b, team_b_pre, team_b_post),
    )


def _clamp_each(
    posts: Sequence[PlayerRating],
    ceilings: Sequence[float],
) -> List[PlayerRating]:
    """Apply each participant's ceiling. Pure — uses engine.apply_ceiling."""
    return [apply_ceiling(p, c) for p, c in zip(posts, ceilings)]


async def _engine_weight_for(session: AsyncSession, match: Match) -> MatchType:
    """DUPR-style weighting: only official (ranked) tournaments carry full weight."""
    if match.tournament_id is None:
        return MatchType.CASUAL
    tournament = await session.get(Tournament, match.tournament_id)
    if tournament is not None and tournament.ranked:
        return MatchType.TOURNAMENT
    return MatchType.CLUB


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def submit_category_match(
    session: AsyncSession,
    sub: CategoryMatchSubmission,
) -> Match:
    """
    Persist a match submission as PENDING. Ratings are NOT applied until
    every participant approves (verify_pending_match) or the window lapses.
    The submitter's approval is recorded automatically.
    """
    _validate_shape(sub)
    winner_team = Team.A if sub.team_a_score > sub.team_b_score else Team.B

    all_ids = sub.team_a_player_ids + sub.team_b_player_ids
    players_by_id = {
        p.id: p for p in await _load_players_locked(session, all_ids)
    }
    team_a = [players_by_id[pid] for pid in sub.team_a_player_ids]
    team_b = [players_by_id[pid] for pid in sub.team_b_player_ids]

    # Materialize rating rows up front so the audit snapshot uses
    # authoritative state — read-only here, written on verify.
    rating_rows = {}
    for player in (*team_a, *team_b):
        rating_rows[player.id] = await get_or_create_overall_rating(
            session, player.id
        )

    now = datetime.now(timezone.utc)
    match = Match(
        played_at=sub.played_at,
        mode=MatchMode.DOUBLES if sub.is_doubles else MatchMode.SINGLES,
        match_type=MatchTypeDB.CASUAL,
        team_a_score=sub.team_a_score,
        team_b_score=sub.team_b_score,
        winner_team=winner_team,
        category=RatingCategory.OVERALL,
        status=MatchStatus.PENDING,
        submitted_by_user_id=sub.submitted_by_user_id,
        verified_at=None,
        expires_at=now + timedelta(days=PENDING_EXPIRY_DAYS),
    )
    session.add(match)

    # Audit row capture only — pre == post, delta == 0. The verify step
    # rewrites these rows with the real deltas.
    for team, players in ((Team.A, team_a), (Team.B, team_b)):
        for player in players:
            pre = _rating_from_row(rating_rows[player.id])
            match.participants.append(
                MatchPlayer.from_update(
                    player_id=player.id, team=team, pre=pre, post=pre
                )
            )
    await session.flush()

    # Submitting is approving — record the submitter's validation so the
    # match only waits on the *other* participants.
    if sub.submitted_by_user_id is not None:
        session.add(MatchValidation(
            match_id=match.id,
            user_id=sub.submitted_by_user_id,
            action=ValidationAction.APPROVED,
        ))
        await session.flush()

    return match


# ---------------------------------------------------------------------------
# Verification — flips PENDING → VERIFIED and applies rating updates
# ---------------------------------------------------------------------------

async def verify_pending_match(
    session: AsyncSession,
    match: Match,
) -> Match:
    """
    Flip a PENDING match to VERIFIED and apply rating updates.

    Assumes the caller has already confirmed all participants approved
    (or the auto-verify window has elapsed). This function is intentionally
    naive about the *why* — it just executes the rating update.
    """
    if match.status is not MatchStatus.PENDING:
        raise CategorySubmissionError(
            f"only PENDING matches can be verified; this one is {match.status}"
        )

    participants = list(match.participants)
    team_a_player_ids = [p.player_id for p in participants if p.team is Team.A]
    team_b_player_ids = [p.player_id for p in participants if p.team is Team.B]

    sub = CategoryMatchSubmission(
        played_at=match.played_at,
        team_a_player_ids=team_a_player_ids,
        team_b_player_ids=team_b_player_ids,
        team_a_score=match.team_a_score,
        team_b_score=match.team_b_score,
        submitted_by_user_id=match.submitted_by_user_id,
    )

    rating_rows = {}
    for pid in team_a_player_ids + team_b_player_ids:
        rating_rows[pid] = await get_or_create_overall_rating(session, pid)

    pre_a = [_rating_from_row(rating_rows[pid]) for pid in team_a_player_ids]
    pre_b = [_rating_from_row(rating_rows[pid]) for pid in team_b_player_ids]

    engine_match_type = await _engine_weight_for(session, match)
    winner_team = Team.A if match.team_a_score > match.team_b_score else Team.B

    post_a, post_b = _compute_post_ratings(
        pre_a, pre_b, sub, winner_team, engine_match_type
    )

    ceil_a = [rating_rows[pid].ceiling for pid in team_a_player_ids]
    ceil_b = [rating_rows[pid].ceiling for pid in team_b_player_ids]
    post_a = _clamp_each(post_a, ceil_a)
    post_b = _clamp_each(post_b, ceil_b)

    # Rewrite the participants' audit rows with real deltas.
    participants_by_pid = {p.player_id: p for p in participants}
    for pid, pre, post in zip(
        team_a_player_ids + team_b_player_ids,
        pre_a + pre_b,
        post_a + post_b,
    ):
        _apply_rating_to_row(rating_rows[pid], post)
        mp = participants_by_pid[pid]
        mp.pre_r, mp.pre_rd, mp.pre_sigma = pre.r, pre.rd, pre.sigma
        mp.post_r, mp.post_rd, mp.post_sigma = post.r, post.rd, post.sigma
        mp.delta_r = post.r - pre.r

    match.status = MatchStatus.VERIFIED
    match.verified_at = datetime.now(timezone.utc)
    await session.flush()
    return match
