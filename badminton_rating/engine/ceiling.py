"""
DUPR-style rating ceiling unlock logic — pure functions, no DB.

A player's display rating is capped at their `ceiling` (per category).
The ceiling only rises through verified ranked tournament participation —
this is the entire anti-sandbagging integrity story.

This module decides, after a tournament completes, what each entrant's
new ceiling should be. The service layer is responsible for persisting
the result and writing CeilingHistory rows.

Formula:

    new_ceiling = max(old_ceiling, achieved_display + tier_bonus)

Where:
- `achieved_display` is the entrant's *peak performance display rating*
  over the tournament — measured as the post-match display rating after
  their best result, not their pre-tournament rating.
- `tier_bonus` depends on the tournament's strength tier (`club` /
  `regional` / `national`).

The ceiling can only go up, never down. A tournament cannot lower a
ceiling, even if the player performs poorly.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Sequence


# ---------------------------------------------------------------------------
# Tournament strength tiers
# ---------------------------------------------------------------------------

class TournamentStrength(str, Enum):
    """How much the ceiling can jump beyond the achieved display rating."""
    CLUB = "club"
    REGIONAL = "regional"
    NATIONAL = "national"


# Bonus added to achieved_display before clamping ceiling. The bonus exists
# so a single national-tournament appearance can break a player above
# their measured performance — letting genuinely strong players who play
# few events still rate accurately.
STRENGTH_BONUS = {
    TournamentStrength.CLUB: 0.0,
    TournamentStrength.REGIONAL: 0.25,
    TournamentStrength.NATIONAL: 0.5,
}


# ---------------------------------------------------------------------------
# Inputs / outputs
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CeilingInput:
    """One entrant's tournament summary, fed into the ceiling unlock pass."""
    player_id: int
    old_ceiling: float
    achieved_display: float  # peak display rating reached during this tournament


@dataclass(frozen=True)
class CeilingUpdate:
    """Output: the new ceiling for one entrant. unchanged == True if no rise."""
    player_id: int
    old_ceiling: float
    new_ceiling: float

    @property
    def unchanged(self) -> bool:
        return self.new_ceiling == self.old_ceiling


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def update_ceilings(
    entries: Sequence[CeilingInput],
    strength: TournamentStrength,
    display_max: float = 8.0,
) -> List[CeilingUpdate]:
    """
    Compute new ceilings for every entrant. Pure function.

    Args:
        entries:     one CeilingInput per tournament entrant
        strength:    tournament strength tier
        display_max: hard upper bound on any ceiling (default 8.0,
                     matches engine/glicko.DISPLAY_MAX)

    Returns:
        One CeilingUpdate per input, in the same order.
    """
    bonus = STRENGTH_BONUS[strength]
    updates: List[CeilingUpdate] = []
    for entry in entries:
        proposed = entry.achieved_display + bonus
        new_ceiling = max(entry.old_ceiling, min(proposed, display_max))
        # Round to 3 decimal places — same precision as display ratings.
        new_ceiling = round(new_ceiling, 3)
        updates.append(
            CeilingUpdate(
                player_id=entry.player_id,
                old_ceiling=entry.old_ceiling,
                new_ceiling=new_ceiling,
            )
        )
    return updates
