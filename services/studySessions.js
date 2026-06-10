const StudySession = require('../models/StudySession');

function summarizeSessions(sessions) {
  const today = new Date().toISOString().slice(0, 10);
  const totalSec = sessions.reduce((sum, s) => sum + Number(s.durationSec || 0), 0);
  const todaySec = sessions
    .filter((s) => new Date(s.startedAt).toISOString().slice(0, 10) === today)
    .reduce((sum, s) => sum + Number(s.durationSec || 0), 0);

  return {
    totalSec,
    todaySec,
    sessionCount: sessions.length,
  };
}

function formatTime(date) {
  if (date == null) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

function dateKey(date) {
  return new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function fmtLabel(date, mode) {
  const d = new Date(date);
  if (mode === 'month') return String(d.getDate());
  return d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' });
}

function buildDailySummary(sessions, days) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - days + 1);
  start.setHours(0, 0, 0, 0);

  const daily = [];
  const map = {};
  sessions.forEach((s) => {
    const key = dateKey(s.startedAt);
    map[key] = (map[key] || 0) + Number(s.durationSec || 0);
  });

  let totalSeconds = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dateKey(d);
    const total = map[key] || 0;
    totalSeconds += total;
    daily.push({
      date: key,
      label: fmtLabel(d, days > 14 ? 'month' : 'week'),
      totalSeconds: total,
    });
  }

  return {
    daily,
    totalSeconds,
    totalHours: Math.round((totalSeconds / 3600) * 10) / 10,
    avgDailySeconds: Math.round(totalSeconds / days),
    avgDailyHours: Math.round((totalSeconds / days / 3600) * 10) / 10,
  };
}

async function getStudyPayload(username, limit = 50) {
  const sessions = await StudySession.find({ username })
    .sort({ startedAt: -1 })
    .limit(limit)
    .lean();

  const allForStats = await StudySession.find(
    { username },
    { durationSec: 1, startedAt: 1, endedAt: 1 }
  ).lean();

  return {
    studySessions: sessions.map((s) => ({
      id: String(s._id),
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSec: s.durationSec,
      date: dateKey(s.startedAt),
      startTime: formatTime(s.startedAt),
      endTime: formatTime(s.endedAt),
      totalSeconds: s.durationSec,
      startIso: s.startedAt,
      endIso: s.endedAt,
    })),
    studyStats: summarizeSessions(allForStats),
    timeTracker: {
      sessions: allForStats
        .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
        .map((s) => ({
          id: String(s._id),
          date: dateKey(s.startedAt),
          startTime: formatTime(s.startedAt),
          endTime: formatTime(s.endedAt),
          totalSeconds: s.durationSec,
          startIso: s.startedAt,
          endIso: s.endedAt,
        })),
      weekly: buildDailySummary(allForStats, 7),
      monthly: buildDailySummary(allForStats, 30),
    },
  };
}

module.exports = { getStudyPayload, summarizeSessions };
