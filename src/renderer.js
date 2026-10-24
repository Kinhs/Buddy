// Skins: 'blob' is a 16x16 sprite drawn in code; 'akatsuki' (Itachi) plays 80x90 pose PNGs. Both scale with CSS image-rendering: pixelated.
const PAL = {
  D: '#7a3a1c', O: '#e07a3f', H: '#f6a873', K: '#2b2118', W: '#ffffff', P: '#f28b8b',
  L: '#b9c0c8', G: '#5d6670', S: '#7fd3ff', M: '#8b5a3c',
};
const BODY = [
  '................',
  '................',
  '.....DDDDDD.....',
  '...DDHHOOOODD...',
  '..DHHOOOOOOOOD..',
  '..DHOOOOOOOOOD..',
  '.DOOOOOOOOOOOOD.',
  '.DOOOOOOOOOOOOD.',
  '.DOOOOOOOOOOOOD.',
  '.DOOOOOOOOOOOOD.',
  '.DOOOOOOOOOOOOD.',
  '..DOOOOOOOOOOD..',
  '..DDOOOOOOOODD..',
  '...DDDDDDDDDD...',
  '...DD......DD...',
  '................',
];
const LAPTOP = { 10: '...GGGGGGGGGG...', 11: '...GLLLLLLLLG...', 12: '...GLLLSSLLLG...', 13: '...GGGGGGGGGG...', 14: '..GGGGGGGGGGGG..' };
const MUG = { 10: '.............GGG', 11: '.............GMG', 12: '.............GGG' };
const FACES = {
  open: [[5, 7], [5, 8], [10, 7], [10, 8]],
  look: [[6, 7], [6, 8], [11, 7], [11, 8]],
  blink: [[4, 8], [5, 8], [10, 8], [11, 8]],
  down: [[5, 8], [5, 9], [10, 8], [10, 9]],
  happy: [[4, 8], [5, 7], [6, 8], [9, 8], [10, 7], [11, 8]],
  wide: [[5, 7], [6, 7], [5, 8], [6, 8], [9, 7], [10, 7], [9, 8], [10, 8]],
};
const MOUTH = { smile: [[7, 10], [8, 10]], open: [[7, 10], [8, 10], [7, 11], [8, 11]] };

const $ = (id) => document.getElementById(id);
const ctx = $('sprite').getContext('2d');
const fx = $('fx'), say = $('say'), panel = $('panel'), tag = $('tag');

let state = 'idle';        // idle | sleep | working | done | waiting | asking | error
let since = Date.now();    // last state update, drives mood decay
let info = { agent: 'buddy', project: '' };
let asks = [];             // queued questions / permission requests
let t = 0;
let tool = '';             // last tool reported by the agent, picks the Itachi working pose
let skin = 'akatsuki';
try { skin = localStorage.getItem('skin') || 'akatsuki'; } catch {}

// Pose skins. A timeline is a looped list of [pose, ms] steps, or { intro, loop } to play `intro` once first.
const times = (n, steps) => Array(n).fill(steps).flat();
// 'pose>land' / 'pose>leave' draw `pose` plus the crow flying to or from his shoulder over that step.
const AK_CROW = [['idle1>land', 500], ['crow2', 3000], ['idle1>leave', 500]];
const AK_IDLE = [['idle1', 3200], ['blink', 140], ['idle1', 2600], ['idle2', 1000], ['idle1', 2200], ['blink', 140], ['idle1', 1200],
  ...AK_CROW, ['idle1', 2600], ['blink', 140], ['idle1', 1800], ...times(2, [['dango1', 800], ['dango2', 800]]), ['idle1', 1600]];
const AK_CALM = new Set(['idle1', 'idle2', 'blink', 'crow2', 'dango1', 'dango2', 'glance1', 'glance2', 'hatstand1']); // held frames that breathe
const CROW = new Image(); CROW.src = 'skins/akatsuki/crow.png';
const PERCH = [54, 32]; // where crow.png sits in the crow2 frame
const SKINS = {
  akatsuki: {
    poses: ['idle1', 'idle2', 'blink', 'crow2', 'dango1', 'dango2', 'snake', 'ram', 'monkey', 'boar', 'horse', 'tiger',
      'fire1', 'fire2', 'fire3', 'sharingan1', 'sharingan2', 'glance1', 'glance2', 'clone1', 'clone2', 'clone3', 'clone4',
      'reform1', 'reform2', 'reform3', 'susanoo1', 'susanoo2', 'susanoo3', 'amaterasu1', 'amaterasu2',
      'eyecover', 'hatsit1', 'hatsit2', 'hatstand1'],
    timelines: {
      idle: AK_IDLE,
      arrive: { intro: [['reform1', 160], ['reform2', 160], ['reform3', 220]], loop: AK_IDLE }, // crows gather into him
      leave: [['hatstand1', 1e3]],
      seals: [['snake', 180], ['ram', 180], ['monkey', 180], ['boar', 180], ['horse', 180], ['tiger', 420]], // Great Fireball seals
      fireball: [['boar', 160], ['horse', 160], ['tiger', 320], ['fire1', 160], ['fire2', 160], ['fire3', 520]], // his short form
      perceive: [['sharingan1', 450], ['sharingan2', 650]],
      clone: [['clone1', 150], ['clone2', 150], ['clone3', 150], ['clone4', 150], ['reform1', 150], ['reform2', 150], ['reform3', 150], ['idle1', 700]],
      susanoo1: [['susanoo1', 1e3]], susanoo2: [['susanoo2', 1e3]], susanoo3: [['susanoo3', 1e3]],
      asking: { intro: [['sharingan1', 200]], loop: [['sharingan2', 1e3]] },
      waiting: [['glance1', 900], ['glance2', 900]],
      done: { intro: [['tiger', 350], ['blink', 450], ['idle1>land', 500], ['crow2', 2200], ['idle1>leave', 500]], loop: AK_IDLE }, // release the seal, crow returns
      sleep: [['hatsit1', 1400], ['hatsit2', 1400]],
      error: { intro: times(3, [['amaterasu1', 140], ['amaterasu2', 140]]), loop: [['eyecover', 1e3]] },
    },
    tools: { Bash: 'fireball', Grep: 'perceive', Glob: 'perceive', Read: 'perceive', WebSearch: 'perceive', WebFetch: 'perceive', Agent: 'clone', Task: 'clone' },
    pick(now) {
      switch (state) {
        case 'working': { // Susanoo builds up stage by stage on long tasks
          const long = now - entered;
          if (long > 6 * 60e3) return 'susanoo3';
          if (long > 4 * 60e3) return 'susanoo2';
          if (long > 2 * 60e3) return 'susanoo1';
          return this.tools[tool] || 'seals';
        }
        case 'idle': return lastKind === 'start' ? 'arrive' : lastKind === 'end' ? 'leave' : 'idle';
        default: return state;
      }
    },
  },
};
for (const [name, sk] of Object.entries(SKINS)) {
  sk.img = Object.fromEntries(sk.poses.map((n) => { const i = new Image(); i.src = `skins/${name}/${n}.png`; return [n, i]; }));
}
let entered = performance.now(); // when `state` last changed (unlike `since`, repeat events don't reset it)
let lastKind = '';         // last event kind, lets idle tell an arrival or departure apart
let tl = '', tlStart = 0, tlState = '', poofAt = -1e9;

function px(x, y, c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
function rows(map, dy) {
  for (const [y, row] of Object.entries(map))
    [...row].forEach((ch, x) => { if (ch !== '.') px(x, +y + dy, PAL[ch]); });
}

function blot(x, y, size, color, alpha = 1) {
  ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), size, size);
  ctx.globalAlpha = 1;
}

function drawPoses() {
  const now = performance.now(), sk = SKINS[skin];
  const k = sk.pick(now);
  if (k !== tl) {
    if (tl && tlState !== state) poofAt = now; // dust on state changes, not on every tool switch
    tl = k; tlStart = now; tlState = state;
  }
  const def = sk.timelines[k], intro = def.intro || [], loop = def.loop || def;
  const span = (st) => st.reduce((a, x) => a + x[1], 0);
  let ms = now - tlStart, steps = intro;
  if (ms >= span(intro)) { ms = (ms - span(intro)) % span(loop); steps = loop; }
  let pose = steps[0][0], stepP = 0;
  for (const [p, d] of steps) { if (ms < d) { pose = p; stepP = ms / d; break; } ms -= d; }
  let crowFx;
  [pose, crowFx] = pose.split('>');

  let dx = 0, dy = 0;
  if (AK_CALM.has(pose)) dy = Math.sin(now / 255) > 0.3 ? 1 : 0; // ~1.6 s breath
  if (k === 'sleep') dy = Math.sin(now / 420) > 0 ? 1 : 0;
  if (k === 'asking') dy = now % 1200 < 140 ? 2 : 0; // alert hop
  if (k === 'error' && now - tlStart < 450) dx = Math.floor(now / 45) % 2 ? 1 : -1;

  ctx.clearRect(0, 0, 80, 90);
  const img = sk.img[pose];
  if (img.complete && img.naturalWidth) ctx.drawImage(img, dx, -dy);
  if (crowFx && CROW.complete) { // glide in from / out to the top right, easing into and out of the perch
    const e = crowFx === 'land' ? 1 - (1 - stepP) ** 2 : stepP ** 2;
    const [fx, fy] = crowFx === 'land' ? [86, -30] : [92, -34];
    const f = crowFx === 'land' ? 1 - e : e, flap = Math.floor(now / 90) % 2;
    ctx.drawImage(CROW, Math.round(PERCH[0] + (fx - PERCH[0]) * f), Math.round(PERCH[1] + (fy - PERCH[1]) * f) - dy - (f > 0.05 ? flap : 0));
  }

  const pp = (now - poofAt) / 320; // dust kicked up at the feet when the pose set changes
  if (pp < 1) for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1, r = 8 + pp * 22 + (i >> 1) * 3, size = pp < 0.4 ? 3 : pp < 0.75 ? 2 : 1;
    blot(40 + side * r - size / 2, 86 - (i >> 1) * 1.5 - pp * 4 - size, size, i % 3 ? '#e9e4dc' : '#b9b4ad', 1 - pp);
  }
  const mk = panel.querySelector('.mk'), mi = String(Math.floor(now / 260) % 3 + 1);
  if (mk && mk.dataset.i !== mi) { mk.dataset.i = mi; mk.src = `skins/akatsuki/mangekyo${mi}.png`; }
}

function draw() {
  if (SKINS[skin]) return drawPoses();
  ctx.clearRect(0, 0, 16, 16);
  let dy = 0, eyes = 'open', mouth = 'smile', cheeks = true;
  const slow = Math.floor(t / 6) % 2;
  if (state === 'working') { dy = t % 4 < 2 ? 0 : -1; eyes = 'down'; }
  else if (state === 'done') { dy = [0, -1, -2, -1][t % 4]; eyes = 'happy'; mouth = 'open'; }
  else if (state === 'asking' || state === 'waiting' || state === 'error') { eyes = 'wide'; mouth = 'open'; dy = t % 8 === 0 ? -1 : 0; }
  else if (state === 'sleep') { eyes = 'blink'; dy = Math.floor(t / 10) % 2 ? 0 : -1; cheeks = false; }
  else { dy = slow ? 0 : -1; eyes = t % 40 === 0 ? 'blink' : t % 120 > 100 ? 'look' : 'open'; }

  rows(Object.fromEntries(BODY.map((r, y) => [y, r])), dy);
  for (const [x, y] of FACES[eyes]) px(x, y + dy, PAL.K);
  if (eyes === 'wide') { px(5, 7 + dy, PAL.W); px(9, 7 + dy, PAL.W); }
  if (cheeks) { px(3, 9 + dy, PAL.P); px(12, 9 + dy, PAL.P); }
  for (const [x, y] of MOUTH[mouth]) px(x, y + dy, PAL.K);

  if (state === 'working') {
    rows(LAPTOP, 0);
    const up = t % 2; // typing hands
    px(2, 10 - up, PAL.O); px(13, 9 + up, PAL.O);
  }
  if (state === 'idle') rows(MUG, 0);
}

function setFx(s) {
  fx.innerHTML = '';
  const add = (cls, text, style = {}) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; Object.assign(d.style, style); fx.appendChild(d); };
  if (s === 'sleep') ['z', 'z', 'Z'].forEach((z, i) => add('z', z, { left: `${120 + i * 6}px`, top: `${40 - i * 8}px`, animationDelay: `${i * 0.8}s` }));
  if (s === 'asking') add('mark', '?');
  if (s === 'waiting') add('mark', '!');
  if (s === 'error') add('mark', '×', { color: '#c2453a' });
  if (s === 'done' && skin === 'blob') for (let i = 0; i < 14; i++)
    add('z', '', { left: `${20 + Math.random() * 140}px`, top: `${20 + Math.random() * 60}px`, width: '6px', height: '6px',
      background: ['#e07a3f', '#4f9d5d', '#7fd3ff', '#f28b8b', '#f4c542'][i % 5], animationDelay: `${Math.random() * 2}s` });
}

function setState(s, text) {
  if (asks.length && s !== 'asking') s = 'asking'; // a pending question always wins
  since = Date.now();
  if (s !== state) { state = s; entered = performance.now(); setFx(s); }
  if (text !== undefined) { $('sayt').textContent = text; say.hidden = !text; }
  tag.textContent = [info.agent, info.project, state].filter(Boolean).join(' · ');
  fit();
}

function fit() {
  requestAnimationFrame(() => {
    const open = asks.length > 0;
    panel.style.display = open ? 'block' : 'none';
    const h = $('stage').offsetHeight + (say.textContent ? say.offsetHeight + 4 : 0) + (open ? panel.offsetHeight + 4 : 0) + 8;
    const w = open ? 300 : Math.max(180, say.textContent ? say.offsetWidth + 20 : 0);
    window.buddy.resize(Math.ceil(w), Math.ceil(h));
  });
}

const TOOL_VERBS = { Edit: 'Editing', Write: 'Writing', Read: 'Reading', Bash: 'Running', Grep: 'Searching', Glob: 'Searching',
  WebFetch: 'Browsing', WebSearch: 'Googling', Agent: 'Delegating', Task: 'Delegating' };

const sessions = createSessions();

window.buddy.onEvent((e) => {
  info = { agent: e.agent || info.agent, project: e.project || info.project };
  lastKind = e.kind;
  const othersBusy = sessions.update(e); // another session still working keeps Buddy in "working"

  if (e.kind === 'working') tool = e.tool || '';
  if (e.kind === 'working') setState('working', e.tool ? `${TOOL_VERBS[e.tool] || e.tool}${e.detail ? ' ' + e.detail : '…'}` : 'On it…');
  else if (e.kind === 'done' && othersBusy) setState('working', `${e.project || e.agent || 'A session'} finished`);
  else if (e.kind === 'done') setState('done', e.message ? e.message.split('\n')[0] : 'All done!');
  else if (e.kind === 'waiting') setState('waiting', e.message || 'Your turn');
  else if (e.kind === 'error') setState('error', e.message ? e.message.split('\n')[0] : `${e.tool || 'Something'} failed`);
  else if ((e.kind === 'end' || e.kind === 'start') && !othersBusy) setState('idle', '');
});

window.buddy.onAsk((a) => { asks.push(a); info = { agent: a.agent || info.agent, project: a.project || info.project }; renderAsk(); setState('asking', ''); });
window.buddy.onAskClosed((id) => {
  const was = asks.length;
  asks = asks.filter((a) => a.id !== id);
  if (asks.length !== was) { renderAsk(); setState(asks.length ? 'asking' : 'working', asks.length ? '' : 'On it…'); }
});

function el(tagName, props = {}, children = []) {
  const n = Object.assign(document.createElement(tagName), props);
  children.forEach((c) => n.append(c));
  return n;
}

function reply(id, result) {
  window.buddy.answer(id, result);
  asks = asks.filter((a) => a.id !== id);
  renderAsk();
  setState('working', 'Thanks!');
}

function renderAsk() {
  panel.innerHTML = '';
  const a = asks[0];
  if (!a) return;
  const more = asks.length > 1 ? ` (+${asks.length - 1} more)` : '';
  const terminal = el('button', { textContent: 'Terminal', title: 'Answer in the terminal instead', onclick: () => reply(a.id, {}) });

  if (a.kind === 'permission') {
    const inp = a.input || {};
    const detail = inp.command || inp.file_path || inp.url || inp.pattern || JSON.stringify(inp);
    panel.append(
      el('h4', { textContent: `${a.agent || 'Agent'} wants to use ${a.tool}${more}` }),
      el('div', {}, [el('code', { textContent: String(detail).slice(0, 300) })]),
      el('div', { className: 'row' }, [
        el('button', { className: 'ok', textContent: 'Allow', onclick: () => reply(a.id, { behavior: 'allow' }) }),
        el('button', { className: 'no', textContent: 'Deny', onclick: () => reply(a.id, { behavior: 'deny' }) }),
        terminal,
      ]),
    );
    return fit();
  }

  const qs = a.questions || [];
  const picks = qs.map(() => new Set());
  const instant = qs.length === 1 && !qs[0].multiSelect;
  const send = el('button', { className: 'ok', textContent: 'Send', disabled: true });
  const submit = () => reply(a.id, { answers: Object.fromEntries(qs.map((q, i) => [q.question, [...picks[i]].join(', ')])) });
  send.onclick = submit;

  if (skin === 'akatsuki') panel.append(el('img', { className: 'mk', src: 'skins/akatsuki/mangekyo1.png', alt: '' }));
  panel.append(el('h4', { textContent: `${a.agent || 'Agent'} asks${more}` }));
  qs.forEach((q, i) => {
    const opts = el('div', { className: 'opts' });
    (q.options || []).forEach((o) => {
      const b = el('button', {}, [o.label, ...(o.description ? [el('small', { textContent: o.description })] : [])]);
      b.onclick = () => {
        if (q.multiSelect) { picks[i].has(o.label) ? picks[i].delete(o.label) : picks[i].add(o.label); b.classList.toggle('sel'); }
        else { picks[i] = new Set([o.label]); opts.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b)); }
        if (instant) return submit();
        send.disabled = !picks.every((p) => p.size);
      };
      opts.append(b);
    });
    panel.append(el('div', { className: 'q' }, [el('div', { className: 'qt', textContent: q.question }), opts]));
  });
  panel.append(el('div', { className: 'row' }, instant ? [terminal] : [send, terminal]));
  fit();
}

// Mood decay: done -> chill -> sleep.
setInterval(() => {
  const age = Date.now() - since;
  if (state === 'done' && age > 20e3) setState('idle', '');
  else if (state === 'idle' && age > 3 * 60e3) setState('sleep', '');
  else if (state === 'error' && age > 5e3) setState('working', 'Trying again…');
  else if (state === 'working' && age > 10 * 60e3) setState('idle', ''); // missed Stop event
}, 1000);
setInterval(() => { t = Math.floor(performance.now() / 150); draw(); }, 50); // blob steps every 150 ms, Itachi effects run at 20 fps

function applySkin(name) {
  skin = name === 'blob' || name in SKINS ? name : 'akatsuki'; // unknown or removed skins (e.g. the old 'itachi') fall back to Itachi
  try { localStorage.setItem('skin', skin); } catch {}
  const c = $('sprite');
  [c.width, c.height] = SKINS[skin] ? [80, 90] : [16, 16];
  document.body.classList.toggle('itachi', !!SKINS[skin]);
  setFx(state);
  draw();
  fit();
}
window.buddy.onSkin(applySkin);

// Menu lives on the name tag; the sprite itself is the drag handle.
tag.addEventListener('click', () => window.buddy.menu(skin));
tag.addEventListener('contextmenu', (e) => { e.preventDefault(); window.buddy.menu(skin); });
applySkin(skin);
setState('idle', 'Hi!');
