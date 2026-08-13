"""
Push-token registration.

The mobile app calls POST /v1/push-tokens with its Expo push token after the
user allows notifications. We upsert by token so a device re-registering (app
restart, new login) just updates its owner + last_seen instead of duplicating.
DELETE unregisters a token (used by the in-app "notifications off" toggle).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from badminton_rating.api.auth import current_player
from badminton_rating.db.models import Player, PushToken
from badminton_rating.db.session import get_db


router = APIRouter(prefix="/v1/push-tokens", tags=["v1-push"])


class PushTokenIn(BaseModel):
    token: str = Field(..., min_length=8, max_length=256)
    platform: Optional[str] = Field(None, max_length=16)  # "ios" | "android"


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
async def register_push_token(
    body: PushTokenIn,
    player: Player = Depends(current_player),
    session: AsyncSession = Depends(get_db),
) -> None:
    """Register (or refresh) this device's push token for the current player."""
    existing = (await session.execute(
        select(PushToken).where(PushToken.token == body.token)
    )).scalar_one_or_none()

    if existing is None:
        session.add(PushToken(
            player_id=player.id,
            token=body.token,
            platform=body.platform,
        ))
    else:
        # Same device could now belong to a different signed-in player (shared
        # phone, account switch), so re-point it and bump last_seen.
        existing.player_id = player.id
        existing.platform = body.platform or existing.platform
        existing.last_seen_at = datetime.now(timezone.utc)

    await session.commit()


@router.delete("/{token}", status_code=status.HTTP_204_NO_CONTENT)
async def unregister_push_token(
    token: str,
    player: Player = Depends(current_player),
    session: AsyncSession = Depends(get_db),
) -> None:
    """Remove a token (notifications toggled off). Scoped to the caller's own."""
    await session.execute(
        delete(PushToken).where(
            PushToken.token == token,
            PushToken.player_id == player.id,
        )
    )
    await session.commit()
