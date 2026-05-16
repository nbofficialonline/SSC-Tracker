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
