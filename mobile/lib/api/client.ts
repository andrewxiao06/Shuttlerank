/*
 * Mobile API client. Mirrors the web app's client function-for-function so
 * screens read the same way. Every response is Zod-validated against
 * `./types`; drift throws SchemaMismatchError. Auth token (when present) is
 * sent as `Authorization: Bearer …`.
 *
 * Base URL comes from EXPO_PUBLIC_API_BASE_URL (set in app config / .env);
 * defaults to the live API.
 */

import { z } from "zod";
import { getAuthToken } from "./auth-bridge";
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
  type PlayerBootstrap,
  type PlayerMe,
  type PlayerMePatch,
  type ReportCreate,
  type Tournament,
  type TournamentCreate,
  type Validation,
  type ValidationCreate,
} from "./types";

const BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://dubr.mooo.com";

export class ApiError extends Error {
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

  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const token = await getAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.detail)
        detail =
          typeof body.detail === "string"
            ? body.detail
            : JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as z.infer<S>;

  const json = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new SchemaMismatchError(path, parsed.error.issues);
  }
  return parsed.data;
}

// --- Player profile --------------------------------------------------------

export function getMe(): Promise<PlayerMe> {
  return request("/players/me", PlayerMeSchema);
}

export function patchMe(patch: PlayerMePatch): Promise<PlayerMe> {
  return request("/players/me", PlayerMeSchema, { method: "PATCH", body: patch });
}

export function bootstrapMe(body: PlayerBootstrap): Promise<PlayerMe> {
  return request("/v1/players/bootstrap", PlayerMeSchema, {
    method: "POST",
    body,
  });
}

export function getPlayer(id: number): Promise<PlayerMe> {
  return request(`/v1/players/${id}`, PlayerMeSchema);
}

export function searchPlayers(query: string): Promise<PlayerMe[]> {
  return request("/v1/players", z.array(PlayerMeSchema), {
    query: { q: query || undefined, limit: 10 },
  });
}

// --- Matches ---------------------------------------------------------------

export function listPlayerMatches(playerId: number): Promise<CategoryMatch[]> {
  return request(`/v1/players/${playerId}/matches`, z.array(CategoryMatchSchema));
}

export function getMatch(id: number): Promise<CategoryMatch> {
  return request(`/v1/matches/${id}`, CategoryMatchSchema);
}

export function createMatch(body: CategoryMatchCreate): Promise<CategoryMatch> {
  return request("/v1/matches", CategoryMatchSchema, { method: "POST", body });
}

export function listPendingForMe(): Promise<CategoryMatch[]> {
  return request("/v1/matches/inbox/pending", z.array(CategoryMatchSchema));
}

export function validateMatch(
  matchId: number,
  body: ValidationCreate,
): Promise<Validation> {
  return request(`/v1/matches/${matchId}/validate`, ValidationSchema, {
    method: "POST",
    body,
  });
}

const ReportResultSchema = z.object({ id: z.number().int() });
export function reportMatch(
  matchId: number,
  body: ReportCreate,
): Promise<{ id: number }> {
  return request(`/v1/matches/${matchId}/report`, ReportResultSchema, {
    method: "POST",
    body,
  });
}

// --- Leaderboard + forecast ------------------------------------------------

export function getLeaderboard(
  opts: { limit?: number; offset?: number; hideProvisional?: boolean } = {},
): Promise<Leaderboard> {
  return request("/v1/leaderboard", LeaderboardSchema, {
    query: {
      limit: opts.limit,
      offset: opts.offset,
      min_matches: opts.hideProvisional ? 10 : undefined,
    },
  });
}

export function getForecast(
  playerId: number,
  opponentId: number,
): Promise<Forecast> {
  return request(`/v1/players/${playerId}/forecast`, ForecastSchema, {
    query: { opponent_id: opponentId },
  });
}

// --- Tournaments -----------------------------------------------------------

export function listTournaments(): Promise<Tournament[]> {
  return request("/tournaments", z.array(TournamentSchema));
}

export function getTournament(id: number): Promise<Tournament> {
  return request(`/tournaments/${id}`, TournamentSchema);
}

export function createTournament(body: TournamentCreate): Promise<Tournament> {
  return request("/tournaments", TournamentSchema, { method: "POST", body });
}

export function enterTournament(id: number): Promise<Tournament> {
  return request(`/tournaments/${id}/entries`, TournamentSchema, {
    method: "POST",
  });
}

export function withdrawFromTournament(id: number): Promise<Tournament> {
  return request(`/tournaments/${id}/entries/me`, TournamentSchema, {
    method: "DELETE",
  });
}

export async function generatePairings(id: number): Promise<Tournament> {
  await request(`/tournaments/${id}/generate-pairings`, PairingsSchema, {
    method: "POST",
  });
  return getTournament(id);
}

export function completeTournament(id: number): Promise<Tournament> {
  return request(`/tournaments/${id}/complete`, TournamentSchema, {
    method: "POST",
  });
}
