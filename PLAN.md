# BRS V1 — Production Plan

This document captures all decisions and the full implementation roadmap for
the v1 product release. The foundational engine + algorithm spec lives in
`CLAUDE.md`; this file builds on top of it.

**Status legend:** ✅ done · 🚧 in progress · ⬜ planned

---

## V1 product requirements

1. **Email-based profiles** — users sign up with an email; their player record
   is linked to a real identity.
2. **Six rating categories** — every player has separate ratings for:
   - Mens singles
   - Womens singles
   - Mens doubles
   - Womens doubles
   - Mixed doubles
   - Casual (open ELO — any combination of genders, singles or doubles)
3. **Match validation flow**
   - Ranked matches require **all participants** to approve before ratings
     update. Auto-verify after 7 days if no dispute is filed.
   - Casual matches verify instantly; any participant can report them
     after the fact as falsified.
4. **Tournament generator** — given an entry list, pair players of similar
   skill randomly into matches. Supports single-elim, round-robin, Swiss.
5. **DUPR-style rating ceiling** — display rating cannot exceed a per-player
   `ceiling` value. The ceiling rises only when the player participates in a
   verified ranked tournament. This is the integrity story — it prevents
   sandbagging via casual play.
6. **TournamentSoftware import** — tournament results from
   tournamentsoftware.com can be imported and used to update ceilings.
   Format spec TBD (user will provide).

---

## Backend — current state (✅ complete)

The MVP backend exists and is fully tested (83 tests passing). See `CLAUDE.md`
for the architectural pitch and engine spec. Summary of what's built:

| Layer | Module | Done |
|---|---|---|
| Engine | `engine/glicko.py`, `weights.py`, `simulator.py` | ✅ |
| Persistence | `db/models.py`, `db/session.py` | ✅ |
| Service layer | `services/matches.py` | ✅ |
| API | `api/app.py`, `api/routes/*`, `api/models/*` | ✅ |
| Migrations | Alembic (initial schema) | ✅ |
| Docker | Postgres + Redis + API compose | ✅ |
| Tests | engine, simulator, service, api (83 passing) | ✅ |

**The v0 schema is `singles_*` / `doubles_*` columns on `players`. V1 will
migrate this to a child `player_ratings` table.**

---

## Decisions locked in

| Topic | Decision | Reason |
|---|---|---|
| Auth provider | **Clerk** | Drops the auth-rolling distraction; the story is the algorithm, not auth plumbing. Free tier covers anything realistic. |
| Frontend stack | Next.js 15 (App Router) + TypeScript + shadcn/ui + Tailwind | Already on resume; shadcn matches DUPR's aesthetic. |
| State + data | TanStack Query (Phase 9 only); mocks until then | Lets every screen be built without the backend. |
| Rating categories | Child `player_ratings` table, not more columns | Future-proof if we add more categories. |
| Validation model | Pending → verified state machine; ratings apply on `verified` | Mirrors DUPR. Auto-verify after 7 days. |
| Casual rating | Single rating that allows mixed gender, no eligibility checks | Solves the "we just want to play" use case. |

---

## Backend Phase 2 — V1 schema migration (⬜ planned)

### New / changed tables

```
# REPLACE the v0 singles_*/doubles_* columns on players with:
player_ratings
  id (PK)
  player_id (FK players.id)
  category (enum: mens_singles, womens_singles,
                  mens_doubles, womens_doubles,
                  mixed_doubles, casual)
  r, rd, sigma, last_active, match_count
  ceiling                     # DUPR-style cap
  ceiling_updated_at
  UNIQUE(player_id, category)

# Add to players:
  clerk_user_id (string, unique, nullable for legacy)
  gender (enum: M, W, X)      # X = unspecified, casual-only
  display_name (separate from name)

# Replace mode on matches with category; add validation state:
matches
  category (enum, replaces mode)
  status (enum: pending, verified, disputed, expired)
  submitted_by_user_id (string, Clerk user id)
  verified_at (nullable)
  expires_at (nullable)
  tournament_id (FK tournaments.id, nullable)
  round (int, nullable)

# New: per-participant validation actions
match_validations
  id (PK)
  match_id (FK matches.id)
  user_id (string, Clerk user id)
  action (enum: approved, disputed)
  acted_at
  note (text, nullable)
  UNIQUE(match_id, user_id)

# New: falsification reports
match_reports
  id (PK)
  match_id (FK)
  reporter_user_id (string, Clerk user id)
  reason (enum: wrong_score, wrong_players, never_happened, other)
  description (text)
  status (enum: open, resolved_invalid, resolved_valid)
  created_at, resolved_at

# New: tournament system
tournaments
  id (PK)
  name, format (enum: single_elim, round_robin, swiss),
  category (enum, same as match.category),
  starts_at, ends_at,
  organizer_user_id (string, Clerk user id),
  status (enum: draft, open, in_progress, completed),
  external_source (enum: manual, tournamentsoftware, nullable),
  external_id (string, nullable)

tournament_entries
  id (PK)
  tournament_id (FK)
  player_id (FK)
  seed (int)
  withdrawn (bool)
  UNIQUE(tournament_id, player_id)

# New: ceiling unlock audit
ceiling_history
  id (PK)
  player_id (FK)
  category (enum)
  old_ceiling, new_ceiling
  tournament_id (FK, nullable)
  changed_at
```

### Migration strategy

1. **Migration A** — additive: create `player_ratings`, copy current
   singles/doubles values into rows, add new columns to `players`/`matches`
   alongside the old ones. Old code still works.
2. **Migration B** — flip the engine + services to read/write the new
   structure. Run both paths in parallel under a feature flag for one week.
3. **Migration C** — destructive: drop the old `singles_*` / `doubles_*`
   columns and the `mode` column on matches. Done.

This is the only safe way to evolve a schema with live data once we ship.

---

## Backend Phase 2.5 — Engine changes (✅ complete)

**Shipped:**

| Deliverable | Location | Tests |
|---|---|---|
| `apply_ceiling()` pure clamp | `engine/glicko.py` | `tests/test_ceiling.py` |
| `from_display_rating()` inverse helper | `engine/glicko.py` | covered by ceiling tests |
| Tournament pairing — single-elim / round-robin / Swiss | `engine/pairing.py` | `tests/test_pairing.py` |
| Post-tournament ceiling unlock | `engine/ceiling.py` | `tests/test_ceiling.py` |
| Category routing service (PlayerCategoryRating) | `services/categories.py` | `tests/test_category_routing.py` |
| Gender eligibility per category | `services/categories.py` | `tests/test_category_routing.py` |
| Pending → verified state machine | `services/categories.py::verify_pending_match` | `tests/test_category_routing.py` |

**Load-bearing decision:** new `PlayerCategoryRating` rows start at
`r = from_display_rating(INITIAL_CEILING)` (≈1333.34) — not at `INITIAL_R`
(1500). The default ceiling (4.0) maps to internal r=1333.34, so without this
override every new player would be permanently above their cap from match 1
and rating movement would be all clamp, no signal. The "new players start AT
the cap" semantic also matches DUPR: your rating is bounded by your ceiling,
and the ceiling unlocks via tournaments.

114 tests passing (83 v0 + 31 new).



### Category routing

`process_match` stays pure but moves to a per-category dispatcher in the
service layer. The engine never knows what category it's processing — it
just takes two ratings and returns two updated ratings.

### Ceiling clamp

New pure function in `engine/glicko.py`:

```python
def apply_ceiling(rating: PlayerRating, ceiling: float) -> PlayerRating:
    """Clamp display rating to the ceiling. Must be called after every update."""
    if rating.display_rating() <= ceiling:
        return rating
    # Reverse-compute the internal r that yields exactly the ceiling
    target_r = (ceiling - 2.0) * 166.67 + 1000
    return PlayerRating(r=target_r, rd=rating.rd, sigma=rating.sigma,
                        last_active=rating.last_active)
```

### Pairing algorithm

New module `engine/pairing.py`:

```python
def pair_by_skill(entries: list[TournamentEntry],
                  format: TournamentFormat) -> list[ProposedMatch]:
    """Pure function. Group entries by rating bucket, generate matchups."""
```

Same architectural principle as the rating engine — pure, testable in
isolation, no DB or framework dependencies.

### Ceiling unlock

```python
def update_ceilings(tournament: Tournament,
                    entries_with_matches: list) -> list[CeilingUpdate]:
    """After tournament completes, compute new ceilings for each entrant."""
```

The formula: `new_ceiling = max(old_ceiling, achieved_display + tier_bonus)`
where `tier_bonus` depends on tournament strength (club: 0, regional: 0.25,
national: 0.5).

---

## Backend Phase 2.6 — API surface (✅ complete)

**Shipped:**

| Layer | Module | Notes |
|---|---|---|
| Auth dep | `api/auth.py` | `current_player`, `current_player_optional`, `verify_clerk_webhook` (svix; bypass via env for tests) |
| Clerk webhook | `api/routes/webhooks.py` | `POST /webhooks/clerk` — user.created (create Player), user.deleted (anonymize) |
| Profile | `api/routes/me.py` | `GET /players/me`, `PATCH /players/me`; must register before v0 `/players/{id}` |
| V1 matches | `api/routes/v1_matches.py` | `POST /v1/matches` (casual=verified, ranked=pending), `GET /v1/matches/{id}`, validate, report, `/v1/matches/inbox/pending` |
| V1 leaderboard | `api/routes/v1_leaderboard.py` | `GET /v1/leaderboard?category=…`, `GET /v1/players/{id}/forecast?category=…` |
| Tournaments | `api/routes/tournaments.py` | Browse / create / sign-up / withdraw / generate-pairings (organizer) / complete (applies ceilings) |
| Admin | `api/routes/admin.py` | `POST /admin/tournaments/import` → 501; `PATCH /admin/reports/{id}`; gated by `BRS_ADMIN_USER_IDS` env |
| Pydantic | `api/models/v1.py` | All v1 request/response schemas |
| Tests | `tests/test_api_v1.py` | 19 e2e tests including the validation state machine and full tournament lifecycle |

**Load-bearing detail:** `me.router` must mount before `players.router`, or
FastAPI parses `me` as the int path param of `/players/{id}` and returns 422.

133 tests passing (83 v0 + 31 Phase 2.5 + 19 Phase 2.6).

**Production checklist before deploy:**
- `pip install svix` and set `CLERK_WEBHOOK_SECRET`
- Set `BRS_ADMIN_USER_IDS` to a comma-separated list of admin Clerk IDs
- ✅ **Real Clerk JWT verification shipped** — `api/auth._verify_clerk_jwt`
  validates the `Authorization: Bearer` token against Clerk's JWKS (RS256
  signature + `exp`/`nbf` + issuer + optional `azp`). Set `CLERK_ISSUER`
  (and optionally `CLERK_AUTHORIZED_PARTIES`). The unverified
  `X-Clerk-User-Id` header is now rejected unless `CLERK_DEV_ALLOW_HEADER=1`
  is explicitly set — **never set that in prod.** Covered by
  `tests/test_auth_hardening.py` (forged/expired/wrong-key/wrong-issuer
  tokens all rejected; valid JWT resolves end-to-end).



### New / changed routes

```
# Identity (mostly handled by Clerk — only our webhook receiver lives here)
POST   /webhooks/clerk           # listens for user.created, user.deleted
                                 # MUST verify svix signature

# Player profile (existing, extended)
GET    /players/me               # current player from Clerk session
PATCH  /players/me               # update gender, display_name
GET    /players/{id}             # public profile

# Matches (existing, extended)
POST   /matches                  # creates pending or verified depending on category
GET    /matches/{id}
GET    /matches/{id}/validations # list of approve/dispute actions
POST   /matches/{id}/validate    # body: action=approved|disputed, note
POST   /matches/{id}/report      # body: reason, description
GET    /matches/pending          # current player's inbox

# Forecast (existing)
GET    /players/{id}/forecast?opponent_id=X&category=Y

# Leaderboard (existing, extended)
GET    /leaderboard?category=mens_singles&...

# Tournaments (new)
GET    /tournaments
POST   /tournaments
GET    /tournaments/{id}
POST   /tournaments/{id}/entries        # sign up
DELETE /tournaments/{id}/entries/me     # withdraw
POST   /tournaments/{id}/generate-pairings  # organizer only
POST   /tournaments/{id}/complete       # triggers ceiling updates

# Admin
POST   /admin/tournaments/import        # 501 Not Implemented (until parser)
PATCH  /admin/reports/{id}
```

### Auth dependency

```python
async def current_player(
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> Player:
    """Verifies Clerk session token, returns the matching Player row."""
```

Apply via `Depends(current_player)` on every protected route.

---

## Frontend — implementation phases (⬜ planned)

Backend integration is **Phase 9 only**. Phases 0–8 run against a hand-written
mock layer matching the API response shapes.

### Tech foundation (Phase 0)

| Decision | Choice |
|---|---|
| Framework | Next.js 15 App Router |
| Language | TypeScript strict |
| UI components | shadcn/ui + Tailwind |
| Data layer | TanStack Query (Phase 9), mocks before that |
| Charts | Recharts |
| Validation | Zod (both API responses and form input) |
| Theme | next-themes |
| Auth | Clerk (`<ClerkProvider>`, `<SignIn />`, `<SignUp />`, `<UserButton />`) |

### Folder layout

```
frontend/
├── app/
│   ├── layout.tsx                 # ClerkProvider + Nav
│   ├── page.tsx                   # Home/dashboard
│   ├── players/
│   │   ├── [id]/page.tsx          # Profile
│   │   └── [id]/matches/page.tsx
│   ├── leaderboard/page.tsx
│   ├── matches/
│   │   ├── new/page.tsx
│   │   └── [id]/page.tsx
│   ├── inbox/page.tsx             # Pending validations
│   ├── tournaments/
│   │   ├── page.tsx               # Browse
│   │   └── [id]/page.tsx          # Bracket detail
│   └── forecast/page.tsx
├── components/
│   ├── ui/                        # shadcn primitives
│   ├── rating/                    # RatingBadge, TierChip, CalibrationDot, CeilingBar
│   ├── player/                    # PlayerCard, PlayerSearch, RatingHistoryChart
│   ├── match/                     # ScoreInput, MatchRow, DeltaPill, ValidationCard
│   ├── tournament/                # BracketView, EntryList
│   └── layout/                    # Nav, MobileTabBar
├── lib/
│   ├── api/
│   │   ├── client.ts              # PHASE 9: real fetcher
│   │   ├── mock.ts                # PHASES 1-8
│   │   ├── types.ts               # TypeScript mirrors of Pydantic schemas
│   │   └── hooks.ts               # useQuery/useMutation wrappers
│   ├── fixtures/                  # JSON fixtures
│   ├── tier.ts                    # Tier-color mapping
│   └── format.ts                  # Display rating, percent, date helpers
└── styles/globals.css
```

### Phase 0.5 — DESIGN.md (single source of visual truth)

The full visual identity lives in **`DESIGN.md`** at the project root, written
to the [Google Stitch DESIGN.md spec](https://github.com/google-labs-code/design.md)
(YAML frontmatter with design tokens + markdown body with rationale). Claude
Code, Cursor, and any future agent picks it up automatically. **Treat it as
authoritative — if a tile color in this PLAN.md ever drifts from `DESIGN.md`,
`DESIGN.md` wins.**

What's in `DESIGN.md`:

- **Tokens (frontmatter):** colors, typography, rounded, spacing, components,
  breakpoints. Every component (button-primary, card, chip-tier, fab,
  delta-positive, etc.) declared as token references — no raw hex in code.
- **Body sections:** Overview · Colors · Typography · Layout · Elevation &
  Depth · Shapes · Components · Do's and Don'ts.
- **Mobile-first contract** (load-bearing — most users are on phones courtside):
  - Every screen authored at 375×667 (iPhone SE) first, progressively
    enhanced via Tailwind `sm: md: lg: xl:` prefixes
  - Minimum 44×44px tap targets (Apple HIG)
  - Body text ≥16px to suppress iOS Safari focus-zoom
  - Safe-area-inset respected on bottom nav + FAB
  - Tabular numerals enforced on every rating/score/delta via `fontFeature: 'tnum' 1`
  - Three elevation levels; borders preferred over shadows
- **Locked semantics:** win=`accent` green, loss=`danger` red, pending=`warning`
  amber, forecast=`info` blue. Colorblind users disambiguate via sign + shape,
  not hue. Tier palette is hard-mapped — never reinterpret.

**Phase 1 (token wiring)** then mirrors these tokens into `tailwind.config.ts`
and a `styles/tokens.css` custom-properties layer so component code reads
`bg-surface` / `text-accent` instead of hex literals. If `DESIGN.md` is
updated later, Phase 1 outputs regenerate from it.

### Type contracts (Phase 2)

`lib/api/types.ts` is the single source of truth for API shapes. Every field
mirrors a Pydantic schema in `badminton_rating/api/models/`. If something
breaks during integration, this file is the first place to check.

### Mock layer (Phase 3)

`lib/api/mock.ts` exports the same function signatures as `client.ts`.
- Simulates 200ms latency
- `?fail=1` query param escape hatch to test error states
- Returns from `lib/fixtures/*.json`

### Screens (Phases 4–8)

Each screen has: north star · user context · UI principles · layout spec ·
states · acceptance criteria · failure modes & one-pass fixes.

**Mobile-first universal acceptance criteria — every screen below inherits these.**

- Passes manual QA at 375×667 (iPhone SE) before any wider breakpoint
- No horizontal scroll on any viewport ≥320px
- Every interactive element is ≥44×44px
- All `<input>` font-size ≥16px
- Bottom-fixed elements respect `env(safe-area-inset-bottom)`
- Lighthouse mobile performance ≥85, accessibility ≥95
- Works with one-handed thumb reach: primary actions live in the bottom
  third of the viewport on mobile (FAB, primary CTA in sheets)
- Tested with `prefers-reduced-motion: reduce` — count-up animations disable

#### Phase 4 — Profile (`app/players/[id]/page.tsx`)

- **North star:** *Your rating is the hero — everything else is supporting cast.*
- **User context:** casual player, mobile, half-attention, wants "did I go up?"
- Six rating tiles (horizontal scroll on mobile, grid on desktop), each with:
  - Display rating (large, tabular)
  - Tier chip
  - Calibration dot if `rd > 150`
  - **Ceiling bar** showing how close to the cap they are; if capped, shows
    "Capped — play a sanctioned tournament to raise this"
- Singles/doubles toggle replaced with category selector
- Rating history chart (Recharts line, last 30 matches)
- Recent matches list with delta pills
- **Acceptance:** category change updates rating, tier, chart, match list
  without reload; ceiling bar reflects `rating.display ÷ ceiling`

#### Phase 5 — Leaderboard (`app/leaderboard/page.tsx`)

- **North star:** *Where do I stand, and who's near me?*
- Category selector (6 + casual)
- Scannable table with sticky header, tabular numerals
- Calibrating rows dimmed (`opacity-60`) with `○` marker
- Current user's row highlighted
- "Hide provisional" filter (excludes players still at starting ceiling)
- URL-synced pagination

#### Phase 6 — Submit match (`app/matches/new/page.tsx`)

- **North star:** *Give me my rating change in under 30 seconds.*
- Step 1: **Category picker** (6 ranked + casual). Ranked categories show
  "Both teams will need to approve." Casual shows "Verifies instantly."
- Step 2: player search filtered by eligible genders for the category
  - Mixed doubles UI enforces 1M+1W per team
- Step 3: score input (multiple games supported — best-of-3 by default)
- Optimistic submit; on success → toast + redirect to `/matches/{id}`
- **Acceptance:** Zod validates before enabling Submit; selecting player in
  team A excludes them from team B; tied scores blocked inline

#### Phase 7 — Match detail (`app/matches/[id]/page.tsx`)

- Scoreboard
- Validation state banner (pending / verified / disputed)
- If pending and current user can validate: inline approve/dispute controls
- Per-participant rating change rows
- Report button (opens modal, see Phase D)

#### Phase 8 — Forecast (`app/forecast/page.tsx`)

- Two player pickers + category selector
- Big "X%" win probability
- Calibration warning if either side has `calibrating: true`

#### Phase A — Inbox (`app/inbox/page.tsx`)

- **North star:** *Approve or dispute your pending matches in under 10 seconds.*
- Card per pending match with auto-verify countdown
- Approve / Dispute buttons; dispute opens reason modal
- Empty state encouraged ("All caught up!")

#### Phase B — Tournaments (`app/tournaments/*`)

- Browse view: list of upcoming tournaments with category, date, entries
- Detail view: bracket SVG, entry list, sign-up button
- Organizer flow (post-MVP polish): create draft → open registration → close → generate pairings → complete

#### Phase C — Report modal (any match detail)

- Reason radio, optional 200-char note
- Submits to `POST /matches/{id}/report`
- Reporter sees "reported by you" tag in their match history afterward

#### Phase D — Home/dashboard (`app/page.tsx`)

- Condensed profile hero
- 3 recent matches
- 3 quick actions: Submit, Leaderboard, Forecast
- Inbox count badge in nav

#### Nav shell

- Desktop: top nav (Home, Leaderboard, Tournaments, Submit, Forecast, Inbox, UserButton)
- Mobile: bottom tab bar with center FAB for Submit

### Backend integration (Phase 9 — last)

1. `lib/api/client.ts` mirrors `mock.ts` against `NEXT_PUBLIC_API_BASE_URL`
2. Every response Zod-validated → `SchemaMismatchError` on drift
3. TanStack Query wrappers in `lib/api/hooks.ts`
4. `NEXT_PUBLIC_USE_MOCKS=1` toggle keeps mocks available for fallback
5. Add `CORSMiddleware` to FastAPI app allowing `http://localhost:3000`
6. Clerk session token passed in `Authorization: Bearer` header on every
   request; FastAPI dependency verifies it via Clerk SDK
7. Error mapping: 400 → inline error, 401 → redirect to sign-in, 5xx → retry

---

## Self-evaluation hooks (debugging the plan in one pass)

| Failure mode | Most likely fix |
|---|---|
| Rating moves on a pending ranked match | `verify_match` should be called instead of `record_match`; check status gate in service layer |
| Mixed doubles accepts two males | Eligibility validator in `services/matches.py` not checking gender per category |
| Player's rating exceeds their ceiling | `apply_ceiling` not called after update, or ceiling is null/uninitialized |
| Casual rating moves when ranked match submitted | Category routing wrong — match writes to the wrong `player_ratings` row |
| Tournament import returns 200 | Should be `501 Not Implemented` until parser exists |
| Auto-verify never fires | Background job not set up (APScheduler or cron + management command) |
| Match row shows wrong delta | `viewerId` prop not passed into `MatchRow`; should locate participant where `player_id === viewerId` |
| Chart shows wrong line | Filter matches by `category` before charting |
| Tier color is gray | Expected fallback for unknown tier — add to `lib/tier.ts` |
| Component uses raw hex instead of token | Read `DESIGN.md` frontmatter; replace with `bg-{token}` / `text-{token}` |
| Horizontal scroll on mobile | Find the offending fixed-width element; replace with `max-w-full` or fluid value — see DESIGN.md Layout section |
| iOS Safari zooms when input is focused | Input font-size <16px — bump to `text-base` (DESIGN.md Typography rule) |
| FAB / bottom nav sits under the iOS home indicator | Add `pb-[env(safe-area-inset-bottom)]` to the container |
| Tap target too small per accessibility audit | Bump component height to 44px or wrap with `py-2` invisible padding |
| Rating numbers jitter on update | Missing `font-variant-numeric: tabular-nums` — apply via `numeral-*` typography token |
| CORS error in browser console | Add `CORSMiddleware` to FastAPI |
| Zod parse fails | Diff actual response vs `lib/api/types.ts`; sync to whichever is correct |
| Clerk webhook returns 200 but no Player created | Verify `svix` signature check is **before** the DB write |

---

## Open decisions

1. **Auto-verify window** — 7 days like DUPR, or shorter for tight clubs?
2. **Tournament strength tiers** — how many (club/regional/national?) and what ceiling bump per tier?
3. **Casual rating decay** — should casual ratings decay faster than ranked since they're less reliable?
4. **TournamentSoftware export format** — XML, CSV, or both? (user will provide)

---

## Implementation order — strict

1. **Backend Phase 2** ✅ — schema migration (additive first, then flip, then drop)
2. **Backend Phase 2.5** ✅ — engine changes (ceiling, pairing, category routing)
3. **Backend Phase 2.6** ✅ — API surface (validation, reports, tournaments, Clerk webhook)
4. **Frontend Phase 0** ✅ — Next.js 16 + Clerk + shadcn + TanStack Query + next-themes scaffold in `frontend/` (build green, `proxy.ts` for Clerk gating, `.env.local.example` documents required keys)
5. **Frontend Phase 0.5** — author `DESIGN.md` (already drafted at project root); future visual changes go here first
6. **Frontend Phase 1** ✅ — DESIGN.md tokens in `frontend/styles/tokens.css`, bridged into Tailwind v4 via `@theme` in `app/globals.css`. Inter wired through `next/font`. Tier helpers + class-name maps in `lib/tier.ts` (avoids JIT purge of dynamic `bg-${name}`). `lib/format.ts` enforces 3-decimal rating display.
6. **Frontend Phase 2** ✅ — Zod schemas in `lib/api/types.ts` mirror `badminton_rating/api/models/v1.py`. Enum values match Python `str` enums exactly. `CategoryMatchCreateSchema` carries the tie-score + equal-team-size refinements client-side so the submit form fails inline before POST.
7. **Frontend Phase 3** ✅ — Mock layer in `lib/api/mock.ts` with module-local mutable store (submitting a match persists for the tab). `?fail=1` URL escape hatch for error states. Fixtures in `lib/fixtures/*.ts` cover calibrating, capped, and fully-calibrated players plus a pending-validation match and one completed tournament. Screens import from `@/lib/api` so the Phase 9 flip is one line.
7. **Frontend Phase 4** ✅ — Profile screen at `app/players/[id]/page.tsx`. Hero rating + 6-tile grid (1/2/3 cols at base/sm/lg), Recharts history line, match list. Tile tap promotes a category into the hero + refilters chart and matches without a route change. Shared primitives shipped: `RatingTile`, `TierChip`, `CalibrationDot`, `CeilingBar`, `DeltaPill`, `MatchRow`, `RatingHistoryChart`. PLAN debug-hook covered: `MatchRow` derives delta from the viewer's participant row.
8. **Frontend Phase 5** ✅ — Leaderboard at `app/leaderboard/page.tsx`. Category selector + "hide provisional" toggle + pagination all URL-synced (survives reload/back). Calibrating rows `opacity-60` with ○ marker; current user's row tinted `surface-muted/60` with a "You" pill. Reusable `CategorySelector` extracted to `components/rating/`.
9. **Frontend Phase 6** ✅ — Submit match at `app/matches/new`. Single-page 3-step flow (category → players → score). `lib/match-rules.ts` enforces team size + gender eligibility per category (mixed-doubles needs 1M+1W per side) mirroring `services/categories.py`. `PlayerSearch` debounces + filters by eligible genders, blocks already-picked players from the other team. Sticky mobile submit bar with safe-area inset; on success → `router.push("/matches/{id}")` (inline confirmation lives in the destination per DESIGN.md "Don't toast routine success").
10. **Frontend Phase 7** ✅ — Match detail at `app/matches/[id]`. Scoreboard, `StatusBanner` with auto-verify countdown, inline approve/dispute buttons (only when viewer is a pending participant), per-participant pre→post rating rows with delta pills, report modal (`ReportModal`, native fixed-overlay so we don't ship a Dialog primitive yet). Participant names resolved via parallel `getPlayer` queries — Phase 9 may swap to a batch endpoint.
11. **Frontend Phase 8** ✅ — Forecast at `app/forecast/`. Two `PlayerSearch` slots + `CategorySelector`. Big `info`-blue headline percentage (DESIGN.md locked semantic: forecast → info). Calibration warning when either side has `rd > 150` — the number still renders but is flagged as soft.
12. **Frontend Phase A** ✅ — Inbox at `app/inbox/`. Pending-match cards with auto-verify countdown, one-click Approve, inline Dispute prompt (optional 200-char note — no modal for the common path). Empty state ("All caught up!") routes to submit. Mutations invalidate `["pending"]` so the list updates without reload. (Phase C — report modal — shipped with Phase 7.)
13. **Frontend Phase B** ✅ — Tournaments at `app/tournaments/` (browse, grouped live/upcoming/past) and `app/tournaments/[id]` (detail). Sign-up + withdraw mutations on the mock store; organizer-only generate-pairings and complete buttons gated on `organizer_user_id === clerk_user_id`. `BracketView` projects a single-elim tree from the entry list; round-robin/Swiss render a "match rows come from API" placeholder until Phase 9.
14. **Frontend Phase D** ✅ — Nav shell + home dashboard. `TopNav` (md+) and `MobileTabBar` (<md) mounted in `app/layout.tsx`. Both surface live `["pending"]` count — top nav shows numeric badge, mobile tab shows a red dot to stay scannable. Center FAB on mobile is the Submit tile (lifted via `-translate-y` so it reads as elevated). Home dashboard (`app/home-view.tsx`) shows condensed hero (best-rated category), three quick-action tiles, three most-recent matches. Sign-in/UserButton wired via `useAuth()` (Clerk v7 dropped `<SignedIn>`/`<SignedOut>` in favor of imperative hooks).
15. **Frontend Phase 9** ✅ — Real API wired. `lib/api/client.ts` mirrors `mock.ts` 1:1 against `NEXT_PUBLIC_API_BASE_URL`; every response Zod-validated → `SchemaMismatchError` on drift. `lib/api/index.ts` flips between mock/client on `NEXT_PUBLIC_USE_MOCKS`. `ClerkTokenBridge` in `app/providers.tsx` pushes Clerk's `getToken()` into a module-level slot via `auth-bridge.ts`; client sends both `Authorization: Bearer …` (prod) and `X-Clerk-User-Id` (matches the dev stub in `api/auth.py`). FastAPI gets `CORSMiddleware` (`BRS_CORS_ORIGINS` env, defaults to `http://localhost:3000`).
16. **Phase 10 — Onboarding** ✅ — Real-data realities surfaced gaps: new Clerk signups had no Player row, and bootstrapped rows had `gender = null` so they vanished from M/W/Mixed pickers. Shipped: (a) `POST /v1/players/bootstrap` — idempotent JIT Player creation, called automatically from `PlayerAutoBootstrap` in `app/providers.tsx` on first authenticated load (also serves as the webhook safety net in production); (b) `GET /v1/players?q=&gender=` + `GET /v1/players/{id}/matches` so the frontend in real mode can search players and load match history; (c) Settings page at `/me` with display-name + gender form (`patchMe`); (d) global `ProfileSetupBanner` that nudges signed-in players with no gender to set up, routes to `/me?next=<current>` so they land back where they were; (e) `clerk_user_id` UNIQUE constraint plus auth `waitForAuthReady()` to eliminate the fresh-tab 401 race. SQLAlchemy enum `values_callable` shim added so Postgres enum strings match Python enum *values* (test suite ran on SQLite which silently ignored the mismatch — covered now via real-DB acceptance).
8. **Frontend Phases A–D** — auth-gated screens against mocks
9. **Frontend Phase 9** — wire to real API, last
