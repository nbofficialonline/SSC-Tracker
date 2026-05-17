const mongoose = require('mongoose');

const studySessionSchema = new mongoose.Schema({
  username: { type: String, required: true, lowercase: true, index: true },
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, required: true },
  durationSec: { type: Number, required: true, min: 1, max: 24 * 60 * 60 },
}, {
  timestamps: true,
});

studySessionSchema.index({ username: 1, startedAt: -1 });

module.exports = mongoose.model('StudySession', studySessionSchema);
