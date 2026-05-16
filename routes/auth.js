const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const User = require('../models/User');
const SiteSetting = require('../models/SiteSetting');
const { categoryStats, overallProgress, seedProgress, topicsWithProgress } = require('../services/topics');
const { authLimiter } = require('../middleware/rateLimiter');
const { validateLogin, validateRegister } = require('../middleware/validate');
const { requireLogin } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', authLimiter, validateRegister, async (req, res, next) => {
  try {
    const registrationsEnabled = await SiteSetting.get('registrationsEnabled', true);
    if (!registrationsEnabled) {
      return res.status(403).json({ ok: false, error: 'Registrations are currently disabled.' });
    }

    const username = req.body.username.toLowerCase().trim();
    const { password, name } = req.body;

    const existing = await User.findOne({ username });
    if (existing) {
      // Return same error as "not found" to prevent username enumeration
      return res.status(400).json({ ok: false, error: 'Registration failed. Try a different username.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.create({
      username,
      passwordHash,
      name: (name || username).trim(),
      theme: 'light',
      role: 'user',
    });

    // Seed progress from master topics
    user.progress = seedProgress();
    await user.save();

    return res.status(201).json({ ok: true, username: user.username, name: user.name });
  } catch (err) { next(err); }
});

// POST /api/auth/login
router.post('/login', authLimiter, validateLogin, async (req, res, next) => {
  try {
    const username = req.body.username.toLowerCase().trim();
    const { password } = req.body;

    const user = await User.findOne({ username });

    // Always hash even if user not found (timing attack prevention)
    const dummyHash = '$2a$12$invalidhashfortimingprotection1234567890ABCDEF';
    const hash = user ? user.passwordHash : dummyHash;
    const match = await bcrypt.compare(password, hash);

    if (!user || !match) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials.' });
    }

    if (user.disabled) {
      return res.status(403).json({ ok: false, error: 'Account disabled. Contact admin.' });
    }

    if (user.isExpired() && user.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Account expired. Contact admin.' });
    }

    // Regenerate session to prevent session fixation
    await new Promise((resolve, reject) => {
      req.session.regenerate(err => err ? reject(err) : resolve());
    });

    req.session.user = {
      username: user.username,
      name: user.name,
      theme: user.theme,
      role: user.role,
      expiresAt: user.expiresAt,
    };

    user.lastLoginAt = new Date();
    await user.save();

    return res.json({
      ok: true,
      user: req.session.user,
      categories: categoryStats(user.progress),
      topics: topicsWithProgress(user.progress),
      overallProgress: overallProgress(user.progress),
    });
  } catch (err) { next(err); }
});

// POST /api/auth/logout
router.post('/logout', (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie('ssc.sid');
    res.clearCookie('csrf-token');
    res.json({ ok: true });
  });
});

// GET /api/auth/me — returns current session user (used on page load)
router.get('/me', requireLogin, (req, res) => {
  res.json({ ok: true, user: req.session.user });
});

module.exports = router;
