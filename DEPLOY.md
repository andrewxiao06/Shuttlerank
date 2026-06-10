# Deploying BRS to production

Target shape (per `CLAUDE.md` / `RUNNING.md`):

| Piece | Where |
|---|---|
| FastAPI + Postgres + Redis + Caddy (TLS) | EC2, via `docker-compose.prod.yml` |
| Next.js frontend | Vercel |
| Auth | Clerk (dev instance for now) |

Status legend: ⬜ not started · 🚧 in progress · ✅ done

---

## 0. Prerequisites

- An AWS account and an SSH keypair.
- The GitHub repo for this project (private). You'll `git clone` it on the box.
- (Later) a domain name. **Everything except the final TLS step works without
  one** — you can smoke-test over the EC2 public IP first.

---

## 1. Provision the EC2 box

1. Launch an instance: **t3.small** (2 GB RAM — Postgres + Redis + API + Caddy
   fit; t3.micro's 1 GB is tight), Ubuntu 24.04 LTS, 20 GB gp3 disk.
2. **Security group** inbound rules:
   - `22/tcp` from **your IP only** (SSH)
   - `80/tcp` from anywhere (HTTP + ACME challenge)
   - `443/tcp` from anywhere (HTTPS)
   - Do **not** open 5432 or 6379 — Postgres/Redis stay on the internal
     compose network.
3. SSH in: `ssh -i your-key.pem ubuntu@<public-ip>`

## 2. Install Docker

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker ubuntu && newgrp docker   # run docker without sudo
docker compose version                            # sanity check
```

## 3. Clone + configure

```bash
git clone <YOUR_REPO_URL> dubr && cd dubr
cp .env.prod.example .env.prod
nano .env.prod                 # fill in EVERY value — see notes below
```

`.env.prod` checklist:
- `POSTGRES_PASSWORD` — generate a long random string (`openssl rand -hex 24`).
- `API_DOMAIN` — `api.yourdomain.com` once you have a domain (step 6). Leave the
  placeholder for now if testing over IP.
- `CLERK_ISSUER` — `https://organic-grizzly-1.clerk.accounts.dev` (dev instance).
- `CLERK_WEBHOOK_SECRET` — from Clerk dashboard (step 7).
- `BRS_ADMIN_USER_IDS` — your Clerk user id (already pre-filled with Andrew's).
- `BRS_CORS_ORIGINS` — your Vercel URL(s) (step 5).
- `CLERK_DEV_ALLOW_HEADER` must stay **absent**. It is an impersonation bypass.

## 4. Bring it up

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml logs -f api    # watch migrations run
```

The api entrypoint waits for Postgres, runs `alembic upgrade head`, then starts
uvicorn. **Verify:**

```bash
# Before a domain (uncomment the :80 block in deploy/Caddyfile first):
curl http://<public-ip>/health        # -> {"status":"ok"}
# After a domain + TLS:
curl https://api.yourdomain.com/health
```

If migrations fail, the api container exits — `docker compose ... logs api`
shows the alembic error. Fix `DATABASE_URL` / credentials in `.env.prod` and
re-up.

## 5. Frontend on Vercel

1. Import the GitHub repo in Vercel; set **Root Directory** to `frontend/`.
2. Project env vars (Settings → Environment Variables):
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = your `pk_...`
   - `CLERK_SECRET_KEY` = your `sk_...`
   - `NEXT_PUBLIC_API_BASE_URL` = `https://api.yourdomain.com` (or the EC2
     `http://<ip>` while testing)
   - `NEXT_PUBLIC_USE_MOCKS` = `0`
3. Deploy. Note the resulting Vercel URL — put it in `.env.prod`'s
   `BRS_CORS_ORIGINS` **and** `CLERK_AUTHORIZED_PARTIES`, then re-up the API
   (step 4) so CORS + azp accept the real frontend origin.

## 6. Domain + TLS (when you have a domain) ⬜

1. Buy a domain (Cloudflare Registrar / Namecheap).
2. DNS records:
   - `A  api.yourdomain.com  -> <EC2 public IP>`
   - Frontend apex/`www` → Vercel (Vercel shows the exact records).
3. Set `API_DOMAIN=api.yourdomain.com` in `.env.prod`, ensure the `:80`
   fallback in `deploy/Caddyfile` is commented out, and re-up. Caddy auto-issues
   the Let's Encrypt cert on first request (needs 80/443 open + DNS resolving).

## 7. Clerk webhook (so signups create Player rows) ⬜

1. Clerk dashboard → Webhooks → add endpoint:
   `https://api.yourdomain.com/webhooks/clerk`
2. Subscribe to `user.created` and `user.deleted`.
3. Copy the signing secret → `CLERK_WEBHOOK_SECRET` in `.env.prod` → re-up.
4. There's also a JIT-bootstrap safety net (`PlayerAutoBootstrap` on the
   frontend), so signups still get a Player row even before the webhook is set.

## 8. Operations

```bash
# Update to latest code:
git pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# Backups (do this before you have real users to lose):
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U brs brs | gzip > backup-$(date +%F).sql.gz

# Tear down (KEEPS data — pgdata + caddy certs are named volumes):
docker compose -f docker-compose.prod.yml down
# Wipe everything including the database:
docker compose -f docker-compose.prod.yml down -v
```

## Production checklist (from PLAN.md Phase 2.6)

- [x] Real Clerk JWT verification (`api/auth._verify_clerk_jwt`) — shipped + e2e
      verified against the live Clerk instance.
- [ ] `CLERK_WEBHOOK_SECRET` set (step 7).
- [ ] `BRS_ADMIN_USER_IDS` set (step 3).
- [ ] `CLERK_ISSUER` set, `CLERK_DEV_ALLOW_HEADER` absent (step 3).
- [ ] Postgres backups scheduled (step 8) — or move to RDS later.
- [ ] `NEXT_PUBLIC_API_BASE_URL` pointed at the real API in Vercel (step 5).
