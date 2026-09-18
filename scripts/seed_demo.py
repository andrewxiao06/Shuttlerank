"""
Seed a demo population: 100 fake players who each play singles AND doubles
against one another, with varied activity (10 to 43 verified matches each), so
the leaderboards and match feed look alive.

Ratings are NOT hand-assigned. Every match goes through the same service path
the app uses (submit_category_match -> verify_pending_match), so the Glicko-2
engine produces the final numbers. Each player has a hidden "true skill";
outcomes and scores are sampled from it, which lets us check that the computed
ratings recover the true ordering (printed at the end).

Every demo player has an email ending in DEMO_EMAIL_DOMAIN, so they can be
removed with --purge without touching real accounts.

    python -m scripts.seed_demo --yes          # seed
    python -m scripts.seed_demo --purge --yes  # remove all demo data
    python -m scripts.seed_demo --dry-run      # plan only, no DB writes
"""

from __future__ import annotations

import argparse
import asyncio
import math
import random
import statistics
import sys
from datetime import date, timedelta

from sqlalchemy import delete, select
from sqlalchemy.engine import make_url

from badminton_rating.db import session as db_session
from badminton_rating.db.models import (
    INITIAL_CEILING,
    Match,
    MatchPlayer,
    Player,
    PlayerCategoryRating,
    PlayerGender,
    RatingCategory,
)
from badminton_rating.engine.glicko import INITIAL_RD, from_display_rating, to_display_rating
from badminton_rating.services.categories import (
    CategoryMatchSubmission,
    submit_category_match,
    verify_pending_match,
)

DEMO_EMAIL_DOMAIN = "@demo.shuttlerank.invalid"
SPAN_DAYS = 90  # first round this long ago, last round yesterday
SEED = 20260918

# Total matches per player (singles + doubles). Skewed the way real clubs are:
# lots of casual regulars in the low teens, a long tail of heavy players.
TOTAL_MATCHES = (
    [10] * 8 + [11, 12, 12, 13, 14, 14, 15, 16, 17, 18, 18, 20, 22, 24, 26, 28, 31, 33, 36, 38, 43, 43]
)

# Profile photos live in frontend/public/demo-avatars (served by the web app so
# mobile can load them too). Counts per kind match the files on disk.
AVATAR_BASE = "https://shuttlerank.org/demo-avatars"
AVATAR_KINDS = {
    "cat": 12, "dog": 12, "cartoon": 20, "land": 15, "badminton": 8,
    "people-m": 10, "people-w": 10,
}

M, W = PlayerGender.M, PlayerGender.W

# (first, last, gender) — Indian American, Asian American, and common American.
NAMES = [
    # Indian American
    ("Aarav", "Patel", M), ("Priya", "Sharma", W), ("Rohan", "Mehta", M),
    ("Ananya", "Iyer", W), ("Arjun", "Reddy", M), ("Neha", "Gupta", W),
    ("Vikram", "Singh", M), ("Kavya", "Nair", W), ("Rahul", "Desai", M),
    ("Sneha", "Kapoor", W), ("Karan", "Shah", M), ("Anjali", "Rao", W),
    ("Dev", "Malhotra", M), ("Pooja", "Joshi", W), ("Nikhil", "Verma", M),
    ("Meera", "Krishnan", W), ("Sanjay", "Kumar", M), ("Divya", "Agarwal", W),
    ("Amit", "Bhatt", M), ("Riya", "Chopra", W), ("Varun", "Choudhury", M),
    ("Tara", "Menon", W), ("Ravi", "Pillai", M), ("Simran", "Kaur", W),
    ("Akash", "Trivedi", M), ("Nisha", "Bhatia", W), ("Sameer", "Kulkarni", M),
    ("Isha", "Banerjee", W), ("Anil", "Ghosh", M), ("Deepa", "Venkat", W),
    ("Neil", "Jain", M), ("Aisha", "Rahman", W), ("Milan", "Thakkar", M),
    ("Sonia", "Dhillon", W), ("Raj", "Prasad", M),
    # Asian American
    ("Kevin", "Nguyen", M), ("Jasmine", "Tran", W), ("Brian", "Chen", M),
    ("Emily", "Wang", W), ("Jason", "Lee", M), ("Michelle", "Kim", W),
    ("David", "Park", M), ("Christine", "Liu", W), ("Andrew", "Zhang", M),
    ("Grace", "Huang", W), ("Eric", "Lin", M), ("Tiffany", "Wu", W),
    ("Daniel", "Choi", M), ("Amy", "Yang", W), ("Justin", "Ho", M),
    ("Vivian", "Chu", W), ("Ryan", "Tanaka", M), ("Sarah", "Nakamura", W),
    ("Alex", "Pham", M), ("Jenny", "Le", W), ("Kenny", "Wong", M),
    ("Stephanie", "Cheng", W), ("Tommy", "Do", M), ("Angela", "Zhou", W),
    ("Nathan", "Jung", M), ("Katie", "Yoon", W), ("Steven", "Cho", M),
    ("Lily", "Xu", W), ("Victor", "Lam", M), ("Hannah", "Shin", W),
    ("Henry", "Truong", M), ("Chloe", "Sato", W), ("Ian", "Kwon", M),
    ("Megan", "Vu", W), ("Colin", "Ma", M),
    # American
    ("Jake", "Miller", M), ("Chris", "Johnson", M), ("Sarah", "Thompson", W),
    ("Matt", "Davis", M), ("Jessica", "Brown", W), ("Ryan", "Anderson", M),
    ("Emma", "Wilson", W), ("Tyler", "Moore", M), ("Lauren", "Taylor", W),
    ("Josh", "Martinez", M), ("Ashley", "Clark", W), ("Brandon", "Hall", M),
    ("Megan", "Lewis", W), ("Nick", "Walker", M), ("Rachel", "Young", W),
    ("Zach", "Allen", M), ("Olivia", "King", W), ("Kyle", "Wright", M),
    ("Hannah", "Scott", W), ("Mike", "Turner", M), ("Taylor", "Green", W),
    ("Cody", "Baker", M), ("Samantha", "Adams", W), ("Ethan", "Nelson", M),
    ("Nicole", "Hill", W), ("Dylan", "Campbell", M), ("Kayla", "Mitchell", W),
    ("Luke", "Roberts", M), ("Jordan", "Carter", M), ("Sean", "Phillips", M),
]

NJ_LOCATIONS = [
    "Edison, NJ", "Iselin, NJ", "Princeton, NJ", "Jersey City, NJ", "Piscataway, NJ",
    "Parsippany, NJ", "Cherry Hill, NJ", "Hoboken, NJ", "Fort Lee, NJ", "Bridgewater, NJ",
    "Woodbridge, NJ", "Cranbury, NJ", "Morristown, NJ", "Livingston, NJ", "Montclair, NJ",
]


def _slug(first: str, last: str) -> str:
    return f"{first}.{last}".lower()


def build_population(rng: random.Random) -> list[dict]:
    assert len(NAMES) == 100, len(NAMES)
    assert len({(f, l) for f, l, _ in NAMES}) == 100, "duplicate full names"
    people = []
    for first, last, gender in NAMES:
        # True skill on the 1.0-5.0 display scale, bell-shaped around Silver/Gold.
        skill = min(4.85, max(1.1, rng.gauss(2.9, 0.85)))
        # Self-picked starting level: people misjudge themselves, so the
        # algorithm has real correcting to do. Self-pick range is 1.0-4.5.
        pick = min(4.5, max(1.0, skill + rng.gauss(0, 0.6)))
        people.append({
            "first": first, "last": last, "gender": gender,
            "skill": skill, "pick": round(pick, 1),
            "age": rng.randint(18, 52),
            "location": rng.choice(NJ_LOCATIONS),
        })
    return people


def split_totals(people: list[dict], rng: random.Random) -> None:
    """Give each player a target singles + doubles match count."""
    for p in people:
        total = rng.choice(TOTAL_MATCHES)
        singles = max(4, round(total * rng.uniform(0.3, 0.6)))
        p["want"] = {1: singles, 2: total - singles}


def plan_matches(
    people: list[dict], size: int, rng: random.Random
) -> list[tuple[int, list[list[int]]]]:
    """Plan every match of one format (size 1 = singles, 2 = doubles).

    Returns [(round_index, [team_a_idx, team_b_idx])]. Players are spread over
    the whole timeline: each round a player is drawn in with probability
    remaining/rounds_left, so heavy players show up often and casual ones now
    and then. Within a round, players are grouped with similar skill (like
    real club play). Leftover targets are topped up at the end so everyone
    reaches at least their target."""
    n, group = len(people), size * 2
    remaining = [p["want"][size] for p in people]
    n_rounds = max(remaining)
    planned: list[tuple[int, list[list[int]]]] = []

    def emit(rnd: int, idxs: list[int]) -> None:
        if size == 1:
            teams = [[idxs[0]], [idxs[1]]]
        else:  # balanced-ish: strongest + weakest vs the middle two, or random
            g = idxs if rng.random() < 0.5 else [idxs[0], idxs[2], idxs[1], idxs[3]]
            teams = [[g[0], g[3]], [g[1], g[2]]]
        planned.append((rnd, teams))

    for rnd in range(n_rounds):
        left = n_rounds - rnd
        active = [i for i in range(n) if remaining[i] > 0 and rng.random() < min(1.0, remaining[i] / left)]
        rng.shuffle(active)
        active = active[: len(active) // group * group]
        active.sort(key=lambda i: people[i]["skill"] + rng.gauss(0, 0.7))
        for k in range(0, len(active), group):
            chunk = active[k : k + group]
            for i in chunk:
                remaining[i] -= 1
            emit(rnd, chunk)

    # Top-up: anyone still short plays extra matches on the final round.
    for i in range(n):
        while remaining[i] > 0:
            others = rng.sample([j for j in range(n) if j != i], group - 1)
            chunk = sorted([i, *others], key=lambda j: people[j]["skill"])
            remaining[i] -= 1
            emit(n_rounds - 1, chunk)
    return planned


def sample_result(skill_a: float, skill_b: float, rng: random.Random) -> tuple[int, int]:
    """Sample (score_a, score_b) for one game to 21 (win by 2, cap 30)."""
    p_a = 1 / (1 + math.exp(-(skill_a - skill_b)))
    a_wins = rng.random() < p_a
    p_w = p_a if a_wins else 1 - p_a  # winner's pre-match win probability
    # Lopsided expected matchups -> lopsided scores; coin-flips go to deuce.
    loser = max(3, round(rng.gauss(18 * (1 - 2.0 * (p_w - 0.5)), 3.5)))
    if loser >= 20:  # deuce: play on until someone is 2 clear (mostly 22-20, 23-21)
        loser = min(28, 20 + int(rng.expovariate(0.9)))
        winner = loser + 2
    else:
        winner = 21
    return (winner, loser) if a_wins else (loser, winner)


def round_date(rnd: int, n_rounds: int, rng: random.Random, today: date) -> date:
    days_ago = round(SPAN_DAYS * (1 - rnd / max(1, n_rounds - 1)))
    return min(today - timedelta(days=1), today - timedelta(days=max(0, days_ago - rng.randint(0, 1))))


def assign_avatars(people: list[dict], rng: random.Random) -> None:
    """Mix of cats/dogs, cartoons, landscapes, portraits and badminton shots;
    ~13% keep the default monogram. Portraits are matched to the player's
    gender; everything else is spread at random."""
    order = list(range(len(people)))
    rng.shuffle(order)
    portraits = {
        PlayerGender.M: [f"people-m-{i:02d}.jpg" for i in range(1, 11)],
        PlayerGender.W: [f"people-w-{i:02d}.jpg" for i in range(1, 11)],
    }
    rest: list[str | None] = [
        f"{kind}-{i:02d}.jpg"
        for kind, count in AVATAR_KINDS.items() if not kind.startswith("people")
        for i in range(1, count + 1)
    ]
    for pool in portraits.values():
        pool.reverse()  # pop() from the end, in order
    unassigned = []
    for idx in order:
        pool = portraits[people[idx]["gender"]]
        if pool:
            people[idx]["avatar"] = pool.pop()
        else:
            unassigned.append(idx)
    rest += [None] * (len(unassigned) - len(rest))
    rng.shuffle(rest)
    for idx, fname in zip(unassigned, rest):
        people[idx]["avatar"] = fname
    for p in people:
        p["avatar_url"] = f"{AVATAR_BASE}/{p['avatar']}" if p["avatar"] else None


async def purge(session) -> None:
    ids = (await session.execute(
        select(Player.id).where(Player.email.like(f"%{DEMO_EMAIL_DOMAIN}"))
    )).scalars().all()
    if not ids:
        print("no demo players found")
        return
    match_ids = (await session.execute(
        select(MatchPlayer.match_id).where(MatchPlayer.player_id.in_(ids)).distinct()
    )).scalars().all()
    # Delete children explicitly rather than relying on DB-level cascades.
    await session.execute(delete(MatchPlayer).where(MatchPlayer.match_id.in_(match_ids)))
    await session.execute(delete(Match).where(Match.id.in_(match_ids)))
    await session.execute(delete(PlayerCategoryRating).where(PlayerCategoryRating.player_id.in_(ids)))
    await session.execute(delete(Player).where(Player.id.in_(ids)))
    await session.commit()
    print(f"purged {len(ids)} demo players and {len(match_ids)} matches")


async def seed(session, rng: random.Random) -> None:
    existing = (await session.execute(
        select(Player.id).where(Player.email.like(f"%{DEMO_EMAIL_DOMAIN}")).limit(1)
    )).first()
    if existing:
        sys.exit("demo players already exist — run with --purge first")

    people = build_population(rng)
    split_totals(people, rng)
    assign_avatars(people, rng)
    players: list[Player] = []
    for p in people:
        player = Player(
            name=f"{p['first']} {p['last']}",
            display_name=f"{p['first']} {p['last']}",
            email=f"{_slug(p['first'], p['last'])}{DEMO_EMAIL_DOMAIN}",
            gender=p["gender"], age=p["age"], location=p["location"],
            avatar_url=p["avatar_url"],
        )
        session.add(player)
        players.append(player)
    await session.flush()

    # Self-pick seed rows (what onboarding writes), so the first match in each
    # format seeds from the player's stated level exactly as it does for real users.
    for player, p in zip(players, people):
        session.add(PlayerCategoryRating(
            player_id=player.id, category=RatingCategory.OVERALL,
            r=from_display_rating(p["pick"]), rd=INITIAL_RD, ceiling=INITIAL_CEILING,
        ))
    await session.flush()

    # Plan both formats, then replay everything in date order so ratings evolve
    # exactly as they would have in real life (doubles cross-seeds off singles).
    today = date.today()
    events = []
    for size in (1, 2):
        planned = plan_matches(people, size, rng)
        n_rounds = 1 + max(r for r, _ in planned)
        for rnd, teams in planned:
            events.append((round_date(rnd, n_rounds, rng, today), rnd, size, teams))
    events.sort(key=lambda e: (e[0], e[1], e[2]))

    total = 0
    for played_at, _, size, (team_a, team_b) in events:
        avg = lambda team: sum(people[i]["skill"] for i in team) / len(team)
        score_a, score_b = sample_result(avg(team_a), avg(team_b), rng)
        match = await submit_category_match(session, CategoryMatchSubmission(
            played_at=played_at,
            team_a_player_ids=[players[i].id for i in team_a],
            team_b_player_ids=[players[i].id for i in team_b],
            team_a_score=score_a, team_b_score=score_b,
        ))
        await verify_pending_match(session, match)
        total += 1
    await session.commit()
    print(f"seeded {len(players)} players, {total} verified matches")

    await report(session, players, people)


async def report(session, players, people) -> None:
    pids = [p.id for p in players]
    rows = (await session.execute(
        select(PlayerCategoryRating).where(
            PlayerCategoryRating.category.in_([RatingCategory.SINGLES, RatingCategory.DOUBLES]),
            PlayerCategoryRating.player_id.in_(pids),
        )
    )).scalars().all()
    by = {(r.player_id, r.category): r for r in rows}
    totals = [
        by[(pl.id, RatingCategory.SINGLES)].match_count + by[(pl.id, RatingCategory.DOUBLES)].match_count
        for pl in players
    ]
    print(f"total matches per player: min {min(totals)}, median {statistics.median(totals)}, max {max(totals)}")
    print(f"distinct totals: {sorted(set(totals))}")
    print(f"avatars: {sum(1 for p in people if p['avatar'])} photos, {sum(1 for p in people if not p['avatar'])} monograms")

    skills = [p["skill"] for p in people]
    for cat in (RatingCategory.SINGLES, RatingCategory.DOUBLES):
        finals = [to_display_rating(by[(pl.id, cat)].r) for pl in players]
        corr = statistics.correlation(skills, finals)
        ranked = sorted(zip(players, finals), key=lambda x: -x[1])
        print(f"[{cat.value}] correlation(true skill, rating) = {corr:.3f}; "
              f"range {min(finals):.2f}-{max(finals):.2f}, median {statistics.median(finals):.2f}")
        print("   top 3:", ", ".join(f"{pl.name} {d:.2f}" for pl, d in ranked[:3]))


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--purge", action="store_true", help="remove all demo players + their matches")
    ap.add_argument("--dry-run", action="store_true", help="print the plan; write nothing")
    ap.add_argument("--yes", action="store_true", help="confirm writing to the target DB")
    args = ap.parse_args()

    url = make_url(db_session.DATABASE_URL)
    print(f"target database: {url.host}/{url.database}")

    rng = random.Random(SEED)
    if args.dry_run:
        people = build_population(rng)
        split_totals(people, rng)
        n = sum(len(plan_matches(people, size, rng)) for size in (1, 2))
        print(f"would create {len(people)} players and {n} matches")
        return
    if not args.yes:
        sys.exit("refusing to write without --yes")

    async with db_session.AsyncSessionLocal() as session:
        if args.purge:
            await purge(session)
        else:
            await seed(session, rng)


if __name__ == "__main__":
    asyncio.run(main())
