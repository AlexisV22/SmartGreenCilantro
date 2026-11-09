# PROMPT 1 — Build the complete SmartGreenAI: Cilantro Crop platform

> Copy everything below this line and paste it into Claude Code, from the root folder of your repository.
> Before running it, create a `docs/` folder in the repo and copy into it: `Project_2.pdf` (the project document), the Sprint 0, 1, 2, 3 and 4 folders, `US08-T1_API_Specification_SmartGreenAI.docx` and `sensors_croph_cilantro1_Oscar.ino`.

---

You are the development team of **Team 3 (UPAEP, Agile Project Management)** building **SmartGreenAI: Cilantro Crop**, an IoT precision-agriculture and AI decision-support platform for a cilantro greenhouse. Build the **complete, working product** (all sprints) in this repository. Everything must really work end-to-end: no mock screens, no "TODO" functions, no fake data in the UI except what comes from the database or the simulator.

## 0. Read first (mandatory)

1. Read `docs/Project_2.pdf` completely: functional requirements FR-01..FR-30, non-functional NFR-01..NFR-09, user roles (Agricultural User/Producer, Administrator, Super Administrator), the AI section (section 11) and the **final acceptance scenario (section 24)**.
2. Read the Scrum documents in `docs/` (use `pandoc -t plain` for .docx): Sprint 0 Product Backlog, Sprint 1 document, and the **Sprint 2, 3 and 4 Planning documents**. Every task ID (for example `US06-T3`, `US16-T4`, `US20-T3`) and its completion conditions must be satisfied by the code you write, because a second step will generate evidence for each task.
3. Read `docs/**/US08-T1_API_Specification_SmartGreenAI.docx` and respect its endpoint paths, JSON payloads, authentication headers and **standard error format** (`status`, `code`, `message`, `details`; codes `ERR_VALIDATION_FAILED`, `ERR_AUTH_REQUIRED`, `ERR_INSUFFICIENT_PERMISSIONS`, `ERR_RESOURCE_NOT_FOUND`, `ERR_INTERNAL_DATABASE`, plus `ERR_CONFLICT` for 409).
4. Read `docs/**/sensors_croph_cilantro1_Oscar.ino` and keep its identifiers: greenhouse `GH-01`, area `AREA-1`, sensors `SM-01`, `SM-02` (soil moisture) and `TMP-01` (temperature).

Then write a short implementation plan (phases below) and a todo list, and execute it phase by phase. After each phase run the tests and fix everything before continuing.

## 1. Tech stack (keep it simple so students can deploy it)

- **Backend:** Node.js 20 LTS + Express 4, `pg`, `bcryptjs`, `jsonwebtoken`, `helmet`, `cors`, `express-rate-limit`, `zod` (validation), `node-cron` (scheduled jobs), `dotenv`.
- **Database:** PostgreSQL 15 (must also run unchanged on Supabase).
- **Frontend:** static HTML + CSS + vanilla JavaScript (ES modules) served by Express from `/public`, Chart.js vendored locally in `public/vendor/` (no CDN dependency). No build step.
- **IoT:** ESP32 Arduino sketch + Node.js simulator.
- **Tests:** Jest + Supertest (API/unit), Playwright (a few end-to-end UI tests).
- **Other:** `docker-compose.yml` with PostgreSQL for local development, Postman collection, `.env.example`.

## 2. Repository structure

```
/database
   schema.sql          <- creates the COMPLETE database (the file to load on the server)
   seed.sql            <- roles, permissions, default users, greenhouse, devices, sensors, actuators, thresholds, configs
   README.md           <- how to load it with psql or the Supabase SQL editor
/server
   src/app.js, src/server.js, src/config, src/db, src/middleware (auth, rbac, errors, apiKey, audit)
   src/modules/<module>/ (routes, controller, service) for: auth, users, roles, organizations, greenhouses,
        areas, crops, devices, sensors, actuators, measurements, thresholds, alerts, anomalies, commands,
        irrigation, events, analysis, ai, recommendations, observations, logs, stats, settings, health
   src/jobs/ (alertResolver, automationEngine, anomalyJob, connectivityJob, recommendationJob)
   src/ai/ (preprocessing.js, trends.js, recommender.js, explainer.js)
   scripts/seed-history.js   <- generates 30 days of realistic history for all sensors
   scripts/acceptance-scenario.js <- runs section 24 end-to-end and prints PASS/FAIL per step
   tests/ (unit + integration)
/public  (index.html login, producer/, admin/, superadmin/, css/, js/, vendor/)
/iot
   esp32_smartgreen/esp32_smartgreen.ino
   simulator/simulator.js (+ README)
/postman  SmartGreenAI.postman_collection.json + environment
/e2e      Playwright tests
/docs     (project and Scrum documents already here) + ARCHITECTURE.md, API.md, TRACEABILITY.md, DEPLOYMENT.md
docker-compose.yml, .env.example, package.json (root scripts), README.md
```

Root `package.json` scripts: `db:up` (docker compose), `db:schema`, `db:seed`, `seed:history`, `dev`, `start`, `simulate`, `test`, `test:e2e`, `acceptance`.

## 3. Database — `database/schema.sql` (most important file)

A single idempotent PostgreSQL script (`CREATE EXTENSION IF NOT EXISTS pgcrypto;`, `CREATE TABLE IF NOT EXISTS`, drop-and-create for views) with comments on every table. All timestamps are `TIMESTAMPTZ` in UTC. Use UUID or text IDs consistent with the API spec (sensor IDs like `SM-01`, actuator IDs like `ACT-PUMP-01`). Include primary keys, foreign keys, CHECK constraints, and indexes (at least `measurements(sensor_id, recorded_at DESC)`, `alerts(status, created_at DESC)`, `actuator_events(actuator_id, created_at DESC)`).

Tables (minimum):
- `organizations` (tenants), `greenhouses`, `areas` (cultivation areas, each with `mode` MANUAL/AUTOMATIC), `crop_types` (with default parameters: temperature, humidity, soil moisture, light, CO₂, pH ranges; selecting a crop auto-configures thresholds of an area).
- `roles`, `permissions`, `role_permissions`, `users` (email, username, `password_hash` bcrypt, role, organization, `is_active`, last_login).
- `devices` (id, name, mac_address, greenhouse/area, `api_key_hash` (SHA-256, never store the plain key), `is_active`, `last_seen`, firmware), `sensors` (id, device_id, area_id, type: temperature, air_humidity, soil_moisture, light, co2, water_level, ph; unit; physical min/max; `is_active`), `actuators` (id, device_id, area_id, type: irrigation_pump, ventilation_fan, shade, lighting; `state` ON/OFF/OFFLINE, `last_update`).
- `measurements` (id, sensor_id, value, unit, `recorded_at` (device), `received_at` (server), `is_anomaly`, device status).
- `thresholds` (area or greenhouse, sensor type, min, max, unit, crop_stage, updated_by, updated_at).
- `alerts` (sensor_id, threshold_id, type LOW/HIGH/DEVICE_OFFLINE/LOW_WATER/ANOMALY, value, severity LOW/MEDIUM/HIGH, status OPEN/ACKNOWLEDGED/RESOLVED, message, created_at, acknowledged_by/at, resolved_at).
- `anomalies` (sensor_id, measurement_id, method OUT_OF_RANGE/SUDDEN_JUMP/ZSCORE/MISSING_DATA/FLATLINE, value, score, explanation, detected_at).
- `actuator_commands` (actuator_id, action ON/OFF, duration_min, source MANUAL/AUTOMATIC/AI, status PENDING/SENT/EXECUTED/FAILED/EXPIRED, requested_by, created_at, executed_at, expires_at).
- `actuator_events` (actuator_id, action, source, user_id, reason, duration_min, created_at).
- `irrigation_config` (per area: enabled, target_moisture, max_duration_min, cooldown_min, consecutive_readings, min_tank_level).
- `automation_rules` (generic FR-18 rules for fans/shade/lights, e.g. temperature > max → fan ON).
- `recommendations` (area_id, type IRRIGATE/WAIT/CHECK_SENSOR/CHECK_WATER/VENTILATE, score, confidence, recommended_duration_min, inputs JSONB, factors JSONB, explanation fields: recommendation, reason, relevant_measurements, confidence_text, status PENDING/ACCEPTED/REJECTED/EXPIRED, decided_by, decided_at, decision_comment, created_at).
- `ai_config` (weights, thresholds, schedule, optional LLM enabled flag).
- `observations` (producer crop notes per area, FR "register observations").
- `notification_settings`, `system_parameters` (global key/value), `security_settings` (session hours, password policy, login attempts), `integrations` (name, type, config JSONB, enabled).
- `audit_logs` (user activity FR-21: user, action, entity, before/after JSONB, ip, created_at) and `system_logs` (level, source, message).
- View `v_latest_measurements` (latest value per sensor) and `v_daily_summary` (daily min/avg/max per sensor, excluding anomalies).

`database/seed.sql` (idempotent, `ON CONFLICT DO NOTHING`): roles `SuperAdministrator`, `Administrator`, `Producer` with permissions; users created with `crypt('<password>', gen_salt('bf'))` (compatible with bcryptjs):
- `superadmin@smartgreen.ai` / `SuperAdmin123!`
- `admin@smartgreen.ai` / `Admin123!`
- `producer@smartgreen.ai` / `Producer123!`

Organization "SmartGreen Team 3", greenhouse `GH-01`, areas `AREA-1` and `AREA-2`, crop type Cilantro, device `dev-node-01` (ESP32) with a known development API key printed in the README (store only its hash), sensors `SM-01`, `SM-02`, `TMP-01`, `HUM-01`, `LUX-01`, `CO2-01`, `WL-01`, `PH-01`, actuators `ACT-PUMP-01`, `ACT-FAN-01`, `ACT-SHADE-01`, `ACT-LIGHT-01`.
Cilantro thresholds approved by the PO: air temperature 15–25 °C, relative humidity 50–70 %, soil moisture 60–80 %, light 10 000–40 000 lux, CO₂ 400–1 000 ppm, water tank 20–100 %, pH 6.2–6.8. Irrigation defaults: target 65 %, max 10 min, cooldown 30 min, 2 consecutive readings, min tank 20 %.

`database/README.md`: how to load it on a server (`psql "$DATABASE_URL" -f database/schema.sql && psql "$DATABASE_URL" -f database/seed.sql`), on Supabase (SQL editor, paste both files) and locally with docker.

## 4. Backend API (base path `/api`, e.g. `POST /api/measurements`)

General: JSON only, zod validation, standard error format, correct HTTP codes (400/401/403/404/409/500), `helmet`, CORS, rate limit on login, request logging to `system_logs`, every write of a user stored in `audit_logs`. Auth for users: `POST /api/auth/login` → JWT (HS256, expiration from `security_settings`, default 8 h) with role; `Authorization: Bearer`. Auth for devices: header `apikey: <key>` validated against `api_key_hash`; inactive devices → 401. Generic messages on login failure (never reveal whether the user exists).

Endpoints (implement all, with the role noted; SA = SuperAdministrator, AD = Administrator, PR = Producer):
- Auth/users: `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`; `GET/POST/PUT /users` + `PATCH /users/:id/status` (AD manages producers, SA manages everyone) (US-22, FR-04); `GET/POST/PUT /admins` (SA, US-23); `GET/POST/PUT /roles`, `PUT /roles/:id/permissions` (SA, US-24).
- Structure: `/organizations` (SA), `/greenhouses`, `/areas` (incl. `PATCH /areas/:id/mode`), `/crops` (AD).
- IoT registry (US-25): `POST /devices` (returns the plain API key **only once**), `GET /devices`, `PUT /devices/:id` (edit/deactivate, never delete), `POST /devices/:id/rotate-key`, `/sensors`, `/actuators` CRUD-without-delete.
- Measurements (US-06/07/08): `POST /measurements` (device apikey; accepts one object or an array/batch for buffered readings; validates sensor exists and is active, numeric value, valid ISO timestamp; stores `received_at`; updates `devices.last_seen`; then triggers alert evaluation and anomaly checks), `GET /sensors/:id/measurements?from&to&limit`, `GET /measurements/latest`, `POST /devices/heartbeat`.
- Thresholds (US-10): `GET /thresholds`, `PUT /thresholds/:id`, `POST /thresholds` (AD; min < max; within the sensor physical range; store updated_by/at).
- Actuators (US-14/15): `GET /actuators/status` (OFFLINE if no update in 5 min), `POST /actuators/:id/command` (PR/AD; only in MANUAL mode; max duration from config), device side `GET /devices/me/commands` (polling, marks SENT) and `POST /actuators/:id/state` (device reports, marks EXECUTED), commands expire after 60 s if not taken.
- Alerts (US-11/12/13): `GET /alerts?status&severity&sensor_id&from&to&limit&offset`, `PATCH /alerts/:id/ack`, `GET /alerts/export.csv`.
- Irrigation (US-16/17): `GET/PUT /irrigation/config/:areaId` (AD), `GET /actuators/events?actuator_id&from&to`, `GET /irrigation/daily-minutes`.
- Automation rules (FR-18): `GET/PUT /automation-rules` (AD).
- Anomalies (US-19): `GET /anomalies?sensor_id&from&to`.
- Analysis (US-18): `GET /analysis/summary?area_id&from&to` (daily min/avg/max, % time in optimal range, irrigation minutes/day) and `GET /analysis/trends?area_id&window=24h|7d` (slope, RISING/FALLING/STABLE, projected time to threshold).
- AI (US-20/21/26): `GET /recommendations?status&area_id`, `POST /recommendations/generate` (AD, force run), `POST /recommendations/:id/decision` (`ACCEPTED`/`REJECTED`, comment; second decision → 409; accepting IRRIGATE creates a command with source AI), `GET/PUT /ai/config` (AD and SA).
- Other: `GET/POST /observations`, `GET /logs/system` and `GET /logs/audit` (AD own org, SA global), `GET /stats` (counts, uptime, measurements per day), `GET/PUT /settings/global`, `GET/PUT /settings/security`, `GET/PUT /settings/notifications`, `GET/PUT /integrations` (SA), `GET /health` (public: status, DB connection, uptime, version).

## 5. Business logic (jobs and engines)

- **Alert engine (US-11):** on each stored measurement compare with the threshold of its sensor type/area; below min → LOW alert, above max → HIGH alert; only one OPEN/ACKNOWLEDGED alert per sensor and type; when the value returns to range → RESOLVED with `resolved_at`.
- **Severity (US-12):** deviation outside the threshold as % of the optimal range (max − min): LOW ≤ 10 %, MEDIUM 10–25 %, HIGH > 25 %; upgrade severity if the deviation grows while open. Configurable in `system_parameters`.
- **Automatic irrigation (US-16):** job every 30 s for areas in AUTOMATIC mode with irrigation enabled: if the average soil moisture of the area is below the minimum for N consecutive readings → create ON command (source AUTOMATIC) until target moisture or max duration, then cooldown. Safety: no irrigation during cooldown; if water tank < min → blocked + LOW_WATER alert; if the soil sensor has no data for 5 min → blocked. MANUAL mode disables the engine; never create a command while another one is PENDING/SENT.
- **Generic automation (FR-18):** fans ON when temperature > max (OFF when < max − 1 °C), shade ON when light > max, lighting ON when light < min during daytime hours — only in AUTOMATIC mode.
- **Event log (US-17):** every actuator state change calls `recordEvent(actuator, action, source, user, reason, duration)`.
- **Anomaly detection (US-19, NFR-08):** out of physical range, sudden jump (configurable per type, e.g. > 15 % soil moisture or > 5 °C between consecutive readings), z-score > 3 over last 24 h, missing data (no reading in 5 min), flatline (same value 30 min). Store in `anomalies`, set `measurements.is_anomaly`, no duplicates.
- **Connectivity (FR-11, US-27):** device OFFLINE if `last_seen` > 5 min → DEVICE_OFFLINE alert; back ONLINE → resolved.
- **AI pipeline (US-18/20/21) — explainable decision support, no black box:**
  - `preprocessing.js`: resample to 5-min buckets, drop anomalies, fill gaps ≤ 15 min by interpolation, compute features (current moisture avg of SM-01/SM-02, moisture slope, temperature, humidity, hours since last irrigation, tank level, anomaly count last hour, sensor agreement).
  - `trends.js`: linear regression slope, classification with tolerance, projected hours to reach the threshold.
  - `recommender.js`: weighted score 0–100 of irrigation need (moisture deficit, temperature above optimum, low humidity, falling trend, time since last irrigation, penalty for recent irrigation); rules → CHECK_SENSOR if soil sensors have anomalies or disagree > 15 %, CHECK_WATER if tank < min, IRRIGATE if score ≥ threshold (default 60), VENTILATE if temperature high and humidity high, else WAIT. Duration = (target − current) × factor, capped by max duration. Confidence (0–1) = data completeness × sensor agreement × (1 − anomaly ratio), shown as High/Medium/Low. Runs every 15 min and when a new alert is created; no duplicate while one is PENDING; weights and thresholds read from `ai_config`.
  - `explainer.js`: builds the 5 elements required by section 11 (Recommendation, Reason, Relevant sensor measurements, Confidence, Timestamp) in plain English from the top contributing factors, e.g. *"Irrigation should be considered for Area 1 because soil moisture (54 %) is below the configured target (65 %) and the current temperature is high (29 °C). Verify water availability before activating the irrigation system."* If `ANTHROPIC_API_KEY` is set and LLM is enabled in `ai_config`, optionally reword the text with the Claude API; always fall back to the template on error or without key.

## 6. Frontend (responsive, clear for a non-technical farmer — NFR-06)

UPAEP-like palette (primary `#9E1B32`, green accents for the crop), status shown with **color + text + icon** (never color only). Login page redirects each role to its home; route guards on every page; logout.
- **Producer:** integrated dashboard (US-09, US-27): status summary, sensor cards (value, unit, status, time, anomaly badge), historical charts per variable with period selector 24 h / 7 d / 30 d and threshold band (FR-10), alerts panel + banner with acknowledge (auto-refresh 30 s), actuator panel (pump/fan/shade/light, state, last update, OFFLINE), irrigation control with confirmation + duration + MANUAL/AUTOMATIC switch, water-tank level next to the pump, AI recommendation cards (5 elements, confidence bar with text, expandable "Why?" factors, Accept/Reject with optional reason), device connectivity. Pages: alert history (filters + CSV export), irrigation history (events + daily minutes), historical analysis (daily averages, trend arrows), recommendation history, crop observations.
- **Administrator:** manage producers; greenhouses, areas, crop types (auto-configure thresholds); devices/sensors/actuators registration (show API key once); thresholds screen (one row per variable, edit/save/cancel, validation messages); alert/severity parameters; irrigation parameters; automation rules; AI configuration; device connectivity; system logs; statistics; notification settings.
- **Super Administrator:** everything global: administrators CRUD, deactivate users, roles & permissions matrix editor, organizations/tenants, global parameters, security parameters, AI configuration, integrations, global logs, availability page (health, uptime, DB status, active devices).

## 7. IoT

- `iot/esp32_smartgreen/esp32_smartgreen.ino`: evolves Oscar's sketch to ESP32: WiFi, NTP (UTC ISO 8601 `recorded_at`), readings of SM-01/SM-02 (raw → % with calibration constants), TMP-01, optional DHT22 humidity, LDR, water level; switched power for soil sensors (keep the anti-corrosion idea); HTTPS POST to `/api/measurements` with `apikey` header every 60 s; local ring buffer (e.g. 100 readings) with retry/back-off and batch resend after reconnection (US06-T4); heartbeat; polling `GET /api/devices/me/commands` every 5 s, relay pin for the pump, auto-OFF after duration, state report; Serial logs. Config in `secrets.h.example`.
- `iot/simulator/simulator.js` (CLI): same protocol as the ESP32 (API key, payload, buffer/retry, polling commands, state report). Options: `--interval`, `--speed` (time acceleration), `--scenario normal|dry|hot|wet|spike|flatline|disconnect|low-tank|outlier|acceptance`, `--count` (e.g. send 100 readings and print success rate and average delay for US06-T5), `--offline-seconds` (to test the buffer), **closed loop**: soil moisture rises while the pump is ON and falls by evaporation depending on temperature (US16-T5), writes a CSV log for charts.
- `server/scripts/seed-history.js`: 30 days of realistic data for all sensors (day/night cycles, irrigation events, a few anomalies) so charts, z-score, analysis and AI have history.

## 8. Quality, security and tests

- Passwords only as bcrypt hashes (NFR-03); API keys only as SHA-256 hashes; JWT secret from env; no secrets in the repo; HTTPS recommended in DEPLOYMENT.md (NFR-09).
- Jest + Supertest tests for: auth (valid, invalid, expired, direct URL), RBAC matrix (every role × every endpoint group), measurements (valid, unknown sensor, inactive device, invalid value/timestamp, batch), thresholds validation, alerts (create, no duplicate, resolve, severity boundaries 9/10/11/24/25/26 %), commands (ON/OFF, expiry, mode), automatic irrigation (trigger, target, max duration, cooldown, low tank, stale sensor, manual ignored), anomalies (each method), analysis stats, recommender scenarios (dry+hot, wet, recent irrigation, low tank, sensor anomaly…), explainer (5 elements always present), decisions (accept → command AI, reject, 409). Coverage report with `jest --coverage`.
- Playwright e2e: login per role, dashboard loads < 3 s with 30 days of data (NFR-01), manual irrigation, accept recommendation.
- `server/scripts/acceptance-scenario.js`: executes the 15 steps of section 24 automatically (simulator low moisture → stored → shown → alert → AI recommendation → accept → command → event → new readings → moisture improved) and prints PASS/FAIL for every step.
- Postman collection covering every endpoint with success and error cases, runnable with `newman`.

## 9. Documentation and traceability

- `README.md`: requirements, quick start (docker DB → schema → seed → seed:history → dev → simulate), default users, dev API key, scripts, screenshots placeholders.
- `docs/ARCHITECTURE.md` (5 layers: IoT, actuation, communication, cloud/API+DB, application+AI; Mermaid diagrams), `docs/API.md`, `docs/DEPLOYMENT.md` (Render/Railway + Supabase, or a VPS with Nginx + PM2 + HTTPS), `docs/TRACEABILITY.md`: table **Task ID → files/functions/tests** for every task of Sprints 2, 3 and 4 and every FR/NFR. Add short code comments tagging the user story (e.g. `// US-16 automatic irrigation`).

## 10. Work method

1. Phase A (Sprint 1–2 scope): schema + seed, auth/RBAC, users/admins/roles, registry, measurements, thresholds, actuator status, simulator, dashboard base.
2. Phase B (Sprint 3 scope): alerts + severity + history, commands + manual irrigation, automatic irrigation + safety, event log, anomalies, closed-loop simulator.
3. Phase C (Sprint 4 scope): analysis + trends, AI pipeline + recommender + explainer, decisions, integrated dashboard, connectivity, super-admin pages.
4. Phase D: tests, e2e, Postman, acceptance script, docs.
Make a git commit per user story with the message format `US-XX: <description>` (e.g. `US-16: automatic irrigation engine with safety rules`). At the end run: schema on a clean DB, seed, seed:history, all tests, acceptance script — and fix until everything passes. Finish with a summary: how to run it, test results, and any assumption you made.
