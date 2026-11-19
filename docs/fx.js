// Звуки (синтез через Web Audio, без файлов) и эффекты
const FX = (() => {
  let ctx = null, master = null, musicGain = null, musicTimer = null, musicOn = false;
  let muted = false;
  try { muted = localStorage.getItem('kx-muted') === '1'; } catch {}

  function ac() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.18; musicGain.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur = 0.15, type = 'sine', vol = 0.4, when = 0, dest) {
    const c = ac(); if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(dur = 0.3, vol = 0.3, when = 0, hp = 1000) {
    const c = ac(); if (!c) return;
    const t = c.currentTime + when;
    const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const g = c.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(master); s.start(t);
  }

  const N = (n) => 440 * Math.pow(2, (n - 69) / 12);

  const sfx = {
    pop() { tone(N(84), 0.08, 'triangle', 0.35); tone(N(91), 0.1, 'triangle', 0.25, 0.05); },
    tick() { tone(N(96), 0.04, 'square', 0.12); },
    tickUrgent() { tone(N(100), 0.06, 'square', 0.2); },
    count() { tone(N(72), 0.25, 'triangle', 0.4); },
    go() { [72, 76, 79, 84].forEach((n, i) => tone(N(n), 0.3, 'triangle', 0.35, i * 0.06)); },
    gong() { tone(N(48), 1.6, 'sine', 0.5); tone(N(55), 1.4, 'sine', 0.3); noise(0.4, 0.15, 0, 3000); },
    correct() { [76, 80, 83, 88].forEach((n, i) => tone(N(n), 0.25, 'triangle', 0.35, i * 0.08)); },
    wrong() { tone(N(52), 0.35, 'sawtooth', 0.25); tone(N(47), 0.5, 'sawtooth', 0.25, 0.18); },
    send() { tone(N(79), 0.08, 'sine', 0.3); tone(N(86), 0.12, 'sine', 0.25, 0.06); },
    whoosh() { noise(0.35, 0.25, 0, 600); },
    drumroll(sec = 2.5) { for (let t = 0; t < sec; t += 0.05) noise(0.05, 0.08 + (t / sec) * 0.15, t, 200); },
    fanfare() {
      const seq = [[67, 0], [72, 0.15], [76, 0.3], [79, 0.45], [76, 0.65], [79, 0.8], [84, 1.0]];
      seq.forEach(([n, w]) => { tone(N(n), 0.35, 'square', 0.18, w); tone(N(n - 12), 0.35, 'triangle', 0.25, w); });
      noise(1.2, 0.12, 1.0, 4000);
    },
    streak() { [79, 83, 86, 91].forEach((n, i) => tone(N(n), 0.12, 'square', 0.15, i * 0.05)); },
  };

  // Фоновая музыка: простая весёлая петля
  function startMusic(kind = 'lobby') {
    stopMusic(); const c = ac(); if (!c) return;
    musicOn = true;
    const prog = kind === 'think'
      ? [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]]
      : [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
    const bpm = kind === 'think' ? 132 : 112, beat = 60 / bpm;
    let step = 0;
    const loop = () => {
      if (!musicOn) return;
      const chord = prog[Math.floor(step / 8) % prog.length];
      const n = chord[step % 3] + (step % 8 >= 4 ? 12 : 0);
      tone(N(n), beat * 0.9, 'triangle', 0.5, 0, musicGain);
      if (step % 4 === 0) tone(N(chord[0] - 24), beat * 1.8, 'sine', 0.8, 0, musicGain);
      if (kind === 'think' && step % 2 === 1) noise(0.03, 0.05, 0, 6000);
      step++;
      musicTimer = setTimeout(loop, beat * 500);
    };
    loop();
  }
  function stopMusic() { musicOn = false; clearTimeout(musicTimer); }

  function setMuted(v) {
    muted = v; try { localStorage.setItem('kx-muted', v ? '1' : '0'); } catch {}
    if (master) master.gain.value = v ? 0 : 0.6;
  }

  // Конфетти на canvas
  let cv = null, parts = [], raf = 0;
  function confetti(amount = 160, opts = {}) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!cv) {
      cv = document.createElement('canvas');
      cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:999';
      document.body.appendChild(cv);
    }
    const W = (cv.width = innerWidth * devicePixelRatio), H = (cv.height = innerHeight * devicePixelRatio);
    const colors = opts.colors || ['#ff3b5c', '#2f7bff', '#ffc21a', '#2bd96b', '#b26bff', '#ffffff'];
    for (let i = 0; i < amount; i++) {
      parts.push({
        x: opts.x != null ? opts.x * W : Math.random() * W, y: opts.y != null ? opts.y * H : -20,
        vx: (Math.random() - 0.5) * (opts.burst ? 26 : 6), vy: opts.burst ? -Math.random() * 24 - 6 : Math.random() * 4 + 2,
        r: Math.random() * 8 + 5, c: colors[(Math.random() * colors.length) | 0], a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3,
        life: 0,
      });
    }
    const g = cv.getContext('2d');
    cancelAnimationFrame(raf);
    const frame = () => {
      g.clearRect(0, 0, W, H);
      parts = parts.filter((p) => p.y < H + 40 && p.life < 600);
      for (const p of parts) {
        p.life++; p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
        g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.c;
        g.fillRect(-p.r, -p.r / 2.5, p.r * 2, p.r / 1.25); g.restore();
      }
      if (parts.length) raf = requestAnimationFrame(frame); else g.clearRect(0, 0, W, H);
    };
    frame();
  }

  function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch {} }

  return { ...sfx, startMusic, stopMusic, setMuted, isMuted: () => muted, confetti, vibrate, unlock: ac };
})();

// Общие помощники
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SHAPES = [
  '<svg viewBox="0 0 32 32"><path d="M16 4 30 28H2z"/></svg>',
  '<svg viewBox="0 0 32 32"><path d="M16 2 30 16 16 30 2 16z"/></svg>',
  '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13"/></svg>',
  '<svg viewBox="0 0 32 32"><rect x="4" y="4" width="24" height="24" rx="2"/></svg>',
  '<svg viewBox="0 0 32 32"><path d="M16 3l4 9 9 1-7 6 2 10-8-5-8 5 2-10-7-6 9-1z"/></svg>',
  '<svg viewBox="0 0 32 32"><path d="M16 4c7 0 12 5 12 12s-5 12-12 12S4 23 4 16 9 4 16 4zm0 6a6 6 0 100 12 6 6 0 000-12z"/></svg>',
];
const TYPE_NAMES = { quiz: 'Викторина', truefalse: 'Правда или миф', type: 'Введи ответ', slider: 'Угадай число', order: 'Расставь по порядку', poll: 'Опрос', slide: 'Слайд' };
const TYPE_ICONS = { quiz: 'grid', truefalse: 'checkc', type: 'keyboard', slider: 'sliders', order: 'listol', poll: 'poll', slide: 'slide' };
const REACTIONS = ['👍', '❤️', '😂', '😮', '🔥', '🙏', '👏', '🎉'];

// ---------- Иконки (свои SVG, линейные) ----------
const ICON_PATHS = {
  play: '<path d="M7 4.5l12 7.5-12 7.5z" fill="currentColor"/>',
  next: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  skip: '<path d="M5 5l9 7-9 7z" fill="currentColor"/><path d="M18 5v14"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.6 3.2-5.5 6.5-5.5s6 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.8 14.6c2.5.2 4.3 1.9 4.8 4.9"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 017.6-1.8"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 010 6M18.3 6.3a8 8 0 010 11.4"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.8" fill="currentColor"/><circle cx="17.5" cy="16" r="2.8" fill="currentColor"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  check: '<path d="M4.5 12.5l5 5L19.5 7"/>',
  cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 01-10 0z"/><path d="M7 6H4.5v1A3 3 0 007 10M17 6h2.5v1A3 3 0 0117 10M12 14v3.5M8.5 20.5h7M9.5 17.5h5"/>',
  flame: '<path d="M12 2.5c1.2 3.2 5.5 5.4 5.5 10.6A5.5 5.5 0 016.5 13c0-2.8 1.5-4.5 2.8-5.6.2 2.2 1.2 3.3 2.4 3.6-.9-3 .3-6.2.3-8.5z" fill="currentColor"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  hash: '<path d="M5 9h14M5 15h14M10.5 4L8.5 20M15.5 4l-2 16"/>',
  bot: '<rect x="4.5" y="8" width="15" height="11" rx="3.5"/><path d="M12 4.5V8"/><circle cx="12" cy="3.8" r="1.3" fill="currentColor"/><circle cx="9.3" cy="13" r="1.4" fill="currentColor"/><circle cx="14.7" cy="13" r="1.4" fill="currentColor"/><path d="M2 12.5v2.5M22 12.5v2.5"/>',
  replay: '<path d="M4 12a8 8 0 103-6.3"/><path d="M4 4v4.5h4.5"/>',
  home: '<path d="M4 11l8-7 8 7v9h-5.5v-6h-5v6H4z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  auto: '<path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5L6.8 15M17.2 9l2.6-1.5"/><circle cx="12" cy="12" r="3"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.3 14a4.3 4.3 0 007.4 0"/><circle cx="9" cy="9.8" r="1.1" fill="currentColor"/><circle cx="15" cy="9.8" r="1.1" fill="currentColor"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  checkc: '<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.7 2.7L16 9.5"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10h.01M11 10h.01M15 10h.01M8 14.5h8"/>',
  sliders: '<path d="M4 8h9M18 8h2M4 16h3M11 16h9"/><circle cx="15.5" cy="8" r="2.4"/><circle cx="9" cy="16" r="2.4"/>',
  listol: '<path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v4M3.8 11.2a1.4 1.4 0 012.4 1L4 14.5h2.4M4 17h1.8a1 1 0 010 2H4.3"/>',
  poll: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  slide: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20.5h8"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  medal: '<path d="M8 3l4 6 4-6"/><circle cx="12" cy="15" r="5.5"/><path d="M12 12.5v5"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[n] || ''}</svg>`;
(function iconStyle() {
  const st = document.createElement('style');
  st.textContent = '.ic{width:1.2em;height:1.2em;vertical-align:-.22em;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;flex:none}'
    + '.btn .ic,.pill .ic,.typetag .ic{margin-right:.4em}.ib{display:inline-flex;align-items:center;justify-content:center;gap:.45em}';
  document.head.appendChild(st);
})();
function applyIcons(root = document) {
  root.querySelectorAll('[data-ic]').forEach((el) => {
    if (el.dataset.icDone) return; el.dataset.icDone = 1;
    el.insertAdjacentHTML('afterbegin', ic(el.dataset.ic));
  });
}

// ---------- Объёмные аватары (SVG с градиентами, бликами и тенью) ----------
const AV_DEFS = [
  { h: 28, ears: 'cat', eyes: 'big', mouth: 'smile', acc: '' },
  { h: 205, ears: 'bear', eyes: 'round', mouth: 'open', acc: 'glasses' },
  { h: 330, ears: 'bunny', eyes: 'happy', mouth: 'smile', acc: 'bow' },
  { h: 120, ears: 'antenna', eyes: 'one', mouth: 'open', acc: '' },
  { h: 48, ears: 'none', eyes: 'big', mouth: 'tongue', acc: 'crown' },
  { h: 265, ears: 'horns', eyes: 'round', mouth: 'smile', acc: '' },
  { h: 0, ears: 'bear', eyes: 'happy', mouth: 'open', acc: 'cap' },
  { h: 175, ears: 'fins', eyes: 'big', mouth: 'smile', acc: '' },
  { h: 15, ears: 'cat', eyes: 'round', mouth: 'tongue', acc: 'glasses' },
  { h: 95, ears: 'leaf', eyes: 'happy', mouth: 'smile', acc: '' },
  { h: 230, ears: 'antenna', eyes: 'big', mouth: 'smile', acc: 'bow' },
  { h: 300, ears: 'cat', eyes: 'happy', mouth: 'open', acc: 'crown' },
  { h: 190, ears: 'bunny', eyes: 'round', mouth: 'smile', acc: 'cap' },
  { h: 60, ears: 'horns', eyes: 'one', mouth: 'tongue', acc: '' },
  { h: 350, ears: 'none', eyes: 'round', mouth: 'smile', acc: 'glasses' },
  { h: 140, ears: 'bear', eyes: 'big', mouth: 'open', acc: 'crown' },
];
const AVATAR_IDS = AV_DEFS.map((_, i) => 'a' + i);
let _avSeq = 0;
function avatarSVG(id) {
  const i = /^a(\d+)$/.exec(String(id || ''));
  if (!i || !AV_DEFS[+i[1]]) return `<span class="av-emoji">${esc(id || '🙂')}</span>`;
  const d = AV_DEFS[+i[1]], h = d.h, u = 'av' + (++_avSeq) + '_';
  const c1 = `hsl(${h},95%,76%)`, c2 = `hsl(${h},80%,55%)`, c3 = `hsl(${h},75%,33%)`;
  const g = `<defs>
    <radialGradient id="${u}b" cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="${c1}"/><stop offset=".55" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/></radialGradient>
    <radialGradient id="${u}e" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c3}"/></radialGradient>
    <radialGradient id="${u}w" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#dcd8ea"/></radialGradient>
    <radialGradient id="${u}s" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <linearGradient id="${u}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe066"/><stop offset="1" stop-color="#e0a100"/></linearGradient></defs>`;
  const E = `url(#${u}e)`;
  const ears = {
    cat: `<path d="M22 34 26 8 44 24Z" fill="${E}"/><path d="M78 34 74 8 56 24Z" fill="${E}"/><path d="M27 28 29 15 38 24Z" fill="#ffb3c7" opacity=".8"/><path d="M73 28 71 15 62 24Z" fill="#ffb3c7" opacity=".8"/>`,
    bear: `<circle cx="24" cy="26" r="11" fill="${E}"/><circle cx="76" cy="26" r="11" fill="${E}"/><circle cx="24" cy="26" r="5.5" fill="#ffc9d6" opacity=".7"/><circle cx="76" cy="26" r="5.5" fill="#ffc9d6" opacity=".7"/>`,
    bunny: `<ellipse cx="36" cy="14" rx="7" ry="18" fill="${E}" transform="rotate(-10 36 14)"/><ellipse cx="64" cy="14" rx="7" ry="18" fill="${E}" transform="rotate(10 64 14)"/><ellipse cx="36" cy="15" rx="3" ry="12" fill="#ffc9d6" transform="rotate(-10 36 15)"/><ellipse cx="64" cy="15" rx="3" ry="12" fill="#ffc9d6" transform="rotate(10 64 15)"/>`,
    antenna: `<path d="M42 22 34 6M58 22 66 6" stroke="${c3}" stroke-width="3" stroke-linecap="round"/><circle cx="34" cy="6" r="5" fill="url(#${u}g)"/><circle cx="66" cy="6" r="5" fill="url(#${u}g)"/>`,
    horns: `<path d="M28 28C20 16 24 6 30 4c-1 8 3 14 8 18Z" fill="url(#${u}g)"/><path d="M72 28C80 16 76 6 70 4c1 8-3 14-8 18Z" fill="url(#${u}g)"/>`,
    fins: `<path d="M50 4C58 10 60 18 58 22H42C40 18 42 10 50 4Z" fill="${E}"/><path d="M14 52C4 46 4 36 8 32c4 6 10 8 14 10Z" fill="${E}"/><path d="M86 52c10-6 10-16 6-20-4 6-10 8-14 10Z" fill="${E}"/>`,
    leaf: `<path d="M50 20C48 8 56 2 66 2c0 10-6 16-16 18Z" fill="hsl(110,70%,45%)"/><path d="M50 20 58 9" stroke="hsl(110,70%,30%)" stroke-width="1.6"/>`,
    none: '',
  }[d.ears] || '';
  const eyeW = (x, r) => `<ellipse cx="${x}" cy="50" rx="${r}" ry="${r * 1.1}" fill="url(#${u}w)"/><circle cx="${x + 1.5}" cy="51.5" r="${r * 0.55}" fill="#1d1830"/><circle cx="${x + 3}" cy="48.5" r="${r * 0.22}" fill="#fff"/>`;
  const eyes = {
    big: eyeW(38, 8.5) + eyeW(62, 8.5),
    round: eyeW(39, 6.5) + eyeW(61, 6.5),
    happy: `<path d="M31 51q7-8 14 0M55 51q7-8 14 0" stroke="#1d1830" stroke-width="3.6" fill="none" stroke-linecap="round"/>`,
    one: `<ellipse cx="50" cy="48" rx="12" ry="13" fill="url(#${u}w)"/><circle cx="52" cy="50" r="7" fill="#1d1830"/><circle cx="55" cy="46" r="2.6" fill="#fff"/>`,
  }[d.eyes];
  const mouth = {
    smile: `<path d="M41 65q9 8 18 0" stroke="#1d1830" stroke-width="3.2" fill="none" stroke-linecap="round"/>`,
    open: `<path d="M40 63q10 0 20 0q-2 11-10 11t-10-11z" fill="#3a1028"/><path d="M44 70q6-4 12 0q-3 4-6 4t-6-4z" fill="#ff6b8b"/>`,
    tongue: `<path d="M41 64q9 6 18 0" stroke="#1d1830" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M48 66h8v4a4 4 0 01-8 0z" fill="#ff6b8b"/>`,
  }[d.mouth];
  const acc = {
    glasses: `<g fill="none" stroke="#1d1830" stroke-width="3"><circle cx="38" cy="50" r="11"/><circle cx="62" cy="50" r="11"/><path d="M49 49h2M27 47l-6-3M73 47l6-3"/></g><path d="M30 44a9 9 0 017-4" stroke="#fff" stroke-width="2" opacity=".7" fill="none"/>`,
    bow: `<path d="M50 22 36 14v16Z M50 22 64 14v16Z" fill="hsl(${(h + 180) % 360},85%,60%)" stroke="hsl(${(h + 180) % 360},70%,35%)" stroke-width="1.5"/><circle cx="50" cy="22" r="4" fill="hsl(${(h + 180) % 360},70%,45%)"/>`,
    crown: `<path d="M34 24 30 8 41 16 50 4 59 16 70 8 66 24Z" fill="url(#${u}g)" stroke="#b07a00" stroke-width="1.2"/><circle cx="50" cy="11" r="2.4" fill="#ff3b5c"/>`,
    cap: `<path d="M20 34Q22 12 50 12T80 34Z" fill="hsl(${(h + 200) % 360},80%,50%)"/><path d="M50 30h36q-4 6-14 6H50Z" fill="hsl(${(h + 200) % 360},75%,38%)"/><circle cx="50" cy="13" r="3" fill="#fff"/>`,
  }[d.acc] || '';
  return `<svg class="av" viewBox="0 0 100 100" aria-hidden="true">${g}
    <ellipse cx="50" cy="94" rx="30" ry="5" fill="url(#${u}s)"/>
    ${ears}
    <circle cx="50" cy="55" r="36" fill="url(#${u}b)"/>
    <ellipse cx="50" cy="66" rx="22" ry="16" fill="#fff" opacity=".18"/>
    <ellipse cx="36" cy="32" rx="12" ry="7" fill="#fff" opacity=".45" transform="rotate(-25 36 32)"/>
    <circle cx="27" cy="62" r="5" fill="#ff7aa0" opacity=".45"/><circle cx="73" cy="62" r="5" fill="#ff7aa0" opacity=".45"/>
    ${eyes}${mouth}${acc}</svg>`;
}
