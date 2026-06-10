/*
 * Mock API layer — Phases 1-8 run against this. Phase 9 introduces
 * `client.ts` with the *same* function signatures so screens flip via a
 * single re-export in `lib/api/index.ts`.
 *
 * Conventions:
 *  - Every call simulates ~200ms of latency (DESIGN.md acceptance: don't
 *    over-animate; the latency just exercises loading states).
 *  - Any call accepts an `?fail=1` query string in the page URL to force
 *    an error — useful for sweeping empty/error states without rebuilding.
 *  - The store is module-local; mutations (submit match, validate, etc.)
 *    persist for the lifetime of the tab so screens feel real.
 */

import {
  type CategoryMatch,
  type CategoryMatchCreate,
  type Forecast,
  type Leaderboard,
  type PlayerMe,
  type PlayerMePatch,
  type ReportCreate,
  type Tournament,
  type TournamentCreate,
  type Validation,
  type ValidationCreate,
} from "./types";
import {
  MATCHES,
  findMatch,
  matchesForPlayer,
  pendingForUser,
} from "../fixtures/matches";
import { ALL_PLAYERS, ME as INITIAL_ME, findPlayer } from "../fixtures/players";
import { leaderboardFor } from "../fixtures/leaderboards";
import { TOURNAMENTS, findTournament } from "../fixtures/tournaments";

const LATENCY_MS = 200;

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function delay<T>(value: T): Promise<T> {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("fail") === "1") {
      await sleep(LATENCY_MS);
      throw new ApiError(500, "Forced failure (?fail=1)");
    }
  }
  await sleep(LATENCY_MS);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Mutable store — module-local. Snapshot fixtures on load.
// ---------------------------------------------------------------------------

const store = {
  me: structuredClone(INITIAL_ME) as PlayerMe,
  matches: [...MATCHES] as CategoryMatch[],
  tournaments: [...TOURNAMENTS] as Tournament[],
  nextMatchId: 1000,
};

// ---------------------------------------------------------------------------
// Player profile
// ---------------------------------------------------------------------------

export async function getMe(): Promise<PlayerMe> {
  return delay(store.me);
}

export async function bootstrapMe(_body: unknown): Promise<PlayerMe> {
  // Mock has a pre-seeded ME — bootstrapping is a no-op.
  return delay(store.me);
}

export async function patchMe(patch: PlayerMePatch): Promise<PlayerMe> {
  if (patch.display_name !== undefined)
    store.me = { ...store.me, display_name: patch.display_name ?? null };
  if (patch.gender !== undefined)
    store.me = { ...store.me, gender: patch.gender ?? null };
  return delay(store.me);
}

export async function getPlayer(id: number): Promise<PlayerMe> {
  const player = findPlayer(id);
  if (!player) throw new ApiError(404, `Player ${id} not found`);
  return delay(player);
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

export async function listPlayerMatches(
  playerId: number,
): Promise<CategoryMatch[]> {
  return delay(matchesForPlayer(playerId));
}

export async function getMatch(id: number): Promise<CategoryMatch> {
  const m = findMatch(id) ?? store.matches.find((x) => x.id === id);
  if (!m) throw new ApiError(404, `Match ${id} not found`);
  return delay(m);
}

export async function createMatch(body: CategoryMatchCreate): Promise<CategoryMatch> {
  const winner: "A" | "B" = body.team_a_score > body.team_b_score ? "A" : "B";
  const m: CategoryMatch = {
    id: store.nextMatchId++,
    category: "overall",
    status: "pending",
    played_at: body.played_at,
    team_a_score: body.team_a_score,
    team_b_score: body.team_b_score,
    winner_team: winner,
    submitted_by_user_id: store.me.clerk_user_id,
    verified_at: null,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    tournament_id: null,
    participants: [
      ...body.team_a_player_ids.map((pid) => ({
        player_id: pid,
        team: "A" as const,
        pre_r: ratingFor(pid),
        post_r: ratingFor(pid),
        delta_r: 0,
      })),
      ...body.team_b_player_ids.map((pid) => ({
        player_id: pid,
        team: "B" as const,
        pre_r: ratingFor(pid),
        post_r: ratingFor(pid),
        delta_r: 0,
      })),
    ],
  };
  store.matches = [m, ...store.matches];
  return delay(m);
}

function ratingFor(playerId: number): number {
  return findPlayer(playerId)?.ratings[0]?.display ?? 4.0;
}

export async function listPendingForMe(): Promise<CategoryMatch[]> {
  return delay(pendingForUser(store.me.clerk_user_id ?? ""));
}

// ---------------------------------------------------------------------------
// Validation + reports
// ---------------------------------------------------------------------------

export async function validateMatch(
  matchId: number,
  body: ValidationCreate,
): Promise<Validation> {
  const m = store.matches.find((x) => x.id === matchId);
  if (!m) throw new ApiError(404, `Match ${matchId} not found`);
  if (m.status !== "pending")
    throw new ApiError(409, `Match ${matchId} is not pending`);

  const updated: CategoryMatch =
    body.action === "approved"
      ? { ...m, status: "verified", verified_at: new Date().toISOString() }
      : { ...m, status: "disputed" };

  store.matches = store.matches.map((x) => (x.id === matchId ? updated : x));
  return delay({
    id: Math.floor(Math.random() * 100000),
    user_id: store.me.clerk_user_id ?? "user_demo",
    action: body.action,
    acted_at: new Date().toISOString(),
    note: body.note ?? null,
  });
}

export async function reportMatch(matchId: number, _body: ReportCreate): Promise<{ id: number }> {
  const m = store.matches.find((x) => x.id === matchId);
  if (!m) throw new ApiError(404, `Match ${matchId} not found`);
  return delay({ id: Math.floor(Math.random() * 100000) });
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export async function getLeaderboard(
  opts: { limit?: number; offset?: number; hideProvisional?: boolean } = {},
): Promise<Leaderboard> {
  return delay(leaderboardFor(opts));
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

export async function getForecast(
  playerId: number,
  opponentId: number,
): Promise<Forecast> {
  const p = findPlayer(playerId);
  const o = findPlayer(opponentId);
  if (!p || !o) throw new ApiError(404, "Player not found");

  // Unrated players forecast from the 4.0 default — any two players work.
  const pr = p.ratings[0];
  const or = o.ratings[0];
  const pDisplay = pr?.display ?? 4.0;
  const oDisplay = or?.display ?? 4.0;

  // Logistic on display-rating diff. Real backend uses Glicko-2 E(); this is a
  // cosmetic stand-in for the mock layer that produces visually sensible numbers.
  const k = 1.1;
  const win = 1 / (1 + Math.exp(-(pDisplay - oDisplay) * k));

  return delay({
    player_id: playerId,
    opponent_id: opponentId,
    player_display: pDisplay,
    opponent_display: oDisplay,
    win_probability: win,
    player_calibrating: pr?.calibrating ?? true,
    opponent_calibrating: or?.calibrating ?? true,
  });
}

// ---------------------------------------------------------------------------
// Tournaments
// ---------------------------------------------------------------------------

export async function listTournaments(): Promise<Tournament[]> {
  return delay(store.tournaments);
}

export async function createTournament(
  body: TournamentCreate,
): Promise<Tournament> {
  if (body.ranked && !store.me.is_admin)
    throw new ApiError(403, "only administrators can host ranked tournaments");
  const t: Tournament = {
    id: Math.max(0, ...store.tournaments.map((x) => x.id)) + 1,
    name: body.name,
    format: body.format,
    ranked: body.ranked,
    starts_at: body.starts_at,
    ends_at: body.ends_at ?? null,
    status: "draft",
    organizer_user_id: store.me.clerk_user_id,
    entries: [],
  };
  store.tournaments = [...store.tournaments, t];
  return delay(t);
}

export async function getTournament(id: number): Promise<Tournament> {
  const t = store.tournaments.find((x) => x.id === id) ?? findTournament(id);
  if (!t) throw new ApiError(404, `Tournament ${id} not found`);
  return delay(t);
}

export async function enterTournament(id: number): Promise<Tournament> {
  const t = store.tournaments.find((x) => x.id === id);
  if (!t) throw new ApiError(404, `Tournament ${id} not found`);
  if (t.status !== "open" && t.status !== "draft")
    throw new ApiError(409, "Registration is closed");
  if (t.entries.some((e) => e.player_id === store.me.id))
    return delay(t);
  const entry = {
    id: Math.max(0, ...t.entries.map((e) => e.id)) + 1,
    player_id: store.me.id,
    seed: null,
    withdrawn: false,
  };
  const updated = { ...t, entries: [...t.entries, entry] };
  store.tournaments = store.tournaments.map((x) => (x.id === id ? updated : x));
  return delay(updated);
}

export async function withdrawFromTournament(id: number): Promise<Tournament> {
  const t = store.tournaments.find((x) => x.id === id);
  if (!t) throw new ApiError(404, `Tournament ${id} not found`);
  const updated = {
    ...t,
    entries: t.entries.map((e) =>
      e.player_id === store.me.id ? { ...e, withdrawn: true } : e,
    ),
  };
  store.tournaments = store.tournaments.map((x) => (x.id === id ? updated : x));
  return delay(updated);
}

export async function generatePairings(id: number): Promise<Tournament> {
  const t = store.tournaments.find((x) => x.id === id);
  if (!t) throw new ApiError(404, `Tournament ${id} not found`);
  if (t.status !== "open" && t.status !== "draft")
    throw new ApiError(409, "Pairings can only be generated before play starts");
  const updated = { ...t, status: "in_progress" as const };
  store.tournaments = store.tournaments.map((x) => (x.id === id ? updated : x));
  return delay(updated);
}

export async function completeTournament(id: number): Promise<Tournament> {
  const t = store.tournaments.find((x) => x.id === id);
  if (!t) throw new ApiError(404, `Tournament ${id} not found`);
  const updated = { ...t, status: "completed" as const };
  store.tournaments = store.tournaments.map((x) => (x.id === id ? updated : x));
  return delay(updated);
}

// ---------------------------------------------------------------------------
// Player search (used by submit-match player picker)
// ---------------------------------------------------------------------------

export async function searchPlayers(query: string): Promise<PlayerMe[]> {
  const q = query.trim().toLowerCase();
  const matches = ALL_PLAYERS.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.display_name ?? "").toLowerCase().includes(q),
  );
  return delay(matches.slice(0, 10));
}

export { ApiError };
