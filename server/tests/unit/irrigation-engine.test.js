'use strict';

// US16-T7 — unit tests of the automatic irrigation rules (irrigation/service
// decide + apply) with mocked readings: trigger after 2 consecutive low
// readings, stop at target, stop at maximum duration, cooldown, low tank and
// stale sensor. Database, command flow and alert engine are mocked, so no
// device and no PostgreSQL are needed.

jest.mock('../../src/db', () => ({ one: jest.fn(), rows: jest.fn(), query: jest.fn() }));
jest.mock('../../src/modules/commands/service', () => ({
  hasInFlight: jest.fn(),
  createCommand: jest.fn(async (c) => ({ id: 'cmd-1', status: 'PENDING', ...c })),
}));
jest.mock('../../src/modules/alerts/service', () => ({ resolveThreshold: jest.fn(), raiseAlert: jest.fn() }));
jest.mock('../../src/modules/actuators/service', () => ({ findByType: jest.fn() }));
jest.mock('../../src/modules/events/service', () => ({ dailyIrrigationMinutes: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({ logSystem: jest.fn() }));

const db = require('../../src/db');
const commands = require('../../src/modules/commands/service');
const alerts = require('../../src/modules/alerts/service');
const actuators = require('../../src/modules/actuators/service');
const { decide, apply } = require('../../src/modules/irrigation/service');

const AREA = { id: 'AREA-1', mode: 'AUTOMATIC' };
const minutesAgo = (m) => new Date(Date.now() - m * 60000);

/**
 * One mocked situation of the greenhouse.
 *   readings     soil-moisture averages, newest first
 *   newestAgeMin age of the newest soil reading (stale-sensor rule)
 *   lastOnAgoMin minutes since the pump was last switched ON (null = never)
 *   tank         water tank level in % (null = no tank sensor)
 */
function scenario({
  readings = [57, 58], pumpState = 'OFF', inFlight = false, newestAgeMin = 0.5, lastOnAgoMin = null,
  tank = 80, config = {},
} = {}) {
  const cfg = {
    area_id: 'AREA-1', enabled: true, target_moisture: 65, max_duration_min: 10, cooldown_min: 30,
    consecutive_readings: 2, min_tank_level: 20, ...config,
  };
  actuators.findByType.mockResolvedValue([{ id: 'ACT-PUMP-01', state: pumpState }]);
  commands.hasInFlight.mockResolvedValue(inFlight);
  alerts.resolveThreshold.mockResolvedValue({ min_value: 60, max_value: 80 });
  db.rows.mockImplementation(async (sql, params) => readings.slice(0, params[1]).map((v, i) => ({ bucket: minutesAgo(i), avg_value: v, sensors: 2 })));
  db.one.mockImplementation(async (sql) => {
    if (sql.includes('FROM irrigation_config')) return cfg;
    if (sql.includes('MAX(m.recorded_at)')) return { at: newestAgeMin === null ? null : minutesAgo(newestAgeMin) };
    if (sql.includes('MAX(e.created_at)')) return { at: lastOnAgoMin === null ? null : minutesAgo(lastOnAgoMin) };
    if (sql.includes('v_latest_measurements')) return tank === null ? null : { value: tank, recorded_at: new Date() };
    throw new Error(`unexpected query: ${sql}`);
  });
}

beforeEach(() => jest.clearAllMocks());

describe('US16-T7 start rule', () => {
  test('2 consecutive readings below the minimum -> ON with the maximum duration', async () => {
    scenario({ readings: [57, 58.5] });
    const d = await decide(AREA);
    expect(d).toMatchObject({ action: 'ON', actuator_id: 'ACT-PUMP-01', duration_min: 10, target_moisture: 65 });
    expect(d.reason).toMatch(/below the minimum of 60 % for 2 consecutive readings/);
  });

  test('only one reading below the minimum is not enough', async () => {
    scenario({ readings: [57, 61] });
    expect((await decide(AREA)).action).toBe('SKIP');
  });

  test('a single reading available when 2 are required -> SKIP', async () => {
    scenario({ readings: [55] });
    expect((await decide(AREA)).action).toBe('SKIP');
  });

  test('readings exactly at the minimum (60 %) do not trigger', async () => {
    scenario({ readings: [60, 60] });
    expect((await decide(AREA)).action).toBe('SKIP');
  });

  test('the number of consecutive readings is configurable', async () => {
    scenario({ readings: [57, 58, 61], config: { consecutive_readings: 3 } });
    expect((await decide(AREA)).action).toBe('SKIP');
    scenario({ readings: [57, 58, 59], config: { consecutive_readings: 3 } });
    expect((await decide(AREA)).action).toBe('ON');
  });
});

describe('US16-T7 stop rules', () => {
  test('pump ON and the target is reached -> OFF', async () => {
    scenario({ readings: [65.2, 63], pumpState: 'ON', lastOnAgoMin: 4 });
    const d = await decide(AREA);
    expect(d.action).toBe('OFF');
    expect(d.reason).toMatch(/reached the target of 65 %/);
  });

  test('pump ON beyond the maximum duration -> OFF even below the target', async () => {
    scenario({ readings: [62, 61], pumpState: 'ON', lastOnAgoMin: 10.5 });
    const d = await decide(AREA);
    expect(d.action).toBe('OFF');
    expect(d.reason).toMatch(/maximum irrigation duration of 10 minutes/);
  });

  test('pump ON, below the target and within the duration -> keeps irrigating', async () => {
    scenario({ readings: [62, 61], pumpState: 'ON', lastOnAgoMin: 3 });
    const d = await decide(AREA);
    expect(d.action).toBe('SKIP');
    expect(d.reason).toMatch(/in progress/);
  });
});

describe('US16-T7 safety conditions', () => {
  test('cooldown: the last irrigation was 10 minutes ago (cooldown 30) -> blocked', async () => {
    scenario({ readings: [57, 58], lastOnAgoMin: 10 });
    const d = await decide(AREA);
    expect(d).toMatchObject({ action: 'SKIP', blocked: true, safety: 'COOLDOWN' });
    expect(d.reason).toMatch(/20 minute\(s\) remaining/);
  });

  test('cooldown elapsed (31 minutes) -> irrigation allowed', async () => {
    scenario({ readings: [57, 58], lastOnAgoMin: 31 });
    expect((await decide(AREA)).action).toBe('ON');
  });

  test('water tank below the minimum -> BLOCK_LOW_WATER', async () => {
    scenario({ readings: [57, 58], tank: 12 });
    const d = await decide(AREA);
    expect(d).toMatchObject({ action: 'BLOCK_LOW_WATER', blocked: true, safety: 'LOW_WATER', tank_level: 12 });
  });

  test('applying BLOCK_LOW_WATER raises a HIGH LOW_WATER alert and sends no command', async () => {
    scenario({ readings: [57, 58], tank: 12 });
    await apply(AREA, await decide(AREA));
    expect(alerts.raiseAlert).toHaveBeenCalledWith(expect.objectContaining({ type: 'LOW_WATER', severity: 'HIGH', value: 12 }));
    expect(commands.createCommand).not.toHaveBeenCalled();
  });

  test('no tank sensor installed -> the tank rule does not block', async () => {
    scenario({ readings: [57, 58], tank: null });
    expect((await decide(AREA)).action).toBe('ON');
  });

  test('stale sensor: no soil reading for 6 minutes -> blocked', async () => {
    scenario({ readings: [57, 58], newestAgeMin: 6 });
    const d = await decide(AREA);
    expect(d).toMatchObject({ action: 'SKIP', blocked: true, safety: 'STALE_SENSOR' });
  });

  test('stale sensor also stops the engine from switching a running pump', async () => {
    scenario({ readings: [66, 64], pumpState: 'ON', newestAgeMin: 8 });
    expect((await decide(AREA)).safety).toBe('STALE_SENSOR');
  });

  test('a command already in flight -> no second command', async () => {
    scenario({ readings: [57, 58], inFlight: true });
    const d = await decide(AREA);
    expect(d.action).toBe('SKIP');
    expect(d.reason).toMatch(/already pending/);
  });
});

describe('US16-T7 mode and application', () => {
  test('MANUAL mode disables the engine', async () => {
    scenario({ readings: [40, 40] });
    const d = await decide({ ...AREA, mode: 'MANUAL' });
    expect(d).toMatchObject({ action: 'SKIP', reason: 'The area is in MANUAL mode.' });
    expect(actuators.findByType).not.toHaveBeenCalled();
  });

  test('automatic irrigation disabled in the configuration -> SKIP', async () => {
    scenario({ readings: [40, 40], config: { enabled: false } });
    expect((await decide(AREA)).action).toBe('SKIP');
  });

  test('applying ON queues an AUTOMATIC command with the reason and duration', async () => {
    scenario({ readings: [57, 58] });
    const result = await apply(AREA, await decide(AREA));
    expect(commands.createCommand).toHaveBeenCalledWith(expect.objectContaining({
      actuatorId: 'ACT-PUMP-01', action: 'ON', durationMin: 10, source: 'AUTOMATIC', enforceManualMode: false,
    }));
    expect(result.command.id).toBe('cmd-1');
  });

  test('applying SKIP does nothing', async () => {
    scenario({ readings: [70, 70] });
    await apply(AREA, await decide(AREA));
    expect(commands.createCommand).not.toHaveBeenCalled();
    expect(alerts.raiseAlert).not.toHaveBeenCalled();
  });
});
