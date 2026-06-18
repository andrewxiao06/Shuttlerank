# DUBR Mobile — Expo / React Native build plan

The native iOS + Android app. **Priority surface** — DUBR's players are on
their phones (see `PLAN.md` → Current focus).

## What's reused vs. rebuilt

- ✅ **Backend: 100% reused.** It's a REST API at `https://dubr.mooo.com`.
  The mobile app is just another client — no backend changes needed (one
  auth caveat below).
- ✅ **Logic/contracts reused.** The Zod types (`frontend/lib/api/types.ts`),
  the API-call shapes, tier/format helpers, and the single-rating + display
  rules (hide internal ELO, show 2.0–8.0 to one decimal) all port over.
- 🔁 **UI rebuilt.** React Native uses native components (`<View>`, `<Text>`,
  `<Pressable>`) instead of HTML/CSS. Screens are re-implemented; the data
  layer underneath is the same.

## ⚠️ Learn/build split (Andrew is learning RN)

Like the EC2 deploy, Andrew drives the learning portions himself; Claude
gives hints/pointers/reviews but doesn't write those parts.

| Area | Owner |
|---|---|
| Expo project setup + running on iPhone (Phase 0) | 🎓 **Andrew** (Claude hints) |
| Leaderboard screen | 🎓 **Andrew** (Claude hints) |
| Profile screen | 🎓 **Andrew** (Claude hints) |
| Navigation/tabs, theming, API client + types, Clerk auth (Phase 1–2) | 🤖 Claude |
| Home, Submit, Match detail, Inbox, Forecast, Tournaments, Settings | 🤖 Claude |

When Andrew is on a 🎓 task, Claude nudges toward the next step and reviews —
but lets him write the code.

---

## Tech choices (recommended)

| Concern | Choice | Why |
|---|---|---|
| Framework | **Expo (managed)** | Handles native build/signing, runs on a real phone in minutes, no Xcode needed to start. |
| Routing | **Expo Router** | File-based routing that mirrors the Next.js `app/` dir Andrew already knows. |
| Styling | **NativeWind** (Tailwind for RN) | Reuses the Tailwind mental model + DESIGN.md tokens. Fallback: plain `StyleSheet` if setup fights us. |
| Data | **TanStack Query** | Same library as web; the query patterns port directly. |
| Auth | **`@clerk/clerk-expo`** + `expo-secure-store` | Same Clerk instance as web; secure token storage on device. |
| Validation | **Zod** | Copy `types.ts` from the web app. |
| Run target | **Expo Go** on Andrew's iPhone (iOS 26) | Fastest dev loop — scan a QR, hot reload. Clerk works in Expo Go. |

## Repo layout

Add a sibling app in the monorepo:
```
DUBR/
├── frontend/        # existing Next.js web app
├── mobile/          # NEW — Expo app
│   ├── app/         # Expo Router screens (mirrors web app/ structure)
│   ├── lib/api/     # ported types.ts + a RN api client
│   └── ...
└── badminton_rating/  # backend (unchanged)
```
Start by **copying** `frontend/lib/api/types.ts` into `mobile/lib/api/`
(simplest). A shared package is a later refactor, not worth the tooling now.

---

## Phased roadmap

### Phase 0 — Project setup + run on device 🎓 Andrew (hints only)
Goal: an Expo app showing a "Hello DUBR" screen on Andrew's iPhone.
- `npx create-expo-app@latest mobile` (with TypeScript), `cd mobile`, `npx expo start`.
- Install **Expo Go** from the App Store on the iPhone; scan the QR from the terminal.
- Confirm hot reload works (edit text → see it update on the phone).
- This is the RN equivalent of the EC2 "get it running" lesson.

### Phase 1 — Foundation 🤖 Claude
- Expo Router tab navigation: Home / Leaderboard / Submit / Inbox / Profile
  (mirrors the web `MobileTabBar`).
- NativeWind + port DESIGN.md tokens (colors, spacing, type scale).
- TanStack Query provider.
- `mobile/lib/api/` — port `types.ts`; write an RN `client.ts` against
  `EXPO_PUBLIC_API_BASE_URL=https://dubr.mooo.com` (native `fetch`, Zod-validated,
  same function names as web so screens read identically).
- Rating display rules carried over: one-decimal display, internal ELO hidden.

### Phase 2 — Auth 🤖 Claude
- `@clerk/clerk-expo` provider + `expo-secure-store` token cache.
- Sign-in / sign-up screens (Clerk components or hosted flow).
- Bridge Clerk's `getToken()` into the API client (RN equivalent of
  `auth-bridge.ts`); send `Authorization: Bearer` on every request.
- Auto-bootstrap on first sign-in (calls `/v1/players/bootstrap`).
- **Auth caveat to verify:** the backend's `CLERK_AUTHORIZED_PARTIES` (azp)
  check is currently set to the Vercel web origin. Native tokens carry a
  different/empty `azp`; we may need to add the mobile party or leave azp
  unset for the mobile client. First sign-in test will tell us — Claude
  handles the fix (backend redeploy is Andrew's to run).

### Phase 3 — Screens
- **Leaderboard** 🎓 Andrew — list of players by rating, calibrating dimmed,
  "you" highlighted. Good first screen: `FlatList` + simple rows.
- **Profile** 🎓 Andrew — hero rating, tier chip, ceiling bar, recent matches.
- Home/dashboard 🤖
- Submit match 🤖 (player search, score entry, format toggle)
- Match detail 🤖 (scoreboard, status, rating changes, report)
- Inbox 🤖 (approve/dispute pending matches)
- Forecast 🤖 (two player pickers + win %)
- Settings / starting-level self-pick 🤖
- Tournaments 🤖 (can come last)

### Phase 4 — Polish 🤖 + 🎓
- Loading skeletons, empty states, pull-to-refresh.
- Error handling (network, auth expiry).
- Icon + splash screen.

### Phase 5 — Store submission (deferred)
- Apple Developer **$99/yr**, Google Play **$25 once**. Build + test on device
  is free; only submission needs these. Use `eas build` when ready.

---

## Verification (end to end)
1. App runs on the iPhone via Expo Go (Phase 0).
2. Sign in with the same Clerk account as web → profile loads (Phase 2).
3. Leaderboard shows the same players as the web app (same API) (Phase 3).
4. Submit a match on mobile → it appears as pending; approve on web → ratings
   update on both. (Proves the shared backend.)

## Notes
- No backend code changes expected beyond the possible azp tweak.
- The web app keeps working independently — same API, different client.
- Keep rating display consistent with web: 2.0–8.0, one decimal, ELO hidden.
