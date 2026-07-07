# Badminton Rating System (BRS)

A dynamic rating system for casual recreational badminton players.
Built as a backend-focused portfolio project demonstrating algorithm design depth.

## Algorithm

Modified Glicko-2 with four original extensions:
1. **Score differential factor** (tanh-based) — explicitly weights match margin, unlike DUPR
2. **Match type weighting** — casual/club/tournament submit different rating impact
3. **Inactivity decay** — RD widens when player goes inactive
4. **Display scale mapping** — internal Glicko scale mapped to 2.0–8.0 (DUPR-style)

See `CLAUDE.md` for full algorithm documentation and design rationale.

## Stack

Python · FastAPI · PostgreSQL · SQLAlchemy (async) · Alembic · Redis · Docker

## Running locally

```bash
docker compose up
uvicorn badminton_rating.api.main:app --reload
```

## Running tests

```bash
pytest tests/test_engine.py -v
```

## Validation

The simulation script (`engine/simulator.py`) generates 200 synthetic players,
runs 5,000 matches through the algorithm, and validates that computed ratings
correlate with true skill at r > 0.85.

## License

Copyright © 2026 Andrew Xiao. All rights reserved.

This project is **source-available for portfolio and reference purposes only**
— it is not open-source. You may view the code, but not use, copy, modify,
distribute, or run it as a service without written permission. See
[`LICENSE`](./LICENSE) for details.
