"""
Category-routed match service — v1 path.

What changed vs. services/matches.py
------------------------------------
The v0 service (matches.py) reads/writes the denormalized singles_* /
doubles_* columns on `players`. That keeps working — this module is a
PARALLEL path. It uses the v1 child table `player_ratings`
(PlayerCategoryRating) keyed by (player_id, category).

Responsibilities
----------------
1. Validate the submission's *gender eligibility* — mens_singles requires
   two male players, mixed_doubles requires 1M+1W per team, casual ignores
   gender entirely.
2. Resolve or auto-create the PlayerCategoryRating row for every
   participant in the requested category.
3. For CASUAL submissions: immediately run the engine, apply the ceiling
   clamp, and persist with `status=VERIFIED`.
4. For RANKED submissions: persist with `status=PENDING` and do NOT apply
   any rating change yet. Phase 2.6 adds the verify endpoint that flips
   PENDING → VERIFIED and runs `_run_and_persist_rating_update`.

Invariant guarded here: ratings only move when a match is `VERIFIED`.
Everything else is upstream of the engine.
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
    from_display_rating,
    process_match,
    to_display_rating,
)
from badminton_rating.db.models import (
    INITIAL_CEILING,
    Match,
    MatchMode,
    MatchPlayer,
    MatchStatus,
    MatchTypeDB,
    Player,
    PlayerCategoryRating,
    PlayerGender,
    RatingCategory,
    Team,
)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class CategorySubmissionError(ValueError):
    """Business-rule violation on a category-routed match submission."""


# ---------------------------------------------------------------------------
# Input payload
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CategoryMatchSubmission:
    category: RatingCategory
    played_at: date
    team_a_player_ids: List[int]
    team_b_player_ids: List[int]
    team_a_score: int
    team_b_score: int
    submitted_by_user_id: Optional[str] = None

    @property
    def is_doubles(self) -> bool:
        if self.category is RatingCategory.CASUAL:
            # Casual is one rating covering both formats — infer mode from
            # the submission. Validated for size consistency in _validate_shape.
            return len(self.team_a_player_ids) == 2
        return self.category in DOUBLES_CATEGORIES

    @property
    def is_casual(self) -> bool:
        return self.category is RatingCategory.CASUAL


DOUBLES_CATEGORIES = frozenset({
    RatingCategory.MENS_DOUBLES,
    RatingCategory.WOMENS_DOUBLES,
    RatingCategory.MIXED_DOUBLES,
})

# Auto-verify ranked matches if no validation action lands within this window.
RANKED_EXPIRY_DAYS = 7


# ---------------------------------------------------------------------------
# Eligibility — the only thing that knows about gender
# ---------------------------------------------------------------------------

def _team_size(category: RatingCategory) -> Optional[int]:
    """Required team size for a category; None means infer from submission."""
    if category in DOUBLES_CATEGORIES:
        return 2
    if category is RatingCategory.CASUAL:
        return None  # casual covers both singles and doubles
    return 1  # mens_singles, womens_singles


def _validate_shape(sub: CategoryMatchSubmission) -> None:
    expected = _team_size(sub.category)
    a, b = len(sub.team_a_player_ids), len(sub.team_b_player_ids)
    if expected is None:
        # Casual: any size 1 or 2, but both teams must match.
        if a != b:
            raise CategorySubmissionError("both teams must have the same number of players")
        if a not in (1, 2):
            raise CategorySubmissionError("casual matches must be 1v1 or 2v2")
    elif a != expected or b != expected:
        raise CategorySubmissionError(
            f"{sub.category.value} match requires {expected} player(s) per team"
        )
    all_ids = sub.team_a_player_ids + sub.team_b_player_ids
    if len(set(all_ids)) != len(all_ids):
        raise CategorySubmissionError("a player cannot appear more than once in a match")
    if sub.team_a_score < 0 or sub.team_b_score < 0:
        raise CategorySubmissionError("scores must be non-negative")
    if sub.team_a_score == sub.team_b_score:
        raise CategorySubmissionError("matches must have a winner — scores cannot be tied")


def _validate_eligibility(
    category: RatingCategory,
    team_a: Sequence[Player],
    team_b: Sequence[Player],
) -> None:
    """Enforce per-category gender rules. Casual is the open fallback."""
    if category is RatingCategory.CASUAL:
        return  # anything goes

    def gender_of(p: Player) -> Optional[PlayerGender]:
        return p.gender

    if category in (RatingCategory.MENS_SINGLES, RatingCategory.MENS_DOUBLES):
        for p in (*team_a, *team_b):
            if gender_of(p) is not PlayerGender.M:
                raise CategorySubmissionError(
                    f"{category.value} requires all male players; "
                    f"{p.name} is {p.gender}"
                )
        return

    if category in (RatingCategory.WOMENS_SINGLES, RatingCategory.WOMENS_DOUBLES):
        for p in (*team_a, *team_b):
            if gender_of(p) is not PlayerGender.W:
                raise CategorySubmissionError(
                    f"{category.value} requires all female players; "
                    f"{p.name} is {p.gender}"
                )
        return

    if category is RatingCategory.MIXED_DOUBLES:
        for label, team in (("A", team_a), ("B", team_b)):
            genders = sorted([g for g in (gender_of(p) for p in team) if g is not None])
            if genders != [PlayerGender.M, PlayerGender.W]:
                raise CategorySubmissionError(
                    f"mixed_doubles requires one male and one female per team; "
                    f"team {label} is {[g.value if g else None for g in (gender_of(p) for p in team)]}"
                )
        return


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


async def _get_or_create_category_rating(
    session: AsyncSession,
    player_id: int,
    category: RatingCategory,
) -> PlayerCategoryRating:
    """Look up the (player, category) row; create with defaults if missing."""
    stmt = select(PlayerCategoryRating).where(
        PlayerCategoryRating.player_id == player_id,
        PlayerCategoryRating.category == category,
    ).with_for_update()
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is not None:
        return row
    # Model defaults handle starting r (= from_display_rating(INITIAL_CEILING))
    # and ceiling — see db/models.PlayerCategoryRating._INITIAL_CATEGORY_R.
    row = PlayerCategoryRating(player_id=player_id, category=category)
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
# Doubles aggregation — same as v0 service, repeated here so this module
# doesn't reach across into matches.py's helpers (keeps the two paths
# fully independent during the additive-migration window).
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
# Engine driver — runs rating math and applies the ceiling clamp
# ---------------------------------------------------------------------------

def _compute_post_ratings(
    pre_a: List[PlayerRating],
    pre_b: List[PlayerRating],
    sub: CategoryMatchSubmission,
    winner_team: Team,
) -> Tuple[List[PlayerRating], List[PlayerRating]]:
    # Casual matches use CASUAL weight; everything else is CLUB-weight by
    # default. Tournament matches lift to TOURNAMENT weight in Phase 2.6
    # when the route knows whether `match.tournament_id` is set.
    engine_match_type = (
        MatchType.CASUAL if sub.is_casual else MatchType.CLUB
    )

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


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def submit_category_match(
    session: AsyncSession,
    sub: CategoryMatchSubmission,
) -> Match:
    """
    Process a category-routed submission.

    Casual → status=VERIFIED, ratings apply now.
    Ranked → status=PENDING, ratings NOT applied (Phase 2.6 verify flow).
    """
    _validate_shape(sub)
    winner_team = Team.A if sub.team_a_score > sub.team_b_score else Team.B

    all_ids = sub.team_a_player_ids + sub.team_b_player_ids
    players_by_id = {
        p.id: p for p in await _load_players_locked(session, all_ids)
    }
    team_a = [players_by_id[pid] for pid in sub.team_a_player_ids]
    team_b = [players_by_id[pid] for pid in sub.team_b_player_ids]
    _validate_eligibility(sub.category, team_a, team_b)

    # Always materialize the PlayerCategoryRating rows up front so the
    # display-rating ceiling check uses authoritative state. For ranked
    # PENDING matches we still touch them — but only to read, never write.
    rating_rows = {}
    for player in (*team_a, *team_b):
        rating_rows[player.id] = await _get_or_create_category_rating(
            session, player.id, sub.category
        )

    # Persist the Match shell first so participants/validations link to it.
    now = datetime.now(timezone.utc)
    if sub.is_casual:
        status = MatchStatus.VERIFIED
        verified_at = now
        expires_at = None
    else:
        status = MatchStatus.PENDING
        verified_at = None
        expires_at = now + timedelta(days=RANKED_EXPIRY_DAYS)

    match = Match(
        played_at=sub.played_at,
        mode=MatchMode.SINGLES if not sub.is_doubles else MatchMode.DOUBLES,
        match_type=MatchTypeDB.CASUAL if sub.is_casual else MatchTypeDB.CLUB,
        team_a_score=sub.team_a_score,
        team_b_score=sub.team_b_score,
        winner_team=winner_team,
        category=sub.category,
        status=status,
        submitted_by_user_id=sub.submitted_by_user_id,
        verified_at=verified_at,
        expires_at=expires_at,
    )
    session.add(match)

    if status is MatchStatus.PENDING:
        # Audit row capture only — pre == post, delta == 0. Phase 2.6's
        # verify step will rewrite these rows with the real deltas.
        for player in team_a:
            pre = _rating_from_row(rating_rows[player.id])
            match.participants.append(
                MatchPlayer.from_update(
                    player_id=player.id, team=Team.A, pre=pre, post=pre
                )
            )
        for player in team_b:
            pre = _rating_from_row(rating_rows[player.id])
            match.participants.append(
                MatchPlayer.from_update(
                    player_id=player.id, team=Team.B, pre=pre, post=pre
                )
            )
        await session.flush()
        return match

    # CASUAL → run the engine now.
    pre_a = [_rating_from_row(rating_rows[p.id]) for p in team_a]
    pre_b = [_rating_from_row(rating_rows[p.id]) for p in team_b]
    post_a, post_b = _compute_post_ratings(pre_a, pre_b, sub, winner_team)

    ceil_a = [rating_rows[p.id].ceiling for p in team_a]
    ceil_b = [rating_rows[p.id].ceiling for p in team_b]
    post_a = _clamp_each(post_a, ceil_a)
    post_b = _clamp_each(post_b, ceil_b)

    for player, pre, post in zip(team_a, pre_a, post_a):
        _apply_rating_to_row(rating_rows[player.id], post)
        match.participants.append(
            MatchPlayer.from_update(player_id=player.id, team=Team.A, pre=pre, post=post)
        )
    for player, pre, post in zip(team_b, pre_b, post_b):
        _apply_rating_to_row(rating_rows[player.id], post)
        match.participants.append(
            MatchPlayer.from_update(player_id=player.id, team=Team.B, pre=pre, post=post)
        )

    await session.flush()
    return match


# ---------------------------------------------------------------------------
# Verification — used by Phase 2.6 routes; included here so the engine
# integration lives next to its sibling submission flow.
# ---------------------------------------------------------------------------

async def verify_pending_match(
    session: AsyncSession,
    match: Match,
) -> Match:
    """
    Flip a PENDING ranked match to VERIFIED and apply rating updates.

    Assumes the caller has already confirmed all participants approved
    (or the auto-verify window has elapsed). This function is intentionally
    naive about the *why* — it just executes the rating update.
    """
    if match.status is not MatchStatus.PENDING:
        raise CategorySubmissionError(
            f"only PENDING matches can be verified; this one is {match.status}"
        )
    if match.category is None:
        raise CategorySubmissionError("match is missing a category — cannot route")

    team_a_player_ids = [p.player_id for p in match.participants if p.team is Team.A]
    team_b_player_ids = [p.player_id for p in match.participants if p.team is Team.B]

    sub = CategoryMatchSubmission(
        category=match.category,
        played_at=match.played_at,
        team_a_player_ids=team_a_player_ids,
        team_b_player_ids=team_b_player_ids,
        team_a_score=match.team_a_score,
        team_b_score=match.team_b_score,
        submitted_by_user_id=match.submitted_by_user_id,
    )

    rating_rows = {}
    for pid in team_a_player_ids + team_b_player_ids:
        rating_rows[pid] = await _get_or_create_category_rating(
            session, pid, match.category
        )

    pre_a = [_rating_from_row(rating_rows[pid]) for pid in team_a_player_ids]
    pre_b = [_rating_from_row(rating_rows[pid]) for pid in team_b_player_ids]

    # Match-type weight: tournament matches use TOURNAMENT weight; ranked
    # club matches use CLUB. Casual never reaches this verify path.
    if match.tournament_id is not None:
        sub = CategoryMatchSubmission(
            **{**sub.__dict__}
        )  # placeholder to make intent explicit
        engine_match_type = MatchType.TOURNAMENT
    else:
        engine_match_type = MatchType.CLUB

    winner_team = Team.A if match.team_a_score > match.team_b_score else Team.B

    # Reuse the doubles/singles routing in _compute_post_ratings but with
    # the right engine weight — by patching MatchType selection via the
    # sub.is_casual flag check inside that helper. To keep this minimal
    # we inline the call here with explicit weight.
    post_a, post_b = _compute_post_ratings_with_weight(
        pre_a, pre_b, sub, winner_team, engine_match_type
    )

    ceil_a = [rating_rows[pid].ceiling for pid in team_a_player_ids]
    ceil_b = [rating_rows[pid].ceiling for pid in team_b_player_ids]
    post_a = _clamp_each(post_a, ceil_a)
    post_b = _clamp_each(post_b, ceil_b)

    # Rewrite the participants' audit rows with real deltas.
    participants_by_pid = {p.player_id: p for p in match.participants}
    for pid, pre, post in zip(team_a_player_ids, pre_a, post_a):
        _apply_rating_to_row(rating_rows[pid], post)
        mp = participants_by_pid[pid]
        mp.pre_r, mp.pre_rd, mp.pre_sigma = pre.r, pre.rd, pre.sigma
        mp.post_r, mp.post_rd, mp.post_sigma = post.r, post.rd, post.sigma
        mp.delta_r = post.r - pre.r
    for pid, pre, post in zip(team_b_player_ids, pre_b, post_b):
        _apply_rating_to_row(rating_rows[pid], post)
        mp = participants_by_pid[pid]
        mp.pre_r, mp.pre_rd, mp.pre_sigma = pre.r, pre.rd, pre.sigma
        mp.post_r, mp.post_rd, mp.post_sigma = post.r, post.rd, post.sigma
        mp.delta_r = post.r - pre.r

    match.status = MatchStatus.VERIFIED
    match.verified_at = datetime.now(timezone.utc)
    await session.flush()
    return match


def _compute_post_ratings_with_weight(
    pre_a: List[PlayerRating],
    pre_b: List[PlayerRating],
    sub: CategoryMatchSubmission,
    winner_team: Team,
    engine_match_type: MatchType,
) -> Tuple[List[PlayerRating], List[PlayerRating]]:
    """Variant of _compute_post_ratings that takes the engine weight explicitly."""
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
