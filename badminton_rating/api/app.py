"""
FastAPI application factory.

Tests construct an app instance with their own DB dependency override;
production runs use the module-level `app` (read at `main.py`).
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from badminton_rating.api.routes import (
    admin,
    leaderboard,
    matches,
    me,
    players,
    tournaments,
    v1_leaderboard,
    v1_matches,
    v1_players,
    webhooks,
)


def create_app() -> FastAPI:
    app = FastAPI(
        title="Badminton Rating System",
        description=(
            "Glicko-2 hybrid rating engine for casual badminton clubs. "
            "Inspired by DUPR and UBR, with original score-differential weighting."
        ),
        version="0.1.0",
    )

    # CORS — the Next.js frontend runs on a different origin in dev and in
    # most prod deploys. BRS_CORS_ORIGINS is a comma-separated allow-list;
    # defaults to localhost:3000 for the local Phase 9 wiring.
    cors_origins = [
        o.strip()
        for o in os.environ.get("BRS_CORS_ORIGINS", "http://localhost:3000").split(",")
        if o.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["meta"])
    async def health() -> dict:
        return {"status": "ok"}

    # /players/me must register BEFORE /players/{id} or FastAPI parses "me"
    # as an int path param and the v0 route swallows it with a 422.
    app.include_router(me.router)
    app.include_router(players.router)
    app.include_router(matches.router)
    app.include_router(leaderboard.router)

    # V1 — category-aware surface, validation flow, tournaments.
    app.include_router(v1_matches.router)
    app.include_router(v1_leaderboard.router)
    app.include_router(v1_players.router)
    app.include_router(tournaments.router)
    app.include_router(webhooks.router)
    app.include_router(admin.router)

    return app


app = create_app()
