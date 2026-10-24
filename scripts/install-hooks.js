#!/usr/bin/env node
// Adds Buddy hooks to ~/.claude/settings.json. Safe to re-run: the first run's backup (settings.json.bak) is never overwritten.
const fs = require('fs');
const os = require('os');
const path = require('path');

const file = path.join(os.homedir(), '.claude', 'settings.json');
const hook = path.resolve(__dirname, '..', 'hooks', 'buddy-hook.js');
const command = `node "${hook.replace(/\\/g, '/')}"`;

// Blocking events wait for your click in Buddy (Buddy itself gives up after 5 min).
const EVENTS = {
  SessionStart: {}, SessionEnd: {}, UserPromptSubmit: {}, Stop: {}, StopFailure: {}, Notification: {},
  PostToolUseFailure: { matcher: '*' },
  PreToolUse: { matcher: '*', timeout: 330 },
  PermissionRequest: { matcher: '*', timeout: 330 },
};

let settings = {};
if (fs.existsSync(file)) {
  if (!fs.existsSync(file + '.bak')) fs.copyFileSync(file, file + '.bak'); // keep the pre-Buddy original
  settings = JSON.parse(fs.readFileSync(file, 'utf8'));
}
settings.hooks = settings.hooks || {};

for (const [event, { matcher, timeout }] of Object.entries(EVENTS)) {
  const groups = (settings.hooks[event] = settings.hooks[event] || []);
  if (groups.some((g) => (g.hooks || []).some((h) => String(h.command).includes('buddy-hook.js')))) continue;
  groups.push({ ...(matcher && { matcher }), hooks: [{ type: 'command', command, ...(timeout && { timeout }) }] });
}

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
console.log(`Buddy hooks added to ${file}\nRestart running Claude Code sessions to pick them up.`);
