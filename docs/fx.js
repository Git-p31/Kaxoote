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
const TYPE_COLORS = { quiz: '#864cbf', truefalse: '#1368ce', type: '#26890c', slider: '#0aa3a3', order: '#d89e00', poll: '#e21b3c', slide: '#46178f' };
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
  plus: '<path d="M12 5v14M5 12h14"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.8" fill="currentColor"/><path d="M21 16l-5-5-9 9"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8"/>',
  save: '<path d="M5 4h11l3 3v12a1 1 0 01-1 1H6a1 1 0 01-1-1z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  link2: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
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

// ---------- Милые 2D-зверята (плоский стиль) ----------
const INK = '#2b2340';
const _e = (x, y, s = 1) => `<ellipse cx="${x}" cy="${y}" rx="${5 * s}" ry="${6 * s}" fill="${INK}"/><circle cx="${x + 1.8 * s}" cy="${y - 2.3 * s}" r="${1.9 * s}" fill="#fff"/><circle cx="${x - 1.6 * s}" cy="${y + 2 * s}" r="${0.8 * s}" fill="#fff" opacity=".8"/>`;
const _eyes = (y = 54, dx = 12, s = 1) => _e(50 - dx, y, s) + _e(50 + dx, y, s);
const _cheeks = (y = 63, dx = 21) => `<ellipse cx="${50 - dx}" cy="${y}" rx="6" ry="3.8" fill="#ff8fab" opacity=".6"/><ellipse cx="${50 + dx}" cy="${y}" rx="6" ry="3.8" fill="#ff8fab" opacity=".6"/>`;
const _w = (y) => `<path d="M44 ${y}q3 3.2 6 0q3 3.2 6 0" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
const _smile = (y, w = 6) => `<path d="M${50 - w} ${y}q${w} ${w * 0.8} ${w * 2} 0" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
const _whisk = (y, c = INK) => `<path d="M30 ${y}h-12M30 ${y + 4}l-11 3M70 ${y}h12M70 ${y + 4}l11 3" stroke="${c}" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>`;
const _mirror = (d, fill) => `<path d="${d}" fill="${fill}"/><path d="${d}" fill="${fill}" transform="translate(100 0) scale(-1 1)"/>`;
const ANIMALS = [
  { n: 'Котик', bg: '#ffe3c2', svg: () => _mirror('M22 42 26 13 45 31Z', '#f59e42') + _mirror('M27 35 29 21 39 30Z', '#ffb4c2')
    + `<ellipse cx="50" cy="57" rx="32" ry="28" fill="#f59e42"/><path d="M50 31v7M44 32l1.2 5.5M56 32l-1.2 5.5" stroke="#d9771a" stroke-width="3" stroke-linecap="round"/>`
    + `<ellipse cx="50" cy="67" rx="12" ry="8" fill="#fff3e6"/>${_eyes(54)}${_cheeks(64)}<path d="M47 61.5h6l-3 3.2z" fill="#ff7a93"/>${_w(65)}${_whisk(63)}` },
  { n: 'Щенок', bg: '#d7ecff', svg: () => `<ellipse cx="50" cy="56" rx="30" ry="28" fill="#e8b77c"/><ellipse cx="62" cy="52" rx="9" ry="10" fill="#c98f52"/>`
    + `<ellipse cx="21" cy="52" rx="9" ry="19" fill="#8a5a32" transform="rotate(14 21 52)"/><ellipse cx="79" cy="52" rx="9" ry="19" fill="#8a5a32" transform="rotate(-14 79 52)"/>`
    + `<ellipse cx="50" cy="68" rx="14" ry="10" fill="#fff1df"/>${_eyes(52)}${_cheeks(63, 20)}<ellipse cx="50" cy="62" rx="5" ry="3.8" fill="${INK}"/><circle cx="48.5" cy="61" r="1.2" fill="#fff"/>`
    + `<path d="M47 71q3 8 6 0z" fill="#ff7a93"/><path d="M50 65.5v3M44 68.5q6 5 12 0" stroke="${INK}" stroke-width="2.3" fill="none" stroke-linecap="round"/>` },
  { n: 'Мишка', bg: '#ffe9d6', svg: () => `<circle cx="26" cy="31" r="11" fill="#9c6b45"/><circle cx="74" cy="31" r="11" fill="#9c6b45"/><circle cx="26" cy="31" r="5.5" fill="#e8b88f"/><circle cx="74" cy="31" r="5.5" fill="#e8b88f"/>`
    + `<ellipse cx="50" cy="57" rx="32" ry="29" fill="#9c6b45"/><ellipse cx="50" cy="67" rx="13" ry="10" fill="#e8c9a6"/>${_eyes(53)}${_cheeks(64, 22)}`
    + `<ellipse cx="50" cy="62" rx="4.8" ry="3.6" fill="${INK}"/><path d="M50 65v2.5M45.5 68q4.5 4 9 0" stroke="${INK}" stroke-width="2.3" fill="none" stroke-linecap="round"/>` },
  { n: 'Зайка', bg: '#ffe0ef', svg: () => `<ellipse cx="38" cy="22" rx="7.5" ry="21" fill="#f6f3fa" transform="rotate(-8 38 22)"/><ellipse cx="62" cy="22" rx="7.5" ry="21" fill="#f6f3fa" transform="rotate(8 62 22)"/>`
    + `<ellipse cx="38" cy="23" rx="3.6" ry="14" fill="#ffb4c8" transform="rotate(-8 38 23)"/><ellipse cx="62" cy="23" rx="3.6" ry="14" fill="#ffb4c8" transform="rotate(8 62 23)"/>`
    + `<ellipse cx="50" cy="59" rx="30" ry="27" fill="#f6f3fa"/>${_eyes(55)}${_cheeks(65)}<ellipse cx="50" cy="63" rx="3.6" ry="2.6" fill="#ff8fab"/>`
    + `<path d="M50 65.5v2.5M46 68q4 3 8 0" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/><rect x="47.3" y="68.5" width="5.4" height="4.6" rx="1.2" fill="#fff" stroke="${INK}" stroke-width="1.2"/>` },
  { n: 'Лисичка', bg: '#fff0d6', svg: () => _mirror('M20 44 24 12 45 31Z', '#f07b2a') + _mirror('M24 12 22.6 25 32.5 21Z', '#3b2b2b') + _mirror('M26 34 27.5 22 37 30Z', '#ffd9b8')
    + `<path d="M17 46Q50 18 83 46Q79 75 50 85Q21 75 17 46Z" fill="#f07b2a"/><path d="M22 58Q37 60 50 72Q63 60 78 58Q71 79 50 85Q29 79 22 58Z" fill="#fff4ea"/>`
    + `${_eyes(53)}${_cheeks(63, 23)}<ellipse cx="50" cy="72" rx="4.2" ry="3.2" fill="${INK}"/>${_smile(76, 3.5)}` },
  { n: 'Панда', bg: '#dff5e1', svg: () => `<circle cx="25" cy="29" r="11" fill="${INK}"/><circle cx="75" cy="29" r="11" fill="${INK}"/><ellipse cx="50" cy="57" rx="32" ry="29" fill="#fff"/>`
    + `<ellipse cx="37" cy="54" rx="9" ry="11.5" fill="${INK}" transform="rotate(-22 37 54)"/><ellipse cx="63" cy="54" rx="9" ry="11.5" fill="${INK}" transform="rotate(22 63 54)"/>`
    + `<circle cx="38" cy="53" r="4.2" fill="#fff"/><circle cx="62" cy="53" r="4.2" fill="#fff"/><circle cx="38.6" cy="53.6" r="2.5" fill="${INK}"/><circle cx="62.6" cy="53.6" r="2.5" fill="${INK}"/><circle cx="39.4" cy="52.4" r=".9" fill="#fff"/><circle cx="63.4" cy="52.4" r=".9" fill="#fff"/>`
    + `${_cheeks(66, 22)}<ellipse cx="50" cy="65" rx="4.2" ry="3" fill="${INK}"/><path d="M50 67.5v2M46 70q4 3 8 0" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>` },
  { n: 'Лягушонок', bg: '#e2f7d0', svg: () => `<circle cx="33" cy="33" r="12.5" fill="#6cc24a"/><circle cx="67" cy="33" r="12.5" fill="#6cc24a"/><ellipse cx="50" cy="60" rx="35" ry="26" fill="#6cc24a"/>`
    + `<circle cx="33" cy="33" r="8" fill="#fff"/><circle cx="67" cy="33" r="8" fill="#fff"/>${_e(33, 33.5, 0.85)}${_e(67, 33.5, 0.85)}`
    + `<circle cx="46" cy="52" r="1.4" fill="#3a7a2a"/><circle cx="54" cy="52" r="1.4" fill="#3a7a2a"/>${_cheeks(62, 25)}<path d="M33 62q17 13 34 0" stroke="${INK}" stroke-width="2.8" fill="none" stroke-linecap="round"/><path d="M45 67.5q5 5 10 0z" fill="#ff7a93"/>` },
  { n: 'Совёнок', bg: '#ece3ff', svg: () => _mirror('M24 36 21 13 39 27Z', '#8b6bd1') + `<ellipse cx="50" cy="57" rx="32" ry="30" fill="#8b6bd1"/>`
    + `<circle cx="38" cy="50" r="12.5" fill="#f3ecff"/><circle cx="62" cy="50" r="12.5" fill="#f3ecff"/>${_e(38, 51, 1.1)}${_e(62, 51, 1.1)}<path d="M45.5 60h9L50 68z" fill="#ffb02e"/>`
    + `${_cheeks(63, 23)}<path d="M40 75q3 3 6 0M54 75q3 3 6 0M47 80q3 3 6 0" stroke="#b9a3ec" stroke-width="2.2" fill="none" stroke-linecap="round"/>` },
  { n: 'Пингвин', bg: '#d9f1ff', svg: () => `<path d="M50 22q-3-7 5-9-2 5 0 9z" fill="#2f3550"/><ellipse cx="50" cy="55" rx="32" ry="31" fill="#2f3550"/>`
    + `<path d="M50 37C40 28 22 36 24 54 26 70 40 79 50 79S74 70 76 54C78 36 60 28 50 37Z" fill="#fff"/>${_eyes(53, 11)}${_cheeks(64, 19)}<ellipse cx="50" cy="63" rx="6.5" ry="4.2" fill="#ffa62b"/>` },
  { n: 'Хрюша', bg: '#ffe3ea', svg: () => _mirror('M24 40 22 18 41 29Z', '#ff9bb3') + `<ellipse cx="50" cy="57" rx="32" ry="28" fill="#ffb8c9"/>${_eyes(50)}${_cheeks(59, 23)}`
    + `<ellipse cx="50" cy="65" rx="11.5" ry="8.5" fill="#ff8fab"/><ellipse cx="46" cy="65" rx="2.1" ry="3.2" fill="#d9607e"/><ellipse cx="54" cy="65" rx="2.1" ry="3.2" fill="#d9607e"/>${_smile(76, 4)}` },
  { n: 'Львёнок', bg: '#fff2c2', svg: () => Array.from({ length: 12 }, (_, k) => { const a = (k / 12) * Math.PI * 2; return `<circle cx="${(50 + Math.cos(a) * 33).toFixed(1)}" cy="${(55 + Math.sin(a) * 31).toFixed(1)}" r="11.5" fill="${k % 2 ? '#e08a2c' : '#d0761c'}"/>`; }).join('')
    + `<circle cx="31" cy="35" r="7.5" fill="#ffcf5c"/><circle cx="69" cy="35" r="7.5" fill="#ffcf5c"/><circle cx="31" cy="35" r="3.6" fill="#e8a63d"/><circle cx="69" cy="35" r="3.6" fill="#e8a63d"/>`
    + `<ellipse cx="50" cy="57" rx="27" ry="25" fill="#ffcf5c"/><ellipse cx="50" cy="67" rx="11" ry="8" fill="#fff0c9"/>${_eyes(53, 11)}${_cheeks(63, 18)}`
    + `<path d="M46 61.5h8l-4 4z" fill="#8a4b2a"/><path d="M50 65.5v2M46 68.5q4 3 8 0" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>` },
  { n: 'Коала', bg: '#e1ecf5', svg: () => `<circle cx="22" cy="38" r="16" fill="#9aa6b6"/><circle cx="78" cy="38" r="16" fill="#9aa6b6"/><circle cx="22" cy="38" r="9" fill="#f3d9e3"/><circle cx="78" cy="38" r="9" fill="#f3d9e3"/>`
    + `<ellipse cx="50" cy="57" rx="30" ry="28" fill="#b3bdcb"/>${_eyes(52, 13)}${_cheeks(64, 23)}<ellipse cx="50" cy="62" rx="7" ry="9" fill="#3a3f52"/><ellipse cx="47.5" cy="58.5" rx="2" ry="2.6" fill="#fff" opacity=".5"/>${_smile(75, 3.5)}` },
  { n: 'Мышонок', bg: '#fff0d9', svg: () => `<circle cx="25" cy="32" r="15" fill="#b9b4c7"/><circle cx="75" cy="32" r="15" fill="#b9b4c7"/><circle cx="25" cy="32" r="9" fill="#ffc2d1"/><circle cx="75" cy="32" r="9" fill="#ffc2d1"/>`
    + `<ellipse cx="50" cy="59" rx="28" ry="26" fill="#cbc6d8"/>${_eyes(55, 11)}${_cheeks(65, 19)}<circle cx="50" cy="63.5" r="3.4" fill="#ff7a93"/>${_smile(68, 3)}${_whisk(63)}` },
  { n: 'Цыплёнок', bg: '#e6f7ff', svg: () => `<ellipse cx="20" cy="63" rx="6" ry="10" fill="#fcc419" transform="rotate(20 20 63)"/><ellipse cx="80" cy="63" rx="6" ry="10" fill="#fcc419" transform="rotate(-20 80 63)"/>`
    + `<path d="M47 26q-7-10 1-13-1 6 4 8 3-7 8-3-6 2-8 8z" fill="#fab005"/><circle cx="50" cy="57" r="32" fill="#ffd43b"/>${_eyes(54, 11)}${_cheeks(64, 20)}<path d="M45 60.5h10L50 67.5z" fill="#ff922b"/>` },
  { n: 'Единорог', bg: '#f1e6ff', svg: () => `<circle cx="27" cy="40" r="10" fill="#ff8fd1"/><circle cx="22" cy="54" r="9" fill="#b197fc"/><circle cx="26" cy="68" r="7.5" fill="#74c0fc"/><circle cx="38" cy="29" r="8" fill="#b197fc"/>`
    + _mirror('M30 36 33 21 43 31Z', '#fff') + `<ellipse cx="50" cy="58" rx="29" ry="27" fill="#fff"/><path d="M50 6 56.5 31h-13z" fill="#ffd43b"/><path d="M45.5 24l9.5-3M46.8 18l7-2.4M48 12l4.6-1.5" stroke="#f08c00" stroke-width="1.8" stroke-linecap="round"/>`
    + `<circle cx="34" cy="33" r="7" fill="#ff8fd1"/>${_eyes(56, 11)}${_cheeks(66, 19)}${_smile(68, 4)}` },
  { n: 'Енотик', bg: '#e9f0e0', svg: () => _mirror('M23 40 25 18 43 30Z', '#7d7f8f') + _mirror('M27 35 28.5 24 37.5 30Z', '#d6c8d9') + `<ellipse cx="50" cy="57" rx="32" ry="28" fill="#a3a5b4"/>`
    + `<path d="M19 53Q29 42 45 50Q50 54 55 50Q71 42 81 53Q73 65 58 59Q50 57 42 59Q27 65 19 53Z" fill="#3b3d4e"/><ellipse cx="36" cy="44" rx="8" ry="2.8" fill="#fff"/><ellipse cx="64" cy="44" rx="8" ry="2.8" fill="#fff"/>`
    + `<circle cx="37" cy="53" r="4.4" fill="#fff"/><circle cx="63" cy="53" r="4.4" fill="#fff"/><circle cx="37.6" cy="53.6" r="2.6" fill="${INK}"/><circle cx="63.6" cy="53.6" r="2.6" fill="${INK}"/>`
    + `<ellipse cx="50" cy="67" rx="12" ry="8" fill="#f2f0f5"/>${_cheeks(66, 23)}<ellipse cx="50" cy="63" rx="3.8" ry="2.8" fill="${INK}"/>${_smile(68, 3)}` },
];
const AVATAR_IDS = ANIMALS.map((_, i) => 'a' + i);
function avatarSVG(id) {
  const m = /^a(\d+)$/.exec(String(id || ''));
  const a = m && ANIMALS[+m[1]];
  if (!a) return `<span class="av-emoji">${esc(id || '🙂')}</span>`;
  return `<svg class="av" viewBox="0 0 100 100" role="img" aria-label="${a.n}"><circle cx="50" cy="50" r="49" fill="${a.bg}"/>${a.svg()}</svg>`;
}
const avatarName = (id) => { const m = /^a(\d+)$/.exec(String(id || '')); return (m && ANIMALS[+m[1]] && ANIMALS[+m[1]].n) || ''; };
