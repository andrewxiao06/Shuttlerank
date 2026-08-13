# ShuttleRank — Architecture & Engineering Reference

The single "how the whole thing fits together" doc. Read this to re-load the
system in your head: what each piece does, how a request flows, the logic
behind each core feature, the bottlenecks that actually bit us and how they
were solved, and how to talk about all of it in an interview.

Companion docs: `CLAUDE.md` (rating math spec), `PLAN.md` (V1 roadmap),
`DEPLOY.md` (ops), `MOBILE.md` (Expo app), `PUSH.md` (notifications),
`DESIGN.md` (visual system).

---

## 1. System at a glance

```
        ┌──────────────┐         ┌──────────────┐
        │  Web (Next)  │         │ Mobile (Expo)│
        │  Vercel      │         │  TestFlight  │
        └──────┬───────┘         └──────┬───────┘
               │ HTTPS + Clerk JWT      │ HTTPS + Clerk JWT
               └────────────┬───────────┘
                            ▼
                    ┌───────────────┐   TLS termination + reverse proxy
                    │  Caddy (EC2)  │   api.shuttlerank.org  (auto Let's Encrypt)
                    └───────┬───────┘
                            ▼
                    ┌───────────────┐   FastAPI (async, uvicorn) in Docker
                    │   API (EC2)   │──► rating engine (pure Python module)
                    └───────┬───────┘
                 ┌──────────┼───────────┐
                 ▼          ▼           ▼
          ┌──────────┐ ┌────────┐ ┌──────────┐
          │ Postgres │ │ Redis  │ │  Clerk   │  (auth, external)
          │  (Neon)  │ │(unused)│ │  Expo    │  (push relay, external)
          └──────────┘ └────────┘ │  Resend  │  (email, external)
                                   └──────────┘
```

**Things you run** (on one EC2 box, via Docker Compose):
- **Caddy** — the only thing on the public internet (:80/:443). Terminates TLS
  (auto-renews Let's Encrypt certs), reverse-proxies to the API. Serves both
  `api.shuttlerank.org` (primary) and `dubr.mooo.com` (legacy).
- **FastAPI API** — the brain. Async (uvicorn + SQLAlchemy 2.0 async + asyncpg).
  Verifies the Clerk JWT on every request, runs business logic, calls the
  rating engine, reads/writes Postgres. Entrypoint runs `alembic upgrade head`
  on start, so migrations apply on deploy.
- **Redis** — provisioned but **not used in code** (placeholder for a future
  leaderboard cache; see §5).

**Things you rent** (managed):
- **Postgres on Neon** — source of truth. Migrated off an on-box container to
  Neon (backups, serverless scaling, no volume to babysit).
- **Clerk** — auth (Google OAuth + email/password). Issues JWTs; a webhook
  syncs users → `players`.
- **Vercel** — hosts the Next.js web app (`shuttlerank.org`). Auto-deploys on
  every push to `main`.
- **Expo/EAS** — builds the mobile app (`.ipa` → TestFlight) and relays push.
- **Resend** — transactional email.

**The code itself:**
- **Rating engine** — a dependency-free Python module (`badminton_rating/engine/`)
  living *inside* the API process. This is the core IP (see §3a).

---

## 2. Request lifecycle

> A user submits a match on the web app. The browser attaches the Clerk JWT and
> `POST`s `/v1/matches` to `api.shuttlerank.org`. **Caddy** terminates TLS and
> forwards to **FastAPI**. FastAPI **verifies the JWT** (`api/auth.py`),
> validates the payload, records the match as **PENDING**, and emails + pushes
> the opponents for approval. Once every opponent approves, the **rating engine**
> computes new ratings and writes them to **Neon Postgres**. The response flows
> back out through Caddy.

Auth is enforced twice, independently: **client-side** by Clerk, and on **every
API call** by FastAPI's JWT verify. The web is purely client-side auth (no
server-side `auth()`), which matters a lot in §4a.

---

## 3. Core features & their logic

### 3a. Rating engine — Glicko-2 + a tanh score-differential factor
**Where:** `badminton_rating/engine/glicko.py` (+ `weights.py`, `ceiling.py`).
Pure functions, zero framework imports — independently testable, and the reason
the 5,000-match simulation (`engine/simulator.py`) can run against it directly.

**Model:** each player carries **two independent ratings** — **singles** and
**doubles** (`RatingCategory.SINGLES/DOUBLES`) — each stored as Glicko-2's three
numbers: `r` (rating), `rd` (deviation/uncertainty), `sigma` (volatility). Six
finer match categories exist (`mens_singles`, `mixed_doubles`, …) for
tournament weighting, but a player's *rating* is singles/doubles.

**The original bit (vs base Glicko-2):** a **score-differential factor** —
`0.5 + 0.5·tanh(margin/total · 3.5)` — so a 21–3 blowout moves the rating more
than a 21–19 nail-biter, while `tanh` caps the effect to stop sandbagging via
blowouts. Reverse-engineering DUPR (1,604 matches) showed it *ignores* margin
(correlation −0.076); this is the deliberate difference. Full math in `CLAUDE.md`.

**Why Glicko-2 over Elo:** it tracks uncertainty (`rd`), so 5 games at 4.0 is
treated differently from 80 games at 4.0. New players have high `rd` → big early
swings that shrink as confidence grows ("still calibrating" UI when `rd > 150`).

### 3b. Match submission + validation (the anti-abuse flow)
**Where:** `api/routes/v1_matches.py` + `services/categories.py`.

The important design decision: **anyone can *record* a match, but it doesn't
count until every real participant approves it.**

```
POST /v1/matches
  → submit_category_match(): create match status=PENDING, expires_at=+7d,
    submitter auto-approves (a MatchValidation row)
  → notify_pending_match(): email + push the other participants

POST /v1/matches/{id}/validate  (each opponent)
  → APPROVED by everyone (all clerk-linked participants) → verify_pending_match()
        → status=VERIFIED, rating engine applies the deltas
  → any DISPUTED → status=DISPUTED, no rating change
```

**Why it's abuse-resistant:** ratings only move on `verify_pending_match`, which
requires an `APPROVED` row from **every** account-holding participant
(`_all_participants_approved`). You can't inflate your rating by fabricating
results — every opponent has to sign off, and any one can dispute.

**Known latent gaps (documented, not yet exploited):**
- Anyone (even a non-participant) can submit → spam vector. Fix = require the
  submitter to be a participant.
- `expires_at` is set (7d) but **nothing auto-verifies on expiry** — deliberately,
  because "silence = consent" is an abuse vector without a dispute window.

### 3c. Auth (Clerk)
**Where:** `api/auth.py` (verify), `api/routes/webhooks.py` (sync), mobile
`lib/auth-sync.tsx`, web `app/providers.tsx`.

- **Client-side sessions** — `ClerkProvider` + `useAuth/useUser`; no page uses
  server-side `auth()`.
- **Every API call** carries `Authorization: Bearer <clerk jwt>`; FastAPI verifies
  it (multi-issuer, 60s leeway).
- **Webhook** (`user.created`, svix-verified) creates the `players` row. Both the
  webhook and a client `bootstrap` fallback **link by verified email** so a
  returning person (dev→prod, pre-created profile) re-attaches to their history
  instead of duplicating.

### 3d. Notifications (email + push)
**Where:** `services/notifications.py` (when/who) → `services/email.py` (Resend)
+ `services/push.py` (Expo). Fired from `notify_pending_match` on submit. Push
deep-links to the match via `data.matchId`. Full detail in `PUSH.md`.

### 3e. Leaderboard
**Where:** `api/routes/v1_leaderboard.py`. Plain Postgres `ORDER BY rating DESC`
per category, `min_matches` filter to hide provisional accounts. **Not** Redis —
see §5.

---

## 4. Bottlenecks that actually bit us (and the fixes) — interview gold

These are the real war stories. Each is a "symptom → red herrings → root cause
→ fix" you can walk through.

### 4a. The 3-second-per-tab freeze after switching to production Clerk
**Symptom:** every web tab switch took ~3s; bursts froze the UI. No errors.
Appeared *only* after moving from Clerk dev keys to production.
**Red herrings:** thought the API was slow (added timing middleware — it was
fast); thought we needed SSR (a Performance profile showed the time was *idle
network wait*, not compute — killed that theory).
**Root cause:** `clerkMiddleware()` ran on **every route**. Production Clerk does
a server-side **handshake that returns a 307**, and Next's App Router **can't
prefetch a 307**, so it re-ran the handshake *live* on every navigation.
**Fix:** scope the middleware matcher to only auth routes (`frontend/proxy.ts`).
Safe because auth is enforced client-side + on the API, so content pages never
needed server-side session verification.

### 4b. TestFlight builds crashed on launch (#5–#7); local builds were fine
**Symptom:** `SIGABRT` in `ObjCTurboModule::performVoidMethodInvocation` at
startup — but only in the App Store build, never on a local device.
**Red herrings (three failed guesses):** `@expo/ui` canary, `reactCompiler`,
`expo-glass-effect`. Each looked plausible; none was it.
**Root cause (via Console.app's live exception):** `@clerk/clerk-expo: Missing
publishableKey`. **EAS Build does not load `.env` files**, so
`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` was `undefined` in the store bundle →
`ClerkProvider` threw at startup → surfaced as a native abort. Local builds
worked because the Expo CLI *does* load `.env`.
**Fix:** declare the `EXPO_PUBLIC_*` vars in `eas.json` `build.<profile>.env`.
**Lesson:** a crash that only happens in the store/distribution build, never
locally, is almost always an env/config difference — get the real exception
before guessing at native deps.

### 4c. Neon "password authentication failed" after DB migration
**Root cause:** the code serialized the DB URL with `str(url)`, and SQLAlchemy
*masks the password as `***`* in `str()`. So it authenticated with `***`.
**Fix:** `url.render_as_string(hide_password=False)` (+ strip libpq
`sslmode`/`channel_binding` since asyncpg ≠ libpq). `db/session.py`.

### 4d. Auth-race 401s / stale-DNS "network request failed"
- Early requests fired before Clerk minted a token → 401s. Fix: `waitForAuthReady`
  + retry `getToken()` briefly (`lib/api/auth-bridge.ts`).
- After the API domain moved to `api.shuttlerank.org`, the app couldn't reach it
  — a stale **negative-DNS cache** on the local network (the record was queried
  before it existed). Not a bug; cleared in ~30 min (SOA negative TTL).

---

## 5. Scaling posture & the real bottleneck

- **Stateless API** → horizontally scalable; nothing lives in process memory
  between requests. This is a *design property*, not deployed infra (single box
  today, which is correct with zero-to-few users).
- **Redis is provisioned but unused.** Honest framing: "the leaderboard is a
  simple indexed Postgres query — fast enough that a cache would be premature
  optimization. I know exactly where Redis slots in (cache the board as a sorted
  set) when reads become the bottleneck." That's a maturity signal, not a gap.
- **The real first bottleneck is Postgres**, not the API layer — connection
  contention / the rating write path. So the first scaling move is PgBouncer +
  read replicas, *not* more API instances.
- **Scale vertically first** (one instance-type bump, no distributed-systems
  complexity), reach for horizontal only when a single box's measured ceiling is
  hit. TODO: a `k6`/`locust` load test to find that ceiling → `SCALING.md`.

---

## 6. Interview talking points (condensed)

- **"Pure function" architecture:** the rating engine has no framework deps —
  algorithm separated from delivery, independently testable, validated by a
  5,000-match simulation asserting correlation with true skill > 0.85.
- **The tanh innovation:** explicit margin weighting, capped to prevent
  sandbagging — something DUPR's reverse-engineered algorithm ignores entirely.
- **Layered auth:** client-side Clerk + independent API JWT verify → let me
  scope middleware off content pages to fix a production-only 307/prefetch stall.
- **A store-only crash → CI didn't inline a public env var the local dev server
  loaded for free** (the EAS `.env` gotcha) — debugged by reading the real
  device exception instead of guessing at native dependencies.
- **Deliberate abuse-resistance:** match ratings only apply after every
  participant approves; I can name the residual gaps and how I'd close them.
- **Right-sized infra:** stateless + managed Postgres; Redis staged but not used
  because the workload doesn't need it yet, and I can say what would change that.
