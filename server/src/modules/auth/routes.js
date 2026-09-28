'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const controller = require('./controller');
const config = require('../../config');
const { requireAuth } = require('../../middleware/auth');
const { validateBody } = require('../../middleware/validate');

const router = express.Router();

// Brute-force protection on the only public endpoint (US01C-T4).
// The window mirrors the defaults of security_settings.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // The automated test suite signs in hundreds of times; LOGIN_RATE_LIMIT
  // lets a dedicated test exercise the limiter with a small value.
  max: Number(process.env.LOGIN_RATE_LIMIT) || (config.isTest ? 10000 : 20),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    status: 429,
    code: 'ERR_RATE_LIMITED',
    message: 'Too many sign-in attempts. Please wait before trying again.',
    details: [],
  }),
});

const loginSchema = z.object({
  // Accepts either the email or the username.
  email: z.string().min(1, 'Email or username is required.'),
  password: z.string().min(1, 'Password is required.'),
});

router.post('/login', loginLimiter, validateBody(loginSchema), controller.login);
router.get('/me', requireAuth, controller.me);
router.post('/logout', requireAuth, controller.logout);

module.exports = router;
