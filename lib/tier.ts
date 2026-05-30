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

export type SubTier = "I" | "II" | "III";

export interface TierInfo {
  name: TierName;
  /** Display label, e.g. "Gold II" */
  label: string;
  /** Bronze..Master subtier */
  sub: SubTier;
  /** Tailwind color token suffix — pair with `bg-tier-…` / `text-tier-…` / `border-tier-…` */
  colorToken: `tier-${TierName}`;
}

const TIERS: { name: TierName; min: number }[] = [
  { name: "bronze", min: 2.0 },
  { name: "silver", min: 3.0 },
  { name: "gold", min: 4.0 },
  { name: "platinum", min: 5.0 },
  { name: "diamond", min: 6.0 },
  { name: "master", min: 7.0 },
];

const UNKNOWN: TierInfo = {
  name: "bronze",
  label: "Unrated",
  sub: "I",
  colorToken: "tier-bronze",
};

export function tierFor(rating: number | null | undefined): TierInfo {
  if (rating == null || Number.isNaN(rating)) return UNKNOWN;

  // Match CLAUDE.md: 2.0–3.0 Bronze, etc. Clamp above 8.0 into Master III.
  const clamped = Math.max(2.0, Math.min(7.999, rating));
  const tier =
    [...TIERS].reverse().find((t) => clamped >= t.min) ?? TIERS[0];

  const within = clamped - tier.min; // 0..1
  const sub: SubTier = within < 0.333 ? "I" : within < 0.667 ? "II" : "III";

  const label = `${tier.name[0].toUpperCase()}${tier.name.slice(1)} ${sub}`;

  return {
    name: tier.name,
    label,
    sub,
    colorToken: `tier-${tier.name}` as const,
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
