const test = require('node:test');
const assert = require('node:assert');
const { createSessions, STALE_MS } = require('../src/sessions.js');

test('one session finishing while another works reports the other as busy', () => {
  const s = createSessions();
  s.update({ kind: 'working', session: 'A' }, 0);
  s.update({ kind: 'working', session: 'B' }, 10);
  assert.strictEqual(s.update({ kind: 'done', session: 'B' }, 20), 1); // A still busy: stay "working"
  assert.strictEqual(s.update({ kind: 'done', session: 'A' }, 30), 0); // last one: show "done"
});

test('ending or starting sessions do not count, Codex (no session id) sees everyone', () => {
  const s = createSessions();
  s.update({ kind: 'working', session: 'A' }, 0);
  assert.strictEqual(s.update({ kind: 'start', session: 'B' }, 1), 1);
  assert.strictEqual(s.update({ kind: 'done' }, 2), 1);
  assert.strictEqual(s.update({ kind: 'end', session: 'A' }, 3), 0);
});

test('a session that disappeared without a Stop stops blocking after STALE_MS', () => {
  const s = createSessions();
  s.update({ kind: 'working', session: 'crashed' }, 0);
  s.update({ kind: 'working', session: 'B' }, STALE_MS);
  assert.strictEqual(s.update({ kind: 'done', session: 'B' }, STALE_MS + 1), 0);
});
