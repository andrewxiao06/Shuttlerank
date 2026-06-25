"""
Transactional email via Resend.

Best-effort by design: if RESEND_API_KEY is unset (local dev, tests) or the
provider errors, sending is a no-op that logs — it never raises, so a mail
outage can't break match submission. Swap the provider here without touching
callers.

Env:
  RESEND_API_KEY   Resend API key (https://resend.com/api-keys). Unset = no-op.
  EMAIL_FROM       From header, e.g. "ShuttleRank <onboarding@resend.dev>".
                   Resend's onboarding@resend.dev works without a verified
                   domain — fine until you add your own.
  APP_URL          Public web URL used to build links in emails (the Vercel
                   origin), e.g. https://dubr-sepia.vercel.app
"""

from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger("shuttlerank.email")

RESEND_ENDPOINT = "https://api.resend.com/emails"
DEFAULT_FROM = "ShuttleRank <onboarding@resend.dev>"


def email_enabled() -> bool:
    return bool(os.environ.get("RESEND_API_KEY"))


def app_url() -> str:
    return os.environ.get("APP_URL", "https://dubr-sepia.vercel.app").rstrip("/")


async def send_email(*, to: str, subject: str, html: str) -> bool:
    """Send one email. Returns True on success, False on no-op/failure.

    Never raises — callers treat email as fire-and-forget.
    """
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        logger.info("email skipped (no RESEND_API_KEY): to=%s subject=%s", to, subject)
        return False
    if not to:
        return False

    payload = {
        "from": os.environ.get("EMAIL_FROM", DEFAULT_FROM),
        "to": [to],
        "subject": subject,
        "html": html,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                RESEND_ENDPOINT,
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
            )
        if resp.status_code >= 400:
            logger.warning("email send failed (%s): %s", resp.status_code, resp.text)
            return False
        return True
    except Exception as e:  # noqa: BLE001 — email must never break the request
        logger.warning("email send error: %s", e)
        return False
