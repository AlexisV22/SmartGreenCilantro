# API reference — SmartGreenAI: Cilantro Crop

Base URL: `http://localhost:3000/api` in development, `https://<your-domain>/api` in production.
All bodies are JSON and all timestamps are ISO-8601 in UTC. This document implements
`docs/scrum/Sprint 2/US08-T1_API_Specification_SmartGreenAI.docx`. The Postman collection in
`postman/` has a request for every endpoint below, with its success and error cases.

## Authentication

| Caller | Header | Obtained from |
|---|---|---|
| User | `Authorization: Bearer <access_token>` | `POST /auth/login` (JWT HS256, expires after `security_settings.session_hours`, default 8 h) |
| IoT device | `apikey: <device key>` | shown once by `POST /devices` or `POST /devices/:id/rotate-key` (stored as SHA-256) |

Roles: **SA** = SuperAdministrator, **AD** = Administrator, **PR** = Producer (Agricultural User). Access is
checked per permission (editable in *Roles & permissions*). The table below shows the default assignment.
Administrators only see data of their own organization.

## Error contract

```json
{ "status": 400, "code": "ERR_VALIDATION_FAILED", "message": "The request data is invalid.",
  "details": [ { "field": "value", "issue": "Expected number, received string" } ] }
```

| HTTP | code | When |
|---|---|---|
| 400 | `ERR_VALIDATION_FAILED` | body/query fails validation, business rule violated (min ≥ max, AUTOMATIC mode…) |
| 401 | `ERR_AUTH_REQUIRED` | missing/invalid/expired token, wrong credentials (generic message), bad or revoked API key |
| 403 | `ERR_INSUFFICIENT_PERMISSIONS` | the role lacks the permission; deactivated account |
| 404 | `ERR_RESOURCE_NOT_FOUND` | unknown id or route |
| 409 | `ERR_CONFLICT` | duplicate id/email, command already in flight, recommendation already decided |
| 429 | `ERR_RATE_LIMITED` | more than 20 login attempts in 15 minutes from one IP |
| 500 | `ERR_INTERNAL_DATABASE` | unexpected server or database error (details are logged, never returned) |

## Endpoints

### Health & authentication

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/health` | public | `{ status, version, uptime_seconds, database: { connected }, devices }` |
| POST | `/auth/login` | public | `{ email, password }` (email or username) → `{ access_token, token_type, expires_in, user }` |
| GET | `/auth/me` | any user | user, role and permission codes |
| POST | `/auth/logout` | any user | audited; the client discards the token |

### Users, administrators, roles, organizations (US-22, US-23, US-24)

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/users?role=` | AD, SA | AD sees its organization |
| GET / PUT | `/users/:id` | AD, SA | AD may only manage producers |
| POST | `/users` | AD, SA | `{ email, username, full_name?, password, role, organization_id? }`; password policy from security settings |
| PATCH | `/users/:id/status` | AD, SA | `{ is_active }` — accounts are deactivated, never deleted (FR-04) |
| GET / POST / PUT | `/admins`, `/admins/:id` | SA | administrator accounts |
| GET | `/roles`, `/roles/:id`, `/roles/permissions` | AD (read), SA | roles with their permission codes |
| POST / PUT | `/roles`, `/roles/:id` | SA | `{ name, description, permissions? }` |
| PUT | `/roles/:id/permissions` | SA | `{ permissions: [codes] }` — unknown codes → 400 |
| GET / POST / PUT | `/organizations`, `/organizations/:id` | AD (read), SA | tenants |

### Structure

| Method | Path | Who | Notes |
|---|---|---|---|
| GET / POST / PUT | `/greenhouses`, `/greenhouses/:id` | read: all · write: AD, SA | `{ id, name, location?, is_active? }` |
| GET / POST / PUT | `/areas`, `/areas/:id` | read: all · write: AD, SA | `{ id, greenhouse_id, name, crop_type_id?, crop_stage?, mode? }`; assigning a crop configures the thresholds |
| PATCH | `/areas/:id/mode` | PR, AD, SA | `{ mode: "MANUAL" \| "AUTOMATIC" }` |
| GET / POST / PUT | `/crops`, `/crops/:id` | read: all · write: AD, SA | crop types with default ranges (`temperature_min/max`, `soil_moisture_min/max`, …) |
| POST | `/crops/:id/apply` | AD, SA | `{ area_id }` → replaces the area thresholds with the crop ranges |

### IoT registry (US-25)

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/devices`, `/devices/:id` | all users | includes `connectivity` ONLINE/OFFLINE (FR-11), never the key or its hash |
| POST | `/devices` | AD, SA | `{ id?, name, mac_address?, location?, greenhouse_id?, area_id?, firmware? }` → **`api_key` returned once** |
| PUT | `/devices/:id` | AD, SA | edit or `{ is_active: false }` (never deleted) |
| POST | `/devices/:id/rotate-key` | AD, SA | new key; the previous one stops working |
| GET / POST / PUT | `/sensors`, `/sensors/:id` | read: all · write: AD, SA | `{ id, device_id, area_id, name, type, unit, physical_min, physical_max }` |
| GET / POST / PUT | `/actuators`, `/actuators/:id` | read: all · write: AD, SA | `{ id, device_id, area_id, name, type }` |

Sensor types: `temperature`, `air_humidity`, `soil_moisture`, `light`, `co2`, `water_level`, `ph`.
Actuator types: `irrigation_pump`, `ventilation_fan`, `shade`, `lighting`.

### Measurements (US-06, US-07, US-08)

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/measurements` | device (apikey) or user | one reading or an **array** (buffered batch, max 500) |
| GET | `/measurements/latest?area_id=` | all users | latest value per sensor + threshold |
| GET | `/sensors/:id/measurements?from&to&limit&include_anomalies` | all users | history, newest first |
| POST | `/devices/heartbeat` | device | `{ firmware?, actuators?: [{ id, state }] }` |

```json
POST /api/measurements          apikey: sec_iot_dev_node_01_smartgreen_team3
{ "device_id": "dev-node-01", "sensor_id": "SM-01", "value": 54.2, "unit": "%", "recorded_at": "2026-10-01T15:04:00Z" }

201 { "id": "msr-3f2a…", "sensor_id": "SM-01", "status": "processed", "inserted_at": "…",
      "alert": { "id": "alr-…", "type": "LOW", "severity": "MEDIUM", "created": true },
      "anomalies": [] }
```

`device_id` is optional (the API key already identifies the node); when present it must be the device of the
sensor and of the API key, otherwise the reading is rejected with 400. Rejected readings are written to the
system log. A batch answers `201 { status, received, accepted, rejected, results[], errors[] }`. Each row is validated
on its own, so one bad row never discards the buffer.

### Thresholds (US-10)

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/thresholds?area_id&sensor_type`, `/thresholds/:id` | all users | |
| POST | `/thresholds` | AD, SA | `{ area_id \| greenhouse_id, sensor_type, min_value, max_value, unit, crop_stage? }` |
| PUT | `/thresholds/:id` | AD, SA | `{ min_value?, max_value? }` — min < max, inside the sensor physical range; stores `updated_by/at` |

### Alerts & anomalies (US-11, US-12, US-13, US-19)

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/alerts?status&severity&type&sensor_id&area_id&from&to&limit&offset` | all users | `{ total, limit, offset, count, data[] }` |
| PATCH | `/alerts/:id/ack` | PR, AD, SA | ACKNOWLEDGED with who/when; idempotent (keeps the first acknowledger) |
| GET | `/alerts/export.csv?…same filters` | all users | `text/csv` |
| GET | `/anomalies?sensor_id&area_id&method&from&to&limit&offset` | all users | methods OUT_OF_RANGE, SUDDEN_JUMP, ZSCORE, MISSING_DATA, FLATLINE |

Severity = deviation outside the threshold as a percentage of (max − min): up to 10 % LOW, up to 25 % MEDIUM,
above that HIGH. Both limits are configurable (`severity.low_max_pct`, `severity.medium_max_pct`).

#### Alert API and alert rules in detail (US11-T9)

**Alert rules.** Every stored measurement is evaluated against the threshold of its sensor type in its area
(the greenhouse threshold is the fallback):

| Situation | Result |
|---|---|
| value < `min_value` | alert `type: "LOW"`, `status: "OPEN"` |
| value > `max_value` | alert `type: "HIGH"`, `status: "OPEN"` |
| value equal to `min_value` or `max_value` | inside the range: no alert (limits are inclusive) |
| an OPEN or ACKNOWLEDGED alert already exists for the sensor and type | no new alert: the same one is refreshed (value, deviation) and its severity is upgraded if the deviation grew; it is never downgraded |
| the value returns inside the range | the open alert becomes `RESOLVED` with `resolved_at` |
| the value crosses from below the minimum to above the maximum (or back) | the old alert is resolved and one of the other type is opened |
| light below its minimum outside daylight hours (`light.day_start_hour`–`light.day_end_hour`, `platform.timezone`) | no alert: darkness at night is normal |
| the reading is a sensor fault (anomaly `OUT_OF_RANGE` or `SUDDEN_JUMP`) | no threshold alert: the value is not trustworthy |

Other alert types are raised by the engines with the same de-duplication: `DEVICE_OFFLINE` (no contact for
`device.offline_minutes`), `LOW_WATER` (irrigation blocked by the tank level) and `ANOMALY`.
Life cycle: `OPEN → ACKNOWLEDGED → RESOLVED` (or `OPEN → RESOLVED` directly).

**`GET /api/alerts`** — permission `alerts.read` (all roles). Query parameters, all optional:

| Parameter | Type | Meaning |
|---|---|---|
| `status` | `OPEN` \| `ACKNOWLEDGED` \| `RESOLVED` | filter by state |
| `severity` | `LOW` \| `MEDIUM` \| `HIGH` | filter by severity |
| `type` | `LOW` \| `HIGH` \| `DEVICE_OFFLINE` \| `LOW_WATER` \| `ANOMALY` | filter by type |
| `sensor_id`, `area_id` | text | filter by sensor or area |
| `from`, `to` | ISO-8601 with offset | `created_at` range (inclusive) |
| `limit` (1–1000, default 100), `offset` (≥ 0) | integer | pagination |

```json
200 { "total": 23, "limit": 100, "offset": 0, "count": 23,
      "data": [ { "id": "alr-…", "sensor_id": "SM-01", "sensor_name": "Soil moisture 1", "area_id": "AREA-1",
                  "type": "LOW", "severity": "MEDIUM", "status": "OPEN", "value": 57, "deviation_pct": 15,
                  "min_value": 60, "max_value": 80, "sensor_unit": "%",
                  "message": "The soil moisture in AREA-1 is 57 %, below the configured minimum of 60 %.",
                  "created_at": "…", "acknowledged_by_email": null, "acknowledged_at": null, "resolved_at": null } ] }
```

Newest first. Errors: `400 ERR_VALIDATION_FAILED` (unknown status/severity/type, malformed date, limit out of range),
`401 ERR_AUTH_REQUIRED` (no or expired token), `403 ERR_INSUFFICIENT_PERMISSIONS`.

**`PATCH /api/alerts/:id/ack`** — permission `alerts.ack` (Producer, Administrator, Super Administrator). No body.
Answers `200` with the alert, now `ACKNOWLEDGED`, `acknowledged_by` and `acknowledged_at`. Acknowledging an
alert that is already acknowledged answers `200` and keeps the first person and time (idempotent).
Errors: `400 ERR_VALIDATION_FAILED` (the alert is already `RESOLVED`), `404 ERR_RESOURCE_NOT_FOUND`
(unknown id), `401`, `403`.

**`GET /api/alerts/export.csv`** — same parameters and permission as the list; answers `text/csv` with one row per
alert (used by the alert history screen, US-13).

The alert of a reading is also returned by `POST /api/measurements` (`alert: { id, type, severity, created }`),
so the device and the simulator can log it. Producer guide: `docs/USER_MANUAL.md`, section 3.4 *Alerts*.

### Actuators, commands, irrigation, automation (US-14, US-15, US-16, US-17, FR-18)

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/actuators/status?area_id=` | all users | state ON/OFF, or OFFLINE after 5 min without a report |
| POST | `/actuators/:id/command` | PR, AD, SA | `{ action: "ON"\|"OFF", duration_min?, reason? }`; only in MANUAL mode; ≤ max duration; 409 if one is in flight |
| GET | `/actuators/:id/commands` | all users | command history (PENDING/SENT/EXECUTED/FAILED/EXPIRED) |
| GET | `/devices/me/commands` | device | collects PENDING commands (they become SENT) |
| POST | `/actuators/:id/state` | device | `{ state, duration_min? }` → command EXECUTED + event |
| GET | `/actuators/events?actuator_id&area_id&source&from&to&limit&offset` | all users | activation history (US-17) |
| GET / PUT | `/irrigation/config/:areaId` | read: all · write: AD, SA | `enabled, target_moisture, max_duration_min, cooldown_min, consecutive_readings, min_tank_level` |
| GET | `/irrigation/status/:areaId` | all users | current decision of the automatic engine (dry run) |
| GET | `/irrigation/daily-minutes?area_id&days` | all users | minutes of irrigation per day |
| GET / POST / PUT | `/automation-rules`, `/automation-rules/:id` | AD, SA | fan / shade / lighting rules with hysteresis and hour windows |

#### Actuator command API and polling protocol (US15-T10)

The greenhouse never accepts inbound connections: the server queues commands and the device (ESP32 firmware or
simulator) **polls** for them, executes them and **acknowledges** them by reporting the new state. Manual control
(US-15), the automatic irrigation engine (US-16, source `AUTOMATIC`), the automation rules (FR-18) and accepted AI
recommendations (US-26, source `AI`) all use this same flow.

```
 web / engine                    API (actuator_commands)                   device (every 5 s)
 POST /actuators/:id/command ──► PENDING  (expires_at = now + 60 s)
                                   │        GET /devices/me/commands ◄──── poll
                                   ├──────► SENT (sent_at) ──────────────► execute relay / servo
                                   │        POST /actuators/:id/state ◄─── { state, duration_min }
                                   └──────► EXECUTED (executed_at) + actuator_events row (US-17)
 not collected/confirmed before expires_at ──► EXPIRED (never delivered again)
```

**1. Queue a command — `POST /api/actuators/:id/command`** (user token, permission `actuators.command`:
Producer, Administrator, Super Administrator).

```json
{ "action": "ON", "duration_min": 3, "reason": "Soil looks dry" }      // action ON | OFF; duration and reason optional

201 { "id": "cmd-…", "actuator_id": "ACT-PUMP-01", "action": "ON", "duration_min": 3, "source": "MANUAL",
      "status": "PENDING", "requested_by": "usr-producer", "reason": "Soil looks dry",
      "created_at": "…", "expires_at": "…(+60 s)", "sent_at": null, "executed_at": null }
```

| Error | When |
|---|---|
| `400 ERR_VALIDATION_FAILED` | unknown action; `duration_min` ≤ 0 or above the area's `max_duration_min` (default 10); the area is in **AUTOMATIC** mode; the actuator is deactivated |
| `401 ERR_AUTH_REQUIRED` | no token, expired token, or a device API key instead of a user token |
| `403 ERR_INSUFFICIENT_PERMISSIONS` | the role does not have `actuators.command` |
| `404 ERR_RESOURCE_NOT_FOUND` | unknown actuator |
| `409 ERR_CONFLICT` | another command for the same actuator is still `PENDING` or `SENT` |

**2. Poll — `GET /api/devices/me/commands`** (header `apikey`). Expired commands are closed first; every
`PENDING` command of the device's actuators is returned **once** and becomes `SENT`.

```json
200 { "device_id": "dev-node-01", "server_time": "…", "count": 1,
      "commands": [ { "id": "cmd-…", "actuator_id": "ACT-PUMP-01", "action": "ON", "duration_min": 3,
                      "source": "MANUAL", "created_at": "…", "expires_at": "…" } ] }
```

**3. Acknowledge — `POST /api/actuators/:id/state`** (header `apikey`, only for actuators of that device).

```json
{ "state": "ON", "duration_min": 3 }        // state ON | OFF; duration_min ≥ 0 optional

200 { "actuator_id": "ACT-PUMP-01", "state": "ON", "last_update": "…", "command_id": "cmd-…" }
```

The most recent `PENDING`/`SENT` command with the same action becomes `EXECUTED` and an event is appended with the
source and user of the command. A state change without a command (for example the duration timer ending on the
device) is recorded with source `SYSTEM` and `command_id: null`. Errors: `400` (invalid state or duration),
`401` (missing/invalid API key or a user token), `404` (unknown actuator or one of another device).

**Command states**

| State | Meaning | Next |
|---|---|---|
| `PENDING` | queued, waiting for the device | `SENT`, `EXPIRED` |
| `SENT` | handed to the device by a poll | `EXECUTED`, `EXPIRED` |
| `EXECUTED` | the device reported the new state | final |
| `EXPIRED` | not collected or not confirmed before `expires_at` (device offline) | final |
| `FAILED` | reserved for a device that reports it could not execute | final |

**Timing and timeouts**

| Value | Default | Where |
|---|---|---|
| Polling interval of the device | 5 s | `POLL_INTERVAL_MS` in the firmware, `--poll` in the simulator |
| Command expiry | 60 s after creation | `system_parameters` `command.expiry_seconds` |
| Expiry check | on every poll and every minute | `commands.expireStale()` in the poll and the `alertResolver` job |
| Actuator shown OFFLINE | 5 min without a state report or heartbeat | `actuator.offline_minutes` |
| Maximum irrigation per command | 10 min | `irrigation_config.max_duration_min` of the area |
| Automatic engine cycle | every 30 s | `automationEngine` job |

A command sent to an offline device therefore expires after 60 s: the command history
(`GET /actuators/:id/commands`) shows it as `EXPIRED` and, after 5 minutes without reports, the actuator panel shows
the actuator as **OFFLINE**, so the user knows it was not executed. Safety on the device: the pump is always switched off when `duration_min` elapses, even if the server
cannot be reached.

### Analysis and AI (US-18, US-20, US-21, US-26)

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/analysis/summary?area_id&from&to` | all users | daily min/avg/max per variable, % time in optimal range, irrigation minutes/day |
| GET | `/analysis/trends?area_id&window=24h\|7d` | all users | slope per hour, RISING/FALLING/STABLE, hours to threshold |
| GET | `/recommendations?status&area_id&limit&offset`, `/recommendations/:id` | all users | with the 5 explanation elements, factors and inputs |
| POST | `/recommendations/generate` | AD, SA | `{ area_id?, force? }` — `force` replaces the pending recommendation of the area |
| POST | `/recommendations/:id/decision` | PR, AD, SA | `{ decision: "ACCEPTED"\|"REJECTED", comment? }`; accepting IRRIGATE creates a command with source `AI`; second decision → 409 |
| GET / PUT | `/ai/config` | AD, SA | weights, thresholds, schedule, `llm_enabled`, `llm_model` |

### Operation (FR-21, settings)

| Method | Path | Who | Notes |
|---|---|---|---|
| GET / POST | `/observations?area_id` | read: all · write: PR, AD, SA | producer crop notes `{ area_id, note }` |
| GET | `/logs/system?level&source&from&to` | AD (own org), SA | system log |
| GET | `/logs/audit?user_id&entity&action&from&to` | AD (own org), SA | user activity with before/after snapshots |
| GET | `/stats` | AD, SA | counts, measurements per day, alerts by severity, uptime |
| GET / PUT | `/settings/global` | AD, SA | `{ parameters: { key: value } }` — unknown keys → 400 |
| GET / PUT | `/settings/security` | AD, SA | session hours, password policy, login attempts |
| GET / PUT | `/settings/notifications` | AD, SA | dashboard/email notifications, minimum severity |
| GET / POST / PUT | `/integrations`, `/integrations/:id` | SA | `{ name, type, config, enabled }` |
