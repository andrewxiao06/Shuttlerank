"""
Expo push-notification transport.

The mobile app registers an Expo push token per device (POST /v1/push-tokens).
When a match needs approval we send a notification to Expo's push service,
which forwards it to Apple (APNs) / Google (FCM). This module is the "how to
send" layer — the "when/who" lives in services/notifications.py, mirroring the
email.py split.

Env:
  EXPO_ACCESS_TOKEN  Optional. If your Expo project has "Enhanced Security" on,
                     set this; otherwise Expo accepts unauthenticated sends.

Best-effort: every send is wrapped so a failure never breaks the request that
triggered it. Returns the list of tokens Expo reported as dead (DeviceNot
Registered) so the caller can prune them.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Iterable, Sequence

import httpx

logger = logging.getLogger("shuttlerank.push")

EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send"


def _looks_like_expo_token(token: str) -> bool:
    return token.startswith("ExponentPushToken[") or token.startswith("ExpoPushToken[")


async def send_push(
    tokens: Sequence[str],
    *,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> list[str]:
    """
    Send one notification to many device tokens. Returns tokens Expo says are
    dead (so the caller can delete them). Never raises.
    """
    valid = [t for t in tokens if _looks_like_expo_token(t)]
    if not valid:
        return []

    messages = [
        {
            "to": t,
            "title": title,
            "body": body,
            "sound": "default",
            "data": data or {},
        }
        for t in valid
    ]

    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    access = os.environ.get("EXPO_ACCESS_TOKEN")
    if access:
        headers["Authorization"] = f"Bearer {access}"

    dead: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # Expo accepts up to 100 messages per request; we send in chunks.
            for i in range(0, len(messages), 100):
                chunk = messages[i : i + 100]
                resp = await client.post(EXPO_PUSH_ENDPOINT, json=chunk, headers=headers)
                resp.raise_for_status()
                tickets = (resp.json() or {}).get("data", [])
                # Map ticket -> token by position; flag dead devices for pruning.
                for msg, ticket in zip(chunk, tickets):
                    if (
                        ticket.get("status") == "error"
                        and (ticket.get("details") or {}).get("error")
                        == "DeviceNotRegistered"
                    ):
                        dead.append(msg["to"])
    except Exception as e:  # noqa: BLE001 — notifications must never break a request
        logger.warning("push send failed (%d tokens): %s", len(valid), e)

    if dead:
        logger.info("push: %d dead tokens to prune", len(dead))
    return dead
