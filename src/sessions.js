// Which agent sessions are mid-turn, so one session finishing doesn't end another's "working".
// A session that vanished without a Stop (crash, closed terminal) stops counting after STALE_MS.
const STALE_MS = 10 * 60e3;

function createSessions() {
  const busy = new Map(); // session id -> time of its last 'working' event
  return {
    // Records the event; returns how many *other* sessions are still busy.
    update(e, now = Date.now()) {
      if (e.session && e.kind === 'working') busy.set(e.session, now);
      if (e.session && (e.kind === 'done' || e.kind === 'end')) busy.delete(e.session);
      for (const [id, at] of busy) if (now - at > STALE_MS) busy.delete(id);
      return [...busy.keys()].filter((id) => id !== e.session).length;
    },
  };
}

if (typeof module !== 'undefined') module.exports = { createSessions, STALE_MS };
