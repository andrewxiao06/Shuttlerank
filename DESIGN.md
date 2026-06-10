---
version: alpha
name: DUBR
description: >
  Badminton rating system inspired by DUPR. Mobile-first, score-forward,
  numerals-as-hero. Casual recreational tone — confident but warm, never
  corporate. Most users are on phones standing courtside between games.

colors:
  # Surfaces — white app canvas with a barely-there green tint
  background: "#F6FAF6"            # near-white with sub-1% green cast
  surface: "#FFFFFF"               # cards
  surface-elevated: "#FFFFFF"
  surface-muted: "#ECF3EC"         # section dividers, calibrating rows
  scrim: "#0A0A0A14"               # 8% black, modal/sheet overlay

  # Text
  text-primary: "#0A0A0A"
  text-secondary: "#4B5563"
  text-muted: "#8A8A8A"
  text-on-accent: "#FFFFFF"

  # Brand + status — court green as the brand
  primary: "#15803D"               # court green: buttons, brand surfaces
  primary-hover: "#166534"         # deeper green for hover
  on-primary: "#FFFFFF"
  accent: "#16A34A"                # win green / positive delta
  on-accent: "#FFFFFF"
  danger: "#DC2626"                # loss / negative delta / dispute
  warning: "#D97706"               # pending validation / calibrating
  info: "#2563EB"                  # forecast probability

  # Borders — soft green-tinted
  border: "#DCE5DC"
  border-strong: "#0A0A0A"
  focus-ring: "#15803D"

  # Tier palette (hard-mapped — never reinterpret)
  tier-bronze: "#A97142"
  tier-silver: "#9CA3AF"
  tier-gold: "#D4AF37"
  tier-platinum: "#5EEAD4"
  tier-diamond: "#60A5FA"
  tier-master: "#A78BFA"

  # Dark mode
  background-dark: "#0F0F0F"
  surface-dark: "#1A1A1A"
  text-primary-dark: "#F5F5F5"
  border-dark: "#2A2A2A"

typography:
  # Display — hero rating number on profile, leaderboard #1
  display-xl:
    fontFamily: Inter
    fontSize: 4.5rem               # 72px desktop
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "'tnum' 1, 'cv11' 1"
  display-lg:
    fontFamily: Inter
    fontSize: 3rem                 # 48px mobile hero rating
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "'tnum' 1"

  # Headings
  h1:
    fontFamily: Inter
    fontSize: 1.875rem             # 30px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  h2:
    fontFamily: Inter
    fontSize: 1.5rem               # 24px
    fontWeight: 600
    lineHeight: 1.25
  h3:
    fontFamily: Inter
    fontSize: 1.125rem             # 18px
    fontWeight: 600
    lineHeight: 1.3

  # Body
  body-lg:
    fontFamily: Inter
    fontSize: 1.0625rem            # 17px — mobile-optimized reading size
    fontWeight: 400
    lineHeight: 1.5
  body-md:
    fontFamily: Inter
    fontSize: 1rem                 # 16px — minimum to avoid iOS zoom on focus
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: Inter
    fontSize: 0.875rem             # 14px — never below this for primary content
    fontWeight: 400
    lineHeight: 1.45

  # Numerals (ratings, scores, deltas) — always tabular
  numeral-lg:
    fontFamily: Inter
    fontSize: 2rem
    fontWeight: 700
    lineHeight: 1
    fontFeature: "'tnum' 1, 'cv11' 1"
  numeral-md:
    fontFamily: Inter
    fontSize: 1.25rem
    fontWeight: 600
    lineHeight: 1
    fontFeature: "'tnum' 1, 'cv11' 1"
  numeral-sm:
    fontFamily: Inter
    fontSize: 0.9375rem            # 15px — leaderboard cells
    fontWeight: 500
    lineHeight: 1
    fontFeature: "'tnum' 1, 'cv11' 1"

  # Labels / chips / metadata
  label:
    fontFamily: Inter
    fontSize: 0.75rem              # 12px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.04em"
  caption:
    fontFamily: Inter
    fontSize: 0.8125rem            # 13px
    fontWeight: 400
    lineHeight: 1.4

rounded:
  none: 0px
  xs: 4px
  sm: 6px                          # chips, tags
  md: 10px                         # inputs, small buttons
  lg: 14px                         # cards, modals
  xl: 20px                         # rating tiles, FAB
  full: 9999px                     # pills, avatars

spacing:
  "0": 0px
  "0.5": 2px
  "1": 4px
  "2": 8px
  "3": 12px
  "4": 16px                        # default mobile padding
  "5": 20px
  "6": 24px                        # default desktop card padding
  "8": 32px
  "10": 40px
  "12": 48px
  "16": 64px

components:
  # Buttons — 44px minimum tap target (Apple HIG) on mobile
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "12px 20px"
    height: 44px
  button-primary-hover:
    backgroundColor: "#1F1F1F"
  button-primary-pressed:
    backgroundColor: "#333333"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "12px 20px"
    height: 44px
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary}"
    typography: "{typography.body-md}"
    padding: "10px 16px"
    height: 40px
  button-destructive:
    backgroundColor: "{colors.danger}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    height: 44px

  # Floating action button (mobile submit-match)
  fab:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    size: 56px

  # Cards
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: 16px                  # mobile; desktop overrides to 24px
  card-rating-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
    padding: 20px

  # Chips
  chip-tier:
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
    height: 24px
  chip-status-pending:
    backgroundColor: "#FEF3C7"
    textColor: "{colors.warning}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  chip-status-verified:
    backgroundColor: "#DCFCE7"
    textColor: "{colors.accent}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  chip-status-disputed:
    backgroundColor: "#FEE2E2"
    textColor: "{colors.danger}"
    rounded: "{rounded.full}"
    padding: "4px 10px"

  # Inputs — 16px font on mobile to suppress iOS auto-zoom
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
    height: 48px                   # generous mobile tap target

  # Delta pills (rating change after match)
  delta-positive:
    backgroundColor: "#DCFCE7"
    textColor: "{colors.accent}"
    typography: "{typography.numeral-sm}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  delta-negative:
    backgroundColor: "#FEE2E2"
    textColor: "{colors.danger}"
    typography: "{typography.numeral-sm}"
    rounded: "{rounded.full}"
    padding: "4px 10px"

  # Nav
  nav-top:
    backgroundColor: "{colors.background}"
    height: 64px
  nav-bottom-tab:
    backgroundColor: "{colors.surface}"
    height: 64px                   # + safe-area-inset-bottom

# Breakpoints (consumed by Tailwind config, mirrored here for agents)
breakpoints:
  sm: 640px
  md: 768px                        # tablet
  lg: 1024px                       # desktop
  xl: 1280px
---

## Overview

DUBR is a badminton rating system for casual recreational players. The visual
identity is **score-forward, calm, and confident** — the user opens the app
between games to answer one question: *did my rating move?* Everything else
is supporting cast.

**Design principles**

- **Numerals are the hero.** Display ratings, scores, and deltas are the
  largest, boldest elements on every screen. Always tabular-numerals so they
  don't jitter as values change.
- **Mobile-first, always.** Layouts are designed for a 375px-wide phone
  standing courtside in poor lighting, then progressively enhanced for
  tablet (≥768px) and desktop (≥1024px). Never the reverse.
- **Calm surfaces.** Warm off-white background (`#FAFAF7`), white cards,
  generous whitespace. Color is used sparingly — only for state (win/loss,
  pending/verified) and for tier identity.
- **No decoration.** No gradients, no glass-morphism, no emoji icons in
  product UI. The only ornament is the tier color stripe on rating tiles.
- **Recognizable to a DUPR user in 3 seconds.** Big number, tier chip,
  recent matches list. Don't reinvent the pattern — extend it.

## Colors

**Surface stack.** `background` (`#FAFAF7`) is the app canvas; `surface`
(`#FFFFFF`) is for any container that needs to feel "lifted" — cards, sheets,
modals. Avoid stacking more than two surface levels; instead use spacing and
borders to communicate hierarchy.

**Status semantics — never improvise.**

| Meaning | Token | Usage |
|---|---|---|
| Win / positive delta / verified | `accent` (`#16A34A`) | green chip, +0.041 |
| Loss / negative delta / disputed | `danger` (`#DC2626`) | red chip, -0.041 |
| Pending validation / calibrating | `warning` (`#D97706`) | amber chip, "still calibrating" dot |
| Forecast probability | `info` (`#2563EB`) | "63% chance to win" |

**Tier palette is locked.** Bronze → Master maps to the six colors in front
matter. Sub-tiers (I/II/III) share the parent color — never invent new shades.
Tier color appears as a 3px left border on rating tiles and as the background
of `chip-tier`. Text color on tier chips is always `text-primary` (the tier
colors are mid-saturation; black text passes WCAG AA on all six).

**Dark mode** swaps `background` → `#0F0F0F`, `surface` → `#1A1A1A`, and
inverts text tokens. Tier and status colors are unchanged — they already
contrast against both modes.

## Typography

Inter is the only family. It's hosted as a variable font and loaded via
`next/font` to avoid FOUT.

**Hierarchy on a profile screen (mobile, top-to-bottom):**

1. `display-lg` (48px) — current rating number
2. `chip-tier` — "Gold II"
3. `h3` (18px) — section labels ("Recent matches")
4. `body-md` (16px) — match rows
5. `caption` (13px) — timestamps, opponent metadata

**Tabular numerals are mandatory** on every rating, score, delta, and
percentage. This is enforced via the `fontFeature: 'tnum' 1` token on all
`numeral-*` and `display-*` styles. Without this, a leaderboard re-renders
visibly when the second decimal changes from `0` to `1`.

**Minimum mobile body size is 16px** to suppress iOS Safari's auto-zoom on
input focus. Any text smaller than 16px must not appear inside or adjacent
to a focused input.

## Layout

**Mobile-first responsive strategy.** Every screen is authored against the
375px viewport first. The component library uses Tailwind breakpoint
prefixes in this order:

- (no prefix) — phones, 320px+
- `sm:` — large phones / small tablets, 640px+
- `md:` — tablets, 768px+
- `lg:` — desktop, 1024px+
- `xl:` — wide desktop, 1280px+

**Container widths.**

| Breakpoint | Max content width | Horizontal padding |
|---|---|---|
| Mobile | 100% | 16px (`spacing.4`) |
| Tablet | 720px | 24px (`spacing.6`) |
| Desktop | 1100px | 32px (`spacing.8`) |

**Grid behavior on the profile screen** (the most layout-sensitive screen):

- Mobile: rating tiles stack vertically, full-width
- `sm:` rating tiles in a horizontal snap-scroll carousel
- `md:` 2-column grid
- `lg:` 3-column grid
- Rating history chart goes 100% width below the tiles at all breakpoints

**Tap targets.** Minimum 44×44px on touch surfaces (Apple HIG). All
`button-*` components hit this via `height: 44px`. Inline links inside body
copy get 8px of extra vertical padding via `py-2` to reach the threshold
without breaking line height.

**Safe area insets.** Bottom tab nav and FAB must respect
`env(safe-area-inset-bottom)` on iOS. The nav height token (64px) is the
visual height; add `pb-[env(safe-area-inset-bottom)]` to the container.

**Sticky elements.** Leaderboard table header is `sticky top-[64px]` on
desktop, `sticky top-0` on mobile (no top nav on mobile — replaced by tab bar).

## Elevation & Depth

**Three-level elevation system, used sparingly.**

| Level | Use | Shadow |
|---|---|---|
| 0 | App background, table rows | none |
| 1 | Cards, rating tiles | `0 1px 3px rgba(10,10,10,0.06), 0 1px 2px rgba(10,10,10,0.04)` |
| 2 | Sheets, dropdowns, popovers | `0 10px 25px rgba(10,10,10,0.08), 0 4px 10px rgba(10,10,10,0.04)` |
| 3 | Modals only | `0 25px 50px rgba(10,10,10,0.15)` + `scrim` backdrop |

No `level 4` exists. If a design wants more emphasis than level 3, the
answer is reducing what's behind it, not deepening the shadow.

Borders (`border: #E5E5E0`) are the **primary** way to delineate elements.
Shadows are reserved for elements that genuinely float.

## Shapes

The shape language is **roundedness as warmth gradient**:

- Chips & pills: `rounded.full` — most rounded → friendliest
- Rating tiles & FAB: `rounded.xl` (20px) — soft hero containers
- Cards & modals: `rounded.lg` (14px) — standard surfaces
- Inputs & buttons: `rounded.md` (10px) — functional, less playful
- Dividers, table cells: `rounded.none` — strict, scannable

Avatars are always `rounded.full`. Tournament bracket nodes are
`rounded.md` to read as "structural / data" not "social."

## Components

**Rating tile** (the signature component, used on profile + home):

```
┌─────────────────────────────┐
│ ▍ MENS SINGLES        ○     │  ← tier-color left stripe, calibrating dot
│                              │
│   4.213                      │  ← display-lg, tabular
│                              │
│   ┌──────────┐               │
│   │ Gold II  │  ↑ 0.041     │  ← chip-tier + delta-positive
│   └──────────┘               │
│                              │
│   ████████░░░░  68% to cap   │  ← ceiling bar
└─────────────────────────────┘
```

**Match row** (leaderboard, match history):

```
┌──────────────────────────────────────────────┐
│  A. Xiao   vs   J. Patel       21-15 21-18   │
│  Gold II        Silver III      2 days ago   │
│                                       +0.041 │
└──────────────────────────────────────────────┘
```

The delta pill aligns to the right edge. On mobile (<640px) the score moves
under the names; the row becomes two lines.

**Bottom tab bar** (mobile only, replaces top nav <md):

```
┌──────────────────────────────────────────────┐
│   ⌂        ☷        ⊕        ⚑       ◉      │
│  Home   Board    Submit    Inbox   Profile   │
└──────────────────────────────────────────────┘
```

Submit is the visually elevated center FAB (level 2 shadow) — primary action
gets primary placement. Inbox shows a red dot badge when pending count > 0.

**Score input** (submit-match):

Number-pad-only inputs (`inputMode="numeric"`) with a +/- stepper for users
who prefer tapping. Game scores arranged horizontally on desktop, vertically
on mobile. Best-of-3 reveals game 2 only when game 1 is complete.

## Do's and Don'ts

**Do**

- Use tabular numerals (`font-variant-numeric: tabular-nums`) on every
  rating, score, percentage, and delta.
- Design every screen at 375px first; widen progressively.
- Use the tier color *only* as a 3px stripe or chip — never as a fill on
  large surfaces (it would compete with the rating number).
- Show a calibrating dot (`○` in `warning` color) when `rd > 150`. This is
  the trust signal that explains why a rating moves a lot early.
- Keep tap targets ≥44px on mobile. Add invisible padding before shrinking
  the visible element.
- Respect `prefers-reduced-motion`: disable rating count-up animations.

**Don't**

- Don't use gradients, glassmorphism, or drop shadows beyond level 3.
- Don't introduce a second font family. Inter only.
- Don't color-code wins/losses with anything other than `accent` / `danger`.
  Colorblind users navigate via the +/- sign and shape, not the hue.
- Don't show rating values to 4+ decimal places in the UI. Always 3 (`4.213`).
  The 3rd decimal is the smallest noticeable Glicko-2 delta on a single match.
- Don't auto-advance the score input. Coaches retype after typos.
- Don't show toasts for routine success ("Match submitted"). Use inline
  confirmation in the destination view instead — toasts are for async events
  the user didn't initiate (e.g. "Opponent disputed your match").
- Don't put more than two surface levels on screen. If you need a third,
  you need a sheet/modal instead.
- Don't ship a feature without checking it at 375×667 (iPhone SE) — that's
  the floor, not an edge case.
