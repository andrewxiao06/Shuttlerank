"""
Seed a demo population: 100 fake players, each with exactly 10 verified singles
matches against one another, so the leaderboard and match feed look alive.

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
MATCHES_PER_PLAYER = 10
SPAN_DAYS = 63  # first round this long ago, last round yesterday
SEED = 20260918

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


def plan_rounds(people: list[dict], rng: random.Random) -> list[list[tuple[int, int]]]:
    """10 rounds; each round is a perfect matching, so everyone plays exactly
    once per round -> exactly 10 matches each. Opponents are drawn from
    similar skill (like real club play) and repeat pairings are avoided."""
    n = len(people)
    met: set[frozenset[int]] = set()
    rounds = []
    for _ in range(MATCHES_PER_PLAYER):
        for _attempt in range(200):
            order = sorted(range(n), key=lambda i: people[i]["skill"] + rng.gauss(0, 0.7))
            pairs = [(order[i], order[i + 1]) for i in range(0, n, 2)]
            if not any(frozenset(p) in met for p in pairs):
                break
        # After 200 tries a rare rematch is acceptable.
        met.update(frozenset(p) for p in pairs)
        rounds.append([(a, b) if rng.random() < 0.5 else (b, a) for a, b in pairs])
    return rounds


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


def match_dates(n_rounds: int, rng: random.Random, today: date) -> list[date]:
    step = SPAN_DAYS / max(1, n_rounds - 1)
    return [
        min(today - timedelta(days=1), today - timedelta(days=round(SPAN_DAYS - i * step)) + timedelta(days=rng.randint(0, 2)))
        for i in range(n_rounds)
    ]


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
    players: list[Player] = []
    for p in people:
        player = Player(
            name=f"{p['first']} {p['last']}",
            display_name=f"{p['first']} {p['last']}",
            email=f"{_slug(p['first'], p['last'])}{DEMO_EMAIL_DOMAIN}",
            gender=p["gender"], age=p["age"], location=p["location"],
        )
        session.add(player)
        players.append(player)
    await session.flush()

    # Self-pick seed rows (what onboarding writes), so the first singles match
    # seeds from the player's stated level exactly as it does for real users.
    for player, p in zip(players, people):
        session.add(PlayerCategoryRating(
            player_id=player.id, category=RatingCategory.OVERALL,
            r=from_display_rating(p["pick"]), rd=INITIAL_RD, ceiling=INITIAL_CEILING,
        ))
    await session.flush()

    rounds = plan_rounds(people, rng)
    dates = match_dates(len(rounds), rng, date.today())
    total = 0
    for played_at, pairs in zip(dates, rounds):
        for a, b in pairs:
            score_a, score_b = sample_result(people[a]["skill"], people[b]["skill"], rng)
            match = await submit_category_match(session, CategoryMatchSubmission(
                played_at=played_at,
                team_a_player_ids=[players[a].id],
                team_b_player_ids=[players[b].id],
                team_a_score=score_a, team_b_score=score_b,
            ))
            await verify_pending_match(session, match)
            total += 1
    await session.commit()
    print(f"seeded {len(players)} players, {total} verified singles matches")

    await report(session, players, people)


async def report(session, players, people) -> None:
    rows = (await session.execute(
        select(PlayerCategoryRating).where(
            PlayerCategoryRating.category == RatingCategory.SINGLES,
            PlayerCategoryRating.player_id.in_([p.id for p in players]),
        )
    )).scalars().all()
    by_pid = {r.player_id: r for r in rows}
    counts = sorted({r.match_count for r in rows})
    print(f"singles rows: {len(rows)}; distinct match counts: {counts}")

    skills = [p["skill"] for p in people]
    finals = [to_display_rating(by_pid[pl.id].r) for pl in players]
    corr = statistics.correlation(skills, finals)
    print(f"correlation(true skill, computed rating) = {corr:.3f}")

    ranked = sorted(zip(players, finals), key=lambda x: -x[1])
    print("top 5:   ", ", ".join(f"{pl.name} {d:.2f}" for pl, d in ranked[:5]))
    print("bottom 5:", ", ".join(f"{pl.name} {d:.2f}" for pl, d in ranked[-5:]))
    print(f"rating range {min(finals):.2f} - {max(finals):.2f}, median {statistics.median(finals):.2f}")


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
        rounds = plan_rounds(people, rng)
        print(f"would create {len(people)} players and {sum(len(r) for r in rounds)} matches")
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
