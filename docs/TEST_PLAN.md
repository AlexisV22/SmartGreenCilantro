# Test plan — SmartGreenAI: Cilantro Crop (US28-T1)

## Objective

Show that every user story of Sprints 2–4 satisfies its acceptance conditions, that the non-functional
requirements hold, and that the final acceptance scenario (section 24 of the project document) works end to end.
The requirement → test mapping is in [TRACEABILITY.md](TRACEABILITY.md).

## Levels

| Level | Tool | Location | Database | Command |
|---|---|---|---|---|
| Unit | Jest | `server/tests/unit/` | none | `npm test` |
| Integration (API + DB) | Jest + Supertest | `server/tests/integration/` | isolated `smartgreen_test`, reloaded from `schema.sql` + `seed.sql` at the start of every run and reseeded per file | `npm test` |
| API contract | Postman / newman | `postman/` | development DB, server running | `npm run postman` |
| End to end (UI) | Playwright | `e2e/` | development DB with `seed:history` | `npm run test:e2e` |
| System / acceptance | Node script | `server/scripts/acceptance-scenario.js` | development DB | `npm run acceptance` |
| IoT transmission | simulator report | `iot/simulator/` | development DB, server running | `node iot/simulator/simulator.js --count 100 --interval 1` |

Integration tests run in band (`--runInBand`) because they share the test database. The background jobs are
disabled in tests; each suite calls the engines directly (`decide()`, `runPeriodicChecks()`, `run()`), so the
results never depend on timers.

## Coverage of the test suites

| Suite | Cases | Covers |
|---|---|---|
| `unit/severity.test.js` | 13 | US-12 deviation and boundaries 9/10/11/24/25/26 % |
| `unit/trends.test.js` | 6 | US-18 slope, direction, projection; US-20 resampling and gap interpolation |
| `unit/recommender.test.js` | 25 | US-20 rules, duration, confidence; US-21 five elements for every type |
| `integration/auth.test.js` | 17 | US-01-C login, generic errors, expired/forged tokens, direct URL, deactivation, health |
| `integration/rbac.test.js` | 92 | FR-02/03, NFR-04: 30 endpoint groups × 3 roles, organization scope |
| `integration/measurements.test.js` | 18 | US-06/07/08 ingestion, validation, batch, history, heartbeat |
| `integration/thresholds-alerts.test.js` | 16 | US-10, US-11, US-12, US-13 |
| `integration/commands.test.js` | 11 | US-14, US-15, US-17 |
| `integration/irrigation.test.js` | 17 | US-16 start/stop, safety rules, modes, FR-18 automation, time zone |
| `integration/anomalies-analysis.test.js` | 13 | US-19 each method and no duplicates; US-18 statistics |
| `integration/recommendations.test.js` | 12 | US-20 generation, US-26 decisions, AI configuration |
| `integration/registry-users.test.js` | 19 | US-25 registry and keys, US-22/23/24, FR-21 logs, settings, observations |
| `e2e/*.spec.js` | 10 | login per role, guards, logout, dashboard < 3 s, manual irrigation, accept recommendation |
| Postman | 138 requests / 184 assertions | every endpoint, success and error cases, error format |
| Acceptance | 15 steps | section 24 |

## Non-functional tests

| NFR | Test | Pass criterion | Result |
|---|---|---|---|
| NFR-01 Performance | `e2e/dashboard.spec.js` with 30 days of data (69 128 readings) | dashboard and 30-day chart < 3 s | ~0.25 s and ~0.1 s |
| NFR-03 Security | `auth.test.js`, `registry-users.test.js` | bcrypt hashes only, SHA-256 API keys | pass |
| NFR-04 Authorization | `rbac.test.js` | 403 for every forbidden role × endpoint | pass (90 cases) |
| NFR-05 Data integrity | `measurements.test.js` | recorded_at, received_at and sensor_id on every row | pass |
| NFR-08 Reliability | `anomalies-analysis.test.js`, simulator `disconnect`, `flatline` | MISSING_DATA, FLATLINE, DEVICE_OFFLINE detected | pass |
| NFR-09 IoT security | `measurements.test.js` | wrong/revoked key 401, inactive device 401 | pass |
| US06-T5 delivery | simulator `--count 6 --interval 2 --offline-seconds 5` | ≥ 95 % delivered | 100 %, 118 ms average |

## Entry and exit criteria

- **Entry**: the schema and seed load on a clean database; `npm install` has been run.
- **Exit**: all Jest, Playwright and Postman cases pass, the acceptance scenario prints 15/15 PASS, and no open
  defect of severity High remains on the board.

## Results — September 28, 2026

| Suite | Result |
|---|---|
| Jest | 259 / 259 passed · coverage: statements 79.3 %, branches 60.9 %, functions 72.4 %, lines 82.1 % |
| Playwright | 10 / 10 passed (two consecutive runs) |
| Postman / newman | 138 requests, 184 / 184 assertions (two consecutive runs) |
| Acceptance scenario | 15 / 15 PASS |

### Defects found and fixed while testing

| Defect | Fix |
|---|---|
| Login audit crashed (`req.get` lost when copying the request) | `middleware/audit.js` reads the IP from the headers; the controller passes a request prototype |
| A z-score outlier hid real drying/heat from alerts, automatic irrigation and the AI | z-score anomalies no longer set `is_anomaly`; only faults (out of range, sudden jump) do |
| Past MISSING_DATA gaps made the AI answer CHECK_SENSOR after the device reconnected | the reliability rule counts reading-level faults only; gaps lower the confidence instead |
| The AI answered WAIT with soil moisture 8 points below the cilantro minimum | below the minimum → IRRIGATE (outside cooldown); explanation cites the minimum |
| The AI used a 5-minute bucket average as the "current" soil moisture | current values are the newest reading of each probe |
| A forced AI run created a second PENDING recommendation | `force` must be explicit and it replaces (expires) the pending one |
| A second acknowledgement overwrote who acknowledged the alert | acknowledgement is idempotent and keeps the first user and time |
| Actuators of an idle but connected device were shown OFFLINE | the heartbeat reports actuator states |
| The lighting daytime window used UTC hours | `platform.timezone` (America/Mexico_City) |
| Batch ingestion did not echo alerts/anomalies per reading | batch results include `alert` and `anomalies` |
| `anomalies_excluded` counted z-score findings that are not excluded | counts the readings flagged `is_anomaly` |
| The server started in production with the default JWT secret | startup guard in `server.js` |
