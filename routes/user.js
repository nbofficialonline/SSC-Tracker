const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Log = require('../models/Log');
const StudySession = require('../models/StudySession');
const { requireLogin } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');
const { body, validationResult } = require('express-validator');
const {
  ALL_TOPICS,
  categoryStats,
  overallProgress,
  topicsWithProgress,
} = require('../services/topics');
const { getStudyPayload } = require('../services/studySessions');

// All user routes require login
router.use(requireLogin);
router.use(apiLimiter);

// Helper — load topics JSON once at module load (not per-request)
const TOPICS_MAP = {};
ALL_TOPICS.forEach(t => { TOPICS_MAP[t.topicId] = t; });

// GET /api/user/categories
// Returns the list of subjects with total topic counts for the sidebar
router.get('/categories', async (req, res, next) => {
  try {
    const username = req.session.user.username;
    const user = await User.findOne({ username }).lean();
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });

    const studyPayload = await getStudyPayload(username);

    return res.json({
      ok: true,
      user: req.session.user,
      categories: categoryStats(user.progress),
      topics: topicsWithProgress(user.progress),
      overallProgress: overallProgress(user.progress),
      ...studyPayload,
    });
  } catch (err) { next(err); }
});

// GET /api/user/profile
router.get('/profile', async (req, res, next) => {
  try {
    const username = req.session.user.username;
    const user = await User.findOne({ username }, { passwordHash: 0 }).lean();
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });

    const progress = overallProgress(user.progress);
    const studyPayload = await getStudyPayload(username);

    return res.json({
      ok: true,
      profile: {
        userId: user.userId,
        username: user.username,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
        expiresAt: user.expiresAt,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
      overallProgress: progress,
      studyStats: studyPayload.studyStats,
    });
  } catch (err) { next(err); }
});

// GET /api/user/topics?category=Maths+Arithmetic
// Returns topics for one category, or all topics if no category is supplied.
router.get('/topics', async (req, res, next) => {
  try {
    const username = req.session.user.username;
    const category = String(req.query.category || '').trim();

    const user = await User.findOne({ username }, { progress: 1 }).lean();
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });

    return res.json({
      ok: true,
      topics: topicsWithProgress(user.progress, category || null),
      overallProgress: overallProgress(user.progress),
    });
  } catch (err) { next(err); }
});

// GET /api/user/overall-progress
// Returns done/total counts across ALL topics for the user
router.get('/overall-progress', async (req, res, next) => {
  try {
    const username = req.session.user.username;
    const user = await User.findOne({ username }, { progress: 1 }).lean();
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });

    return res.json({
      ok: true,
      overallProgress: overallProgress(user.progress),
    });
  } catch (err) { next(err); }
});

router.get('/study-sessions', async (req, res, next) => {
  try {
    const payload = await getStudyPayload(req.session.user.username);
    res.json({ ok: true, ...payload });
  } catch (err) { next(err); }
});

router.post('/study-sessions',
  body('startedAt').isISO8601().toDate(),
  body('endedAt').isISO8601().toDate(),
  body('durationSec').isInt({ min: 1, max: 24 * 60 * 60 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ ok: false, error: 'Invalid study session.' });

      const startedAt = req.body.startedAt;
      const endedAt = req.body.endedAt;
      if (endedAt <= startedAt) {
        return res.status(422).json({ ok: false, error: 'Study session end must be after start.' });
      }

      await StudySession.create({
        username: req.session.user.username,
        startedAt,
        endedAt,
        durationSec: Number(req.body.durationSec),
      });

      const payload = await getStudyPayload(req.session.user.username);
      res.status(201).json({ ok: true, ...payload });
    } catch (err) { next(err); }
  }
);

// POST /api/user/toggle-topic
// Body: { topicId: string }
// Toggles completion status optimistically, returns new state
router.post('/toggle-topic',
  body('topicId').trim().notEmpty().isLength({ max: 200 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ ok: false, error: 'Invalid topicId.' });

      const username = req.session.user.username;
      const topicId = req.body.topicId;

      // Verify topic exists in master list
      if (!TOPICS_MAP[topicId]) {
        return res.status(404).json({ ok: false, error: 'Topic not found.' });
      }

      const user = await User.findOne({ username });
      if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });

      let progressEntry = user.progress.find(p => p.topicId === topicId);

      if (!progressEntry) {
        // Auto-seed this topic if missing (shouldn't normally happen)
        user.progress.push({ topicId, completed: false, completedAt: null });
        progressEntry = user.progress[user.progress.length - 1];
      }

      const nextState = !progressEntry.completed;
      progressEntry.completed = nextState;
      progressEntry.completedAt = nextState ? new Date() : null;

      await user.save();

      // Write log asynchronously (fire and forget)
      Log.create({
        username,
        topicId,
        action: nextState ? 'completed' : 'uncompleted',
      }).catch(err => console.error('Log write failed:', err));

      return res.json({
        ok: true,
        topicId,
        completed: nextState,
        completedAt: progressEntry.completedAt,
        overallProgress: overallProgress(user.progress),
      });
    } catch (err) { next(err); }
  }
);

// POST /api/user/set-topics-completion
// Body: { topicIds: string[], completed: boolean }
// Updates a group of topics in one round trip for subject/subsection actions.
router.post('/set-topics-completion',
  body('topicIds').isArray({ min: 1, max: 500 }).withMessage('topicIds must be a non-empty array.'),
  body('topicIds.*').trim().notEmpty().isLength({ max: 200 }),
  body('completed').isBoolean().withMessage('completed must be boolean.'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ ok: false, error: errors.array()[0].msg });

      const username = req.session.user.username;
      const topicIds = [...new Set(req.body.topicIds.map((id) => String(id).trim()))];
      const invalidTopic = topicIds.find((topicId) => !TOPICS_MAP[topicId]);
      if (invalidTopic) {
        return res.status(404).json({ ok: false, error: `Topic not found: ${invalidTopic}` });
      }

      const user = await User.findOne({ username });
      if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });

      const completed = Boolean(req.body.completed);
      const completedAt = completed ? new Date() : null;
      const changedTopics = [];

      topicIds.forEach((topicId) => {
        let progressEntry = user.progress.find((p) => p.topicId === topicId);
        if (!progressEntry) {
          user.progress.push({ topicId, completed: false, completedAt: null });
          progressEntry = user.progress[user.progress.length - 1];
        }

        if (progressEntry.completed !== completed) {
          progressEntry.completed = completed;
          progressEntry.completedAt = completedAt;
          changedTopics.push({ topicId, completed, completedAt });
        }
      });

      if (changedTopics.length) {
        await user.save();
        Log.insertMany(changedTopics.map((topic) => ({
          username,
          topicId: topic.topicId,
          action: completed ? 'completed' : 'uncompleted',
        }))).catch((err) => console.error('Batch log write failed:', err));
      }

      return res.json({
        ok: true,
        completed,
        changedTopics,
        overallProgress: overallProgress(user.progress),
      });
    } catch (err) { next(err); }
  }
);

// GET /api/user/settings
router.get('/settings', async (req, res, next) => {
  try {
    const user = await User.findOne({ username: req.session.user.username }, { theme: 1, name: 1 }).lean();
    if (!user) return res.status(404).json({ ok: false, error: 'Not found.' });
    res.json({ ok: true, settings: { theme: user.theme, name: user.name } });
  } catch (err) { next(err); }
});

// POST /api/user/settings
// Body: { theme?: 'light'|'dark', name?: string }
router.post('/settings',
  body('theme').optional().isIn(['light', 'dark']).withMessage('Theme must be light or dark.'),
  body('name').optional().trim().isLength({ max: 100 }).withMessage('Name too long.'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ ok: false, error: errors.array()[0].msg });

      const update = {};
      if (req.body.theme) update.theme = req.body.theme;
      if (req.body.name)  update.name  = req.body.name.trim();

      await User.updateOne({ username: req.session.user.username }, update);

      // Update session too
      if (update.theme) req.session.user.theme = update.theme;
      if (update.name)  req.session.user.name  = update.name;

      res.json({ ok: true });
    } catch (err) { next(err); }
  }
);

// POST /api/user/reset-progress
router.post('/reset-progress', async (req, res, next) => {
  try {
    const username = req.session.user.username;
    await User.updateOne(
      { username },
      { $set: { 'progress.$[].completed': false, 'progress.$[].completedAt': null } }
    );
    await Log.deleteMany({ username });
    await StudySession.deleteMany({ username });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
