# Push Notifications

When a match is submitted, the other participants get a push notification on
their phone ("🏸 Match needs your approval"). Tapping it deep-links straight to
that match so they can approve it. Runs **alongside** the existing email
notification (both channels; email is the fallback for anyone who hasn't
allowed push).

Uses **Expo Push Notifications** (Expo's service relays to Apple APNs / Google
FCM), so we never talk to APNs directly.

---

## Data flow

```
Phone (signed in, push allowed)
  └─ registers Expo push token ──► POST /v1/push-tokens ──► push_tokens table
                                                                   │
Someone submits a match ──► create_v1_match (api/routes/v1_matches.py)
                                    └─ notify_pending_match (services/notifications.py)
                                          ├─ email each opponent (services/email.py)
                                          └─ _push_pending_match
                                                └─ look up opponents' tokens (push_tokens)
                                                     └─ send_push (services/push.py)
                                                          └─ POST exp.host/--/api/v2/push/send
                                                                   └─ Expo ─► APNs ─► phone buzzes
                                                                                        └─ tap ─► /match/[id]
```

One sentence: **phone registers a token → a match is submitted → the backend
looks up the opponents' tokens and sends via Expo → their phones buzz → tap →
opens the match.**

---

## Files

### Backend (`badminton_rating/`)
| File | Role |
|---|---|
| `db/models.py` → `PushToken` | Table: one row per device (`player_id`, `token`, `platform`). |
| `db/migrations/versions/…c0d1e2f3a4b5_push_tokens.py` | Creates `push_tokens` (runs on deploy via `alembic upgrade head`). |
| `api/routes/v1_push.py` | `POST /v1/push-tokens` (register/upsert), `DELETE /v1/push-tokens/{token}` (opt-out). Auth'd. |
| `services/push.py` | **How to send** — POSTs to Expo's push API, prunes dead tokens. Best-effort. |
| `services/notifications.py` → `notify_pending_match`, `_push_pending_match` | **When/who** — fires email + push on submit. ← start reading here |
| `api/app.py` | Registers the route. |

**Trigger point:** `api/routes/v1_matches.py` → `create_v1_match` calls
`await notify_pending_match(...)`. That one line fans out to email + push.

### Mobile (`mobile/`)
| File | Role |
|---|---|
| `lib/push.ts` | Permission + Expo-token helper, foreground display handler, on/off pref (secure-store). |
| `lib/push-sync.tsx` → `PushSync` | Registers the token on sign-in; routes a notification tap to `/match/[id]` (warm + cold start). Mounted in `src/app/_layout.tsx`. |
| `lib/api/client.ts` | `registerPushToken` / `unregisterPushToken`. |
| `src/app/edit-profile.tsx` | "Push notifications" toggle. |
| `app.json` | `expo-notifications` plugin. |

---

## Turning it on (one-time)

Push only works from a **build that includes `expo-notifications`** and has the
**APNs key** configured in EAS.

```bash
cd mobile
eas build --platform ios --profile production --auto-submit
```
When EAS detects `expo-notifications` it prompts **"set up Push Notifications?"**
→ **yes** (it creates/uploads the APNs key to Apple and adds the
`aps-environment` entitlement). To do it explicitly instead:
`eas credentials` → iOS → Push Notifications Key.

Backend needs nothing extra — it's already deployed. (Optional: set
`EXPO_ACCESS_TOKEN` in `.env.prod` if you enable Expo "Enhanced Security".)

---

## Testing

**Must use a real device** — the simulator can't get a push token (the code
returns `null` there and skips registration).

1. Install the build from TestFlight → sign in → **Allow** notifications when prompted.
2. From a **second account**, submit a match that includes the first account.
3. First phone gets **"🏸 Match needs your approval — [name] submitted…"**.
4. Tap it → app opens directly on that match → approve.

Opt out: **Edit Profile → Push notifications** toggle (unregisters the device).

---

## Troubleshooting

- **No notification arrives:**
  - Confirm it's a real device and permission was granted (iOS Settings → ShuttleRank → Notifications).
  - Confirm a token exists: `select count(*) from push_tokens;` on Neon.
  - Check the API logs for `shuttlerank.push` warnings.
  - The build must have push credentials (`eas credentials` → iOS shows a Push Key).
- **Tap doesn't open the match:** the notification's `data.matchId` drives the
  deep link (`lib/push-sync.tsx`); the route is `src/app/match/[id].tsx`.
- **Dead tokens:** Expo reports `DeviceNotRegistered`; `send_push` returns them
  and `_push_pending_match` deletes them automatically.

---

## Possible next steps
- Notify on **approve/dispute/verify** too (not just submit), reusing `send_push`.
- A **push receipts** check (Expo tickets → receipts) for delivery confirmation.
- Per-event preferences (e.g., mute tournament pairings) beyond the single toggle.
