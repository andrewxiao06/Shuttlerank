"""
Clerk webhook receiver.

Listens for `user.created` and `user.deleted`. On `user.created` we ensure
a `Player` row exists keyed by `clerk_user_id`. On `user.deleted` we
anonymize (we don't hard-delete — historical match records reference the
player and we want the audit trail intact).

The svix signature MUST be verified before any DB write. Bypassing
verification is only safe in tests (CLERK_WEBHOOK_SKIP_VERIFY=1).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from badminton_rating.api.auth import verify_clerk_webhook
from badminton_rating.api.models.v1 import ClerkWebhookEvent
from badminton_rating.db.models import Player
from badminton_rating.db.session import get_db


router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/clerk", status_code=status.HTTP_200_OK)
async def clerk_webhook(
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> dict:
    body = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}
    # Signature check happens FIRST — never touch the DB on unverified payloads.
    verify_clerk_webhook(body, headers)

    try:
        event = ClerkWebhookEvent.model_validate_json(body)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"malformed Clerk webhook payload: {e}",
        )

    if event.type == "user.created":
        await _handle_user_created(session, event)
    elif event.type == "user.deleted":
        await _handle_user_deleted(session, event)
    # Unknown event types are acknowledged (200) so Clerk doesn't retry forever.
    await session.commit()
    return {"ok": True, "type": event.type}


async def _handle_user_created(
    session: AsyncSession, event: ClerkWebhookEvent
) -> None:
    existing = (await session.execute(
        select(Player).where(Player.clerk_user_id == event.data.id)
    )).scalar_one_or_none()
    if existing is not None:
        return
    email = (
        event.data.email_addresses[0].email_address
        if event.data.email_addresses
        else None
    )
    name = " ".join(
        part for part in (event.data.first_name, event.data.last_name) if part
    ) or (email.split("@")[0] if email else event.data.id)
    session.add(Player(
        clerk_user_id=event.data.id,
        name=name,
        display_name=name,
        email=email,
    ))


async def _handle_user_deleted(
    session: AsyncSession, event: ClerkWebhookEvent
) -> None:
    player = (await session.execute(
        select(Player).where(Player.clerk_user_id == event.data.id)
    )).scalar_one_or_none()
    if player is None:
        return
    # Anonymize: keep the row (matches reference it) but scrub PII.
    player.clerk_user_id = None
    player.email = None
    player.display_name = None
    player.name = f"deleted-{player.id}"
