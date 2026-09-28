-- ===========================================================================
--  SmartGreenAI: Cilantro Crop — COMPLETE DATABASE SCHEMA
--  Team 3 — UPAEP, Agile Project Management
--
--  This single idempotent script creates the whole database. It is the file
--  to load on the server:
--      psql "$DATABASE_URL" -f database/schema.sql
--      psql "$DATABASE_URL" -f database/seed.sql
--  It runs unchanged on local PostgreSQL 15 and on Supabase (SQL editor).
--
--  Conventions
--    * Every timestamp is TIMESTAMPTZ and stored in UTC (NFR-05).
--    * Domain entities keep the human-readable identifiers used by the IoT
--      firmware and the API specification (GH-01, AREA-1, SM-01, ACT-PUMP-01,
--      dev-node-01); transactional rows get a generated prefixed id.
--    * Records are deactivated, never deleted (US-25).
--  Traceability: US-07 (data model), US-25 (registry), US-11/12/13 (alerts),
--                US-15/16/17 (actuators), US-19 (anomalies), US-20/21/26 (AI).
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. TENANTS AND PHYSICAL STRUCTURE
-- ---------------------------------------------------------------------------

-- Greenhouse organizations / tenants managed by the Super Administrator.
CREATE TABLE IF NOT EXISTS organizations (
    id          TEXT PRIMARY KEY,
    name        TEXT        NOT NULL UNIQUE,
    contact_email TEXT,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE organizations IS 'Tenants of the platform. A Super Administrator manages all of them; an Administrator only sees its own.';

-- Physical greenhouses. The firmware identifies its greenhouse as GH-01.
CREATE TABLE IF NOT EXISTS greenhouses (
    id              TEXT PRIMARY KEY,
    organization_id TEXT        NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    name            TEXT        NOT NULL,
    location        TEXT,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE greenhouses IS 'Greenhouses belonging to an organization (FR-07).';

-- Crop catalogue. Selecting a crop auto-configures the thresholds of an area.
CREATE TABLE IF NOT EXISTS crop_types (
    id                    TEXT PRIMARY KEY,
    name                  TEXT        NOT NULL UNIQUE,
    description           TEXT,
    -- Default agronomic ranges applied when the crop is assigned to an area.
    temperature_min       NUMERIC(10,3),
    temperature_max       NUMERIC(10,3),
    air_humidity_min      NUMERIC(10,3),
    air_humidity_max      NUMERIC(10,3),
    soil_moisture_min     NUMERIC(10,3),
    soil_moisture_max     NUMERIC(10,3),
    light_min             NUMERIC(10,3),
    light_max             NUMERIC(10,3),
    co2_min               NUMERIC(10,3),
    co2_max               NUMERIC(10,3),
    ph_min                NUMERIC(10,3),
    ph_max                NUMERIC(10,3),
    water_level_min       NUMERIC(10,3),
    water_level_max       NUMERIC(10,3),
    default_crop_stage    TEXT        NOT NULL DEFAULT 'vegetative',
    is_active             BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE crop_types IS 'Crop catalogue with default parameter ranges; assigning a crop to an area auto-configures its thresholds (Administrator functionality).';

-- Cultivation areas inside a greenhouse. The operating mode drives the
-- automation engines: only AUTOMATIC areas are evaluated by the jobs (US-16).
CREATE TABLE IF NOT EXISTS areas (
    id            TEXT PRIMARY KEY,
    greenhouse_id TEXT        NOT NULL REFERENCES greenhouses(id) ON DELETE RESTRICT,
    name          TEXT        NOT NULL,
    crop_type_id  TEXT        REFERENCES crop_types(id) ON DELETE SET NULL,
    crop_stage    TEXT        NOT NULL DEFAULT 'vegetative',
    mode          TEXT        NOT NULL DEFAULT 'MANUAL'
                              CHECK (mode IN ('MANUAL', 'AUTOMATIC')),
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE areas IS 'Cultivation areas (FR-07). "mode" selects manual or automatic operation for the actuator engines (US-15, US-16).';
CREATE INDEX IF NOT EXISTS idx_areas_greenhouse ON areas (greenhouse_id);

-- ---------------------------------------------------------------------------
-- 2. ACCESS, ROLES AND SECURITY  (FR-01..FR-04, NFR-03, NFR-04)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
    id          TEXT PRIMARY KEY,
    name        TEXT        NOT NULL UNIQUE,
    description TEXT,
    is_system   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE roles IS 'Application roles: SuperAdministrator, Administrator, Producer (US-24).';

CREATE TABLE IF NOT EXISTS permissions (
    id          TEXT PRIMARY KEY,
    code        TEXT        NOT NULL UNIQUE,
    description TEXT,
    category    TEXT
);
COMMENT ON TABLE permissions IS 'Atomic permission codes (e.g. thresholds.write) used by the RBAC middleware.';

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id       TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);
COMMENT ON TABLE role_permissions IS 'Role x permission matrix editable by the Super Administrator (US-24).';

CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY DEFAULT ('usr-' || encode(gen_random_bytes(6), 'hex')),
    organization_id TEXT        REFERENCES organizations(id) ON DELETE RESTRICT,
    email           TEXT        NOT NULL UNIQUE,
    username        TEXT        NOT NULL UNIQUE,
    full_name       TEXT,
    -- bcrypt hash only; plain passwords are never stored (NFR-03).
    password_hash   TEXT        NOT NULL,
    role_id         TEXT        NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    last_login      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE users IS 'Platform users. Passwords are bcrypt hashes (NFR-03); accounts are deactivated, not deleted (FR-04).';
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role_id);
CREATE INDEX IF NOT EXISTS idx_users_org  ON users (organization_id);

-- ---------------------------------------------------------------------------
-- 3. IoT REGISTRY: DEVICES, SENSORS AND ACTUATORS  (US-25, FR-05, FR-06)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS devices (
    id              TEXT PRIMARY KEY,
    organization_id TEXT        REFERENCES organizations(id) ON DELETE RESTRICT,
    greenhouse_id   TEXT        REFERENCES greenhouses(id) ON DELETE SET NULL,
    area_id         TEXT        REFERENCES areas(id) ON DELETE SET NULL,
    name            TEXT        NOT NULL,
    mac_address     TEXT        UNIQUE,
    location        TEXT,
    -- SHA-256 of the API key. The plain key is shown once, at registration,
    -- and is never stored (NFR-09, US25-T4).
    api_key_hash    TEXT        NOT NULL,
    firmware        TEXT,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    last_seen       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE devices IS 'Registered IoT nodes. Only active devices may ingest measurements; last_seen drives the ONLINE/OFFLINE indicator (FR-11, US27-T4).';
CREATE INDEX IF NOT EXISTS idx_devices_apikey    ON devices (api_key_hash);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices (last_seen DESC);

CREATE TABLE IF NOT EXISTS sensors (
    id           TEXT PRIMARY KEY,
    device_id    TEXT        NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
    area_id      TEXT        NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
    name         TEXT        NOT NULL,
    type         TEXT        NOT NULL CHECK (type IN (
                     'temperature', 'air_humidity', 'soil_moisture',
                     'light', 'co2', 'water_level', 'ph')),
    unit         TEXT        NOT NULL,
    -- Physical measuring range of the hardware; readings outside it are
    -- flagged as OUT_OF_RANGE anomalies (US-19) and bound threshold edits.
    physical_min NUMERIC(10,3) NOT NULL,
    physical_max NUMERIC(10,3) NOT NULL,
    is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_sensor_physical_range CHECK (physical_min < physical_max)
);
COMMENT ON TABLE sensors IS 'Uniquely identified sensors linked to a device and an area (FR-06, FR-07). Keeps the firmware ids SM-01, SM-02, TMP-01.';
CREATE INDEX IF NOT EXISTS idx_sensors_area   ON sensors (area_id);
CREATE INDEX IF NOT EXISTS idx_sensors_device ON sensors (device_id);
CREATE INDEX IF NOT EXISTS idx_sensors_type   ON sensors (type);

CREATE TABLE IF NOT EXISTS actuators (
    id          TEXT PRIMARY KEY,
    device_id   TEXT        NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
    area_id     TEXT        NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
    name        TEXT        NOT NULL,
    type        TEXT        NOT NULL CHECK (type IN (
                    'irrigation_pump', 'ventilation_fan', 'shade', 'lighting')),
    state       TEXT        NOT NULL DEFAULT 'OFF'
                            CHECK (state IN ('ON', 'OFF', 'OFFLINE')),
    last_update TIMESTAMPTZ,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE actuators IS 'Controllable equipment (US-14). An actuator with no update in the configured window is reported as OFFLINE.';
CREATE INDEX IF NOT EXISTS idx_actuators_area   ON actuators (area_id);
CREATE INDEX IF NOT EXISTS idx_actuators_device ON actuators (device_id);

-- ---------------------------------------------------------------------------
-- 4. MEASUREMENTS  (US-06, US-07, FR-08, FR-20, NFR-05)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS measurements (
    id            TEXT PRIMARY KEY DEFAULT ('msr-' || encode(gen_random_bytes(6), 'hex')),
    sensor_id     TEXT        NOT NULL REFERENCES sensors(id) ON DELETE RESTRICT,
    value         NUMERIC(12,3) NOT NULL,
    unit          TEXT        NOT NULL,
    -- recorded_at: instant measured by the device (UTC, from NTP).
    -- received_at: instant the server stored it. Both are kept (US07-T1).
    recorded_at   TIMESTAMPTZ NOT NULL,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    device_status TEXT        NOT NULL DEFAULT 'OK',
    is_anomaly    BOOLEAN     NOT NULL DEFAULT FALSE
);
COMMENT ON TABLE measurements IS 'Historical sensor readings. Anomalous rows stay stored but are flagged so the analysis and AI pipelines can exclude them (US-19, US-18, US-20).';
-- Required by every history query and by the dashboard charts (NFR-01).
CREATE INDEX IF NOT EXISTS idx_measurements_sensor_time ON measurements (sensor_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_measurements_received    ON measurements (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_measurements_anomaly     ON measurements (is_anomaly) WHERE is_anomaly;

-- ---------------------------------------------------------------------------
-- 5. THRESHOLDS  (US-10, FR-12)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS thresholds (
    id            TEXT PRIMARY KEY DEFAULT ('th-' || encode(gen_random_bytes(5), 'hex')),
    area_id       TEXT        REFERENCES areas(id) ON DELETE CASCADE,
    greenhouse_id TEXT        REFERENCES greenhouses(id) ON DELETE CASCADE,
    sensor_type   TEXT        NOT NULL CHECK (sensor_type IN (
                      'temperature', 'air_humidity', 'soil_moisture',
                      'light', 'co2', 'water_level', 'ph')),
    min_value     NUMERIC(10,3) NOT NULL,
    max_value     NUMERIC(10,3) NOT NULL,
    unit          TEXT        NOT NULL,
    crop_stage    TEXT        NOT NULL DEFAULT 'vegetative',
    updated_by    TEXT        REFERENCES users(id) ON DELETE SET NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_threshold_min_max CHECK (min_value < max_value),
    -- A threshold belongs either to one area or to a whole greenhouse.
    CONSTRAINT chk_threshold_scope   CHECK (area_id IS NOT NULL OR greenhouse_id IS NOT NULL)
);
COMMENT ON TABLE thresholds IS 'Optimal ranges per sensor type and crop stage (US-10). Area thresholds take precedence over greenhouse ones.';
CREATE UNIQUE INDEX IF NOT EXISTS uq_threshold_area
    ON thresholds (area_id, sensor_type, crop_stage) WHERE area_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_threshold_greenhouse
    ON thresholds (greenhouse_id, sensor_type, crop_stage) WHERE area_id IS NULL;

-- ---------------------------------------------------------------------------
-- 6. ALERTS AND ANOMALIES  (US-11, US-12, US-13, US-19)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alerts (
    id              TEXT PRIMARY KEY DEFAULT ('alr-' || encode(gen_random_bytes(6), 'hex')),
    sensor_id       TEXT        REFERENCES sensors(id) ON DELETE CASCADE,
    device_id       TEXT        REFERENCES devices(id) ON DELETE CASCADE,
    area_id         TEXT        REFERENCES areas(id) ON DELETE CASCADE,
    threshold_id    TEXT        REFERENCES thresholds(id) ON DELETE SET NULL,
    type            TEXT        NOT NULL CHECK (type IN (
                        'LOW', 'HIGH', 'DEVICE_OFFLINE', 'LOW_WATER', 'ANOMALY')),
    value           NUMERIC(12,3),
    severity        TEXT        NOT NULL DEFAULT 'LOW'
                                CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
    status          TEXT        NOT NULL DEFAULT 'OPEN'
                                CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
    message         TEXT        NOT NULL,
    deviation_pct   NUMERIC(10,3),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_by TEXT        REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ
);
COMMENT ON TABLE alerts IS 'Threshold, connectivity and safety alerts (FR-13..FR-15). Only one non-resolved alert may exist per sensor and type; resolved rows stay as history (US-13).';
CREATE INDEX IF NOT EXISTS idx_alerts_status_time ON alerts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_sensor      ON alerts (sensor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_severity    ON alerts (severity);
-- De-duplication rule of US11-T1: at most one OPEN/ACKNOWLEDGED alert per
-- sensor (or device) and type at any moment.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_open_sensor_type
    ON alerts (sensor_id, type)
    WHERE status IN ('OPEN', 'ACKNOWLEDGED') AND sensor_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_open_device_type
    ON alerts (device_id, type)
    WHERE status IN ('OPEN', 'ACKNOWLEDGED') AND sensor_id IS NULL AND device_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS anomalies (
    id             TEXT PRIMARY KEY DEFAULT ('anm-' || encode(gen_random_bytes(6), 'hex')),
    sensor_id      TEXT        NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    measurement_id TEXT        REFERENCES measurements(id) ON DELETE SET NULL,
    method         TEXT        NOT NULL CHECK (method IN (
                       'OUT_OF_RANGE', 'SUDDEN_JUMP', 'ZSCORE', 'MISSING_DATA', 'FLATLINE')),
    value          NUMERIC(12,3),
    score          NUMERIC(10,3),
    explanation    TEXT        NOT NULL,
    detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE anomalies IS 'Abnormal or missing sensor data detected by the five methods of US19-T1 (FR-27, NFR-08).';
CREATE INDEX IF NOT EXISTS idx_anomalies_sensor_time ON anomalies (sensor_id, detected_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_anomalies_measurement_method
    ON anomalies (measurement_id, method) WHERE measurement_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. ACTUATOR COMMANDS AND EVENTS  (US-15, US-16, US-17, FR-17..FR-19, FR-23)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS actuator_commands (
    id           TEXT PRIMARY KEY DEFAULT ('cmd-' || encode(gen_random_bytes(6), 'hex')),
    actuator_id  TEXT        NOT NULL REFERENCES actuators(id) ON DELETE CASCADE,
    action       TEXT        NOT NULL CHECK (action IN ('ON', 'OFF')),
    duration_min NUMERIC(10,2),
    -- MANUAL: sent by a user. AUTOMATIC: created by an automation engine.
    -- AI: created by accepting a recommendation (US-26).
    source       TEXT        NOT NULL CHECK (source IN ('MANUAL', 'AUTOMATIC', 'AI')),
    status       TEXT        NOT NULL DEFAULT 'PENDING'
                             CHECK (status IN ('PENDING', 'SENT', 'EXECUTED', 'FAILED', 'EXPIRED')),
    reason       TEXT,
    requested_by TEXT        REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at      TIMESTAMPTZ,
    executed_at  TIMESTAMPTZ,
    -- A command not picked up by the device before this instant is EXPIRED.
    expires_at   TIMESTAMPTZ NOT NULL
);
COMMENT ON TABLE actuator_commands IS 'Command queue polled by the devices (US15-T1). No inbound connection to the greenhouse is required; stale commands expire.';
CREATE INDEX IF NOT EXISTS idx_commands_actuator_time ON actuator_commands (actuator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commands_status        ON actuator_commands (status, created_at);

CREATE TABLE IF NOT EXISTS actuator_events (
    id           TEXT PRIMARY KEY DEFAULT ('evt-' || encode(gen_random_bytes(6), 'hex')),
    actuator_id  TEXT        NOT NULL REFERENCES actuators(id) ON DELETE CASCADE,
    command_id   TEXT        REFERENCES actuator_commands(id) ON DELETE SET NULL,
    action       TEXT        NOT NULL CHECK (action IN ('ON', 'OFF', 'OFFLINE')),
    source       TEXT        NOT NULL CHECK (source IN ('MANUAL', 'AUTOMATIC', 'AI', 'SYSTEM')),
    user_id      TEXT        REFERENCES users(id) ON DELETE SET NULL,
    reason       TEXT,
    duration_min NUMERIC(10,2),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE actuator_events IS 'Immutable log of every actuator state change, written by recordEvent (US17-T1). Feeds the irrigation history (FR-19, FR-23).';
CREATE INDEX IF NOT EXISTS idx_events_actuator_time ON actuator_events (actuator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_source        ON actuator_events (source);

-- ---------------------------------------------------------------------------
-- 8. AUTOMATION CONFIGURATION  (US-16, FR-18)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS irrigation_config (
    area_id              TEXT PRIMARY KEY REFERENCES areas(id) ON DELETE CASCADE,
    enabled              BOOLEAN       NOT NULL DEFAULT TRUE,
    target_moisture      NUMERIC(10,3) NOT NULL DEFAULT 65,
    max_duration_min     NUMERIC(10,2) NOT NULL DEFAULT 10,
    cooldown_min         NUMERIC(10,2) NOT NULL DEFAULT 30,
    -- Number of consecutive below-minimum readings required before starting.
    consecutive_readings INTEGER       NOT NULL DEFAULT 2,
    min_tank_level       NUMERIC(10,3) NOT NULL DEFAULT 20,
    updated_by           TEXT          REFERENCES users(id) ON DELETE SET NULL,
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_irrigation_positive CHECK (
        max_duration_min > 0 AND cooldown_min >= 0 AND consecutive_readings >= 1
    )
);
COMMENT ON TABLE irrigation_config IS 'Per-area automatic irrigation parameters and safety limits (US16-T2).';

CREATE TABLE IF NOT EXISTS automation_rules (
    id             TEXT PRIMARY KEY DEFAULT ('rul-' || encode(gen_random_bytes(5), 'hex')),
    area_id        TEXT        NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    name           TEXT        NOT NULL,
    sensor_type    TEXT        NOT NULL,
    -- ABOVE_MAX / BELOW_MIN are evaluated against the area threshold.
    condition      TEXT        NOT NULL CHECK (condition IN ('ABOVE_MAX', 'BELOW_MIN')),
    actuator_type  TEXT        NOT NULL,
    action         TEXT        NOT NULL CHECK (action IN ('ON', 'OFF')),
    -- Hysteresis applied when releasing the rule, in sensor units.
    hysteresis     NUMERIC(10,3) NOT NULL DEFAULT 1,
    -- Optional daytime restriction (used by the auxiliary lighting rule).
    active_from_hour INTEGER,
    active_to_hour   INTEGER,
    enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
    updated_by     TEXT        REFERENCES users(id) ON DELETE SET NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE automation_rules IS 'Generic rules for fans, shade and lighting evaluated only in AUTOMATIC mode (FR-18).';
CREATE INDEX IF NOT EXISTS idx_rules_area ON automation_rules (area_id) WHERE enabled;

-- ---------------------------------------------------------------------------
-- 9. ARTIFICIAL INTELLIGENCE  (US-18, US-20, US-21, US-26, FR-25..FR-30)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recommendations (
    id                      TEXT PRIMARY KEY DEFAULT ('rec-' || encode(gen_random_bytes(6), 'hex')),
    area_id                 TEXT        NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    type                    TEXT        NOT NULL CHECK (type IN (
                                'IRRIGATE', 'WAIT', 'CHECK_SENSOR', 'CHECK_WATER', 'VENTILATE')),
    score                   NUMERIC(10,3) NOT NULL,
    confidence              NUMERIC(5,4)  NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    recommended_duration_min NUMERIC(10,2),
    -- Raw feature vector used by the model, for auditability (FR-29).
    inputs                  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- Ranked contributing factors behind the score ("Why?" list, US21-T3).
    factors                 JSONB       NOT NULL DEFAULT '[]'::jsonb,
    -- The five explanation elements required by section 11 of the project.
    recommendation          TEXT        NOT NULL,
    reason                  TEXT        NOT NULL,
    relevant_measurements   JSONB       NOT NULL DEFAULT '[]'::jsonb,
    confidence_text         TEXT        NOT NULL,
    status                  TEXT        NOT NULL DEFAULT 'PENDING'
                                        CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED')),
    decided_by              TEXT        REFERENCES users(id) ON DELETE SET NULL,
    decided_at              TIMESTAMPTZ,
    decision_comment        TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE recommendations IS 'Explainable AI decision support (US-20, US-21). Every row carries the five elements of section 11 plus the inputs and factors that produced it.';
CREATE INDEX IF NOT EXISTS idx_recommendations_area_time ON recommendations (area_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recommendations_status    ON recommendations (status, created_at DESC);
-- Only one pending recommendation per area at a time (US20-T3).
CREATE UNIQUE INDEX IF NOT EXISTS uq_recommendation_pending_area
    ON recommendations (area_id) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS ai_config (
    id                     TEXT PRIMARY KEY DEFAULT 'ai-default',
    -- Weights of the irrigation-need score; they are normalised at runtime.
    weight_moisture_deficit NUMERIC(6,3) NOT NULL DEFAULT 40,
    weight_temperature      NUMERIC(6,3) NOT NULL DEFAULT 20,
    weight_humidity         NUMERIC(6,3) NOT NULL DEFAULT 10,
    weight_trend            NUMERIC(6,3) NOT NULL DEFAULT 15,
    weight_time_since_irrigation NUMERIC(6,3) NOT NULL DEFAULT 15,
    -- Penalty subtracted when irrigation happened inside the cooldown window.
    penalty_recent_irrigation NUMERIC(6,3) NOT NULL DEFAULT 25,
    -- Score at or above which the engine recommends IRRIGATE.
    irrigate_score_threshold NUMERIC(6,3) NOT NULL DEFAULT 60,
    -- Disagreement between the two soil sensors that forces CHECK_SENSOR.
    sensor_disagreement_pct  NUMERIC(6,3) NOT NULL DEFAULT 15,
    -- Minutes between scheduled recommendation runs.
    schedule_minutes        INTEGER      NOT NULL DEFAULT 15,
    duration_factor         NUMERIC(6,3) NOT NULL DEFAULT 0.5,
    llm_enabled             BOOLEAN      NOT NULL DEFAULT FALSE,
    llm_model               TEXT         NOT NULL DEFAULT 'claude-opus-5',
    updated_by              TEXT         REFERENCES users(id) ON DELETE SET NULL,
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE ai_config IS 'Tunable weights and thresholds of the recommendation engine (US20-T4, US-306). Editable by Administrator and Super Administrator.';

-- ---------------------------------------------------------------------------
-- 10. PRODUCER NOTES AND PLATFORM SETTINGS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS observations (
    id         TEXT PRIMARY KEY DEFAULT ('obs-' || encode(gen_random_bytes(6), 'hex')),
    area_id    TEXT        NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    user_id    TEXT        REFERENCES users(id) ON DELETE SET NULL,
    note       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE observations IS 'Free-text crop notes registered by the producer for an area.';
CREATE INDEX IF NOT EXISTS idx_observations_area_time ON observations (area_id, created_at DESC);

CREATE TABLE IF NOT EXISTS system_parameters (
    key         TEXT PRIMARY KEY,
    value       TEXT        NOT NULL,
    description TEXT,
    updated_by  TEXT        REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE system_parameters IS 'Global key/value configuration (severity boundaries, offline windows, anomaly parameters) managed by the Super Administrator.';

CREATE TABLE IF NOT EXISTS security_settings (
    id                    TEXT PRIMARY KEY DEFAULT 'security-default',
    session_hours         INTEGER     NOT NULL DEFAULT 8 CHECK (session_hours BETWEEN 1 AND 72),
    password_min_length   INTEGER     NOT NULL DEFAULT 8 CHECK (password_min_length >= 6),
    password_require_upper BOOLEAN    NOT NULL DEFAULT TRUE,
    password_require_digit BOOLEAN    NOT NULL DEFAULT TRUE,
    password_require_symbol BOOLEAN   NOT NULL DEFAULT TRUE,
    max_login_attempts    INTEGER     NOT NULL DEFAULT 5 CHECK (max_login_attempts >= 1),
    login_window_minutes  INTEGER     NOT NULL DEFAULT 15,
    updated_by            TEXT        REFERENCES users(id) ON DELETE SET NULL,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE security_settings IS 'Session length, password policy and login rate limit (Super Administrator, NFR-03).';

CREATE TABLE IF NOT EXISTS notification_settings (
    id              TEXT PRIMARY KEY DEFAULT 'notif-default',
    organization_id TEXT        REFERENCES organizations(id) ON DELETE CASCADE,
    dashboard_enabled BOOLEAN   NOT NULL DEFAULT TRUE,
    email_enabled   BOOLEAN     NOT NULL DEFAULT FALSE,
    email_recipients TEXT,
    -- Minimum severity that triggers a notification.
    min_severity    TEXT        NOT NULL DEFAULT 'MEDIUM'
                                CHECK (min_severity IN ('LOW', 'MEDIUM', 'HIGH')),
    notify_on_recommendation BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by      TEXT        REFERENCES users(id) ON DELETE SET NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE notification_settings IS 'Notification mechanisms configured by the Administrator.';

CREATE TABLE IF NOT EXISTS integrations (
    id         TEXT PRIMARY KEY DEFAULT ('int-' || encode(gen_random_bytes(5), 'hex')),
    name       TEXT        NOT NULL UNIQUE,
    type       TEXT        NOT NULL,
    config     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    enabled    BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_by TEXT        REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE integrations IS 'External system integrations managed by the Super Administrator.';

-- ---------------------------------------------------------------------------
-- 11. AUDIT AND LOGGING  (FR-21, US-28)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
    id         TEXT PRIMARY KEY DEFAULT ('aud-' || encode(gen_random_bytes(6), 'hex')),
    user_id    TEXT        REFERENCES users(id) ON DELETE SET NULL,
    organization_id TEXT   REFERENCES organizations(id) ON DELETE SET NULL,
    action     TEXT        NOT NULL,
    entity     TEXT        NOT NULL,
    entity_id  TEXT,
    before_data JSONB,
    after_data  JSONB,
    ip         TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE audit_logs IS 'User activity trail: every write operation records who changed what, with before/after snapshots (FR-21).';
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS system_logs (
    id         TEXT PRIMARY KEY DEFAULT ('log-' || encode(gen_random_bytes(6), 'hex')),
    level      TEXT        NOT NULL CHECK (level IN ('DEBUG', 'INFO', 'WARN', 'ERROR')),
    source     TEXT        NOT NULL,
    message    TEXT        NOT NULL,
    context    JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE system_logs IS 'Technical log of requests, jobs and engines, consulted from the Administrator and Super Administrator screens.';
CREATE INDEX IF NOT EXISTS idx_system_logs_time  ON system_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs (level, created_at DESC);

-- ---------------------------------------------------------------------------
-- 12. VIEWS  (drop and create, so the script stays idempotent)
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_latest_measurements;
-- Latest reading per sensor, used by the dashboard sensor cards (FR-09).
CREATE VIEW v_latest_measurements AS
SELECT DISTINCT ON (m.sensor_id)
       m.sensor_id,
       s.name        AS sensor_name,
       s.type        AS sensor_type,
       s.area_id,
       s.device_id,
       m.id          AS measurement_id,
       m.value,
       m.unit,
       m.recorded_at,
       m.received_at,
       m.is_anomaly,
       m.device_status
FROM   measurements m
JOIN   sensors s ON s.id = m.sensor_id
ORDER  BY m.sensor_id, m.recorded_at DESC;
COMMENT ON VIEW v_latest_measurements IS 'Most recent measurement of every sensor (dashboard current values).';

DROP VIEW IF EXISTS v_daily_summary;
-- Daily min/avg/max per sensor, excluding anomalies (US-18).
CREATE VIEW v_daily_summary AS
SELECT s.area_id,
       m.sensor_id,
       s.type        AS sensor_type,
       m.unit,
       date_trunc('day', m.recorded_at) AS day,
       MIN(m.value)   AS min_value,
       AVG(m.value)   AS avg_value,
       MAX(m.value)   AS max_value,
       COUNT(*)       AS sample_count
FROM   measurements m
JOIN   sensors s ON s.id = m.sensor_id
WHERE  m.is_anomaly = FALSE
GROUP  BY s.area_id, m.sensor_id, s.type, m.unit, date_trunc('day', m.recorded_at);
COMMENT ON VIEW v_daily_summary IS 'Daily aggregates per sensor with anomalous readings excluded (US18-T2).';

-- ===========================================================================
--  End of schema. Load database/seed.sql next.
-- ===========================================================================
