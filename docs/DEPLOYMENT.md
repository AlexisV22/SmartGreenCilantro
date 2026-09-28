# Deployment — SmartGreenAI: Cilantro Crop

The application is one Node.js process (API + web app + background jobs) plus a PostgreSQL 15 database.
Choose one of the two options below. Both serve everything over **HTTPS** (NFR-09).

## Environment variables

| Variable | Required | Example / default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | `postgresql://user:pass@host:5432/db` | Supabase: use the *Session pooler* string |
| `PGSSLMODE` | on managed DBs | `require` | `disable` only for local docker |
| `JWT_SECRET` | **yes in production** | 96 random hex chars | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` — the server refuses to start in production with the default |
| `NODE_ENV` | yes | `production` | |
| `PORT` | no | `3000` | set automatically by Render/Railway |
| `JOBS_ENABLED` | no | `true` | run exactly **one** instance with jobs enabled |
| `CORS_ORIGIN` | no | `https://smartgreen.example.com` | comma-separated; same-origin needs nothing |
| `ANTHROPIC_API_KEY` | no | — | enables the optional LLM rewording of explanations |
| `ANTHROPIC_MODEL` | no | `claude-opus-5` | |

Never commit `.env`. Keep secrets in the platform's secret store.

## Option A — Render (or Railway) + Supabase

1. **Database (Supabase)**: create a project → *SQL editor* → run `database/schema.sql`, then `database/seed.sql`.
   Copy the Session pooler connection string.
2. **Web service (Render)**: *New → Web Service* → connect the GitHub repository.
   - Runtime: Node 20 · Build command: `npm ci --omit=dev` · Start command: `npm start`
   - Environment: the variables above (`PGSSLMODE=require`).
   - Health check path: `/api/health`.
   Railway works the same way: *New project → Deploy from repo*, add the variables, set the start command to `npm start`.
3. Render/Railway terminate TLS: the app is served at `https://<service>.onrender.com`.
4. Optional demo data: run `npm run seed:history` once from your computer with `DATABASE_URL` pointing at Supabase.
5. **Change the default passwords** (Super Administrator → Administrators / Users) and create the real devices,
   whose API keys are shown once.

> Free tiers sleep when idle. The firmware buffers readings and resends them when the service wakes up
> (US06-T4). For a permanent demo, use a paid instance or option B.

## Option B — Ubuntu VPS with Nginx + PM2 + Let's Encrypt

```bash
# 1. System packages
sudo apt update && sudo apt install -y nginx postgresql-15 certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm install -g pm2

# 2. Database
sudo -u postgres psql -c "CREATE USER smartgreen WITH PASSWORD 'change-me';"
sudo -u postgres psql -c "CREATE DATABASE smartgreen OWNER smartgreen;"
git clone <repo> /opt/smartgreen && cd /opt/smartgreen
npm ci --omit=dev
cp .env.example .env    # set DATABASE_URL, JWT_SECRET, NODE_ENV=production
psql "postgresql://smartgreen:change-me@localhost/smartgreen" -f database/schema.sql
psql "postgresql://smartgreen:change-me@localhost/smartgreen" -f database/seed.sql

# 3. Process manager (restarts on crash and on reboot)
pm2 start server/src/server.js --name smartgreen
pm2 save && pm2 startup
```

`/etc/nginx/sites-available/smartgreen`:

```nginx
server {
    server_name smartgreen.example.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/smartgreen /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d smartgreen.example.com     # HTTPS + automatic renewal
```

The app trusts the first proxy (`trust proxy = 1`), so rate limiting and the audit log see the real client IP.

## IoT devices in production

1. *Administration → IoT devices → Register device*: copy the API key shown once.
2. In `iot/esp32_smartgreen/secrets.h`, set `API_BASE_URL "https://smartgreen.example.com/api"`, the key and the
   WiFi credentials. For HTTPS validation, define `API_ROOT_CA` with the root certificate of your domain
   (ISRG Root X1 for Let's Encrypt).
3. Flash the ESP32 (board *ESP32 Dev Module*, libraries ArduinoJson 7 and DHT sensor library).
4. The device appears as **Online** on *Overview & connectivity* after its first heartbeat.

## Operations checklist

- [ ] `JWT_SECRET` is long and random; the default passwords were changed
- [ ] `GET /api/health` answers `status: ok` and `database.connected: true`
- [ ] exactly one instance runs with `JOBS_ENABLED=true`
- [ ] database backups: Supabase daily backups, or `pg_dump` in a cron job on the VPS
- [ ] HTTPS certificate renews automatically (Render/Railway, or certbot's timer)
- [ ] `npm run acceptance` passes against a staging copy of the database before a release
