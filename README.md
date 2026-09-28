# SmartGreenAI: Cilantro Crop

IoT precision-agriculture and AI decision-support platform for a cilantro greenhouse.
Team 3 · UPAEP · Agile Project Management.

ESP32 sensors send soil moisture, temperature, humidity, light, CO₂, water-tank and pH readings to a cloud
API. The platform stores every reading with its sensor ID and timestamps and raises graded alerts against the
cilantro thresholds. It detects abnormal readings, runs irrigation manually or automatically with safety
rules, and gives the producer **explainable** AI irrigation recommendations to accept or reject.

| Layer | Technology |
|---|---|
| IoT | ESP32 firmware (`iot/esp32_smartgreen`) and a Node.js simulator with the same protocol (`iot/simulator`) |
| API | Node.js 20 · Express 4 · zod · JWT (HS256) · bcrypt · device API keys (SHA-256) |
| Database | PostgreSQL 15 (runs unchanged on Supabase) — `database/schema.sql` + `database/seed.sql` |
| Web app | Static HTML + CSS + vanilla JS modules served by Express, Chart.js vendored locally (no build step) |
| AI | Explainable weighted recommender (`server/src/ai`), optional rewording with the Claude API |
| Tests | Jest + Supertest (259 tests), Playwright e2e (10), Postman/newman (138 requests), acceptance script (15 steps) |

## Requirements

- Node.js **20 or newer**
- PostgreSQL 15 — easiest with Docker Desktop (`docker compose`), or a Supabase project

## Quick start

```bash
npm install
cp .env.example .env            # adjust DATABASE_URL / JWT_SECRET if needed

npm run db:up                   # PostgreSQL 15 in docker (port 5432)
npm run db:schema               # creates the complete database
npm run db:seed                 # roles, users, greenhouse, devices, sensors, thresholds…
npm run seed:history            # 30 days of realistic readings, irrigations and anomalies

npm run dev                     # http://localhost:3000
npm run simulate                # in a second terminal: the IoT node sends readings every 60 s
```

Open <http://localhost:3000> and sign in with one of the default users.

### Default users

| Role | Email | Password | Home |
|---|---|---|---|
| Super Administrator | `superadmin@smartgreen.ai` | `SuperAdmin123!` | `/superadmin/` |
| Administrator | `admin@smartgreen.ai` | `Admin123!` | `/admin/` |
| Agricultural User (Producer) | `producer@smartgreen.ai` | `Producer123!` | `/producer/` |

Change these passwords before any real deployment.

### Development device

| Device | API key (`apikey` header) | Sensors | Actuators |
|---|---|---|---|
| `dev-node-01` (ESP32, GH-01 / AREA-1) | `sec_iot_dev_node_01_smartgreen_team3` | SM-01, SM-02, TMP-01, HUM-01, LUX-01, CO2-01, WL-01, PH-01 | ACT-PUMP-01, ACT-FAN-01, ACT-SHADE-01, ACT-LIGHT-01 |

The database stores only the SHA-256 hash of the key. New devices get their key once, from
*Administration → IoT devices → Register device*.

## Scripts

| Script | What it does |
|---|---|
| `npm run db:up` / `db:down` | start / stop the PostgreSQL container |
| `npm run db:schema` / `db:seed` / `db:reset` | load `database/schema.sql`, `database/seed.sql`, or both |
| `npm run seed:history` | 30 days of history for every AREA-1 sensor (`--days`, `--step`) |
| `npm run dev` / `npm start` | API + web app (`dev` reloads on changes) |
| `npm run simulate` | IoT simulator — see [iot/simulator/README.md](iot/simulator/README.md) for scenarios |
| `npm test` / `npm run test:coverage` | Jest unit + integration tests on an isolated `smartgreen_test` database |
| `npm run test:e2e` | Playwright end-to-end tests (needs the seed and `seed:history`) |
| `npm run acceptance` | final acceptance scenario of section 24, PASS/FAIL per step |
| `npm run postman` | run the Postman collection with newman (server must be running) |
| `npm run postman:build` | regenerate the Postman collection |

## Test results (September 28, 2026)

| Suite | Result |
|---|---|
| Jest (unit + integration) | **259 / 259 passed**, 12 suites · coverage 82 % lines, 79 % statements |
| Playwright e2e | **10 / 10 passed** · dashboard with 30 days of data renders in ~0.25 s (NFR-01 target: 3 s) |
| Postman / newman | **138 requests, 184 / 184 assertions passed**, repeatable |
| Acceptance scenario (section 24) | **15 / 15 steps PASS** |
| Simulator delivery (US06-T5) | 48 / 48 readings delivered (100 %) through a simulated 5 s outage, average round-trip 118 ms |

If Playwright cannot download its browser (no access to the Playwright CDN), point it at an installed
Chromium: `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

## Project structure

```
database/          schema.sql (complete DB), seed.sql, README.md
server/src/        app.js, server.js, config, db, middleware (auth, rbac, apiKey, audit, errors, validate)
server/src/modules/<module>/   routes + controller + service for every domain (26 modules)
server/src/jobs/   automationEngine, anomalyJob, connectivityJob, alertResolver, recommendationJob
server/src/ai/     preprocessing, trends, recommender, explainer
server/scripts/    run-sql, seed-history, acceptance-scenario, build-postman
server/tests/      unit/ and integration/ (Jest)
public/            index.html (login), producer/, admin/, superadmin/, css/, js/, vendor/ (Chart.js)
iot/               esp32_smartgreen/ (firmware), simulator/
e2e/               Playwright tests
postman/           collection + environment
docs/              project and Scrum documents, ARCHITECTURE, API, DEPLOYMENT, TRACEABILITY, TEST_PLAN, USER_MANUAL
legacy/nextjs/     the Sprint 1 Next.js login prototype (kept for reference, not used)
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the 5 layers, data flows and design decisions
- [docs/API.md](docs/API.md) — every endpoint, authentication and the error contract
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Render/Railway + Supabase, or a VPS with Nginx + PM2 + HTTPS
- [docs/TRACEABILITY.md](docs/TRACEABILITY.md) — task ID → files / functions / tests, and FR/NFR coverage
- [docs/TEST_PLAN.md](docs/TEST_PLAN.md) — test strategy, how to run each suite and the results
- [docs/USER_MANUAL.md](docs/USER_MANUAL.md) — how producers and administrators use the platform
- [database/README.md](database/README.md) — loading the database with psql, Supabase or docker

## Screenshots

Add the captures used in the Sprint Review here (`docs/screenshots/`): login, producer dashboard,
alert history, irrigation history, historical analysis, recommendation card with its explanation,
administrator thresholds, IoT registry (API key shown once), roles & permissions matrix, availability page.

## Assumptions

- One IoT node (`dev-node-01`) serves AREA-1. AREA-2 exists to show the multi-area structure (NFR-02).
- Time is stored in UTC. Daytime automation windows use `platform.timezone` (America/Mexico_City).
- A z-score outlier is recorded as an anomaly but does not invalidate the reading, because a real
  heat or drying trend is also statistically unusual. Only out-of-physical-range values and impossible jumps
  are treated as sensor faults: they are excluded from statistics, alerts, automatic irrigation and the AI.
- Soil moisture below the cilantro minimum always leads to an IRRIGATE recommendation, unless the sensors
  are unreliable, the tank is low or an irrigation just ran (cooldown). The weighted score anticipates
  irrigation before the minimum is reached.
- The Claude API only rewords the explanation text when `ANTHROPIC_API_KEY` is set and LLM is enabled in the AI
  configuration. The decision itself is always the deterministic, explainable model.
