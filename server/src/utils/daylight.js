'use strict';

/**
 * Local time of the greenhouse. Light below its minimum at night is normal,
 * so the light threshold only applies during daylight hours (alerts, analysis),
 * and the lighting automation window uses local hours, not UTC.
 */

const settings = require('./settings');

/** Hour of day (0-23) in the given IANA time zone. */
function localHour(timeZone, date = new Date()) {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(date)));
  } catch {
    return new Date(date).getUTCHours();
  }
}

async function daylightWindow() {
  return {
    timeZone: await settings.getString('platform.timezone', 'America/Mexico_City'),
    from: await settings.getNumber('light.day_start_hour', 7),
    to: await settings.getNumber('light.day_end_hour', 19),
  };
}

/** True when `date` falls inside the daylight hours of the greenhouse. */
async function isDaylight(date = new Date()) {
  const { timeZone, from, to } = await daylightWindow();
  const hour = localHour(timeZone, date);
  return hour >= from && hour < to;
}

module.exports = { localHour, isDaylight, daylightWindow };
