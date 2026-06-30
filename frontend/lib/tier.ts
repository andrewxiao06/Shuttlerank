/*
 * Tier mapping — single source of truth for the rating → tier → color
 * lookup. Mirrors CLAUDE.md "Rating Scale" and DESIGN.md tier palette.
 *
 * Colors are Tailwind class fragments so callers compose them as
 * `bg-${tier.colorClass}` or `text-${tier.colorClass}`. Never inline hex.
 */

export type TierName =
  | "bronze"
  | "silver"
  | "gold"
  | "platinum"
  | "diamond"
  | "master";

/** Sub-division within a tier: 1–5 (one per 0.2 of rating). */
export type SubTier = 1 | 2 | 3 | 4 | 5;

export interface TierInfo {
  name: TierName;
  /** Display label, e.g. "Gold 3" */
  label: string;
  sub: SubTier;
  /** Tailwind color token suffix — pair with `bg-tier-…` / `text-tier-…` / `border-tier-…` */
  colorToken: `tier-${TierName}`;
}

// Tier keyed by the integer part of the rating: 1=Bronze … 5=Diamond,
// 6+=Master (future competitive). Each tier spans 1.0, split into 5
// sub-divisions of 0.2 (1.0=Bronze 1, 1.2=Bronze 2, … 2.4=Silver 3).
const BAND_NAMES: Record<number, TierName> = {
  1: "bronze",
  2: "silver",
  3: "gold",
  4: "platinum",
  5: "diamond",
  6: "master",
};

const UNKNOWN: TierInfo = {
  name: "bronze",
  label: "Unrated",
  sub: 1,
  colorToken: "tier-bronze",
};

export function tierFor(rating: number | null | undefined): TierInfo {
  if (rating == null || Number.isNaN(rating)) return UNKNOWN;

  const band = Math.max(1, Math.min(6, Math.floor(rating)));
  const name = BAND_NAMES[band] ?? "master";
  // +1e-6 absorbs float error so 1.2 → sub 2 (not 1).
  const sub = Math.min(5, Math.max(1, Math.floor((rating - band) / 0.2 + 1e-6) + 1)) as SubTier;

  const label = `${name[0].toUpperCase()}${name.slice(1)} ${sub}`;

  return {
    name,
    label,
    sub,
    colorToken: `tier-${name}` as const,
  };
}

/** True when a player is "still calibrating" per DESIGN.md (rd > 150). */
export function isCalibrating(rd: number | null | undefined): boolean {
  return rd != null && rd > 150;
}

/*
 * Static class-name maps. Tailwind's JIT scans source for *literal* class
 * strings — dynamic `bg-${name}` strings get purged, which would silently
 * render as the gray fallback called out in PLAN.md's debugging table.
 */
export const TIER_BG: Record<TierName, string> = {
  bronze: "bg-tier-bronze",
  silver: "bg-tier-silver",
  gold: "bg-tier-gold",
  platinum: "bg-tier-platinum",
  diamond: "bg-tier-diamond",
  master: "bg-tier-master",
};

export const TIER_TEXT: Record<TierName, string> = {
  bronze: "text-tier-bronze",
  silver: "text-tier-silver",
  gold: "text-tier-gold",
  platinum: "text-tier-platinum",
  diamond: "text-tier-diamond",
  master: "text-tier-master",
};

export const TIER_BORDER: Record<TierName, string> = {
  bronze: "border-tier-bronze",
  silver: "border-tier-silver",
  gold: "border-tier-gold",
  platinum: "border-tier-platinum",
  diamond: "border-tier-diamond",
  master: "border-tier-master",
};

/** Tier-tinted chip background — uses an inline rgba via CSS var to avoid /15 dynamic opacity issues. */
export const TIER_CHIP_BG: Record<TierName, string> = {
  bronze: "bg-tier-bronze/15",
  silver: "bg-tier-silver/15",
  gold: "bg-tier-gold/15",
  platinum: "bg-tier-platinum/20",
  diamond: "bg-tier-diamond/20",
  master: "bg-tier-master/20",
};
