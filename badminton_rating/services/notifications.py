"""
Notification orchestration. Currently: email participants when a match needs
their approval. Decoupled from the email transport (services/email.py) so the
"when/who/what" lives here and the "how to send" lives there.

Design notes
------------
- Best-effort: every send is wrapped so a failure never bubbles into the
  request that triggered it (match submission must succeed regardless).
- Who gets emailed: every participant who still needs to act — i.e. everyone
  except the submitter, who auto-approves on submit. Recipients need a stored
  email (Player.email) and are skipped silently otherwise.
- "App" notifications are already covered by the in-app Inbox; this module is
  the email channel. A per-user channel preference is a future addition
  (see PLAN.md → Notifications).
"""

from __future__ import annotations

import logging
from typing import Sequence

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from badminton_rating.db.models import Match, Player, PushToken, Team
from badminton_rating.services.email import app_url, email_enabled, send_email
from badminton_rating.services.push import send_push

logger = logging.getLogger("shuttlerank.notifications")


def _display_name(p: Player) -> str:
    return p.display_name or p.name


def _team_names(players: Sequence[Player]) -> str:
    return " & ".join(_display_name(p) for p in players) or "—"


def _pending_email_html(
    *, recipient_name: str, submitter_name: str, summary: str
) -> str:
    inbox = f"{app_url()}/inbox"
    return f"""\
<div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px;">
  <h2 style="margin:0 0 8px;">A match needs your approval</h2>
  <p style="color:#444;">Hi {recipient_name},</p>
  <p style="color:#444;">{submitter_name} submitted a match you're in:</p>
  <p style="font-size:18px;font-weight:700;margin:16px 0;">{summary}</p>
  <p style="color:#444;">Approve or dispute it so ratings can update.
     It auto-verifies in 7 days if no one disputes.</p>
  <p style="margin:24px 0;">
    <a href="{inbox}" style="background:#2f7d4f;color:#fff;text-decoration:none;
       padding:10px 18px;border-radius:8px;display:inline-block;">Review in ShuttleRank</a>
  </p>
  <p style="color:#888;font-size:12px;">You're getting this because you were in the match.</p>
</div>"""


async def notify_pending_match(session: AsyncSession, match: Match) -> int:
    """Email every participant who needs to approve `match`.

    Returns the number of emails attempted (0 when email is disabled). Never
    raises.
    """
    try:
        participants = list(match.participants)
        ids = [p.player_id for p in participants]
        players = {
            p.id: p
            for p in (
                await session.execute(select(Player).where(Player.id.in_(ids)))
            ).scalars().all()
        }

        team_a = [players[p.player_id] for p in participants if p.team is Team.A and p.player_id in players]
        team_b = [players[p.player_id] for p in participants if p.team is Team.B and p.player_id in players]
        summary = (
            f"{_team_names(team_a)}  {match.team_a_score}–{match.team_b_score}  "
            f"{_team_names(team_b)}"
        )

        submitter = next(
            (p for p in players.values() if p.clerk_user_id == match.submitted_by_user_id),
            None,
        )
        submitter_name = _display_name(submitter) if submitter else "Someone"

        # Everyone who needs to act = participants except the submitter.
        recipients = [
            p for p in players.values()
            if p.clerk_user_id != match.submitted_by_user_id
        ]

        # --- Email channel (only if Resend is configured) ---
        sent = 0
        if email_enabled():
            for p in recipients:
                if not p.email:
                    continue
                await send_email(
                    to=p.email,
                    subject="A ShuttleRank match needs your approval",
                    html=_pending_email_html(
                        recipient_name=_display_name(p),
                        submitter_name=submitter_name,
                        summary=summary,
                    ),
                )
                sent += 1
        else:
            logger.info("notifications: email disabled, skipping emails for match %s", match.id)

        # --- Push channel (all recipients' registered devices) ---
        await _push_pending_match(session, [p.id for p in recipients], submitter_name, summary, match.id)

        return sent
    except Exception as e:  # noqa: BLE001 — notifications must never break submit
        logger.warning("notify_pending_match failed for match %s: %s", match.id, e)
        return 0


async def _push_pending_match(
    session: AsyncSession,
    recipient_player_ids: list[int],
    submitter_name: str,
    summary: str,
    match_id: int,
) -> None:
    """
    Push "a match needs your approval" to every recipient's registered devices.

    `data.matchId` lets the app deep-link straight to the match when the user
    taps the notification. Best-effort — prunes tokens Expo says are dead and
    never raises (its own guard, so a push failure can't undo emails that
    already sent).
    """
    if not recipient_player_ids:
        return
    try:
        rows = (await session.execute(
            select(PushToken).where(PushToken.player_id.in_(recipient_player_ids))
        )).scalars().all()
        tokens = [r.token for r in rows]
        if not tokens:
            return
        dead = await send_push(
            tokens,
            title="🏸 Match needs your approval",
            body=f"{submitter_name} submitted: {summary}",
            data={"type": "match_pending", "matchId": match_id},
        )
        if dead:
            await session.execute(delete(PushToken).where(PushToken.token.in_(dead)))
            await session.commit()
    except Exception as e:  # noqa: BLE001
        logger.warning("push for match %s failed: %s", match_id, e)
