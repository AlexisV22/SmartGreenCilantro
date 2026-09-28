# Database — SmartGreenAI: Cilantro Crop

Two files build the whole database:

| File | Content |
|---|---|
| `schema.sql` | The **complete** PostgreSQL 15 schema: 28 tables, 2 views, constraints, indexes and comments. Idempotent (`CREATE ... IF NOT EXISTS`, views dropped and recreated). |
| `seed.sql` | Roles and permissions, the three default users, organization, greenhouse GH-01, areas AREA-1/AREA-2, crop type Cilantro, device `dev-node-01`, its 8 sensors and 4 actuators, the thresholds approved by the Product Owner, irrigation defaults, automation rules, AI configuration and system parameters. Idempotent (`ON CONFLICT DO NOTHING`). |

All timestamps are `TIMESTAMPTZ` in UTC. Passwords are bcrypt hashes (`crypt(..., gen_salt('bf'))`,
compatible with bcryptjs); device API keys are stored only as SHA-256 hashes.

## Load it on a server (psql)

```bash
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/seed.sql
```

## Load it on Supabase

1. Supabase dashboard → **SQL editor** → New query.
2. Paste the content of `schema.sql` and run it.
3. Paste the content of `seed.sql` and run it.
4. Use the *Session pooler* connection string as `DATABASE_URL` and set `PGSSLMODE=require` in `.env`.

## Local development with Docker

```bash
npm run db:up        # postgres:15-alpine on localhost:5432 (user/password/db: smartgreen)
npm run db:schema    # same as psql -f database/schema.sql, without needing psql installed
npm run db:seed
npm run seed:history # optional: 30 days of realistic history for the charts and the AI
```

To start again from zero:

```bash
docker exec smartgreen-db psql -U smartgreen -d smartgreen -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npm run db:reset
```

The test suite never touches this database. `npm test` creates `smartgreen_test` and loads both files into it.

## Tables

| Group | Tables |
|---|---|
| Tenancy & structure | `organizations`, `greenhouses`, `areas` (mode MANUAL/AUTOMATIC), `crop_types` (default ranges) |
| Security | `roles`, `permissions`, `role_permissions`, `users`, `security_settings` |
| IoT registry | `devices` (`api_key_hash`, `last_seen`), `sensors` (physical range), `actuators` (state ON/OFF/OFFLINE) |
| Data | `measurements` (`recorded_at` from the device, `received_at` from the server, `is_anomaly`) |
| Monitoring | `thresholds`, `alerts` (LOW/HIGH/DEVICE_OFFLINE/LOW_WATER/ANOMALY, severity, status), `anomalies` (5 methods) |
| Actuation | `actuator_commands` (PENDING → SENT → EXECUTED / EXPIRED), `actuator_events`, `irrigation_config`, `automation_rules` |
| AI | `recommendations` (type, score, confidence, inputs, factors, the 5 explanation elements, decision), `ai_config` |
| Operation | `observations`, `notification_settings`, `system_parameters`, `integrations`, `audit_logs`, `system_logs` |
| Views | `v_latest_measurements` (latest value per sensor), `v_daily_summary` (daily min/avg/max, anomalies excluded) |

Main indexes: `measurements(sensor_id, recorded_at DESC)`, `alerts(status, created_at DESC)`,
`actuator_events(actuator_id, created_at DESC)`, plus unique partial indexes that guarantee one open alert per
sensor and type, and one anomaly per measurement and method.
