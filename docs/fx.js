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
const AVATARS = ['🦁', '🐯', '🐻', '🐼', '🦊', '🐸', '🐵', '🦄', '🐙', '🐢', '🦉', '🐬', '🐝', '🦖', '🐧', '🐨'];
