#!/usr/bin/env node
// Bridges Claude Code hooks (JSON on stdin) and Codex `notify` (JSON as last argv) to the Buddy app.
// Never breaks the agent: if Buddy is not running or anything fails, it exits 0 with no output.
const http = require('http');
const path = require('path');

const PORT = Number(process.env.BUDDY_PORT) || 47321;
const WAITING = new Set(['permission_prompt', 'idle_prompt', 'agent_needs_input', 'elicitation_dialog']);

function post(route, body, timeoutMs) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: PORT, path: route, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => { try { resolve(JSON.parse(out || '{}')); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    if (timeoutMs) req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
    req.end(data);
  });
}

function readStdin() {
  return new Promise((resolve) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { s += c; });
    process.stdin.on('end', () => resolve(s));
  });
}

function toolDetail(input = {}) {
  if (input.file_path) return path.basename(input.file_path);
  if (input.command) {
    const cmd = input.command.split('\n')[0];
    return cmd.length > 120 ? cmd.slice(0, 119) + '…' : cmd;
  }
  return input.pattern || input.query || input.url || input.description || '';
}

function print(hookSpecificOutput) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
}

async function claude(h) {
  const base = { agent: 'Claude', session: h.session_id, project: h.cwd ? path.basename(h.cwd) : '' };
  const event = (extra) => post('/event', { ...base, ...extra }, 800);

  switch (h.hook_event_name) {
    case 'SessionStart': return event({ kind: 'start' });
    case 'SessionEnd': return event({ kind: 'end' });
    case 'UserPromptSubmit': return event({ kind: 'working' });
    case 'Stop': return event({ kind: 'done', message: (h.last_assistant_message || '').slice(0, 200) });
    case 'StopFailure': return event({ kind: 'error', message: h.error || 'API error' });
    case 'PostToolUseFailure':
      if (h.is_interrupt) return; // user pressed Esc, not a real failure
      return event({ kind: 'error', tool: h.tool_name });
    case 'Notification':
      if (WAITING.has(h.notification_type)) return event({ kind: 'waiting', message: h.message });
      return;
    case 'PreToolUse': {
      if (h.tool_name !== 'AskUserQuestion') return event({ kind: 'working', tool: h.tool_name, detail: toolDetail(h.tool_input) });
      const r = await post('/ask', { ...base, kind: 'question', questions: h.tool_input.questions });
      if (r && r.answers) print({ hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...h.tool_input, answers: r.answers } });
      return;
    }
    case 'PermissionRequest': {
      if (h.tool_name === 'AskUserQuestion' || h.tool_name === 'ExitPlanMode') return; // need the terminal UI
      const r = await post('/ask', { ...base, kind: 'permission', tool: h.tool_name, input: h.tool_input });
      if (r && (r.behavior === 'allow' || r.behavior === 'deny')) print({ hookEventName: 'PermissionRequest', decision: { behavior: r.behavior } });
    }
  }
}

async function codex(n) {
  if (n.type !== 'agent-turn-complete') return;
  await post('/event', { agent: 'Codex', kind: 'done', project: n.cwd ? path.basename(n.cwd) : '',
    message: (n['last-assistant-message'] || '').slice(0, 200) }, 800);
}

(async () => {
  try {
    const arg = process.argv[process.argv.length - 1];
    if (arg && arg.trim().startsWith('{')) await codex(JSON.parse(arg));
    else await claude(JSON.parse(await readStdin()));
  } catch { /* stay silent: never block the agent */ }
  process.exit(0);
})();
