// Kaxoote — своя викторина в стиле Kahoot. Запуск: npm start
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const QDIR = path.join(__dirname, 'quizzes');
const UDIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(QDIR, { recursive: true });
fs.mkdirSync(UDIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e7 });

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
const safeId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60);
const quizPath = (id) => path.join(QDIR, safeId(id) + '.json');

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  // домашние сети первыми
  out.sort((a, b) => (b.startsWith('192.168.') ? 1 : 0) - (a.startsWith('192.168.') ? 1 : 0));
  return out;
}

function readQuiz(id) {
  try { return JSON.parse(fs.readFileSync(quizPath(id), 'utf8')); } catch { return null; }
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- REST API ----------
app.get('/api/quizzes', (req, res) => {
  const list = fs.readdirSync(QDIR).filter((f) => f.endsWith('.json')).map((f) => {
    const id = f.slice(0, -5);
    const q = readQuiz(id) || {};
    return { id, title: q.title || id, description: q.description || '', count: (q.questions || []).length, cover: q.cover || '' };
  });
  res.json(list);
});

app.get('/api/quizzes/:id', (req, res) => {
  const q = readQuiz(req.params.id);
  if (!q) return res.status(404).json({ error: 'Не найдено' });
  res.json({ id: safeId(req.params.id), ...q });
});

app.post('/api/quizzes', (req, res) => {
  const body = req.body || {};
  let id = safeId(body.id);
  if (!id) id = 'quiz-' + Date.now().toString(36);
  const { id: _drop, ...data } = body;
  fs.writeFileSync(quizPath(id), JSON.stringify(data, null, 2), 'utf8');
  res.json({ id });
});

app.delete('/api/quizzes/:id', (req, res) => {
  try { fs.unlinkSync(quizPath(req.params.id)); } catch {}
  res.json({ ok: true });
});

app.post('/api/upload', (req, res) => {
  const m = /^data:(image\/(png|jpe?g|gif|webp));base64,(.+)$/.exec((req.body || {}).data || '');
  if (!m) return res.status(400).json({ error: 'Нужна картинка png/jpg/gif/webp' });
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
  const name = Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.' + ext;
  fs.writeFileSync(path.join(UDIR, name), Buffer.from(m[3], 'base64'));
  res.json({ url: '/uploads/' + name });
});

app.get('/api/info', async (req, res) => {
  const ips = lanIPs();
  const pin = String(req.query.pin || '').replace(/\D/g, '');
  const base = `http://${ips[0] || 'localhost'}:${PORT}/play.html`;
  const url = pin ? `${base}?pin=${pin}` : base;
  let qr = '';
  try { qr = await QRCode.toDataURL(url, { margin: 1, width: 320 }); } catch {}
  res.json({ ips, port: PORT, url, base, qr });
});

// ---------- GAME ----------
// убираем пустые варианты, оставленные в редакторе
function cleanQuiz(quiz) {
  if (!quiz) return null;
  quiz.questions = (quiz.questions || []).map((q) => {
    q = { ...q, text: String(q.text || '').trim(), time: Number(q.time) || 20 };
    if (q.type === 'quiz' || q.type === 'poll') {
      const keep = []; const map = {};
      (q.options || []).forEach((o, i) => { if (String(o).trim()) { map[i] = keep.length; keep.push(String(o).trim()); } });
      q.options = keep;
      q.correct = (q.correct || []).filter((i) => map[i] !== undefined).map((i) => map[i]);
      if (q.type === 'quiz' && !q.correct.length) q.correct = [0];
      if (q.options.length < 2) return null;
    }
    if (q.type === 'order') { q.items = (q.items || []).map((s) => String(s).trim()).filter(Boolean); if (q.items.length < 2) return null; }
    if (q.type === 'type') { q.accept = (q.accept || []).map((s) => String(s).trim()).filter(Boolean); if (!q.accept.length) return null; }
    if (q.type === 'slider') { for (const k of ['min', 'max', 'step', 'answer', 'tolerance']) q[k] = Number(q[k]) || 0; if (!q.step) q.step = 1; if (q.max <= q.min) q.max = q.min + 1; }
    if (q.type === 'truefalse') q.correct = [Number((q.correct || [0])[0]) ? 1 : 0];
    if (!q.text && q.type !== 'slide') return null;
    return q;
  }).filter(Boolean);
  return quiz;
}

const games = new Map(); // pin -> game

function newPin() {
  let pin;
  do { pin = String(Math.floor(100000 + Math.random() * 900000)); } while (games.has(pin));
  return pin;
}

function publicQuestion(q, forPlayer) {
  const base = { type: q.type, text: q.text, image: q.image || '', time: q.time || 20, points: q.points || 'standard' };
  if (q.type === 'quiz' || q.type === 'poll') {
    base.options = q.options; base.multi = !!q.multi && q.type === 'quiz';
  } else if (q.type === 'truefalse') {
    base.options = q.labels && q.labels.length === 2 ? q.labels : ['Правда', 'Миф'];
  } else if (q.type === 'slider') {
    Object.assign(base, { min: q.min, max: q.max, step: q.step || 1, unit: q.unit || '' });
  } else if (q.type === 'order') {
    base.items = q._shuffled; // [{id,text}]
  } else if (q.type === 'slide') {
    base.body = q.body || '';
  }
  if (forPlayer) delete base.image;
  return base;
}

function ranking(game) {
  return [...game.players.values()].sort((a, b) => b.score - a.score);
}

function hostEmit(game, ev, data) { io.to(game.hostId).emit(ev, data); }

function playersList(game) {
  return [...game.players.values()].map((p) => ({ name: p.name, avatar: p.avatar, connected: p.connected }));
}

function checkAnswer(q, value) {
  // returns {correct:boolean, factor:number 0..1}
  switch (q.type) {
    case 'quiz': {
      const corr = (q.correct || []).slice().sort();
      if (q.multi) {
        const v = (Array.isArray(value) ? value : [value]).map(Number).sort();
        return { correct: v.length === corr.length && v.every((x, i) => x === corr[i]), factor: 1 };
      }
      return { correct: corr.includes(Number(Array.isArray(value) ? value[0] : value)), factor: 1 };
    }
    case 'truefalse':
      return { correct: Number(value) === Number((q.correct || [0])[0]), factor: 1 };
    case 'type': {
      const v = norm(value);
      return { correct: (q.accept || []).some((a) => norm(a) === v), factor: 1 };
    }
    case 'slider': {
      const diff = Math.abs(Number(value) - Number(q.answer));
      const tol = Number(q.tolerance || 0);
      if (diff > tol) return { correct: false, factor: 0 };
      return { correct: true, factor: tol ? 1 - 0.5 * (diff / tol) : 1 };
    }
    case 'order': {
      const v = (value || []).map(Number);
      return { correct: v.length === q.items.length && v.every((x, i) => x === i), factor: 1 };
    }
    default:
      return { correct: false, factor: 0 };
  }
}

function startQuestion(game) {
  const q = game.quiz.questions[game.qIndex];
  if (q.type === 'order') q._shuffled = shuffle(q.items.map((t, i) => ({ id: i, text: t })));
  game.state = 'intro';
  for (const p of game.players.values()) p.answer = null;
  const info = { index: game.qIndex, total: game.quiz.questions.length, type: q.type, text: q.text };
  hostEmit(game, 'q:intro', info);
  io.to(game.pin + ':players').emit('p:intro', info);
  clearTimeout(game.timer);
  const introMs = q.type === 'slide' ? 0 : 4000;
  game.timer = setTimeout(() => {
    game.state = 'question';
    game.qStart = Date.now();
    hostEmit(game, 'q:start', { index: game.qIndex, total: game.quiz.questions.length, q: publicQuestion(q, false) });
    io.to(game.pin + ':players').emit('p:start', { index: game.qIndex, q: publicQuestion(q, true) });
    if (q.type !== 'slide') {
      game.timer = setTimeout(() => reveal(game), (q.time || 20) * 1000 + 300);
    }
  }, introMs);
}

function reveal(game) {
  if (game.state !== 'question') return;
  clearTimeout(game.timer);
  game.state = 'reveal';
  const q = game.quiz.questions[game.qIndex];
  const players = [...game.players.values()];
  const before = ranking(game).map((p) => p.key);

  // scoring
  for (const p of players) {
    p.lastPoints = 0; p.lastCorrect = false;
    if (q.type === 'poll' || q.type === 'slide') continue;
    if (!p.answer) { p.streak = 0; continue; }
    const { correct, factor } = checkAnswer(q, p.answer.value);
    p.lastCorrect = correct;
    if (correct) {
      p.streak = (p.streak || 0) + 1;
      const base = q.points === 'double' ? 2000 : q.points === 'none' ? 0 : 1000;
      const t = Math.min(1, p.answer.ms / ((q.time || 20) * 1000));
      let pts = Math.round(base * (1 - t / 2) * factor);
      if (base && p.streak >= 2) pts += Math.min(500, (p.streak - 1) * 100);
      p.lastPoints = pts;
      p.score += pts;
    } else {
      p.streak = 0;
    }
  }

  // stats
  let stats = {};
  if (['quiz', 'truefalse', 'poll'].includes(q.type)) {
    const n = q.type === 'truefalse' ? 2 : q.options.length;
    const counts = Array(n).fill(0);
    for (const p of players) {
      if (!p.answer) continue;
      const v = Array.isArray(p.answer.value) ? p.answer.value : [p.answer.value];
      v.forEach((i) => { if (counts[i] !== undefined) counts[i]++; });
    }
    stats.counts = counts;
  } else if (q.type === 'type') {
    const m = {};
    for (const p of players) if (p.answer) { const k = String(p.answer.value).trim(); m[k] = (m[k] || 0) + 1; }
    stats.top = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6);
  } else if (q.type === 'slider') {
    const vals = players.filter((p) => p.answer).map((p) => Number(p.answer.value));
    stats.values = vals;
    stats.avg = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  }
  stats.answered = players.filter((p) => p.answer).length;
  stats.correctCount = players.filter((p) => p.lastCorrect).length;
  stats.total = players.length;

  const ranked = ranking(game);
  ranked.forEach((p, i) => { p.prevRank = before.indexOf(p.key) + 1; p.rank = i + 1; });

  const correctInfo = {
    correct: q.correct, accept: q.accept, answer: q.answer, tolerance: q.tolerance,
    items: q.type === 'order' ? q.items : undefined, explain: q.explain || '',
  };
  hostEmit(game, 'q:reveal', { index: game.qIndex, q: publicQuestion(q, false), correct: correctInfo, stats });

  for (const p of players) {
    if (!p.socketId) continue;
    const above = ranked[p.rank - 2];
    io.to(p.socketId).emit('p:result', {
      type: q.type, correct: p.lastCorrect, answered: !!p.answer, points: p.lastPoints, score: p.score,
      streak: p.streak || 0, rank: p.rank, total: ranked.length,
      behind: above ? { name: above.name, by: above.score - p.score } : null,
      explain: q.explain || '',
    });
  }
}

function leaderboard(game) {
  game.state = 'leaderboard';
  const ranked = ranking(game);
  hostEmit(game, 'leaderboard', {
    top: ranked.slice(0, 5).map((p) => ({ name: p.name, avatar: p.avatar, score: p.score, rank: p.rank, prevRank: p.prevRank, streak: p.streak || 0 })),
    last: game.qIndex >= game.quiz.questions.length - 1,
  });
}

function podium(game) {
  game.state = 'end';
  clearTimeout(game.timer);
  const ranked = ranking(game);
  hostEmit(game, 'podium', { all: ranked.map((p, i) => ({ name: p.name, avatar: p.avatar, score: p.score, rank: i + 1 })) });
  ranked.forEach((p, i) => { if (p.socketId) io.to(p.socketId).emit('p:final', { rank: i + 1, score: p.score, total: ranked.length }); });
}

io.on('connection', (socket) => {
  // ---- host ----
  socket.on('host:create', ({ quizId }, cb) => {
    const quiz = cleanQuiz(readQuiz(quizId));
    if (!quiz || !(quiz.questions || []).length) return cb && cb({ error: 'Викторина пустая или не найдена' });
    const pin = newPin();
    const game = { pin, hostId: socket.id, quiz, players: new Map(), state: 'lobby', qIndex: -1, locked: false };
    games.set(pin, game);
    socket.data.hostPin = pin;
    socket.join(pin);
    cb && cb({ pin, title: quiz.title, count: quiz.questions.length });
  });

  const hostGame = () => games.get(socket.data.hostPin);

  socket.on('host:next', () => {
    const g = hostGame(); if (!g) return;
    const q = g.quiz.questions[g.qIndex];
    if (g.state === 'lobby' || g.state === 'leaderboard' || (g.state === 'question' && q && q.type === 'slide')) {
      if (g.qIndex >= g.quiz.questions.length - 1) return podium(g);
      g.qIndex++;
      startQuestion(g);
    } else if (g.state === 'question') {
      reveal(g);
    } else if (g.state === 'reveal') {
      if (q.type === 'poll' || q.type === 'slide') {
        if (g.qIndex >= g.quiz.questions.length - 1) return podium(g);
        g.qIndex++; return startQuestion(g);
      }
      leaderboard(g);
    }
  });

  socket.on('host:end', () => { const g = hostGame(); if (g) podium(g); });
  socket.on('host:lock', (v) => { const g = hostGame(); if (g) g.locked = !!v; });
  socket.on('host:kick', (name) => {
    const g = hostGame(); if (!g) return;
    for (const [k, p] of g.players) if (p.name === name) {
      if (p.socketId) io.to(p.socketId).emit('p:kicked');
      g.players.delete(k);
    }
    hostEmit(g, 'lobby', playersList(g));
  });

  // ---- player ----
  socket.on('player:join', ({ pin, name, avatar, key }, cb) => {
    const g = games.get(String(pin || '').trim());
    if (!g) return cb({ error: 'Игра с таким PIN не найдена' });
    name = String(name || '').trim().slice(0, 18);
    if (!name) return cb({ error: 'Введи имя' });
    // переподключение
    let p = key && g.players.get(key);
    if (!p) {
      if (g.locked) return cb({ error: 'Игра закрыта ведущим' });
      if ([...g.players.values()].some((x) => x.name.toLowerCase() === name.toLowerCase())) return cb({ error: 'Это имя уже занято' });
      key = Math.random().toString(36).slice(2) + Date.now().toString(36);
      p = { key, name, avatar: avatar || '🙂', score: 0, streak: 0, answer: null, connected: true };
      g.players.set(key, p);
    }
    p.socketId = socket.id; p.connected = true;
    socket.data.pin = g.pin; socket.data.key = key;
    socket.join(g.pin + ':players');
    hostEmit(g, 'lobby', playersList(g));
    cb({ ok: true, key, name: p.name, title: g.quiz.title, score: p.score, state: g.state });
    if (g.state === 'question') {
      const q = g.quiz.questions[g.qIndex];
      if (!p.answer) socket.emit('p:start', { index: g.qIndex, q: publicQuestion(q, true) });
    }
  });

  socket.on('player:answer', ({ value }, cb) => {
    const g = games.get(socket.data.pin); if (!g || g.state !== 'question') return cb && cb({ late: true });
    const p = g.players.get(socket.data.key); if (!p || p.answer) return cb && cb({ dup: true });
    const q = g.quiz.questions[g.qIndex];
    if (q.type === 'slide') return;
    p.answer = { value, ms: Date.now() - g.qStart };
    cb && cb({ ok: true });
    const answered = [...g.players.values()].filter((x) => x.answer).length;
    hostEmit(g, 'answers', { answered, total: g.players.size });
    if (answered >= [...g.players.values()].filter((x) => x.connected).length) setTimeout(() => reveal(g), 400);
  });

  socket.on('disconnect', () => {
    if (socket.data.hostPin) {
      const g = games.get(socket.data.hostPin);
      if (g) {
        io.to(g.pin + ':players').emit('p:hostleft');
        clearTimeout(g.timer);
        games.delete(g.pin);
      }
    }
    if (socket.data.pin) {
      const g = games.get(socket.data.pin);
      const p = g && g.players.get(socket.data.key);
      if (p && p.socketId === socket.id) {
        p.connected = false;
        if (g.state === 'lobby') g.players.delete(socket.data.key);
        hostEmit(g, 'lobby', playersList(g));
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanIPs();
  console.log('\n  ★ Kaxoote запущен!\n');
  console.log(`  Ведущий (этот компьютер):  http://localhost:${PORT}`);
  ips.forEach((ip) => console.log(`  Игроки (телефоны в той же Wi-Fi):  http://${ip}:${PORT}/play.html`));
  console.log('\n  Чтобы остановить — нажми Ctrl+C\n');
});
