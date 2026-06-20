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

/** Tier label from a display rating (2.0–8.0). Matches the web tier bands. */
export function tierLabel(rating: number | null | undefined): string {
  if (rating == null || Number.isNaN(rating)) return "Unrated";
  const bands: [number, string][] = [
    [7.0, "Master"],
    [6.0, "Diamond"],
    [5.0, "Platinum"],
    [4.0, "Gold"],
    [3.0, "Silver"],
    [2.0, "Bronze"],
  ];
  const clamped = Math.max(2.0, Math.min(7.999, rating));
  const band = bands.find(([min]) => clamped >= min);
  if (!band) return "Bronze";
  const within = clamped - band[0];
  const sub = within < 0.333 ? "I" : within < 0.667 ? "II" : "III";
  return `${band[1]} ${sub}`;
}

/** True when the rating is still calibrating (high uncertainty). */
export function isCalibrating(rd: number | null | undefined): boolean {
  return rd != null && rd > 150;
}
