/*
 * Number + date formatting helpers. Ratings show on the DUPR-style 2.0–8.0
 * scale rounded to one decimal (e.g. "4.5"). The internal Glicko number is
 * never surfaced to users — only these display values are.
 */

export function formatRating(r: number | null | undefined): string {
  if (r == null || Number.isNaN(r)) return "—";
  return r.toFixed(1);
}

export function formatDelta(d: number | null | undefined): string {
  if (d == null || Number.isNaN(d)) return "—";
  // Round to one decimal first so the sign matches the shown magnitude
  // (a +0.04 change renders as "±0.0", not "+0.0").
  const rounded = Math.round(d * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  return `${sign}${Math.abs(rounded).toFixed(1)}`;
}

export function formatPercent(p: number | null | undefined, digits = 0): string {
  if (p == null || Number.isNaN(p)) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}

export function deltaTone(d: number | null | undefined): "positive" | "negative" | "neutral" {
  if (d == null || Number.isNaN(d) || d === 0) return "neutral";
  return d > 0 ? "positive" : "negative";
}
