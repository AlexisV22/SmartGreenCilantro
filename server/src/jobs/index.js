'use strict';

/**
 * Background engines.
 *
 * Each job exports { NAME, SCHEDULE, run } so it can be executed directly by
 * the tests and the acceptance script without a scheduler. A run that throws
 * is logged and never crashes the process, and overlapping executions are
 * skipped so a slow tick cannot pile up.
 */

const cron = require('node-cron');
const { logSystem } = require('../utils/logger');

const JOBS = [
  require('./automationEngine'),
  require('./anomalyJob'),
  require('./connectivityJob'),
  require('./alertResolver'),
  require('./recommendationJob'),
];

const tasks = [];
const running = new Set();

function wrap(job) {
  return async () => {
    if (running.has(job.NAME)) return;
    running.add(job.NAME);
    try {
      await job.run();
    } catch (err) {
      logSystem('ERROR', job.NAME, `Job failed: ${err.message}`);
      // eslint-disable-next-line no-console
      console.error(`[jobs] ${job.NAME} failed:`, err.message);
    } finally {
      running.delete(job.NAME);
    }
  };
}

function start() {
  for (const job of JOBS) {
    const task = cron.schedule(job.SCHEDULE, wrap(job), { timezone: 'UTC' });
    tasks.push(task);
  }
  logSystem('INFO', 'jobs', `Started ${JOBS.length} background engines.`);
  // eslint-disable-next-line no-console
  console.log(`  Engines   ${JOBS.map((j) => j.NAME).join(', ')}`);
}

function stop() {
  for (const task of tasks) task.stop();
  tasks.length = 0;
}

/** Run every job once, in order. Used by the acceptance script and tests. */
async function runAllOnce() {
  const results = {};
  for (const job of JOBS) {
    results[job.NAME] = await job.run();
  }
  return results;
}

module.exports = { start, stop, runAllOnce, JOBS };
