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

async function getStudyPayload(username, limit = 50) {
  const sessions = await StudySession.find({ username })
    .sort({ startedAt: -1 })
    .limit(limit)
    .lean();

  const allForStats = await StudySession.find({ username }, { durationSec: 1, startedAt: 1 }).lean();

  return {
    studySessions: sessions.map((s) => ({
      id: String(s._id),
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSec: s.durationSec,
    })),
    studyStats: summarizeSessions(allForStats),
  };
}

module.exports = { getStudyPayload, summarizeSessions };
