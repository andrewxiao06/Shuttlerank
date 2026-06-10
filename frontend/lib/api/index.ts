/*
 * API surface re-export. Screens import from `@/lib/api`, never from
 * `./mock` or `./client` directly — that keeps the Phase 9 swap a
 * single-file change.
 *
 * The split is at build time: `NEXT_PUBLIC_USE_MOCKS=1` (the default for
 * the demo) re-exports the mock module; anything else re-exports the
 * real client. Both modules expose identical function signatures.
 *
 * If a screen accidentally imports `./mock` directly, it will still work
 * but will resist the swap — search for `from "@/lib/api/mock"` before
 * shipping production builds.
 */

import * as mock from "./mock";
import * as client from "./client";

const useMocks =
  process.env.NEXT_PUBLIC_USE_MOCKS === "1" ||
  process.env.NEXT_PUBLIC_USE_MOCKS === "true";

const impl = useMocks ? mock : client;

export const getMe = impl.getMe;
export const patchMe = impl.patchMe;
export const bootstrapMe = impl.bootstrapMe;
export const getPlayer = impl.getPlayer;
export const listPlayerMatches = impl.listPlayerMatches;
export const getMatch = impl.getMatch;
export const createMatch = impl.createMatch;
export const listPendingForMe = impl.listPendingForMe;
export const validateMatch = impl.validateMatch;
export const reportMatch = impl.reportMatch;
export const getLeaderboard = impl.getLeaderboard;
export const getForecast = impl.getForecast;
export const listTournaments = impl.listTournaments;
export const getTournament = impl.getTournament;
export const enterTournament = impl.enterTournament;
export const withdrawFromTournament = impl.withdrawFromTournament;
export const generatePairings = impl.generatePairings;
export const completeTournament = impl.completeTournament;
export const searchPlayers = impl.searchPlayers;

export type * from "./types";
