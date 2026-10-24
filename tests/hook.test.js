// The hook is the contract with Claude Code: these check the exact JSON it prints for answers from Buddy.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'buddy-hook.js');

// Fake Buddy: records requests and answers /ask with `reply`.
function fakeBuddy(reply) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, body: JSON.parse(body), origin: req.headers.origin });
      if (req.url === '/ask') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(reply)); }
      else { res.statusCode = 204; res.end(); }
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, seen, port: server.address().port })));
}

function runHook(input, port) {
  return new Promise((resolve) => {
    const p = spawn('node', [HOOK], { env: { ...process.env, BUDDY_PORT: String(port) } });
    let out = '';
    p.stdout.on('data', (c) => { out += c; });
    p.on('close', (code) => resolve({ code, out }));
    p.stdin.end(JSON.stringify(input));
  });
}

const QUESTION = { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/x/Buddy', tool_name: 'AskUserQuestion',
  tool_input: { questions: [{ question: 'Which theme?', options: [{ label: 'Cozy' }, { label: 'Neon' }], multiSelect: false }] } };

test('question answered in Buddy becomes allow + updatedInput.answers', async () => {
  const b = await fakeBuddy({ answers: { 'Which theme?': 'Neon' } });
  const { code, out } = await runHook(QUESTION, b.port);
  b.server.close();
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(JSON.parse(out), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow',
    updatedInput: { ...QUESTION.tool_input, answers: { 'Which theme?': 'Neon' } } } });
  assert.strictEqual(b.seen[0].url, '/ask');
  assert.strictEqual(b.seen[0].origin, undefined); // Buddy rejects requests that carry an Origin header
});

test('"Terminal" in Buddy prints nothing, so Claude Code shows its own prompt', async () => {
  const b = await fakeBuddy({});
  const { code, out } = await runHook(QUESTION, b.port);
  b.server.close();
  assert.strictEqual(code, 0);
  assert.strictEqual(out, '');
});

test('permission deny becomes a PermissionRequest decision', async () => {
  const b = await fakeBuddy({ behavior: 'deny' });
  const { out } = await runHook({ hook_event_name: 'PermissionRequest', session_id: 's1', cwd: '/x', tool_name: 'Bash',
    tool_input: { command: 'rm -rf node_modules' } }, b.port);
  b.server.close();
  assert.deepStrictEqual(JSON.parse(out), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny' } } });
});

test('ordinary tool call sends a working event with a trimmed first-line detail and prints nothing', async () => {
  const b = await fakeBuddy({});
  const { out } = await runHook({ hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/x/Buddy', tool_name: 'Bash',
    tool_input: { command: 'x'.repeat(200) + '\necho second line' } }, b.port);
  b.server.close();
  assert.strictEqual(out, '');
  const e = b.seen[0].body;
  assert.deepStrictEqual([e.kind, e.tool, e.session, e.project], ['working', 'Bash', 's1', 'Buddy']);
  assert.strictEqual(e.detail.length, 120);
  assert.ok(!e.detail.includes('second line'));
});

test('Buddy not running: exits 0 with no output', async () => {
  const b = await fakeBuddy({});
  const port = b.port;
  await new Promise((r) => b.server.close(r));
  const { code, out } = await runHook(QUESTION, port);
  assert.strictEqual(code, 0);
  assert.strictEqual(out, '');
});
