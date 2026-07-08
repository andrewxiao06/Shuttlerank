/*
 * Single source of truth for API shapes. Mirrors
 * `badminton_rating/api/models/v1.py`. If integration breaks during Phase 9,
 * this file is the first place to check — diff against the Pydantic schemas.
 *
 * Conventions:
 *  - Enums are Zod enums + exported as TS string-literal unions, matching the
 *    Python str-Enum values exactly (snake_case).
 *  - Dates that arrive as ISO strings stay strings here; format helpers in
 *    `lib/format.ts` turn them into Date objects at the edge.
 *  - Every `*Schema` has a matching inferred type with the same name minus
 *    "Schema" so call sites read naturally: `LeaderboardOut`, not `z.infer<…>`.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums — mirror badminton_rating/db/models.py
// ---------------------------------------------------------------------------

/**
 * "overall" is the only bucket written today — one rating per player.
 * Legacy values remain so historical match rows still parse.
 */
export const RatingCategorySchema = z.enum([
  "overall",
  "singles",
  "doubles",
  "mens_singles",
  "womens_singles",
  "mens_doubles",
  "womens_doubles",
  "mixed_doubles",
  "casual",
]);
export type RatingCategory = z.infer<typeof RatingCategorySchema>;

export const PlayerGenderSchema = z.enum(["M", "W", "X"]);
export type PlayerGender = z.infer<typeof PlayerGenderSchema>;

export const MatchStatusSchema = z.enum([
  "pending",
  "verified",
  "disputed",
  "expired",
]);
export type MatchStatus = z.infer<typeof MatchStatusSchema>;

export const ValidationActionSchema = z.enum(["approved", "disputed"]);
export type ValidationAction = z.infer<typeof ValidationActionSchema>;

export const ReportReasonSchema = z.enum([
  "wrong_score",
  "wrong_players",
  "never_happened",
  "other",
]);
export type ReportReason = z.infer<typeof ReportReasonSchema>;

export const ReportStatusSchema = z.enum([
  "open",
  "resolved_invalid",
  "resolved_valid",
]);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

export const TournamentFormatSchema = z.enum([
  "single_elim",
  "round_robin",
  "swiss",
]);
export type TournamentFormat = z.infer<typeof TournamentFormatSchema>;

export const TournamentStatusSchema = z.enum([
  "draft",
  "open",
  "in_progress",
  "completed",
]);
export type TournamentStatus = z.infer<typeof TournamentStatusSchema>;

// ---------------------------------------------------------------------------
// Display labels — UI helpers. Source: PLAN.md V1 categories.
// ---------------------------------------------------------------------------

export const CATEGORY_LABEL: Record<RatingCategory, string> = {
  overall: "Overall",
  singles: "Singles",
  doubles: "Doubles",
  mens_singles: "Men's singles",
  womens_singles: "Women's singles",
  mens_doubles: "Men's doubles",
  womens_doubles: "Women's doubles",
  mixed_doubles: "Mixed doubles",
  casual: "Casual",
};

export const CATEGORY_SHORT: Record<RatingCategory, string> = {
  overall: "Match",
  singles: "Singles",
  doubles: "Doubles",
  mens_singles: "M Singles",
  womens_singles: "W Singles",
  mens_doubles: "M Doubles",
  womens_doubles: "W Doubles",
  mixed_doubles: "Mixed",
  casual: "Casual",
};

export const STATUS_LABEL: Record<MatchStatus, string> = {
  pending: "Pending approval",
  verified: "Verified",
  disputed: "Disputed",
  expired: "Expired",
};

// ---------------------------------------------------------------------------
// Player profile (v1)
// ---------------------------------------------------------------------------

export const CategoryRatingSchema = z.object({
  category: RatingCategorySchema,
  r: z.number(),
  rd: z.number(),
  display: z.number(),
  tier: z.string(),
  calibrating: z.boolean(),
  ceiling: z.number(),
  match_count: z.number().int(),
  last_active: z.string().nullable(),
});
export type CategoryRating = z.infer<typeof CategoryRatingSchema>;

export const PlayerMeSchema = z.object({
  id: z.number().int(),
  clerk_user_id: z.string().nullable(),
  name: z.string(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  gender: PlayerGenderSchema.nullable(),
  avatar_url: z.string().nullable().optional(),
  age: z.number().int().nullable().optional(),
  location: z.string().nullable().optional(),
  created_at: z.string(),
  // Single-element list holding the player's one overall rating.
  ratings: z.array(CategoryRatingSchema),
  // True when the player can host ranked tournaments.
  is_admin: z.boolean().optional().default(false),
});
export type PlayerMe = z.infer<typeof PlayerMeSchema>;

export const PlayerMePatchSchema = z.object({
  display_name: z.string().max(120).nullable().optional(),
  gender: PlayerGenderSchema.nullable().optional(),
  age: z.number().int().min(5).max(120).nullable().optional(),
  location: z.string().max(120).nullable().optional(),
  avatar_url: z.string().max(512).nullable().optional(),
  // Self-selected starting level (1.0–4.5). Only honored before first match.
  starting_rating: z.number().min(1).max(4.5).optional(),
});
export type PlayerMePatch = z.infer<typeof PlayerMePatchSchema>;

/** Body the client posts to /v1/players/bootstrap on first sign-in. */
export const PlayerBootstrapSchema = z.object({
  name: z.string().min(1).max(120),
  display_name: z.string().max(120).nullable().optional(),
  email: z.string().max(320).nullable().optional(),
  gender: PlayerGenderSchema.nullable().optional(),
  avatar_url: z.string().max(512).nullable().optional(),
});
export type PlayerBootstrap = z.infer<typeof PlayerBootstrapSchema>;

// ---------------------------------------------------------------------------
// Matches (v1)
// ---------------------------------------------------------------------------

export const CategoryMatchCreateSchema = z
  .object({
    played_at: z.string(), // YYYY-MM-DD
    team_a_player_ids: z.array(z.number().int()).min(1).max(2),
    team_b_player_ids: z.array(z.number().int()).min(1).max(2),
    team_a_score: z.number().int().nonnegative(),
    team_b_score: z.number().int().nonnegative(),
  })
  .refine((m) => m.team_a_score !== m.team_b_score, {
    message: "Scores cannot be tied",
    path: ["team_b_score"],
  })
  .refine((m) => m.team_a_player_ids.length === m.team_b_player_ids.length, {
    message: "Teams must have the same number of players",
    path: ["team_b_player_ids"],
  });
export type CategoryMatchCreate = z.infer<typeof CategoryMatchCreateSchema>;

export const MatchParticipantSchema = z.object({
  player_id: z.number().int(),
  team: z.enum(["A", "B"]),
  name: z.string().default(""),
  avatar_url: z.string().nullable().optional(),
  pre_r: z.number(),
  post_r: z.number(),
  delta_r: z.number(),
  // Display-scale (2.0–8.0) values — the only ones shown to users.
  pre_display: z.number(),
  post_display: z.number(),
  delta_display: z.number(),
});
export type MatchParticipant = z.infer<typeof MatchParticipantSchema>;

export const CategoryMatchSchema = z.object({
  id: z.number().int(),
  category: RatingCategorySchema.nullable(),
  status: MatchStatusSchema.nullable(),
  played_at: z.string(),
  team_a_score: z.number().int(),
  team_b_score: z.number().int(),
  winner_team: z.enum(["A", "B"]),
  submitted_by_user_id: z.string().nullable(),
  verified_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  tournament_id: z.number().int().nullable(),
  participants: z.array(MatchParticipantSchema),
});
export type CategoryMatch = z.infer<typeof CategoryMatchSchema>;

// ---------------------------------------------------------------------------
// Validation + reports
// ---------------------------------------------------------------------------

export const ValidationCreateSchema = z.object({
  action: ValidationActionSchema,
  note: z.string().max(500).optional(),
});
export type ValidationCreate = z.infer<typeof ValidationCreateSchema>;

export const ValidationSchema = z.object({
  id: z.number().int(),
  user_id: z.string(),
  action: ValidationActionSchema,
  acted_at: z.string(),
  note: z.string().nullable(),
});
export type Validation = z.infer<typeof ValidationSchema>;

export const ReportCreateSchema = z.object({
  reason: ReportReasonSchema,
  description: z.string().max(500).optional(),
});
export type ReportCreate = z.infer<typeof ReportCreateSchema>;

export const ReportSchema = z.object({
  id: z.number().int(),
  match_id: z.number().int(),
  reporter_user_id: z.string(),
  reason: ReportReasonSchema,
  description: z.string().nullable(),
  status: ReportStatusSchema,
  created_at: z.string(),
});
export type Report = z.infer<typeof ReportSchema>;

// ---------------------------------------------------------------------------
// Leaderboard (v1)
// ---------------------------------------------------------------------------

export const LeaderboardEntrySchema = z.object({
  rank: z.number().int(),
  player_id: z.number().int(),
  name: z.string(),
  display: z.number(),
  tier: z.string(),
  rd: z.number(),
  calibrating: z.boolean(),
  ceiling: z.number(),
  match_count: z.number().int(),
  avatar_url: z.string().nullable().optional(),
  age: z.number().int().nullable().optional(),
  location: z.string().nullable().optional(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardSchema = z.object({
  category: RatingCategorySchema,
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  entries: z.array(LeaderboardEntrySchema),
});
export type Leaderboard = z.infer<typeof LeaderboardSchema>;

// ---------------------------------------------------------------------------
// Tournaments
// ---------------------------------------------------------------------------

export const TournamentCreateSchema = z.object({
  name: z.string().min(1).max(200),
  format: TournamentFormatSchema,
  // Ranked tournaments are admin-only; everyone can host casual ones.
  ranked: z.boolean(),
  starts_at: z.string(),
  ends_at: z.string().nullable().optional(),
  registration_closes_at: z.string().nullable().optional(),
  min_rating: z.number().nullable().optional(),
  max_rating: z.number().nullable().optional(),
});
export type TournamentCreate = z.infer<typeof TournamentCreateSchema>;

export const TournamentEntrySchema = z.object({
  id: z.number().int(),
  player_id: z.number().int(),
  seed: z.number().int().nullable(),
  withdrawn: z.boolean(),
});
export type TournamentEntry = z.infer<typeof TournamentEntrySchema>;

export const TournamentSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  format: TournamentFormatSchema,
  ranked: z.boolean(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  registration_closes_at: z.string().nullable().optional(),
  min_rating: z.number().nullable().optional(),
  max_rating: z.number().nullable().optional(),
  status: TournamentStatusSchema,
  organizer_user_id: z.string().nullable(),
  entries: z.array(TournamentEntrySchema),
});
export type Tournament = z.infer<typeof TournamentSchema>;

export const PairingsSchema = z.object({
  matches: z.array(CategoryMatchSchema),
});
export type Pairings = z.infer<typeof PairingsSchema>;

// ---------------------------------------------------------------------------
// Forecast (v1)
// ---------------------------------------------------------------------------

export const ForecastSchema = z.object({
  player_id: z.number().int(),
  opponent_id: z.number().int(),
  player_display: z.number(),
  opponent_display: z.number(),
  win_probability: z.number().min(0).max(1),
  player_calibrating: z.boolean(),
  opponent_calibrating: z.boolean(),
});
export type Forecast = z.infer<typeof ForecastSchema>;

// ---------------------------------------------------------------------------
// Error shape — FastAPI's default validation error envelope.
// ---------------------------------------------------------------------------

export const ApiErrorBodySchema = z.object({
  detail: z.union([z.string(), z.array(z.unknown())]),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

/** Thrown when an API response shape drifts from `types.ts`. */
export class SchemaMismatchError extends Error {
  constructor(
    public endpoint: string,
    public issues: z.core.$ZodIssue[],
  ) {
    super(
      `Schema mismatch on ${endpoint}: ${issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
    this.name = "SchemaMismatchError";
  }
}
