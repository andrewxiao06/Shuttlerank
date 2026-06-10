"""
Admin routes — privileged endpoints for moderation and bulk imports.

The "admin" check here is intentionally minimal for V1: a Player whose
`clerk_user_id` is listed in the `BRS_ADMIN_USER_IDS` environment variable
is an admin. Anything more elaborate (roles table, Clerk organization
metadata) is post-MVP.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Set

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from badminton_rating.api.auth import current_player
from badminton_rating.api.models.v1 import ReportOut, ReportPatch
from badminton_rating.db.models import MatchReport, Player, ReportStatus
from badminton_rating.db.session import get_db


router = APIRouter(prefix="/admin", tags=["admin"])


def _admin_user_ids() -> Set[str]:
    raw = os.environ.get("BRS_ADMIN_USER_IDS", "")
    return {x.strip() for x in raw.split(",") if x.strip()}


async def require_admin(player: Player = Depends(current_player)) -> Player:
    if player.clerk_user_id not in _admin_user_ids():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="admin only",
        )
    return player


# ---------------------------------------------------------------------------
# POST /admin/tournaments/import — stubbed
# ---------------------------------------------------------------------------

@router.post(
    "/tournaments/import",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
)
async def import_tournament(
    _: Player = Depends(require_admin),
) -> dict:
    """
    Placeholder for the TournamentSoftware import.

    Returns 501 until the export format is documented and a parser exists.
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="TournamentSoftware import not yet implemented",
    )


# ---------------------------------------------------------------------------
# PATCH /admin/reports/{id} — resolve a falsification report
# ---------------------------------------------------------------------------

@router.patch("/reports/{report_id}", response_model=ReportOut)
async def patch_report(
    report_id: int,
    payload: ReportPatch,
    session: AsyncSession = Depends(get_db),
    _: Player = Depends(require_admin),
) -> ReportOut:
    report = await session.get(MatchReport, report_id)
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"report {report_id} not found",
        )
    if payload.status is ReportStatus.OPEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="cannot transition a report back to OPEN",
        )
    report.status = payload.status
    report.resolved_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(report)
    return ReportOut.model_validate(report)
