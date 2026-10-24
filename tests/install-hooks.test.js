const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'install-hooks.js');
const run = (home) => execFileSync('node', [SCRIPT], { env: { ...process.env, HOME: home, USERPROFILE: home } });

test('install keeps existing settings, is idempotent, and never overwrites the first backup', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-home-'));
  const file = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file));
  const original = JSON.stringify({ theme: 'dark', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }] } });
  fs.writeFileSync(file, original);

  run(home);
  run(home);

  assert.strictEqual(fs.readFileSync(file + '.bak', 'utf8'), original);
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(s.theme, 'dark');
  assert.strictEqual(s.hooks.PreToolUse.length, 2); // user's hook + one Buddy entry, not two
  assert.strictEqual(s.hooks.PreToolUse[0].hooks[0].command, 'rtk hook claude');
  for (const groups of Object.values(s.hooks)) {
    assert.strictEqual(groups.filter((g) => g.hooks.some((h) => h.command.includes('buddy-hook.js'))).length, 1);
  }
});
