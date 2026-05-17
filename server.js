require('dotenv').config({ override: true });
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const cookieParser = require('cookie-parser');
const path = require('path');

const { csrfMiddleware, csrfTokenRoute } = require('./middleware/csrf');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');

const app = express();

const mongoSanitizeOptions = { replaceWith: '_' };

function mongoSanitizeMiddleware(req, res, next) {
  ['body', 'params', 'headers', 'query'].forEach((key) => {
    if (!req[key]) return;

    if (mongoSanitize.has(req[key])) {
      console.warn(`Sanitized key: ${key} from ${req.ip}`);
    }

    mongoSanitize.sanitize(req[key], mongoSanitizeOptions);
  });

  next();
}

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
      scriptSrcAttr: ["'unsafe-inline'"],         // existing UI uses inline event handlers
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

// ── Response Compression ────────────────────────────────
app.use(compression({ level: 6 }));

// ── Body parsers ─────────────────────────────────────────
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));
app.use(cookieParser());

// ── NoSQL injection prevention ───────────────────────────
app.use(mongoSanitizeMiddleware);

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
  setHeaders(res, filePath) {
    if (filePath.endsWith(path.sep + 'index.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

// ── API Routes ────────────────────────────────────────────
app.get('/api/csrf-token', csrfTokenRoute);   // Frontend fetches this on load
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);

// ── SPA fallback ─────────────────────────────────────────
app.use((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
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
