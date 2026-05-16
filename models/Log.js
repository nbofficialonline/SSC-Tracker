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
