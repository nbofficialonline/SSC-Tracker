const ALL_TOPICS = require('../data/topics.json');

function buildCompletionMap(progress) {
  const completionMap = {};
  (progress || []).forEach((p) => {
    completionMap[p.topicId] = {
      completed: Boolean(p.completed),
      completedAt: p.completedAt || null,
    };
  });
  return completionMap;
}

function topicsWithProgress(progress, category) {
  const completionMap = buildCompletionMap(progress);
  return ALL_TOPICS
    .filter((t) => !category || t.category === category)
    .map((t) => ({
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
}

function categoryStats(progress) {
  const completionMap = buildCompletionMap(progress);
  const catMap = {};

  ALL_TOPICS.forEach((t) => {
    if (!catMap[t.category]) {
      catMap[t.category] = { name: t.category, total: 0, done: 0, high: 0, medium: 0, low: 0 };
    }

    const stats = catMap[t.category];
    const priority = stats[t.priority] === undefined ? 'medium' : t.priority;
    stats.total++;
    stats[priority]++;
    if (completionMap[t.topicId]?.completed) stats.done++;
  });

  return Object.values(catMap).map((stats) => ({
    ...stats,
    pending: stats.total - stats.done,
    percent: stats.total ? Math.round((stats.done * 100) / stats.total) : 0,
  }));
}

function overallProgress(progress) {
  const completionMap = buildCompletionMap(progress);
  const total = ALL_TOPICS.length;
  const done = ALL_TOPICS.reduce((sum, t) => sum + (completionMap[t.topicId]?.completed ? 1 : 0), 0);
  return {
    total,
    done,
    pending: total - done,
    percent: total ? Math.round((done * 100) / total) : 0,
  };
}

function seedProgress() {
  return ALL_TOPICS.map((t) => ({ topicId: t.topicId, completed: false, completedAt: null }));
}

module.exports = {
  ALL_TOPICS,
  categoryStats,
  overallProgress,
  seedProgress,
  topicsWithProgress,
};
