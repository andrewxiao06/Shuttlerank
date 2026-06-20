/*
 * Shared visual tokens for the mobile app. Mirrors the web DESIGN.md
 * palette at a high level. Plain JS objects consumed by StyleSheet.
 */

export const colors = {
  bg: "#f7f8f7",
  surface: "#ffffff",
  surfaceMuted: "#eef0ee",
  border: "#e2e5e2",
  text: "#1a1d1a",
  textSecondary: "#5b605b",
  textMuted: "#8a908a",
  primary: "#2f7d4f", // DUBR green
  onPrimary: "#ffffff",
  accent: "#2f7d4f",
  danger: "#c2473d",
  dangerSoft: "#f7e2e0",
  accentSoft: "#e3f0e8",
  warning: "#b07b1e",
  warningSoft: "#f6ecd6",
  info: "#2563eb",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;
