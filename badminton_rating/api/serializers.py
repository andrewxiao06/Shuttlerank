"""
ORM → Pydantic mappers.

Live in their own module so route handlers stay thin and so the same
mapping logic is reused everywhere we hand a Player to the client.
"""

from __future__ import annotations

from badminton_rating.api.models.players import ModeRating, PlayerOut
from badminton_rating.db.models import MatchMode, Player
from badminton_rating.engine.glicko import get_tier, to_display_rating


_CALIBRATING_RD = 150.0


def _mode_rating(
    *, r: float, rd: float, sigma: float, last_active, match_count: int
) -> ModeRating:
    display = to_display_rating(r)
    calibrating = rd > _CALIBRATING_RD
    matches_needed = max(0, int((rd - _CALIBRATING_RD) / 20)) if calibrating else 0
    return ModeRating(
        r=r,
        rd=rd,
        sigma=sigma,
        display=display,
        tier=get_tier(display),
        calibrating=calibrating,
        matches_needed=matches_needed,
        match_count=match_count,
        last_active=last_active,
    )


def player_to_out(player: Player) -> PlayerOut:
    return PlayerOut(
        id=player.id,
        name=player.name,
        created_at=player.created_at,
        singles=_mode_rating(
            r=player.singles_r,
            rd=player.singles_rd,
            sigma=player.singles_sigma,
            last_active=player.singles_last_active,
            match_count=player.singles_match_count,
        ),
        doubles=_mode_rating(
            r=player.doubles_r,
            rd=player.doubles_rd,
            sigma=player.doubles_sigma,
            last_active=player.doubles_last_active,
            match_count=player.doubles_match_count,
        ),
    )


def mode_fields(player: Player, mode: MatchMode):
    """Return (r, rd, sigma, last_active, match_count) for the given mode."""
    if mode is MatchMode.SINGLES:
        return (
            player.singles_r,
            player.singles_rd,
            player.singles_sigma,
            player.singles_last_active,
            player.singles_match_count,
        )
    return (
        player.doubles_r,
        player.doubles_rd,
        player.doubles_sigma,
        player.doubles_last_active,
        player.doubles_match_count,
    )
