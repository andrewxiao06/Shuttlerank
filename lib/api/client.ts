/*
 * Real API client — Phase 9. Mirrors `./mock` function-for-function so
 * `./index` can swap providers via `NEXT_PUBLIC_USE_MOCKS` without any
 * screen changing an import.
 *
 * Every response is Zod-validated against `./types`; drift throws
 * `SchemaMismatchError` so we hear about backend changes loudly. HTTP
 * failures bubble as `ApiError` with the status preserved.
 *
 * Auth: the Clerk session token is fetched via the auth bridge and sent
 * as both `Authorization: Bearer …` (production) and `X-Clerk-User-Id`
 * (dev — current backend stub at `api/auth._extract_clerk_user_id`).
 * The production checklist in PLAN.md flips this once the stub is
 * replaced with a real JWT verify.
 */

import { getAuthToken, getUserId } from "./auth-bridge";
import {
  CategoryMatchSchema,
  ForecastSchema,
  LeaderboardSchema,
  PairingsSchema,
  PlayerMeSchema,
  SchemaMismatchError,
  TournamentSchema,
  ValidationSchema,
  type CategoryMatch,
  type CategoryMatchCreate,
  type Forecast,
  type Leaderboard,
  type PlayerGender,
  type PlayerMe,
  type PlayerMePatch,
  type RatingCategory,
  type ReportCreate,
  type Tournament,
  type ValidationCreate,
} from "./types";
import { z } from "zod";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
}

async function request<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  opts: RequestOptions = {},
): Promise<z.infer<S>> {
  const url = new URL(path.replace(/^\//, ""), BASE_URL + "/");
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const token = await getAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // Dev shim — the backend stub at api/auth.py reads X-Clerk-User-Id
  // as the literal user id (e.g. `user_2abc…`). Sent independently so
  // the header is correct even before production JWT verify lands.
  const userId = getUserId();
  if (userId) headers["X-Clerk-User-Id"] = userId;

  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "include",
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.detail) detail =
        typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }

  // 204 No Content — nothing to validate.
  if (res.status === 204) return undefined as z.infer<S>;

  const json = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new SchemaMismatchError(path, parsed.error.issues);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Player profile
// ---------------------------------------------------------------------------

export async function getMe(): Promise<PlayerMe> {
  return request("/players/me", PlayerMeSchema);
}

export async function patchMe(patch: PlayerMePatch): Promise<PlayerMe> {
  return request("/players/me", PlayerMeSchema, {
    method: "PATCH",
    body: patch,
  });
}

export async function getPlayer(id: number): Promise<PlayerMe> {
  return request(`/v1/players/${id}`, PlayerMeSchema);
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

export async function listPlayerMatches(
  playerId: number,
  category?: RatingCategory,
): Promise<CategoryMatch[]> {
  return request(
    `/v1/players/${playerId}/matches`,
    z.array(CategoryMatchSchema),
    { query: { category } },
  );
}

export async function getMatch(id: number): Promise<CategoryMatch> {
  return request(`/v1/matches/${id}`, CategoryMatchSchema);
}

export async function createMatch(body: CategoryMatchCreate): Promise<CategoryMatch> {
  return request("/v1/matches", CategoryMatchSchema, {
    method: "POST",
    body,
  });
}

export async function listPendingForMe(): Promise<CategoryMatch[]> {
  return request("/v1/matches/inbox/pending", z.array(CategoryMatchSchema));
}

// ---------------------------------------------------------------------------
// Validation + reports
// ---------------------------------------------------------------------------

export async function validateMatch(
  matchId: number,
  body: ValidationCreate,
): Promise<CategoryMatch> {
  return request(
    `/v1/matches/${matchId}/validate`,
    CategoryMatchSchema,
    { method: "POST", body },
  );
}

const ReportResultSchema = z.object({ id: z.number().int() });
export async function reportMatch(
  matchId: number,
  body: ReportCreate,
): Promise<{ id: number }> {
  return request(`/v1/matches/${matchId}/report`, ReportResultSchema, {
    method: "POST",
    body,
  });
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export async function getLeaderboard(
  category: RatingCategory,
  opts: { limit?: number; offset?: number; hideProvisional?: boolean } = {},
): Promise<Leaderboard> {
  return request("/v1/leaderboard", LeaderboardSchema, {
    query: {
      category,
      limit: opts.limit,
      offset: opts.offset,
      hide_provisional: opts.hideProvisional ? "1" : undefined,
    },
  });
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

export async function getForecast(
  playerId: number,
  opponentId: number,
  category: RatingCategory,
): Promise<Forecast> {
  return request(`/v1/players/${playerId}/forecast`, ForecastSchema, {
    query: { opponent_id: opponentId, category },
  });
}

// ---------------------------------------------------------------------------
// Tournaments
// ---------------------------------------------------------------------------

export async function listTournaments(): Promise<Tournament[]> {
  return request("/tournaments", z.array(TournamentSchema));
}

export async function getTournament(id: number): Promise<Tournament> {
  return request(`/tournaments/${id}`, TournamentSchema);
}

export async function enterTournament(id: number): Promise<Tournament> {
  return request(`/tournaments/${id}/entries`, TournamentSchema, {
    method: "POST",
  });
}

export async function withdrawFromTournament(id: number): Promise<Tournament> {
  return request(`/tournaments/${id}/entries/me`, TournamentSchema, {
    method: "DELETE",
  });
}

// `generate-pairings` returns a PairingsOut (list of matches). The mock
// returns the tournament for convenience; we re-fetch on the client to
// keep the surface aligned.
export async function generatePairings(id: number): Promise<Tournament> {
  await request(
    `/tournaments/${id}/generate-pairings`,
    PairingsSchema,
    { method: "POST" },
  );
  return getTournament(id);
}

export async function completeTournament(id: number): Promise<Tournament> {
  return request(`/tournaments/${id}/complete`, TournamentSchema, {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// Player search — no backend endpoint yet. Returns [] so PlayerSearch
// renders the empty state instead of throwing. TODO Phase 10: add a
// `/v1/players?q=` endpoint and wire here.
// ---------------------------------------------------------------------------

export async function searchPlayers(
  query: string,
  opts: { eligibleGenders?: PlayerGender[] | null } = {},
): Promise<PlayerMe[]> {
  // FastAPI expects repeated `?gender=M&gender=W` for List[Enum] params,
  // which URLSearchParams supports natively (`.append`). The shared
  // `request()` helper only does single-value query strings, so we build
  // the URL by hand and call fetch directly here.
  const url = new URL("/v1/players", BASE_URL + "/");
  if (query) url.searchParams.set("q", query);
  url.searchParams.set("limit", "10");
  for (const g of opts.eligibleGenders ?? []) {
    url.searchParams.append("gender", g);
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  const token = await getAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const userId = getUserId();
  if (userId) headers["X-Clerk-User-Id"] = userId;

  const res = await fetch(url.toString(), { headers, credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  const json = await res.json();
  const parsed = z.array(PlayerMeSchema).safeParse(json);
  if (!parsed.success) throw new SchemaMismatchError("/v1/players", parsed.error.issues);
  return parsed.data;
}

// Re-export ValidationSchema for parity with mock (used by future test code).
export { ValidationSchema, ApiError };
