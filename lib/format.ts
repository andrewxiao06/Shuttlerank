/*
 * Number + date formatting helpers. DESIGN.md "Don't" list locks the
 * display rating to 3 decimals — the 3rd decimal is the smallest
 * noticeable Glicko-2 delta on a single match.
 */

export function formatRating(r: number | null | undefined): string {
  if (r == null || Number.isNaN(r)) return "—";
  return r.toFixed(3);
}

export function formatDelta(d: number | null | undefined): string {
  if (d == null || Number.isNaN(d)) return "—";
  const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  return `${sign}${Math.abs(d).toFixed(3)}`;
}

export function formatPercent(p: number | null | undefined, digits = 0): string {
  if (p == null || Number.isNaN(p)) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}

export function deltaTone(d: number | null | undefined): "positive" | "negative" | "neutral" {
  if (d == null || Number.isNaN(d) || d === 0) return "neutral";
  return d > 0 ? "positive" : "negative";
}
