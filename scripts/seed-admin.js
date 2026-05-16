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
