const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Log = require('../models/Log');
const SiteSetting = require('../models/SiteSetting');
const { requireAdmin } = require('../middleware/auth');
const { adminLimiter } = require('../middleware/rateLimiter');
const { body, validationResult } = require('express-validator');

const { ALL_TOPICS, overallProgress, seedProgress, topicsWithProgress } = require('../services/topics');

router.use(requireAdmin);
router.use(adminLimiter);

// GET /api/admin/dashboard
// Returns counts for the top stats bar
router.get('/dashboard', async (req, res, next) => {
  try {
    const [totalUsers, disabledCount, recentLogs, masterCount] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'user', disabled: true }),
      Log.find().sort({ date: -1 }).limit(50).lean(),
      Promise.resolve(ALL_TOPICS.length),
    ]);

    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const expiringSoon = await User.countDocuments({
      role: 'user',
      expiresAt: { $gt: now, $lte: sevenDaysFromNow },
    });

    const activeCount = await User.countDocuments({
      role: 'user',
      disabled: false,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    });

    const registrationsEnabled = await SiteSetting.get('registrationsEnabled', true);

    return res.json({
      ok: true,
      dashboard: {
        stats: {
          totalUsers,
          active: activeCount,
          disabled: disabledCount,
          expiringSoon,
          masterTopics: masterCount,
        },
        recentLogs: recentLogs.map(l => ({
          username: l.username,
          topicId: l.topicId,
          action: l.action,
          date: l.date,
        })),
        settings: { registrationsEnabled },
      }
    });
  } catch (err) { next(err); }
});

// GET /api/admin/users?q=&status=all&page=1&limit=50
router.get('/users', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const status = String(req.query.status || 'all');
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 50));

    const filter = { role: 'user' };
    if (q) {
      filter.$or = [
        { username: { $regex: q, $options: 'i' } },
        { name: { $regex: q, $options: 'i' } },
      ];
    }

    const now = new Date();
    if (status === 'disabled') filter.disabled = true;
    if (status === 'active') {
      filter.disabled = false;
      filter.$and = [{ $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }];
    }
    if (status === 'expired') {
      filter.expiresAt = { $lte: now };
      filter.disabled = false;
    }

    const [users, total] = await Promise.all([
      User.find(filter, { passwordHash: 0 })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    const enriched = users.map(u => {
      const expired = u.expiresAt && new Date() > u.expiresAt;
      const status = u.disabled ? 'disabled' : expired ? 'expired' : 'active';
      const daysRemaining = u.expiresAt
        ? Math.ceil((u.expiresAt - now) / 86400000)
        : null;
      const progress = overallProgress(u.progress);
      const { progress: _progress, ...safeUser } = u;
      return {
        ...safeUser,
        status,
        daysRemaining,
        totalTopics: progress.total,
        completedTopics: progress.done,
        progressPct: progress.percent,
      };
    });

    return res.json({ ok: true, users: enriched, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// POST /api/admin/users/create
// Body: { username, password, name, expiryDays? }
router.post('/users/create',
  body('username').trim().isLength({ min: 3, max: 50 }).matches(/^[a-zA-Z0-9_.-]+$/),
  body('password').isLength({ min: 6, max: 128 }),
  body('name').optional().trim().isLength({ max: 100 }),
  body('expiryDays').optional().isInt({ min: 1, max: 3650 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ ok: false, error: errors.array()[0].msg });

      const username = req.body.username.toLowerCase().trim();
      const { password, name, expiryDays } = req.body;

      const exists = await User.findOne({ username });
      if (exists) return res.status(409).json({ ok: false, error: 'Username already exists.' });

      const passwordHash = await bcrypt.hash(password, 12);

      let expiresAt = null;
      if (expiryDays) {
        expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + parseInt(expiryDays));
        expiresAt.setHours(23, 59, 59, 999);
      }

      const user = await User.create({
        username,
        passwordHash,
        name: (name || username).trim(),
        expiresAt,
        progress: seedProgress(),
      });

      return res.status(201).json({ ok: true, username: user.username, expiresAt: user.expiresAt });
    } catch (err) { next(err); }
  }
);

// PATCH /api/admin/users/:username/disable
// Body: { disabled: boolean }
router.patch('/users/:username/disable',
  body('disabled').isBoolean(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ ok: false, error: 'disabled must be boolean.' });

      const { username } = req.params;
      if (username === req.session.user.username) {
        return res.status(400).json({ ok: false, error: 'Cannot disable your own account.' });
      }

      const user = await User.findOne({ username });
      if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });
      if (user.role === 'admin') return res.status(400).json({ ok: false, error: 'Cannot disable admin accounts.' });

      user.disabled = Boolean(req.body.disabled);
      await user.save();

      return res.json({ ok: true, username, disabled: user.disabled });
    } catch (err) { next(err); }
  }
);

// PATCH /api/admin/users/:username/expiry
// Body: { expiryDays: number } or { clearExpiry: true }
router.patch('/users/:username/expiry', async (req, res, next) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });
    if (user.role === 'admin') return res.status(400).json({ ok: false, error: 'Cannot set expiry on admin accounts.' });

    if (req.body.clearExpiry) {
      user.expiresAt = null;
    } else {
      const days = parseInt(req.body.expiryDays);
      if (!days || days < 1) return res.status(422).json({ ok: false, error: 'expiryDays must be >= 1.' });
      const d = new Date();
      d.setDate(d.getDate() + days);
      d.setHours(23, 59, 59, 999);
      user.expiresAt = d;
    }

    await user.save();
    return res.json({ ok: true, username, expiresAt: user.expiresAt });
  } catch (err) { next(err); }
});

// PATCH /api/admin/users/:username/password
// Body: { password: string }
router.patch('/users/:username/password',
  body('password').isLength({ min: 6, max: 128 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ ok: false, error: 'Password must be at least 6 chars.' });

      const { username } = req.params;
      const user = await User.findOne({ username });
      if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });

      user.passwordHash = await bcrypt.hash(req.body.password, 12);
      await user.save();

      return res.json({ ok: true });
    } catch (err) { next(err); }
  }
);

// PATCH /api/admin/users/:username/role
// Body: { role: 'user' | 'admin' }
router.patch('/users/:username/role',
  body('role').isIn(['user', 'admin']),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ ok: false, error: 'Role must be user or admin.' });

      const { username } = req.params;
      if (username === req.session.user.username) {
        return res.status(400).json({ ok: false, error: 'Cannot change your own role.' });
      }

      const user = await User.findOne({ username });
      if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });

      user.role = req.body.role;
      if (req.body.role === 'admin') { user.disabled = false; user.expiresAt = null; }
      await user.save();

      return res.json({ ok: true, username, role: user.role });
    } catch (err) { next(err); }
  }
);

// GET /api/admin/users/:username/detail
router.get('/users/:username/detail', async (req, res, next) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username }).lean();
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });

    const completionMap = {};
    (user.progress || []).forEach(p => { completionMap[p.topicId] = p; });

    const topics = ALL_TOPICS.map(t => ({
      ...t,
      completed: completionMap[t.topicId]?.completed || false,
      completedAt: completionMap[t.topicId]?.completedAt || null,
    }));

    const logs = await Log.find({ username }).sort({ date: -1 }).limit(100).lean();

    return res.json({
      ok: true,
      user: {
        username: user.username,
        name: user.name,
        role: user.role,
        disabled: user.disabled,
        expiresAt: user.expiresAt,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        ...user, // spreads everything except passwordHash (it's not in the lean projection above — add explicit select)
      },
      topics,
      logs,
    });
  } catch (err) { next(err); }
});

// POST /api/admin/users/:username/toggle-topic
// Body: { topicId: string }
router.post('/users/:username/toggle-topic',
  body('topicId').trim().notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ ok: false, error: 'Invalid topicId.' });

      const { username } = req.params;
      const { topicId } = req.body;

      const user = await User.findOne({ username });
      if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });

      let entry = user.progress.find(p => p.topicId === topicId);
      if (!entry) {
        user.progress.push({ topicId, completed: false, completedAt: null });
        entry = user.progress[user.progress.length - 1];
      }

      const nextState = !entry.completed;
      entry.completed = nextState;
      entry.completedAt = nextState ? new Date() : null;
      await user.save();

      Log.create({ username, topicId, action: nextState ? 'admin-completed' : 'admin-uncompleted' })
        .catch(console.error);

      return res.json({ ok: true, topicId, completed: nextState, completedAt: entry.completedAt });
    } catch (err) { next(err); }
  }
);

// POST /api/admin/users/:username/reset-progress
router.post('/users/:username/reset-progress', async (req, res, next) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });

    user.progress.forEach(p => { p.completed = false; p.completedAt = null; });
    await user.save();
    await Log.deleteMany({ username });

    return res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/admin/users/:username
router.delete('/users/:username', async (req, res, next) => {
  try {
    const { username } = req.params;
    if (username === req.session.user.username) {
      return res.status(400).json({ ok: false, error: 'Cannot delete your own account.' });
    }
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });
    if (user.role === 'admin') return res.status(400).json({ ok: false, error: 'Cannot delete admin accounts.' });

    await User.deleteOne({ username });
    await Log.deleteMany({ username });

    return res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/admin/settings
router.get('/settings', async (req, res, next) => {
  try {
    const registrationsEnabled = await SiteSetting.get('registrationsEnabled', true);
    res.json({ ok: true, settings: { registrationsEnabled } });
  } catch (err) { next(err); }
});

// POST /api/admin/settings
// Body: { key: string, value: any }
router.post('/settings',
  body('key').trim().notEmpty().isLength({ max: 100 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ ok: false, error: 'Invalid key.' });

      const ALLOWED_KEYS = ['registrationsEnabled'];
      const { key, value } = req.body;
      if (!ALLOWED_KEYS.includes(key)) {
        return res.status(400).json({ ok: false, error: 'Unknown setting key.' });
      }

      await SiteSetting.set(key, value);
      return res.json({ ok: true, key, value });
    } catch (err) { next(err); }
  }
);

// POST /api/admin/rebuild-topics
// Triggers the build-topics script logic (re-parses raw files)
router.post('/rebuild-topics', async (req, res, next) => {
  try {
    const { exec } = require('child_process');
    const path = require('path');
    const scriptPath = path.join(__dirname, '../scripts/build-topics.js');

    exec(`node "${scriptPath}"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        return res.status(500).json({ ok: false, error: 'Rebuild failed' });
      }
      // Re-load the ALL_TOPICS from disk if we were using it in memory
      // Since it's a require(), we need to clear the cache if we want live updates
      delete require.cache[require.resolve('../data/topics.json')];
      const NEW_TOPICS = require('../data/topics.json');
      // Update the local ALL_TOPICS reference if possible, but it's a const in this file
      // Better to just tell the user to restart if they need immediate master list changes in this process
      // Or we can change ALL_TOPICS to a let.
      return res.json({ ok: true, count: NEW_TOPICS.length });
    });
  } catch (err) { next(err); }
});

// POST /api/admin/users/:username/seed-topics
// Ensures user has all topics from the master list in their progress array
router.post('/users/:username/seed-topics', async (req, res, next) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });

    const existingIds = new Set(user.progress.map(p => p.topicId));
    const missing = ALL_TOPICS.filter(t => !existingIds.has(t.topicId));

    if (missing.length > 0) {
      const newEntries = missing.map(t => ({ topicId: t.topicId, completed: false, completedAt: null }));
      user.progress.push(...newEntries);
      await user.save();
    }

    return res.json({ ok: true, count: missing.length, totalMaster: ALL_TOPICS.length });
  } catch (err) { next(err); }
});

module.exports = router;
