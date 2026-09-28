'use strict';

/**
 * Express application for SmartGreenAI: Cilantro Crop.
 *
 * Serves the JSON API under /api and the static web application from
 * /public. Exported without listening so the test suite can drive it with
 * Supertest (US28-T2).
 */

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const config = require('./config');
const { notFoundHandler, errorHandler } = require('./middleware/errors');
const { logSystem } = require('./utils/logger');

const app = express();

// Behind Render/Railway/Nginx the real client IP arrives in X-Forwarded-For;
// the rate limiter and the audit trail depend on it.
app.set('trust proxy', 1);

app.use(helmet({
  // The dashboard loads its own scripts, styles and the vendored Chart.js
  // build; no external origin is ever contacted.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
  credentials: false,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// --- Request logging -------------------------------------------------------
// Every API call is timed; failures and slow calls are persisted so the
// Administrator log screen and the NFR-01 measurements have real data.
app.use('/api', (req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const line = `${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs.toFixed(1)} ms)`;

    if (res.statusCode >= 500) {
      logSystem('ERROR', 'api', line);
    } else if (res.statusCode >= 400) {
      logSystem('WARN', 'api', line);
    } else if (durationMs > 3000) {
      // NFR-01: normal dashboard operations must answer in about 3 seconds.
      logSystem('WARN', 'api', `SLOW ${line}`);
    } else if (!config.isTest) {
      logSystem('INFO', 'api', line);
    }
  });
  next();
});

// --- API routes ------------------------------------------------------------
app.use('/api', require('./modules'));

// --- Static web application -----------------------------------------------
const publicDir = path.resolve(__dirname, '../../public');
app.use(express.static(publicDir, { index: 'index.html', extensions: ['html'] }));

// Unmatched /api routes get the standard 404 contract; anything else falls
// back to the login page so a deep link still lands in the application.
app.use('/api', notFoundHandler);
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  return res.sendFile(path.join(publicDir, 'index.html'));
});

app.use(errorHandler);

module.exports = app;
