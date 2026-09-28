-- ===========================================================================
--  SmartGreenAI: Cilantro Crop — SEED DATA
--  Team 3 — UPAEP, Agile Project Management
--
--  Idempotent: every statement uses ON CONFLICT DO NOTHING (or a guarded
--  UPDATE), so the script can be re-run safely on an existing database.
--
--      psql "$DATABASE_URL" -f database/schema.sql
--      psql "$DATABASE_URL" -f database/seed.sql
--
--  Default accounts (see database/README.md):
--      superadmin@smartgreen.ai / SuperAdmin123!
--      admin@smartgreen.ai      / Admin123!
--      producer@smartgreen.ai   / Producer123!
--
--  Development device API key (plain key NEVER stored, only its SHA-256):
--      sec_iot_dev_node_01_smartgreen_team3
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. ROLES AND PERMISSIONS  (US-24)
-- ---------------------------------------------------------------------------

INSERT INTO roles (id, name, description, is_system) VALUES
    ('role-superadmin', 'SuperAdministrator', 'Platform-level administration: administrators, roles, tenants, global parameters, security and integrations.', TRUE),
    ('role-admin',      'Administrator',      'Operational configuration: producers, greenhouses, areas, crops, IoT registry, thresholds, irrigation, automation and AI parameters.', TRUE),
    ('role-producer',   'Producer',           'Agricultural user: monitors the greenhouse, acknowledges alerts, controls irrigation and decides on AI recommendations.', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (id, code, description, category) VALUES
    ('perm-users-read',        'users.read',              'List and view platform users',                 'Users'),
    ('perm-users-write',       'users.write',             'Create, edit and activate/deactivate users',   'Users'),
    ('perm-admins-read',       'admins.read',             'List administrator accounts',                  'Users'),
    ('perm-admins-write',      'admins.write',            'Create and edit administrator accounts',       'Users'),
    ('perm-roles-read',        'roles.read',              'View roles and their permissions',             'Security'),
    ('perm-roles-write',       'roles.write',             'Create roles and edit the permission matrix',  'Security'),
    ('perm-orgs-read',         'organizations.read',      'View organizations / tenants',                 'Tenants'),
    ('perm-orgs-write',        'organizations.write',     'Create and edit organizations / tenants',      'Tenants'),
    ('perm-greenhouses-read',  'greenhouses.read',        'View greenhouses',                             'Structure'),
    ('perm-greenhouses-write', 'greenhouses.write',       'Register and edit greenhouses',                'Structure'),
    ('perm-areas-read',        'areas.read',              'View cultivation areas',                       'Structure'),
    ('perm-areas-write',       'areas.write',             'Register and edit cultivation areas',          'Structure'),
    ('perm-areas-mode',        'areas.mode',              'Switch an area between MANUAL and AUTOMATIC',  'Structure'),
    ('perm-crops-read',        'crops.read',              'View crop types and their default ranges',     'Structure'),
    ('perm-crops-write',       'crops.write',             'Register crop types and auto-configure areas', 'Structure'),
    ('perm-devices-read',      'devices.read',            'View registered IoT devices',                  'IoT'),
    ('perm-devices-write',     'devices.write',           'Register, edit, deactivate and rotate device keys', 'IoT'),
    ('perm-sensors-read',      'sensors.read',            'View registered sensors',                      'IoT'),
    ('perm-sensors-write',     'sensors.write',           'Register, edit and deactivate sensors',        'IoT'),
    ('perm-actuators-read',    'actuators.read',          'View actuator status',                         'Actuators'),
    ('perm-actuators-write',   'actuators.write',         'Register, edit and deactivate actuators',      'Actuators'),
    ('perm-actuators-command', 'actuators.command',       'Send manual ON/OFF commands to an actuator',   'Actuators'),
    ('perm-measurements-read', 'measurements.read',       'Query current and historical measurements',    'Monitoring'),
    ('perm-thresholds-read',   'thresholds.read',         'View configured thresholds',                   'Monitoring'),
    ('perm-thresholds-write',  'thresholds.write',        'Create and update thresholds',                 'Monitoring'),
    ('perm-alerts-read',       'alerts.read',             'View active alerts and alert history',         'Alerts'),
    ('perm-alerts-ack',        'alerts.ack',              'Acknowledge an alert',                         'Alerts'),
    ('perm-anomalies-read',    'anomalies.read',          'View detected anomalies',                      'Alerts'),
    ('perm-irrigation-read',   'irrigation.read',         'View irrigation configuration and history',    'Irrigation'),
    ('perm-irrigation-write',  'irrigation.write',        'Edit the automatic irrigation parameters',     'Irrigation'),
    ('perm-automation-read',   'automation.read',         'View the generic automation rules',            'Irrigation'),
    ('perm-automation-write',  'automation.write',        'Edit the generic automation rules',            'Irrigation'),
    ('perm-analysis-read',     'analysis.read',           'Query historical analysis and trends',         'AI'),
    ('perm-recs-read',         'recommendations.read',    'View AI recommendations',                      'AI'),
    ('perm-recs-decide',       'recommendations.decide',  'Accept or reject an AI recommendation',        'AI'),
    ('perm-recs-generate',     'recommendations.generate','Force a recommendation run',                   'AI'),
    ('perm-ai-read',           'ai.read',                 'View the AI configuration',                    'AI'),
    ('perm-ai-write',          'ai.write',                'Edit the AI weights and thresholds',           'AI'),
    ('perm-observations-read', 'observations.read',       'View crop observations',                       'Crop'),
    ('perm-observations-write','observations.write',      'Register crop observations',                   'Crop'),
    ('perm-logs-read',         'logs.read',               'View system and audit logs',                   'Platform'),
    ('perm-stats-read',        'stats.read',              'View platform statistics',                     'Platform'),
    ('perm-settings-read',     'settings.read',           'View global, security and notification settings', 'Platform'),
    ('perm-settings-write',    'settings.write',          'Edit global, security and notification settings', 'Platform'),
    ('perm-integrations-read', 'integrations.read',       'View external integrations',                   'Platform'),
    ('perm-integrations-write','integrations.write',      'Configure external integrations',              'Platform')
ON CONFLICT (id) DO NOTHING;

-- The Super Administrator holds every permission of the platform.
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'role-superadmin', id FROM permissions
ON CONFLICT DO NOTHING;

-- The Administrator manages the operational configuration, but not the
-- platform governance (tenants, roles, administrators, integrations).
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'role-admin', id FROM permissions WHERE code IN (
    'users.read', 'users.write',
    'greenhouses.read', 'greenhouses.write',
    'areas.read', 'areas.write', 'areas.mode',
    'crops.read', 'crops.write',
    'devices.read', 'devices.write',
    'sensors.read', 'sensors.write',
    'actuators.read', 'actuators.write', 'actuators.command',
    'measurements.read',
    'thresholds.read', 'thresholds.write',
    'alerts.read', 'alerts.ack',
    'anomalies.read',
    'irrigation.read', 'irrigation.write',
    'automation.read', 'automation.write',
    'analysis.read',
    'recommendations.read', 'recommendations.decide', 'recommendations.generate',
    'ai.read', 'ai.write',
    'observations.read', 'observations.write',
    'logs.read', 'stats.read',
    'settings.read', 'settings.write',
    'roles.read', 'organizations.read'
)
ON CONFLICT DO NOTHING;

-- The Producer operates the greenhouse: reads everything agronomic and acts
-- on irrigation, alerts and recommendations, but changes no configuration.
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'role-producer', id FROM permissions WHERE code IN (
    'greenhouses.read', 'areas.read', 'areas.mode', 'crops.read',
    'devices.read', 'sensors.read',
    'actuators.read', 'actuators.command',
    'measurements.read', 'thresholds.read',
    'alerts.read', 'alerts.ack',
    'anomalies.read',
    'irrigation.read',
    'analysis.read',
    'recommendations.read', 'recommendations.decide',
    'observations.read', 'observations.write'
)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. ORGANIZATION, GREENHOUSE, CROP AND AREAS
-- ---------------------------------------------------------------------------

INSERT INTO organizations (id, name, contact_email) VALUES
    ('org-team3', 'SmartGreen Team 3', 'team3@smartgreen.ai')
ON CONFLICT (id) DO NOTHING;

-- GH-01 / AREA-1 are the identifiers hard-coded in the ESP32 firmware.
INSERT INTO greenhouses (id, organization_id, name, location) VALUES
    ('GH-01', 'org-team3', 'Cilantro Greenhouse 01', 'Puebla, Puebla — UPAEP')
ON CONFLICT (id) DO NOTHING;

-- Agronomic ranges approved by the Product Owner at the Sprint 2 Planning
-- (US10-T1): they become the thresholds of any area assigned to this crop.
INSERT INTO crop_types (
    id, name, description,
    temperature_min, temperature_max,
    air_humidity_min, air_humidity_max,
    soil_moisture_min, soil_moisture_max,
    light_min, light_max,
    co2_min, co2_max,
    ph_min, ph_max,
    water_level_min, water_level_max
) VALUES (
    'crop-cilantro', 'Cilantro', 'Coriandrum sativum — leafy crop grown in greenhouse beds.',
    15, 25,
    50, 70,
    60, 80,
    10000, 40000,
    400, 1000,
    6.2, 6.8,
    20, 100
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO areas (id, greenhouse_id, name, crop_type_id, crop_stage, mode) VALUES
    ('AREA-1', 'GH-01', 'Cultivation Area 1', 'crop-cilantro', 'vegetative', 'AUTOMATIC'),
    ('AREA-2', 'GH-01', 'Cultivation Area 2', 'crop-cilantro', 'vegetative', 'MANUAL')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. DEFAULT USERS  (NFR-03: bcrypt hashes produced by pgcrypto, verified by
--    bcryptjs at login — both use the $2a$ Blowfish format)
-- ---------------------------------------------------------------------------

INSERT INTO users (id, organization_id, email, username, full_name, password_hash, role_id) VALUES
    ('usr-superadmin', 'org-team3', 'superadmin@smartgreen.ai', 'superadmin', 'Platform Super Administrator',
     crypt('SuperAdmin123!', gen_salt('bf')), 'role-superadmin'),
    ('usr-admin',      'org-team3', 'admin@smartgreen.ai',      'admin',      'Greenhouse Administrator',
     crypt('Admin123!', gen_salt('bf')), 'role-admin'),
    ('usr-producer',   'org-team3', 'producer@smartgreen.ai',   'producer',   'Cilantro Producer',
     crypt('Producer123!', gen_salt('bf')), 'role-producer')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. IoT REGISTRY  (US-25)
-- ---------------------------------------------------------------------------

-- Only the SHA-256 digest of the development key is stored. The plain key
-- (sec_iot_dev_node_01_smartgreen_team3) is documented in database/README.md
-- for local development and must be rotated before any real deployment.
INSERT INTO devices (id, organization_id, greenhouse_id, area_id, name, mac_address, location, api_key_hash, firmware) VALUES
    ('dev-node-01', 'org-team3', 'GH-01', 'AREA-1',
     'Nodo Central Invernadero 1', 'A4:CF:12:89:56:B2', 'Bloque A - Cilantro',
     encode(digest('sec_iot_dev_node_01_smartgreen_team3', 'sha256'), 'hex'),
     'esp32-smartgreen-1.0.0')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sensors (id, device_id, area_id, name, type, unit, physical_min, physical_max) VALUES
    ('SM-01',  'dev-node-01', 'AREA-1', 'Soil moisture 1',   'soil_moisture', '%',     0,      100),
    ('SM-02',  'dev-node-01', 'AREA-1', 'Soil moisture 2',   'soil_moisture', '%',     0,      100),
    ('TMP-01', 'dev-node-01', 'AREA-1', 'Air temperature',   'temperature',   'C',   -40,       85),
    ('HUM-01', 'dev-node-01', 'AREA-1', 'Relative humidity', 'air_humidity',  '%',     0,      100),
    ('LUX-01', 'dev-node-01', 'AREA-1', 'Light intensity',   'light',         'lux',   0,   120000),
    ('CO2-01', 'dev-node-01', 'AREA-1', 'CO2 concentration', 'co2',           'ppm',   0,     5000),
    ('WL-01',  'dev-node-01', 'AREA-1', 'Water tank level',  'water_level',   '%',     0,      100),
    ('PH-01',  'dev-node-01', 'AREA-1', 'Soil pH',           'ph',            'pH',    0,       14)
ON CONFLICT (id) DO NOTHING;

INSERT INTO actuators (id, device_id, area_id, name, type, state) VALUES
    ('ACT-PUMP-01',  'dev-node-01', 'AREA-1', 'Irrigation pump',   'irrigation_pump', 'OFF'),
    ('ACT-FAN-01',   'dev-node-01', 'AREA-1', 'Ventilation fan',   'ventilation_fan', 'OFF'),
    ('ACT-SHADE-01', 'dev-node-01', 'AREA-1', 'Shade system',      'shade',           'OFF'),
    ('ACT-LIGHT-01', 'dev-node-01', 'AREA-1', 'Auxiliary lighting','lighting',        'OFF')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. THRESHOLDS  (US-10, approved by the Product Owner)
--    Air temperature 15-25 C | Relative humidity 50-70 % | Soil moisture 60-80 %
--    Light 10 000-40 000 lux | CO2 400-1 000 ppm | Water tank 20-100 % | pH 6.2-6.8
-- ---------------------------------------------------------------------------

INSERT INTO thresholds (id, area_id, sensor_type, min_value, max_value, unit, crop_stage) VALUES
    ('th-a1-temperature',   'AREA-1', 'temperature',      15,     25, 'C',   'vegetative'),
    ('th-a1-air-humidity',  'AREA-1', 'air_humidity',     50,     70, '%',   'vegetative'),
    ('th-a1-soil-moisture', 'AREA-1', 'soil_moisture',    60,     80, '%',   'vegetative'),
    ('th-a1-light',         'AREA-1', 'light',         10000,  40000, 'lux', 'vegetative'),
    ('th-a1-co2',           'AREA-1', 'co2',             400,   1000, 'ppm', 'vegetative'),
    ('th-a1-water-level',   'AREA-1', 'water_level',      20,    100, '%',   'vegetative'),
    ('th-a1-ph',            'AREA-1', 'ph',              6.2,    6.8, 'pH',  'vegetative'),
    ('th-a2-temperature',   'AREA-2', 'temperature',      15,     25, 'C',   'vegetative'),
    ('th-a2-air-humidity',  'AREA-2', 'air_humidity',     50,     70, '%',   'vegetative'),
    ('th-a2-soil-moisture', 'AREA-2', 'soil_moisture',    60,     80, '%',   'vegetative'),
    ('th-a2-light',         'AREA-2', 'light',         10000,  40000, 'lux', 'vegetative'),
    ('th-a2-co2',           'AREA-2', 'co2',             400,   1000, 'ppm', 'vegetative'),
    ('th-a2-water-level',   'AREA-2', 'water_level',      20,    100, '%',   'vegetative'),
    ('th-a2-ph',            'AREA-2', 'ph',              6.2,    6.8, 'pH',  'vegetative')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. IRRIGATION AND AUTOMATION DEFAULTS  (US-16, FR-18)
-- ---------------------------------------------------------------------------

INSERT INTO irrigation_config (area_id, enabled, target_moisture, max_duration_min, cooldown_min, consecutive_readings, min_tank_level) VALUES
    ('AREA-1', TRUE, 65, 10, 30, 2, 20),
    ('AREA-2', TRUE, 65, 10, 30, 2, 20)
ON CONFLICT (area_id) DO NOTHING;

INSERT INTO automation_rules (id, area_id, name, sensor_type, condition, actuator_type, action, hysteresis, active_from_hour, active_to_hour) VALUES
    ('rul-a1-fan',   'AREA-1', 'Ventilate when the air is too warm', 'temperature', 'ABOVE_MAX', 'ventilation_fan', 'ON', 1,    NULL, NULL),
    ('rul-a1-shade', 'AREA-1', 'Close the shade under excessive light', 'light',    'ABOVE_MAX', 'shade',           'ON', 2000, NULL, NULL),
    ('rul-a1-light', 'AREA-1', 'Auxiliary lighting during daytime hours', 'light',  'BELOW_MIN', 'lighting',        'ON', 1000, 7,    19)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. PLATFORM SETTINGS
-- ---------------------------------------------------------------------------

INSERT INTO ai_config (id) VALUES ('ai-default') ON CONFLICT (id) DO NOTHING;
INSERT INTO security_settings (id) VALUES ('security-default') ON CONFLICT (id) DO NOTHING;
INSERT INTO notification_settings (id, organization_id) VALUES ('notif-default', 'org-team3') ON CONFLICT (id) DO NOTHING;

-- Tunable engine parameters (US12-T1 severity boundaries, US-19 anomaly
-- parameters, FR-11 offline window). Values are read at runtime.
INSERT INTO system_parameters (key, value, description) VALUES
    ('severity.low_max_pct',          '10',    'Deviation (% of the optimal range) up to which an alert is LOW'),
    ('severity.medium_max_pct',       '25',    'Deviation (% of the optimal range) up to which an alert is MEDIUM; above it, HIGH'),
    ('device.offline_minutes',        '5',     'Minutes without contact after which a device is OFFLINE (FR-11)'),
    ('actuator.offline_minutes',      '5',     'Minutes without a state report after which an actuator is shown as OFFLINE'),
    ('command.expiry_seconds',        '60',    'Seconds a command waits to be collected by the device before EXPIRED'),
    ('anomaly.zscore_threshold',      '3',     'Z-score above which a reading is a statistical outlier (24 h window)'),
    ('anomaly.missing_data_minutes',  '5',     'Minutes without readings that raise a MISSING_DATA anomaly (NFR-08)'),
    ('anomaly.flatline_minutes',      '30',    'Minutes with an identical value that raise a FLATLINE anomaly'),
    ('anomaly.jump.soil_moisture',    '15',    'Maximum % change in soil moisture between consecutive readings'),
    ('anomaly.jump.temperature',      '5',     'Maximum C change in temperature between consecutive readings'),
    ('anomaly.jump.air_humidity',     '20',    'Maximum % change in relative humidity between consecutive readings'),
    ('anomaly.jump.light',            '30000', 'Maximum lux change between consecutive readings'),
    ('anomaly.jump.co2',              '400',   'Maximum ppm change between consecutive readings'),
    ('anomaly.jump.water_level',      '25',    'Maximum % change in tank level between consecutive readings'),
    ('anomaly.jump.ph',               '1',     'Maximum pH change between consecutive readings'),
    ('analysis.trend_tolerance',      '0.05',  'Absolute slope below which a trend is classified STABLE'),
    ('platform.name',                 'SmartGreenAI: Cilantro Crop', 'Name displayed in the web application'),
    ('platform.timezone',             'America/Mexico_City', 'IANA time zone of the greenhouse, used for daytime automation windows')
ON CONFLICT (key) DO NOTHING;

-- ===========================================================================
--  End of seed. Optionally run:  npm run seed:history
--  (30 days of realistic measurements for charts, z-score, analysis and AI)
-- ===========================================================================
