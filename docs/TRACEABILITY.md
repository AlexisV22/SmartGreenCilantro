# Traceability matrix — SmartGreenAI: Cilantro Crop

Where every task of Sprints 2, 3 and 4 and every functional (FR) and non-functional (NFR) requirement is
implemented and verified. Paths are relative to the repository root. Test files live in `server/tests/`
(Jest), `e2e/` (Playwright) and `postman/` (newman). The acceptance script is `server/scripts/acceptance-scenario.js`.

Abbreviations: **svc** = `server/src/modules/<m>/service.js`, **rt** = `…/routes.js`, **ctl** = `…/controller.js`.

## Sprint 2 (September 21 – October 9, 2026)

### US-01-C — Complete secure login and role-based access

| Task | Implementation | Verification |
|---|---|---|
| US01C-T1 Connect the login form to the authentication service | `public/index.html`, `public/js/pages/login.js`, `public/js/api.js` (token storage); auth svc `login()` (bcryptjs compare, JWT HS256 with expiry from `security_settings`); `database/seed.sql` users with `crypt(..., gen_salt('bf'))` | `integration/auth.test.js` (login per role, bcrypt hashes, expires_in); `e2e/login.spec.js` |
| US01C-T2 Implement RBAC and redirection | `server/src/middleware/auth.js` (`requireAuth`), `middleware/rbac.js` (`requirePermission`, `organizationScope`); `public/js/layout.js` (`boot({ roles })` route guard, `HOME` per role); roles/permissions in `seed.sql` | `integration/rbac.test.js`; `e2e/login.spec.js` (redirect per role, producer → admin page denied) |
| US01C-T3 Build and run the permission matrix test | `integration/rbac.test.js` `MATRIX` (30 endpoint groups × 3 roles = 90 cases) | `npm test` output (all pass) |
| US01C-T4 Test invalid credentials and unauthorized access | generic 401 in auth svc; `middleware/auth.js` (expired / forged token); login rate limit in auth rt | `integration/auth.test.js` (wrong password, unknown user, empty fields, expired token, forged token, direct URL, deactivated account); `e2e/login.spec.js` |

### US-06 — Transmit IoT measurements to the cloud

| Task | Implementation | Verification |
|---|---|---|
| US06-T1 Design the IoT-to-cloud data flow and message format | `docs/ARCHITECTURE.md` (sections 1–3, diagrams); payload in `docs/API.md` → Measurements | review of the documents |
| US06-T2 Configure the cloud service and device authentication | `middleware/apiKey.js` (`requireDeviceKey`, SHA-256 `hashApiKey`); `devices.api_key_hash`; `docs/DEPLOYMENT.md` | `integration/measurements.test.js` (missing/wrong key 401, inactive device 401, hash stored) |
| US06-T3 Implement measurement sending from the device (or simulator) | `iot/esp32_smartgreen/esp32_smartgreen.ino` (`readSensors`, `flushBuffer`); `iot/simulator/simulator.js` (`readSensors`, `sendReadings`) | simulator run log; `postman/` folder 05 |
| US06-T4 Handle connection failures | firmware ring buffer `pushReading` + back-off in `flushBuffer`; simulator `pushBuffer` / `--offline-seconds`; batch ingestion `storeBatch()` in measurements svc | `node iot/simulator/simulator.js --count 6 --interval 2 --offline-seconds 5` (24 buffered readings resent in one batch); `integration/measurements.test.js` › batch |
| US06-T5 End-to-end transmission test | simulator `--count` delivery report (success rate, average delay) | report: 48/48 delivered, 100 %, 118 ms average; acceptance step 2 |

### US-07 — Store measurements with sensor IDs and timestamps

| Task | Implementation | Verification |
|---|---|---|
| US07-T1 Design the measurement data model | `database/schema.sql` → `measurements` (sensor_id FK, value, unit, recorded_at, received_at, is_anomaly) | `database/README.md` |
| US07-T2 Create the database schema | `database/schema.sql` (28 tables, indexes, views), `server/scripts/run-sql.js` | `npm run db:schema`; `server/tests/globalSetup.js` loads it for every test run |
| US07-T3 Implement the storage service | measurements svc `store()`, `validateReading()` | `integration/measurements.test.js` (stored with recorded_at/received_at, last_seen) |
| US07-T4 Implement history queries | measurements svc `history()`, `latest()`; `GET /sensors/:id/measurements`, `GET /measurements/latest` | `integration/measurements.test.js` › history and latest |
| US07-T5 Test storage and retrieval | — | `integration/measurements.test.js`; `server/scripts/seed-history.js` (69 128 readings) |

### US-08 — Provide APIs for IoT devices and web application

| Task | Implementation | Verification |
|---|---|---|
| US08-T1 Write the API specification | `docs/scrum/Sprint 2/US08-T1_API_Specification_SmartGreenAI.docx`, implemented in `docs/API.md` | — |
| US08-T2 Set up the API project and security layer | `server/src/app.js` (helmet CSP, CORS, JSON), `config/index.js`, `middleware/*`, `modules/index.js` | `integration/auth.test.js` › health and 404 |
| US08-T3 Implement measurement endpoints | measurements rt/ctl (`ingest`, `historyBySensor`, `latest`), devices rt (`/heartbeat`, `/me/commands`) | `integration/measurements.test.js` |
| US08-T4 Implement web application endpoints | the 26 modules under `server/src/modules/` | `integration/*.test.js`; Postman folders 01–10 |
| US08-T5 Standardize validation and error responses | `middleware/validate.js` (zod → details[]), `middleware/errors.js` (`status, code, message, details`) | `integration/auth.test.js` (keys of the error body), Postman "standard error format" assertion on every error case |
| US08-T6 API test collection | `postman/SmartGreenAI.postman_collection.json` (138 requests), generator `server/scripts/build-postman.js` | `npm run postman`: 184/184 assertions |

### US-10 — Configure sensor thresholds

| Task | Implementation | Verification |
|---|---|---|
| US10-T1 Define the threshold data model and default values | `schema.sql` → `thresholds`; cilantro values in `seed.sql` (15–25 °C, 50–70 %, 60–80 %, 10 000–40 000 lux, 400–1 000 ppm, 20–100 %, pH 6.2–6.8) | `integration/thresholds-alerts.test.js` › list |
| US10-T2 Design the threshold configuration screen | `public/admin/thresholds.html`, `public/js/pages/thresholds.js` | screenshot |
| US10-T3 Implement create/update logic with validation | thresholds svc `validateRange()` (min < max, inside the physical range), `update()` (updated_by/at + audit) | `integration/thresholds-alerts.test.js` (4 invalid cases, audit before/after) |
| US10-T4 Connect the screen to the API | `thresholds.js` → `PUT /thresholds/:id` with inline error messages | manual test / screenshot |
| US10-T5 Test threshold configuration | — | `integration/thresholds-alerts.test.js`; Postman folder 06 |

### US-14 — View actuator status

| Task | Implementation | Verification |
|---|---|---|
| US14-T1 Define actuator states and data | `schema.sql` → `actuators.state` ON/OFF/OFFLINE, `last_update` | — |
| US14-T2 Implement the current-status query | actuators svc `status()`, `applyOfflineRule()` (5 min, `actuator.offline_minutes`); heartbeat actuator refresh in devices svc `heartbeat()` | `integration/commands.test.js` › US-14 |
| US14-T3 Build the actuator status panel | `public/js/pages/producer-dashboard.js` → `renderActuators()` (icon + state badge + last change) | `e2e/dashboard.spec.js` |
| US14-T4 Test actuator status visualization | — | `integration/commands.test.js`; `integration/measurements.test.js` › heartbeat |

### US-25 — Register IoT devices, sensors and actuators

| Task | Implementation | Verification |
|---|---|---|
| US25-T1 Define the device registry model | `schema.sql` → `devices`, `sensors`, `actuators` | — |
| US25-T2 Design the registration screens | `public/admin/devices.html`, `public/js/pages/devices.js`, `public/js/crud.js` | screenshot |
| US25-T3 Implement register, edit and deactivate | devices / sensors / actuators svc `create()`, `update()` (no DELETE route) | `integration/registry-users.test.js` › US-25 |
| US25-T4 Generate device credentials | `middleware/apiKey.js` `generateApiKey()`, `hashApiKey()`; devices svc `create()`, `rotateKey()` (key returned once) | `integration/registry-users.test.js` (hash = SHA-256, key not returned again, rotation revokes) |
| US25-T5 Test the registration flow | — | `integration/registry-users.test.js`; Postman folder 04 |

### Sprint 2 — sprint-level tasks

| Task | Implementation | Verification |
|---|---|---|
| SPR-T1 End-to-end integration test | simulator → API → DB → dashboard | `npm run acceptance` steps 1–4; `e2e/dashboard.spec.js` |
| SPR-T2 Sprint Review preparation and evidence compilation | `docs/scrum/Sprint 2/`, this matrix | — |

## Sprint 3 (October 12 – October 30, 2026)

### US-11 — Receive threshold alerts

| Task | Implementation | Verification |
|---|---|---|
| US11-T1 Design the alert engine and alert data model | `schema.sql` → `alerts` (+ unique index: one open alert per sensor and type); `docs/ARCHITECTURE.md` ingestion diagram | — |
| US11-T2 Implement alert evaluation on measurement ingestion | alerts svc `evaluateMeasurement()`, `raiseAlert()`, `resolveAlerts()`; called from measurements svc `store()`; `jobs/alertResolver.js` | `integration/thresholds-alerts.test.js` › US-11 (create, no duplicate, resolve) |
| US11-T3 Show active alerts to the producer | `producer-dashboard.js` → `renderBanner()`, `renderAlerts()` (auto-refresh 30 s, acknowledge) | `e2e/dashboard.spec.js` (alerts panel) |
| US11-T4 Test alert generation | — | `integration/thresholds-alerts.test.js`; acceptance steps 5–6 |

### US-12 — Classify alerts by severity

| Task | Implementation | Verification |
|---|---|---|
| US12-T1 Define severity classification rules | deviation % of the optimal range, LOW ≤ 10 %, MEDIUM ≤ 25 %, HIGH > 25 % (`severity.*` in `system_parameters`) | `public/admin/alert-settings.html` explanation |
| US12-T2 Implement severity classification and display | alerts svc `deviationPercent()`, `classifySeverity()`, upgrade while open; `ui.js` `severityBadge()` (colour + icon + text) | `integration/thresholds-alerts.test.js` (LOW → MEDIUM upgrade) |
| US12-T3 Test severity classification | — | `unit/severity.test.js` (boundaries 9/10/11/24/25/26 %) |

### US-13 — View alert history

| Task | Implementation | Verification |
|---|---|---|
| US13-T1 Implement the alert history endpoint | alerts svc `list()`, `acknowledge()` (idempotent), ctl `exportCsv` | `integration/thresholds-alerts.test.js` › US-13 |
| US13-T2 Build the alert history screen | `public/producer/alerts.html`, `public/js/pages/alerts.js` (filters, pagination, CSV) | screenshot |
| US13-T3 Test alert history | — | `integration/thresholds-alerts.test.js`; Postman folder 07 |

### US-15 — Manually activate or deactivate irrigation

| Task | Implementation | Verification |
|---|---|---|
| US15-T1 Design the actuator command flow | `docs/ARCHITECTURE.md` actuation sequence diagram; `schema.sql` → `actuator_commands` | — |
| US15-T2 Implement the actuator command endpoint | commands svc `createCommand()` (MANUAL mode only, max duration, one in flight), actuators rt `POST /:id/command` | `integration/commands.test.js` |
| US15-T3 Execute commands on the device or simulator | commands svc `collectForDevice()`, `reportState()`, `expireStale()`; firmware `pollCommands()`, `setPump()`, `reportState()`; simulator `pollCommands()` | `integration/commands.test.js` (PENDING → SENT → EXECUTED, expiry) |
| US15-T4 Build irrigation control and mode selector | `producer-dashboard.js` → `renderActuators()`, `changeMode()`, `sendCommand()` (confirmation + duration) | `e2e/irrigation.spec.js` |
| US15-T5 Test manual irrigation | — | `integration/commands.test.js`; `e2e/irrigation.spec.js`; Postman folder 08 |

### US-16 — Automatic irrigation according to predefined conditions

| Task | Implementation | Verification |
|---|---|---|
| US16-T1 Define automatic irrigation rules | `schema.sql` → `irrigation_config`; defaults in `seed.sql` (target 65 %, max 10 min, cooldown 30 min, 2 readings, tank 20 %) | — |
| US16-T2 Build the irrigation parameters screen | `public/admin/automation.html`, `public/js/pages/automation.js` | screenshot |
| US16-T3 Implement the automatic irrigation engine | irrigation svc `decide()`, `apply()`; `jobs/automationEngine.js` (every 30 s); automation svc `evaluateArea()` (FR-18) | `integration/irrigation.test.js` › start/stop conditions, scheduled engine |
| US16-T4 Implement irrigation safety conditions | `decide()`: cooldown, tank < minimum → `BLOCK_LOW_WATER` + LOW_WATER alert, stale sensor > 5 min, fault readings excluded, MANUAL mode, command in flight | `integration/irrigation.test.js` › US16-T4 safety rules |
| US16-T5 Run the closed-loop irrigation simulation | simulator `step()` physics (pump +1.1 %/min, evaporation by temperature/humidity), `--speed`, `--csv` | `node iot/simulator/simulator.js --scenario dry --speed 60 --interval 5 --csv loop.csv` |
| US16-T6 Test automatic irrigation | — | `integration/irrigation.test.js` (17 cases); acceptance step 11 |

### US-17 — Record actuator activation events

| Task | Implementation | Verification |
|---|---|---|
| US17-T1 Implement the actuator event log | events svc `recordEvent()` (single entry point for MANUAL, AUTOMATIC, AI, SYSTEM), `list()`, `dailyIrrigationMinutes()` | `integration/commands.test.js` (event with user and duration) |
| US17-T2 Build the irrigation history screen | `public/producer/irrigation.html`, `public/js/pages/irrigation-history.js` (events + minutes/day chart) | screenshot |
| US17-T3 Test event recording | — | `integration/commands.test.js`; acceptance step 12 |

### US-19 — Identify unusual environmental measurements

| Task | Implementation | Verification |
|---|---|---|
| US19-T1 Define anomaly detection methods | OUT_OF_RANGE, SUDDEN_JUMP (`anomaly.jump.*`), ZSCORE > 3 over 24 h, MISSING_DATA 5 min, FLATLINE 30 min (`system_parameters`) | `docs/ARCHITECTURE.md` |
| US19-T2 Implement the anomaly detection service | anomalies svc `checkMeasurement()`, `runPeriodicChecks()`, `record()` (no duplicates); `jobs/anomalyJob.js` | `integration/anomalies-analysis.test.js` › US-19 |
| US19-T3 Display anomalies to the producer | dashboard anomaly badge and red ✖ markers on the chart (`charts.js` scatter series); `GET /anomalies` | `e2e/dashboard.spec.js` |
| US19-T4 Test anomaly detection | — | `integration/anomalies-analysis.test.js` (each method + no duplicates); simulator scenarios `spike`, `outlier`, `flatline`, `disconnect` |

### Sprint 3 — sprint-level tasks

| Task | Implementation | Verification |
|---|---|---|
| SPR-T1 End-to-end integration test | alert → command → event chain | `npm run acceptance` steps 5–6, 10–14 |
| SPR-T2 Sprint Review preparation and evidence compilation | `docs/scrum/Sprint 3/` | — |

## Sprint 4 (November 2 – November 20, 2026)

### US-18 — Analyze historical sensor information

| Task | Implementation | Verification |
|---|---|---|
| US18-T1 Define historical analysis metrics | daily min/avg/max, % time in optimal range, irrigation minutes/day, trend slope | `docs/API.md` → Analysis |
| US18-T2 Implement the historical aggregation service | analysis svc `summary()`; view `v_daily_summary` | `integration/anomalies-analysis.test.js` › US-18 |
| US18-T3 Implement trend identification | `server/src/ai/trends.js` (`linearSlopePerHour`, `classify`, `hoursToThreshold`, `analyse`); analysis svc `trendReport()` | `unit/trends.test.js` |
| US18-T4 Build the historical analysis view | `public/producer/analysis.html`, `public/js/pages/analysis.js` | screenshot |
| US18-T5 Test historical analysis | — | `unit/trends.test.js`; `integration/anomalies-analysis.test.js` |

### US-20 — AI irrigation recommendation

| Task | Implementation | Verification |
|---|---|---|
| US20-T1 Design the recommendation model | `docs/ARCHITECTURE.md` → AI pipeline; `schema.sql` → `recommendations`, `ai_config` | — |
| US20-T2 Build the data preprocessing pipeline | `server/src/ai/preprocessing.js` (`resample`, `completeness`, `buildFeatures`) | `unit/trends.test.js` › preprocessing |
| US20-T3 Implement the recommendation engine | `server/src/ai/recommender.js` `recommend()`; recommendations svc `generateForArea()`, `generateAll()`; `jobs/recommendationJob.js` (15 min + after a new alert) | `unit/recommender.test.js`; `integration/recommendations.test.js` |
| US20-T4 Calculate duration and configure AI parameters | duration = deficit × `duration_factor`, capped; `PUT /ai/config`; `public/admin/ai.html` | `unit/recommender.test.js` (duration, cap, weights from config) |
| US20-T5 Deliver recommendations to the producer | `GET /recommendations`; dashboard `renderRecs()`; `public/producer/recommendations.html` | `integration/recommendations.test.js`; acceptance step 9 |
| US20-T6 Validate recommendations with scenarios | — | `unit/recommender.test.js` (dry+hot, below minimum, wet, cooldown, low tank, sensor anomaly, disagreement, ventilate); acceptance steps 7–8 |

### US-21 — Explainable AI recommendation

| Task | Implementation | Verification |
|---|---|---|
| US21-T1 Define the explanation structure | the 5 elements of section 11: `recommendation`, `reason`, `relevant_measurements`, `confidence_text`, timestamp (`created_at`) + `factors` | — |
| US21-T2 Implement the natural-language explanation generator | `server/src/ai/explainer.js` (`headlineFor`, `buildReason`, `buildRelevantMeasurements`, `confidenceText`, optional `rewordWithClaude` with template fallback) | `unit/recommender.test.js` › US-21 |
| US21-T3 Show the explanation in the recommendation card | `public/js/recs.js` `recommendationCard()` (5 elements, confidence bar with text, expandable "Why?") | `e2e/recommendation.spec.js` |
| US21-T4 Test explanation readability and consistency | — | `unit/recommender.test.js` (5 elements for every type, plain-English reason with the measured values) |

### US-26 — Accept or reject AI recommendations

| Task | Implementation | Verification |
|---|---|---|
| US26-T1 Implement the recommendation decision endpoint | recommendations svc `decide()` (409 on a second decision, IRRIGATE → command with source AI, audit) | `integration/recommendations.test.js` › US-26 |
| US26-T2 Add accept/reject actions to the dashboard | `recs.js` → Accept / Reject with optional comment | `e2e/recommendation.spec.js` |
| US26-T3 Test the decision flow | — | `integration/recommendations.test.js`; acceptance step 10; Postman folder 09 |

### US-27 — Integrated monitoring dashboard

| Task | Implementation | Verification |
|---|---|---|
| US27-T1 Design the integrated dashboard layout | `public/producer/index.html`, `public/css/app.css` | screenshot |
| US27-T2 Integrate sensor cards and historical graphs | `producer-dashboard.js` `renderSensors()`, `loadChart()` (24 h / 7 d / 30 d, threshold band); `public/js/charts.js` | `e2e/dashboard.spec.js` |
| US27-T3 Integrate alerts, actuators and recommendations panels | `renderBanner()`, `renderAlerts()`, `renderActuators()`, `renderRecs()` | `e2e/dashboard.spec.js`, `e2e/recommendation.spec.js` |
| US27-T4 Add device connectivity indicator | `renderDevices()`; `jobs/connectivityJob.js`; devices svc `withConnectivity()` | dashboard + `public/admin/index.html` |
| US27-T5 Check dashboard performance and usability | downsampling (`charts.js` `downsample`), colour + text + icon badges | `e2e/dashboard.spec.js`: ~0.25 s with 30 days (target 3 s) |
| US27-T6 Test the integrated dashboard | — | `e2e/*.spec.js` (10 tests) |

### US-28 — Execute system tests

| Task | Implementation | Verification |
|---|---|---|
| US28-T1 Write the test plan and traceability matrix | `docs/TEST_PLAN.md`, this document | — |
| US28-T2 Build the automated test suite | `server/tests/` (Jest + Supertest, isolated DB), `e2e/`, `postman/` | `npm test`, `npm run test:e2e`, `npm run postman` |
| US28-T3 Execute functional tests | — | 259 Jest tests, 138 Postman requests |
| US28-T4 Execute non-functional tests | NFR-01 timing, NFR-03 hashes, NFR-04 matrix, NFR-08 anomalies | `e2e/dashboard.spec.js`, `integration/auth.test.js`, `integration/rbac.test.js`, `integration/anomalies-analysis.test.js`; coverage report |
| US28-T5 Run the final acceptance scenario | `server/scripts/acceptance-scenario.js` | `npm run acceptance`: 15/15 PASS |

### Sprint 4 — sprint-level tasks

| Task | Implementation | Verification |
|---|---|---|
| SPR-T1 Final demonstration rehearsal and Sprint Review | `npm run acceptance` + `npm run simulate -- --scenario acceptance` | — |
| SPR-T2 User manual | `docs/USER_MANUAL.md` | — |
| SPR-T3 Technical documentation | `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEPLOYMENT.md`, `database/README.md` | — |
| SPR-T4 Final presentation and evidence compilation | `docs/scrum/Sprint 4/` | — |

## Functional requirements

| FR | Requirement | Implementation | Tests |
|---|---|---|---|
| FR-01 | Authenticate with username/email and password | auth svc `login()`, `login.js` | `auth.test.js`, `e2e/login.spec.js` |
| FR-02 | Permissions according to the role | `rbac.js`, `role_permissions`, roles svc | `rbac.test.js` |
| FR-03 | Prevent unauthorized access | `requireAuth`, `requirePermission`, `layout.js` guard | `rbac.test.js`, `auth.test.js`, `e2e/login.spec.js` |
| FR-04 | Activate/deactivate users | users svc `setStatus()`, `PATCH /users/:id/status` | `registry-users.test.js`, `auth.test.js` |
| FR-05 | Receive measurements from IoT devices | `POST /measurements`, firmware, simulator | `measurements.test.js` |
| FR-06 | Identify each sensor uniquely | `sensors.id` PK (SM-01…), validation in `validateReading()` | `measurements.test.js` (unknown sensor) |
| FR-07 | Associate each sensor with an area | `sensors.area_id` FK | `registry-users.test.js` |
| FR-08 | Store measurements in the cloud | measurements svc `store()` | `measurements.test.js` |
| FR-09 | Display current measurements | `GET /measurements/latest`, sensor cards | `measurements.test.js`, `e2e/dashboard.spec.js` |
| FR-10 | Display historical measurements | `GET /sensors/:id/measurements`, chart with threshold band | `measurements.test.js`, `e2e/dashboard.spec.js` |
| FR-11 | Indicate disconnected devices | `connectivityJob`, `devices.connectivity`, DEVICE_OFFLINE alert | `measurements.test.js` (last_seen), dashboard |
| FR-12 | Compare measurements against thresholds | alerts svc `evaluateMeasurement()` | `thresholds-alerts.test.js` |
| FR-13 | Generate alerts | `raiseAlert()` | `thresholds-alerts.test.js`, acceptance 5–6 |
| FR-14 | Classify alerts by severity | `classifySeverity()` | `unit/severity.test.js` |
| FR-15 | Alert history | `GET /alerts`, `alerts.html`, CSV | `thresholds-alerts.test.js` |
| FR-16 | Monitor actuator status | actuators svc `status()` | `commands.test.js` |
| FR-17 | Manual activation by authorized users | `POST /actuators/:id/command` | `commands.test.js`, `e2e/irrigation.spec.js` |
| FR-18 | Automatic activation by rules | irrigation svc `decide()`, automation svc `evaluateArea()` | `irrigation.test.js` |
| FR-19 | Record actuator activation events | events svc `recordEvent()` | `commands.test.js` |
| FR-20 | Store historical sensor data | `measurements` + `seed-history.js` | `anomalies-analysis.test.js` |
| FR-21 | Store user activity | `middleware/audit.js`, `audit_logs`, `GET /logs/audit` | `auth.test.js`, `registry-users.test.js` |
| FR-22 | Store alerts | `alerts` table | `thresholds-alerts.test.js` |
| FR-23 | Store actuator events | `actuator_events` | `commands.test.js` |
| FR-24 | APIs for IoT devices and the web app | `server/src/modules/*`, `docs/API.md` | all integration tests, Postman |
| FR-25 | Analyze historical data | analysis svc `summary()` | `anomalies-analysis.test.js` |
| FR-26 | Identify trends | `ai/trends.js` | `unit/trends.test.js` |
| FR-27 | Identify abnormal measurements | anomalies svc | `anomalies-analysis.test.js` |
| FR-28 | Generate recommendations | `ai/recommender.js`, recommendations svc | `unit/recommender.test.js`, `recommendations.test.js` |
| FR-29 | Explain each recommendation | `ai/explainer.js`, `recs.js` | `unit/recommender.test.js`, `e2e/recommendation.spec.js` |
| FR-30 | Consider multiple variables | features: soil moisture, slope, temperature, humidity, hours since irrigation, tank, sensor agreement, anomalies | `unit/recommender.test.js` |

## Non-functional requirements

| NFR | Requirement | How it is met | Evidence |
|---|---|---|---|
| NFR-01 | Dashboard responds in ≈ 3 s | indexes `measurements(sensor_id, recorded_at DESC)`, parallel requests, chart downsampling; slow requests (> 3 s) logged as WARN | `e2e/dashboard.spec.js` (~0.25 s with 30 days) |
| NFR-02 | Scalability | organizations → greenhouses → areas → devices/sensors are rows; per-area thresholds and configs | `rbac.test.js` › organization scope, `registry-users.test.js` |
| NFR-03 | Passwords never in plain text | bcrypt (`crypt`/bcryptjs), API keys SHA-256, JWT secret from env, production guard in `server.js` | `auth.test.js` (bcrypt hashes), `registry-users.test.js` (key hash) |
| NFR-04 | Only authorized functionality | permission guard on every route + organization scope + page guards | `rbac.test.js` (90 cases) |
| NFR-05 | Timestamps and sensor IDs for all measurements | `recorded_at` + `received_at` NOT NULL, `sensor_id` FK, UTC | `measurements.test.js` |
| NFR-06 | Usability for non-technical users | plain-language texts, colour + text + icon badges, confirmation dialogs, responsive layout | `e2e/dashboard.spec.js`, `docs/USER_MANUAL.md` |
| NFR-07 | Maintainability | 5 layers in separate folders, routes/controller/service per module, pure decision functions | `docs/ARCHITECTURE.md` |
| NFR-08 | Detect missing or abnormal data | 5 anomaly methods, DEVICE_OFFLINE, stale-sensor irrigation block | `anomalies-analysis.test.js`, `irrigation.test.js` |
| NFR-09 | Authenticated, encrypted IoT communication | per-device API key, HTTPS (Render/Railway/Nginx + Let's Encrypt), optional CA pinning in firmware | `measurements.test.js`, `docs/DEPLOYMENT.md` |
