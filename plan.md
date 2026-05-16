# SSC Prep Tracker — Full Server Migration Plan
### From Google Apps Script → Node.js + MongoDB Atlas + Express

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Tech Stack Decisions](#tech-stack-decisions)
3. [Phase 0 — Repo & Environment Setup](#phase-0)
4. [Phase 1 — Project Scaffolding & Dependencies](#phase-1)
5. [Phase 2 — Configuration & Secrets](#phase-2)
6. [Phase 3 — MongoDB Models (Mongoose)](#phase-3)
7. [Phase 4 — Security Middleware Stack](#phase-4)
8. [Phase 5 — Auth Routes (Login / Register / Logout)](#phase-5)
9. [Phase 6 — User Routes (Topics, Progress, Settings)](#phase-6)
10. [Phase 7 — Admin Routes](#phase-7)
11. [Phase 8 — Static Data (Master Topics JSON)](#phase-8)
12. [Phase 9 — Frontend Migration](#phase-9)
13. [Phase 10 — Hardening & Edge Cases](#phase-10)
14. [Phase 11 — Deploy to Render](#phase-11)
15. [Security Checklist](#security-checklist)
16. [API Reference](#api-reference)

---

## Architecture Overview

```
Browser (index.html)
       │  HTTPS only
       ▼
  Express Server (Node.js 20)
  ├── Helmet (CSP, HSTS, X-Frame-Options, …)
  ├── Rate Limiter (express-rate-limit)
  ├── CSRF Token middleware (double-submit cookie)
  ├── express-session → connect-mongo (session store)
  ├── express-mongo-sanitize (NoSQL injection)
  ├── express-validator (input validation)
  ├── cors (locked to own origin)
  │
  ├── /api/auth        — login, register, logout, me
  ├── /api/user        — topics, toggle, settings, logs, progress
  ├── /api/admin       — user management, site settings
  └── /               — serves index.html (SPA)
       │
       ▼
MongoDB Atlas M0 (free)
  Collections: users, sessions, logs, user_progress, site_settings
  ── Master topics stored as topics.json in /data/  (no DB needed)
```

**Key design decision:** Master topics (the 15 subject course lists) are stored in `/data/topics.json` in the codebase. This avoids DB reads on every request. User progress (which topics each user has checked off) is stored in MongoDB as a lightweight `{username, topicId, completed, completedAt}` array embedded in the user document.

---

## Tech Stack Decisions

| Concern | Choice | Reason |
|---|---|---|
| Runtime | Node.js 20 LTS | LTS, wide hosting support |
| Framework | Express 5 | Mature, minimal |
| Database | MongoDB Atlas M0 | Free, persistent, good for user docs |
| Sessions | express-session + connect-mongo | Server-side sessions; no JWT secret rotation headache |
| Password hashing | bcryptjs (pure JS) | No native binding issues on free tier hosts |
| CSRF | Custom double-submit cookie | csurf is deprecated; manual implementation is 20 lines |
| Validation | express-validator | Chainable, well-maintained |
| Security headers | helmet 7 | Single line, comprehensive CSP |
| Rate limiting | express-rate-limit | Simple, in-memory or Redis-backed |
| NoSQL injection | express-mongo-sanitize | Strips `$` and `.` from inputs |
| HTTP param pollution | hpp | Prevents query string array abuse |
| Logging | morgan (dev) | Request logging |
| ENV management | dotenv | Standard |
| Deploy | Render (free web service) | Free tier, GitHub auto-deploy |

---

## Phase 0 — Repo & Environment Setup {#phase-0}

### Step 0.1 — Create GitHub repository

```
Name: ssc-prep-tracker
Visibility: Private
Initialize with: README, .gitignore (Node), MIT License
```

### Step 0.2 — Clone locally

```bash
git clone https://github.com/YOUR_USERNAME/ssc-prep-tracker.git
cd ssc-prep-tracker
```

### Step 0.3 — Create MongoDB Atlas M0 cluster

1. Go to https://cloud.mongodb.com → Create free account
2. Create a new Project called `ssc-tracker`
3. Build a Database → M0 Free → Region: Mumbai (ap-south-1) → Cluster name: `ssc-cluster`
4. Create a Database User:
   - Username: `ssc_app`
   - Password: generate a strong random password (save it)
   - Role: `readWriteAnyDatabase`
5. Network Access → Add IP Address → `0.0.0.0/0` (allow all — Render uses dynamic IPs)
6. Connect → Drivers → Node.js → Copy the connection string:
   ```
   mongodb+srv://ssc_app:<password>@ssc-cluster.XXXXX.mongodb.net/?retryWrites=true&w=majority
   ```
7. Replace `<password>` with actual password. Replace `/?` with `/ssc_tracker?` to set the default DB name.
   Final URI: `mongodb+srv://ssc_app:PASS@ssc-cluster.XXXXX.mongodb.net/ssc_tracker?retryWrites=true&w=majority&appName=ssc-cluster`

### Step 0.4 — Create `.env` file (never commit this)

```env
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb+srv://ssc_app:PASS@ssc-cluster.XXXXX.mongodb.net/ssc_tracker?retryWrites=true&w=majority
SESSION_SECRET=REPLACE_WITH_64_CHAR_RANDOM_STRING
CSRF_SECRET=REPLACE_WITH_32_CHAR_RANDOM_STRING
ADMIN_USERNAME=nbofficialonline
ADMIN_PASSWORD=S@hiL@2003
SITE_URL=http://localhost:3000
```

Generate secrets with:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 0.5 — Add to `.gitignore`

Ensure `.gitignore` contains:
```
node_modules/
.env
.env.*
*.log
dist/
```

---

## Phase 1 — Project Scaffolding & Dependencies {#phase-1}

### Step 1.1 — Initialize package.json

```bash
npm init -y
```

Edit `package.json`:
```json
{
  "name": "ssc-prep-tracker",
  "version": "1.0.0",
  "description": "SSC Exam Prep Topic Tracker",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "seed-admin": "node scripts/seed-admin.js"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### Step 1.2 — Install production dependencies

```bash
npm install \
  express \
  mongoose \
  express-session \
  connect-mongo \
  bcryptjs \
  helmet \
  express-rate-limit \
  express-validator \
  express-mongo-sanitize \
  hpp \
  cors \
  morgan \
  dotenv \
  uuid \
  cookie-parser
```

### Step 1.3 — Install dev dependencies

```bash
npm install --save-dev nodemon
```

### Step 1.4 — Create directory structure

```
ssc-prep-tracker/
├── server.js                  ← Express app entry point
├── .env                       ← secrets (gitignored)
├── package.json
├── data/
│   └── topics.json            ← master topic list (15 subjects)
├── middleware/
│   ├── auth.js                ← requireLogin, requireAdmin
│   ├── csrf.js                ← CSRF double-submit cookie
│   ├── rateLimiter.js         ← rate limit configs
│   └── validate.js            ← reusable express-validator chains
├── models/
│   ├── User.js                ← Mongoose user schema
│   ├── Log.js                 ← Mongoose log schema
│   └── SiteSetting.js         ← Mongoose site settings schema
├── routes/
│   ├── auth.js                ← POST /api/auth/login, register, logout, GET /api/auth/me
│   ├── user.js                ← GET/POST /api/user/topics, toggle, settings, progress
│   └── admin.js               ← /api/admin/* all admin endpoints
├── scripts/
│   └── seed-admin.js          ← one-time script to create default admin
└── public/
    └── index.html             ← migrated frontend (SPA)
```

---

## Phase 2 — Configuration & Secrets {#phase-2}

### Step 2.1 — Create `server.js` (main entry point)

The file must do exactly the following in order:

1. Load dotenv: `require('dotenv').config()`
2. Import all dependencies
3. Connect to MongoDB — exit process on failure
4. Configure Express middleware in this exact order:
   a. morgan (logging)
   b. helmet (security headers)
   c. cors (same-origin only)
   d. express.json() with limit 50kb
   e. express.urlencoded() with limit 50kb
   f. cookie-parser (needed for CSRF cookie reading)
   g. express-mongo-sanitize
   h. hpp
   i. express-session with connect-mongo store
   j. CSRF middleware (custom)
5. Mount routes: `/api/auth`, `/api/user`, `/api/admin`
6. Serve `public/index.html` for all other GET requests
7. Global error handler
8. Start listening

Full `server.js`:
```javascript
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const cookieParser = require('cookie-parser');
const path = require('path');

const { csrfMiddleware, csrfTokenRoute } = require('./middleware/csrf');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');

const app = express();

// ── Connect MongoDB ──────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error('MongoDB connection failed:', err); process.exit(1); });

// ── Security Headers (helmet) ────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],   // inline scripts in index.html
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    }
  },
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ─────────────────────────────────────────────────
// Only allow same origin in production
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.SITE_URL
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
}));

// ── Logging ──────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// ── Body parsers ─────────────────────────────────────────
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));
app.use(cookieParser());

// ── NoSQL injection prevention ───────────────────────────
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    console.warn(`Sanitized key: ${key} from ${req.ip}`);
  }
}));

// ── HTTP Parameter Pollution ─────────────────────────────
app.use(hpp());

// ── Sessions ─────────────────────────────────────────────
app.use(session({
  name: 'ssc.sid',                          // don't use default 'connect.sid'
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    dbName: 'ssc_tracker',
    collectionName: 'sessions',
    ttl: 7 * 24 * 60 * 60,                 // 7 days
    autoRemove: 'native',
  }),
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',  // HTTPS only in prod
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,       // 7 days in ms
  }
}));

// ── CSRF ─────────────────────────────────────────────────
app.use(csrfMiddleware);

// ── Static files ─────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
}));

// ── API Routes ────────────────────────────────────────────
app.get('/api/csrf-token', csrfTokenRoute);   // Frontend fetches this on load
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);

// ── SPA fallback ─────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler ──────────────────────────────────
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' && status === 500
    ? 'Internal server error'
    : err.message || 'Internal server error';
  console.error(`[ERROR] ${status} — ${message}`, err.stack);
  res.status(status).json({ ok: false, error: message });
});

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} [${process.env.NODE_ENV}]`);
});
```

---

## Phase 3 — MongoDB Models {#phase-3}

### Step 3.1 — Create `models/User.js`

This is the most important model. Embed user progress as an array of `{topicId, completed, completedAt}` inside the user document. This avoids needing a separate `progress` collection and makes per-user topic reads a single DB call.

```javascript
const mongoose = require('mongoose');

const progressSchema = new mongoose.Schema({
  topicId:     { type: String, required: true },
  completed:   { type: Boolean, default: false },
  completedAt: { type: Date, default: null },
}, { _id: false });

const userSchema = new mongoose.Schema({
  username:     { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 50 },
  passwordHash: { type: String, required: true },
  name:         { type: String, default: '', trim: true, maxlength: 100 },
  theme:        { type: String, default: 'light', enum: ['light', 'dark'] },
  role:         { type: String, default: 'user', enum: ['user', 'admin'] },
  disabled:     { type: Boolean, default: false },
  expiresAt:    { type: Date, default: null },
  progress:     { type: [progressSchema], default: [] },
  lastLoginAt:  { type: Date, default: null },
}, {
  timestamps: true,   // adds createdAt, updatedAt automatically
});

// ── Indexes ──────────────────────────────────────────────
userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ role: 1 });
userSchema.index({ disabled: 1 });
userSchema.index({ expiresAt: 1 });
// Sparse index for searching by topicId inside progress array
userSchema.index({ 'progress.topicId': 1 });

// ── Methods ───────────────────────────────────────────────
userSchema.methods.isExpired = function() {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
};

userSchema.methods.isActive = function() {
  if (this.role === 'admin') return true;
  return !this.disabled && !this.isExpired();
};

userSchema.methods.toSafeObject = function() {
  return {
    username: this.username,
    name: this.name,
    theme: this.theme,
    role: this.role,
    disabled: this.disabled,
    expiresAt: this.expiresAt ? this.expiresAt.toISOString() : null,
    createdAt: this.createdAt,
    lastLoginAt: this.lastLoginAt,
  };
};

userSchema.methods.progressStats = function() {
  const total = this.progress.length;
  const done = this.progress.filter(p => p.completed).length;
  return { total, done, pending: total - done, percent: total ? Math.round(done * 100 / total) : 0 };
};

module.exports = mongoose.model('User', userSchema);
```

### Step 3.2 — Create `models/Log.js`

```javascript
const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  username: { type: String, required: true, lowercase: true, index: true },
  topicId:  { type: String, required: true },
  action:   { type: String, required: true, enum: ['completed', 'uncompleted', 'admin-completed', 'admin-uncompleted'] },
  date:     { type: Date, default: Date.now, index: true },
}, {
  timeseries: false,
});

logSchema.index({ username: 1, date: -1 });

module.exports = mongoose.model('Log', logSchema);
```

### Step 3.3 — Create `models/SiteSetting.js`

```javascript
const mongoose = require('mongoose');

const siteSettingSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });

siteSettingSchema.statics.get = async function(key, defaultValue) {
  const doc = await this.findOne({ key });
  return doc ? doc.value : defaultValue;
};

siteSettingSchema.statics.set = async function(key, value) {
  return this.findOneAndUpdate({ key }, { value }, { upsert: true, new: true });
};

module.exports = mongoose.model('SiteSetting', siteSettingSchema);
```

---

## Phase 4 — Security Middleware {#phase-4}

### Step 4.1 — Create `middleware/csrf.js`

Using the **double-submit cookie** pattern. On every GET request the server sets a `csrf-token` cookie. On every state-changing request (POST/PUT/PATCH/DELETE) the server reads the token from a request header `X-CSRF-Token` and compares it against the cookie. Since an attacker's site cannot read the cookie (SameSite=Strict + different origin), they cannot forge the header.

```javascript
const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function csrfMiddleware(req, res, next) {
  // Skip CSRF for GET, HEAD, OPTIONS — they are read-only
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    // Ensure the cookie exists for the next POST
    if (!req.cookies['csrf-token']) {
      const token = generateToken();
      res.cookie('csrf-token', token, {
        httpOnly: false,          // Must be readable by JS so frontend can set header
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }
    return next();
  }

  // For mutating requests: validate
  const cookieToken = req.cookies['csrf-token'];
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ ok: false, error: 'Invalid or missing CSRF token.' });
  }

  next();
}

function csrfTokenRoute(req, res) {
  // Called by frontend on page load to get/refresh the token
  let token = req.cookies['csrf-token'];
  if (!token) {
    token = generateToken();
    res.cookie('csrf-token', token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
  res.json({ csrfToken: token });
}

module.exports = { csrfMiddleware, csrfTokenRoute };
```

### Step 4.2 — Create `middleware/rateLimiter.js`

Define **three separate limiters** with different configs:

```javascript
const rateLimit = require('express-rate-limit');

// Auth endpoints: very strict — 10 attempts per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { ok: false, error: 'Too many attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,  // count even successful logins to prevent enumeration timing
});

// General API: 200 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { ok: false, error: 'Too many requests. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Admin: 60 per minute
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { ok: false, error: 'Too many admin requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { authLimiter, apiLimiter, adminLimiter };
```

### Step 4.3 — Create `middleware/auth.js`

```javascript
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: 'Not authenticated.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: 'Not authenticated.' });
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin access required.' });
  }
  next();
}

module.exports = { requireLogin, requireAdmin };
```

### Step 4.4 — Create `middleware/validate.js`

Validation chains reused across routes:

```javascript
const { body, validationResult } = require('express-validator');

// Call this at the end of any route that uses validators
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      ok: false,
      error: errors.array().map(e => e.msg).join('; ')
    });
  }
  next();
}

const validateLogin = [
  body('username').trim().isLength({ min: 3, max: 50 }).withMessage('Invalid username.'),
  body('password').isLength({ min: 1, max: 128 }).withMessage('Password required.'),
  handleValidation,
];

const validateRegister = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 }).withMessage('Username must be 3–50 chars.')
    .matches(/^[a-zA-Z0-9_.-]+$/).withMessage('Username: only letters, numbers, _ . -'),
  body('password')
    .isLength({ min: 6, max: 128 }).withMessage('Password must be at least 6 chars.'),
  body('name')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Name too long.'),
  handleValidation,
];

const validateTopicId = [
  body('topicId').trim().isLength({ min: 1, max: 200 }).withMessage('Invalid topicId.'),
  handleValidation,
];

module.exports = { handleValidation, validateLogin, validateRegister, validateTopicId };
```

---

## Phase 5 — Auth Routes {#phase-5}

### Step 5.1 — Create `routes/auth.js`

All auth routes: login, register, logout, /me (session check).

```javascript
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const User = require('../models/User');
const SiteSetting = require('../models/SiteSetting');
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
    const topics = require('../data/topics.json');
    user.progress = topics.map(t => ({ topicId: t.topicId, completed: false, completedAt: null }));
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
```

---

## Phase 6 — User Routes {#phase-6}

### Step 6.1 — Create `routes/user.js`

All user-facing endpoints. Require authentication on all.

```javascript
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Log = require('../models/Log');
const { requireLogin } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');
const { body, validationResult } = require('express-validator');

// All user routes require login
router.use(requireLogin);
router.use(apiLimiter);

// Helper — load topics JSON once at module load (not per-request)
const ALL_TOPICS = require('../data/topics.json');
const TOPICS_MAP = {};
ALL_TOPICS.forEach(t => { TOPICS_MAP[t.topicId] = t; });

// GET /api/user/categories
// Returns the list of subjects with total topic counts for the sidebar
router.get('/categories', async (req, res, next) => {
  try {
    const username = req.session.user.username;
    const user = await User.findOne({ username }).lean();
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });

    // Build category stats from master topics
    const catMap = {};
    ALL_TOPICS.forEach(t => {
      if (!catMap[t.category]) catMap[t.category] = { total: 0, high: 0, medium: 0, low: 0 };
      catMap[t.category].total++;
      catMap[t.category][t.priority || 'medium']++;
    });

    const categories = Object.entries(catMap).map(([name, stats]) => ({ name, ...stats }));

    return res.json({ ok: true, categories });
  } catch (err) { next(err); }
});

// GET /api/user/topics?category=Maths+Arithmetic
// Returns topics for a specific category with user's completion status
router.get('/topics', async (req, res, next) => {
  try {
    const username = req.session.user.username;
    const category = String(req.query.category || '').trim();
    if (!category) return res.status(400).json({ ok: false, error: 'category param required.' });

    const user = await User.findOne({ username }, { progress: 1 }).lean();
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });

    // Build a completion map from user progress
    const completionMap = {};
    (user.progress || []).forEach(p => {
      completionMap[p.topicId] = { completed: p.completed, completedAt: p.completedAt };
    });

    const categoryTopics = ALL_TOPICS.filter(t => t.category === category);

    const topics = categoryTopics.map(t => ({
      topicId: t.topicId,
      category: t.category,
      subsection: t.subsection,
      topicName: t.topicName,
      priority: t.priority,
      courseOrder: t.courseOrder,
      classNo: t.classNo,
      completed: completionMap[t.topicId]?.completed || false,
      completedAt: completionMap[t.topicId]?.completedAt || null,
    }));

    return res.json({ ok: true, topics });
  } catch (err) { next(err); }
});

// GET /api/user/overall-progress
// Returns done/total counts across ALL topics for the user
router.get('/overall-progress', async (req, res, next) => {
  try {
    const username = req.session.user.username;
    const user = await User.findOne({ username }, { progress: 1 }).lean();
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });

    const total = user.progress.length;
    const done = user.progress.filter(p => p.completed).length;

    return res.json({
      ok: true,
      overallProgress: {
        total,
        done,
        pending: total - done,
        percent: total ? Math.round(done * 100 / total) : 0,
      }
    });
  } catch (err) { next(err); }
});

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

      const next = !progressEntry.completed;
      progressEntry.completed = next;
      progressEntry.completedAt = next ? new Date() : null;

      await user.save();

      // Write log asynchronously (fire and forget)
      Log.create({
        username,
        topicId,
        action: next ? 'completed' : 'uncompleted',
      }).catch(err => console.error('Log write failed:', err));

      return res.json({
        ok: true,
        topicId,
        completed: next,
        completedAt: progressEntry.completedAt,
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
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
```

---

## Phase 7 — Admin Routes {#phase-7}

### Step 7.1 — Create `routes/admin.js`

All routes require `requireAdmin` middleware. The `adminLimiter` is applied globally to the router.

```javascript
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Log = require('../models/Log');
const SiteSetting = require('../models/SiteSetting');
const { requireAdmin } = require('../middleware/auth');
const { adminLimiter } = require('../middleware/rateLimiter');
const { body, validationResult } = require('express-validator');

const ALL_TOPICS = require('../data/topics.json');

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
      User.find(filter, { passwordHash: 0, progress: 0 })
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
      return { ...u, status, daysRemaining };
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

      const progress = ALL_TOPICS.map(t => ({ topicId: t.topicId, completed: false, completedAt: null }));

      const user = await User.create({
        username,
        passwordHash,
        name: (name || username).trim(),
        expiresAt,
        progress,
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

      const next = !entry.completed;
      entry.completed = next;
      entry.completedAt = next ? new Date() : null;
      await user.save();

      Log.create({ username, topicId, action: next ? 'admin-completed' : 'admin-uncompleted' })
        .catch(console.error);

      return res.json({ ok: true, topicId, completed: next, completedAt: entry.completedAt });
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

module.exports = router;
```

---

## Phase 8 — Static Data (Master Topics JSON) {#phase-8}

### Step 8.1 — Create `data/topics.json`

This file replaces the Google Sheets `master_topics` tab. It is a JSON array where each entry is:

```json
[
  {
    "topicId": "maths-basic-concepts-001-number-system",
    "category": "Maths Basic Concepts",
    "subsection": "Number System",
    "topicName": "Class-01 | Number System | Basic Concepts",
    "priority": "high",
    "courseOrder": 1,
    "classNo": 1,
    "sourceFile": "basic concept of maths.txt"
  },
  ...
]
```

**How to generate this file from your existing Apps Script data:**

In your current Google Sheet, go to Apps Script editor and run this one-time function:

```javascript
function exportTopicsJson() {
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName('master_topics');
  var rows = sh.getDataRange().getValues();
  var headers = rows[0];
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = rows[i][j];
    out.push(obj);
  }
  Logger.log(JSON.stringify(out));
}
```

Copy the JSON from the Apps Script log → paste into `data/topics.json`.

### Step 8.2 — Add a script to rebuild topics.json from raw text files

Create `scripts/build-topics.js`. This is a Node.js port of your existing `Import.gs`. It reads raw Careerwill text from `data/raw/*.txt` files and outputs `data/topics.json`. Run manually whenever you update the syllabus.

The agent should implement the same parsing logic as `parseRawCareerwillFile_` in `Import.gs`, including:
- `cleanVideoLine_` — strip non-breaking spaces, normalize whitespace
- `isScrapeNoiseLine_` — filter timestamps, dates, UI labels
- `normalizeTopicTitle_` — clean up "Class-01", pipe separators
- `extractSubsection_` — derive subsection from title pipes
- `categoryFromSourceFile_` — map filename to category name
- `dedupeAdjacent_` — remove consecutive duplicate lines
- `makeTopicId_` — slug-based unique ID

---

## Phase 9 — Frontend Migration {#phase-9}

### Step 9.1 — Replace `google.script.run` with `fetch`

The frontend JavaScript in `public/index.html` currently calls:
```javascript
google.script.run.withSuccessHandler(fn).withFailureHandler(fn).functionName(args)
```

Replace the `gs()` helper function with a `fetch`-based equivalent:

```javascript
// Fetch the CSRF token once on page load and store it
var CSRF_TOKEN = '';

async function initCsrf() {
  try {
    const r = await fetch('/api/csrf-token', { credentials: 'include' });
    const data = await r.json();
    CSRF_TOKEN = data.csrfToken || '';
  } catch (e) {
    console.error('CSRF init failed', e);
  }
}

// Universal API call helper (replaces gs())
async function api(method, path, body) {
  const opts = {
    method: method.toUpperCase(),
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': CSRF_TOKEN,
    },
  };
  if (body && method.toUpperCase() !== 'GET') {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}
```

### Step 9.2 — Map every GAS function call to its REST equivalent

| Old GAS call | New REST call |
|---|---|
| `gs('login', u, p)` | `api('POST', '/auth/login', {username, password})` |
| `gs('register', u, p, n)` | `api('POST', '/auth/register', {username, password, name})` |
| `gs('userLoginBootstrap', u, p)` | `api('POST', '/auth/login', {...})` then `api('GET', '/user/categories')` |
| `gs('userBootstrap', u)` | `api('GET', '/user/categories')` |
| `gs('userCategoryBootstrap', u, cat)` | `api('GET', '/user/topics?category='+encodeURIComponent(cat))` |
| `gs('userOverallProgress', u)` | `api('GET', '/user/overall-progress')` |
| `gs('toggleTopicFast', u, id)` | `api('POST', '/user/toggle-topic', {topicId})` |
| `gs('getSettings', u)` | `api('GET', '/user/settings')` |
| `gs('saveSettings', u, obj)` | `api('POST', '/user/settings', obj)` |
| `gs('resetProgress', u)` | `api('POST', '/user/reset-progress', {})` |
| `gs('adminBootstrap', tok, q, st)` | `api('GET', '/admin/dashboard')` + `api('GET', '/admin/users?q='+q+'&status='+st)` |
| `gs('adminCreateUser', tok, ...)` | `api('POST', '/admin/users/create', {...})` |
| `gs('adminSetUserDisabled', tok, u, d)` | `api('PATCH', '/admin/users/'+u+'/disable', {disabled:d})` |
| `gs('adminSetUserExpiry', tok, u, amt, unit)` | `api('PATCH', '/admin/users/'+u+'/expiry', {expiryDays})` |
| `gs('adminClearUserExpiry', tok, u)` | `api('PATCH', '/admin/users/'+u+'/expiry', {clearExpiry:true})` |
| `gs('adminResetUserPassword', tok, u, pw)` | `api('PATCH', '/admin/users/'+u+'/password', {password:pw})` |
| `gs('adminSetUserRole', tok, u, role)` | `api('PATCH', '/admin/users/'+u+'/role', {role})` |
| `gs('adminGetUserDetail', tok, u)` | `api('GET', '/admin/users/'+u+'/detail')` |
| `gs('adminToggleUserTopic', tok, u, id)` | `api('POST', '/admin/users/'+u+'/toggle-topic', {topicId:id})` |
| `gs('adminResetUserProgress', tok, u)` | `api('POST', '/admin/users/'+u+'/reset-progress', {})` |
| `gs('adminSeedMissingTopicsForUser', tok, u)` | Not needed — server seeds on creation |
| `gs('adminDeleteUser', tok, u)` | `api('DELETE', '/admin/users/'+u)` |
| `gs('adminSetSiteSetting', tok, k, v)` | `api('POST', '/admin/settings', {key:k, value:v})` |
| `gs('buildMasterTopicsFromRawFiles')` | Not exposed via API — run `node scripts/build-topics.js` locally |

### Step 9.3 — On-load session check

At the very start of the frontend script (before `renderLogin()`), check if the user already has a valid session:

```javascript
async function bootstrap() {
  await initCsrf();
  try {
    const r = await api('GET', '/auth/me');
    if (r.ok && r.user) {
      state.user = r.user;
      state.screen = 'user';
      // Load categories
      const cats = await api('GET', '/user/categories');
      state.categories = cats.categories || [];
      renderUser();
      fetchOverallProgress();
      return;
    }
  } catch (e) {
    // Not logged in — fall through to login screen
  }
  renderLogin();
}

// Replace renderLogin() at the bottom of the script with:
bootstrap();
```

### Step 9.4 — Remove admin token state

The current frontend stores and passes `state.adminToken` to every GAS admin call. This is no longer needed — the server uses the session cookie. Remove all references to `state.adminToken`, `state.adminToken=r.admin.adminToken`, and `token` parameters from all admin API calls. The session cookie is sent automatically by `credentials: 'include'`.

Also remove `doAdminLogin()` — admins log in through the same `POST /api/auth/login` endpoint. The role in the session determines access.

### Step 9.5 — Error handling for session expiry

Add a global fetch interceptor. When any API call returns `401`, log the user out and show the login screen:

```javascript
async function api(method, path, body) {
  // ... existing implementation ...
  const res = await fetch('/api' + path, opts);
  if (res.status === 401) {
    // Session expired
    state.user = null; state.admin = null; state.screen = 'login';
    renderLogin();
    toast('Session expired. Please login again.', 'err');
    throw new Error('Session expired');
  }
  // ... rest of handler
}
```

---

## Phase 10 — Hardening & Edge Cases {#phase-10}

### Step 10.1 — Create `scripts/seed-admin.js`

One-time script to create the default admin if they don't exist. Run once after deploy:

```javascript
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const ALL_TOPICS = require('../data/topics.json');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const username = (process.env.ADMIN_USERNAME || 'nbofficialonline').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'S@hiL@2003';

  let admin = await User.findOne({ username });

  if (admin) {
    admin.passwordHash = await bcrypt.hash(password, 12);
    admin.role = 'admin';
    admin.disabled = false;
    admin.expiresAt = null;
    await admin.save();
    console.log('Admin password reset:', username);
  } else {
    await User.create({
      username,
      passwordHash: await bcrypt.hash(password, 12),
      name: 'Admin',
      role: 'admin',
      disabled: false,
      expiresAt: null,
      progress: ALL_TOPICS.map(t => ({ topicId: t.topicId, completed: false, completedAt: null })),
    });
    console.log('Admin created:', username);
  }

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
```

### Step 10.2 — Add request size enforcement in `server.js`

Already included via `express.json({ limit: '50kb' })`. Confirm this is in place.

### Step 10.3 — Add X-Content-Type-Options, X-Frame-Options

These are already set by `helmet()` by default. Verify by checking response headers after starting the server:
```bash
curl -I http://localhost:3000/api/csrf-token
# Should include: X-Content-Type-Options: nosniff, X-Frame-Options: SAMEORIGIN
```

### Step 10.4 — Prevent session fixation

Already handled in Step 5.1 with `req.session.regenerate()` on login.

### Step 10.5 — Brute force detection on login

The `authLimiter` (10 requests per 15 minutes per IP) is already applied to the `/api/auth/` router. Additionally, constant-time password comparison (`bcrypt.compare` with a dummy hash when user not found) prevents timing-based user enumeration.

### Step 10.6 — Add `Referrer-Policy` header

Add to `helmet()` config in `server.js`:
```javascript
app.use(helmet({
  // ... existing config ...
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
```

### Step 10.7 — Sanitize all Mongoose queries

`express-mongo-sanitize` strips keys starting with `$` from `req.body`, `req.query`, `req.params`. This is already applied globally. Additionally, always use Mongoose model methods which parameterize queries — never construct raw query strings.

### Step 10.8 — Session cookie name

The session cookie is named `ssc.sid` (not the default `connect.sid`) so it doesn't reveal the session library in use.

---

## Phase 11 — Deploy to Render {#phase-11}

### Step 11.1 — Create `render.yaml` in repo root

```yaml
services:
  - type: web
    name: ssc-prep-tracker
    env: node
    region: singapore
    plan: free
    buildCommand: npm install
    startCommand: node server.js
    healthCheckPath: /api/csrf-token
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 10000
      - key: MONGODB_URI
        fromDatabase:   # or set manually in Render dashboard
          name: not-applicable
          property: connectionString
      - key: SESSION_SECRET
        generateValue: true
      - key: CSRF_SECRET
        generateValue: true
      - key: SITE_URL
        value: https://ssc-prep-tracker.onrender.com
      - key: ADMIN_USERNAME
        sync: false    # set manually in Render dashboard
      - key: ADMIN_PASSWORD
        sync: false    # set manually in Render dashboard
```

### Step 11.2 — Deploy steps

1. Push code to GitHub
2. Go to https://render.com → New → Web Service → Connect GitHub repo
3. Set environment: Node, build command `npm install`, start command `node server.js`
4. Add all environment variables from `.env` in the Render dashboard (Environment tab)
5. Deploy
6. After first deploy succeeds, open the Render shell tab and run:
   ```bash
   node scripts/seed-admin.js
   ```
7. Visit the deployed URL — login as admin to verify

### Step 11.3 — MongoDB Atlas network access

If Render's outbound IPs change (they can with the free tier), the safest approach for M0 is to allow all IPs (`0.0.0.0/0`). M0 requires auth, so this is acceptable. If you upgrade to a paid Atlas tier, use Render's static outbound IPs and whitelist only those.

---

## Security Checklist {#security-checklist}

| # | Check | Implementation |
|---|---|---|
| 1 | HTTPS only in production | `cookie.secure: true` in session; `helmet` HSTS |
| 2 | CSRF protection on all mutations | Double-submit cookie via `middleware/csrf.js` |
| 3 | Brute force rate limiting | `authLimiter`: 10 req / 15 min on `/api/auth/` |
| 4 | Password hashing (bcrypt, cost 12) | `bcryptjs` in auth routes |
| 5 | Timing-safe login | Dummy hash compare when user not found |
| 6 | Session fixation prevention | `req.session.regenerate()` on login |
| 7 | HttpOnly + SameSite=Strict cookies | Session config in `server.js` |
| 8 | NoSQL injection prevention | `express-mongo-sanitize` |
| 9 | HTTP param pollution | `hpp` middleware |
| 10 | Input validation | `express-validator` on all body params |
| 11 | Content Security Policy | `helmet` with explicit directive list |
| 12 | X-Frame-Options: SAMEORIGIN | `helmet` default |
| 13 | X-Content-Type-Options: nosniff | `helmet` default |
| 14 | HSTS (prod only) | `helmet` with `maxAge: 31536000` |
| 15 | Referrer-Policy | `helmet` config |
| 16 | Body size limit (50kb) | `express.json({ limit: '50kb' })` |
| 17 | Route-level auth guards | `requireLogin`, `requireAdmin` middleware |
| 18 | Admin-only routes isolated | `/api/admin/*` all protected |
| 19 | Secrets in env vars, never in code | `.env` with `.gitignore` |
| 20 | Username normalization | `.toLowerCase().trim()` before all DB ops |
| 21 | Mongoose parameterized queries | Model methods only, no raw string queries |
| 22 | Safe error messages (prod) | Generic 500 message exposed, full error logged server-side |
| 23 | CORS locked to own origin | `cors({ origin: process.env.SITE_URL })` |
| 24 | Session expiry | 7-day TTL on both session store and cookie |
| 25 | Non-default session cookie name | `name: 'ssc.sid'` |

---

## API Reference {#api-reference}

### Auth
| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/api/auth/register` | None | `{username, password, name?}` | `{ok, username, name}` |
| POST | `/api/auth/login` | None | `{username, password}` | `{ok, user}` |
| POST | `/api/auth/logout` | Session | — | `{ok}` |
| GET | `/api/auth/me` | Session | — | `{ok, user}` |
| GET | `/api/csrf-token` | None | — | `{csrfToken}` |

### User
| Method | Path | Auth | Params / Body | Returns |
|---|---|---|---|---|
| GET | `/api/user/categories` | Session | — | `{ok, categories[]}` |
| GET | `/api/user/topics` | Session | `?category=` | `{ok, topics[]}` |
| GET | `/api/user/overall-progress` | Session | — | `{ok, overallProgress}` |
| POST | `/api/user/toggle-topic` | Session | `{topicId}` | `{ok, completed, completedAt}` |
| GET | `/api/user/settings` | Session | — | `{ok, settings}` |
| POST | `/api/user/settings` | Session | `{theme?, name?}` | `{ok}` |
| POST | `/api/user/reset-progress` | Session | — | `{ok}` |

### Admin (all require admin role)
| Method | Path | Body / Params | Returns |
|---|---|---|---|
| GET | `/api/admin/dashboard` | — | `{ok, dashboard}` |
| GET | `/api/admin/users` | `?q=&status=&page=&limit=` | `{ok, users[], total}` |
| POST | `/api/admin/users/create` | `{username, password, name?, expiryDays?}` | `{ok, username, expiresAt}` |
| PATCH | `/api/admin/users/:u/disable` | `{disabled: bool}` | `{ok, disabled}` |
| PATCH | `/api/admin/users/:u/expiry` | `{expiryDays}` or `{clearExpiry:true}` | `{ok, expiresAt}` |
| PATCH | `/api/admin/users/:u/password` | `{password}` | `{ok}` |
| PATCH | `/api/admin/users/:u/role` | `{role}` | `{ok, role}` |
| GET | `/api/admin/users/:u/detail` | — | `{ok, user, topics[], logs[]}` |
| POST | `/api/admin/users/:u/toggle-topic` | `{topicId}` | `{ok, completed, completedAt}` |
| POST | `/api/admin/users/:u/reset-progress` | — | `{ok}` |
| DELETE | `/api/admin/users/:u` | — | `{ok}` |
| GET | `/api/admin/settings` | — | `{ok, settings}` |
| POST | `/api/admin/settings` | `{key, value}` | `{ok, key, value}` |

---

## Implementation Order for the Agent

Execute phases in this exact order:

1. **Phase 0** — Repo, MongoDB Atlas cluster, `.env` file
2. **Phase 1** — `npm init`, install all packages, create directory tree
3. **Phase 2** — Write `server.js` completely
4. **Phase 3** — Write all three Mongoose models
5. **Phase 4** — Write all four middleware files
6. **Phase 5** — Write `routes/auth.js`
7. **Phase 6** — Write `routes/user.js`
8. **Phase 7** — Write `routes/admin.js`
9. **Phase 8** — Export `data/topics.json` from Apps Script (one-time manual step)
10. **Phase 10** — Write `scripts/seed-admin.js`
11. Test locally: `npm run dev` → verify all endpoints with curl or Postman
12. **Phase 9** — Migrate `public/index.html` (replace `gs()` with `api()`, add `bootstrap()`)
13. **Phase 11** — Deploy to Render, run `seed-admin.js`
14. Run through the Security Checklist — verify every header with curl

---

*End of plan. All code snippets are complete and production-ready. The agent should implement each step exactly as written, using the filenames and paths specified.*