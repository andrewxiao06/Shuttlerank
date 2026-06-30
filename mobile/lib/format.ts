/*
 * Number formatting — ported from the web app. Ratings show on the
 * DUPR-style 2.0–8.0 scale rounded to one decimal (e.g. "4.5"). The
 * internal Glicko number is never surfaced to users.
 */

export function formatRating(r: number | null | undefined): string {
  if (r == null || Number.isNaN(r)) return "—";
  return r.toFixed(1);
}

export function formatDelta(d: number | null | undefined): string {
  if (d == null || Number.isNaN(d)) return "—";
  const rounded = Math.round(d * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  return `${sign}${Math.abs(rounded).toFixed(1)}`;
}

export function formatPercent(p: number | null | undefined, digits = 0): string {
  if (p == null || Number.isNaN(p)) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}

/**
 * Tier label from a display rating. 1=Bronze, 2=Silver, 3=Gold, 4=Platinum,
 * 5=Diamond, 6+=Master; each tier split into 5 sub-divisions of 0.2
 * (1.0=Bronze 1, 1.2=Bronze 2, … 2.4=Silver 3). Mirrors the web tier.ts.
 */
const BAND_NAMES: Record<number, string> = {
  1: "Bronze",
  2: "Silver",
  3: "Gold",
  4: "Platinum",
  5: "Diamond",
  6: "Master",
};

export function tierLabel(rating: number | null | undefined): string {
  if (rating == null || Number.isNaN(rating)) return "Unrated";
  const band = Math.max(1, Math.min(6, Math.floor(rating)));
  const name = BAND_NAMES[band] ?? "Master";
  // +1e-6 absorbs float error so 1.2 → sub 2 (not 1).
  const sub = Math.min(5, Math.max(1, Math.floor((rating - band) / 0.2 + 1e-6) + 1));
  return `${name} ${sub}`;
}

/** True when the rating is still calibrating (high uncertainty). */
export function isCalibrating(rd: number | null | undefined): boolean {
  return rd != null && rd > 150;
}
