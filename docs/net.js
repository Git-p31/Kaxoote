// Сеть без сервера: браузер ведущего = игровой сервер, телефоны подключаются к нему через WebRTC (PeerJS).
// Объекты HostSocket / PlayerSocket повторяют интерфейс socket.io: on(ev, fn) и emit(ev, data, cb).
const PEER_PREFIX = 'kaxoote-v1-';
const PEER_OPTS = { debug: 1, config: { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
] } };
if (window.KX_PEER) Object.assign(PEER_OPTS, window.KX_PEER); // свой сервер соединений (необязательно)

// ================= ВЕДУЩИЙ =================
function HostSocket() {
  const handlers = {};
  const local = (ev, data) => { if (handlers[ev]) handlers[ev](data); };
  let game = null, peer = null;

  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function cleanQuiz(quiz) {
    if (!quiz) return null;
    quiz.questions = (quiz.questions || []).map((q) => {
      q = { ...q, text: String(q.text || '').trim(), time: Number(q.time) || 20 };
      if (q.type === 'quiz' || q.type === 'poll') {
        const keep = [], map = {};
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

  function publicQuestion(q, forPlayer) {
    const base = { type: q.type, text: q.text, image: q.image || '', time: q.time || 20, points: q.points || 'standard' };
    if (q.type === 'quiz' || q.type === 'poll') { base.options = q.options; base.multi = !!q.multi && q.type === 'quiz'; }
    else if (q.type === 'truefalse') base.options = q.labels && q.labels.length === 2 ? q.labels : ['Правда', 'Миф'];
    else if (q.type === 'slider') Object.assign(base, { min: q.min, max: q.max, step: q.step || 1, unit: q.unit || '' });
    else if (q.type === 'order') base.items = q._shuffled;
    else if (q.type === 'slide') base.body = q.body || '';
    if (forPlayer) delete base.image; // картинки на телефон не шлём — экономим трафик
    return base;
  }

  function checkAnswer(q, value) {
    switch (q.type) {
      case 'quiz': {
        const corr = (q.correct || []).slice().sort();
        if (q.multi) {
          const v = (Array.isArray(value) ? value : [value]).map(Number).sort();
          return { correct: v.length === corr.length && v.every((x, i) => x === corr[i]), factor: 1 };
        }
        return { correct: corr.includes(Number(Array.isArray(value) ? value[0] : value)), factor: 1 };
      }
      case 'truefalse': return { correct: Number(value) === Number((q.correct || [0])[0]), factor: 1 };
      case 'type': { const v = norm(value); return { correct: (q.accept || []).some((a) => norm(a) === v), factor: 1 }; }
      case 'slider': {
        const diff = Math.abs(Number(value) - Number(q.answer)), tol = Number(q.tolerance || 0);
        if (diff > tol) return { correct: false, factor: 0 };
        return { correct: true, factor: tol ? 1 - 0.5 * (diff / tol) : 1 };
      }
      case 'order': { const v = (value || []).map(Number); return { correct: v.length === q.items.length && v.every((x, i) => x === i), factor: 1 }; }
      default: return { correct: false, factor: 0 };
    }
  }

  const ranking = () => [...game.players.values()].sort((a, b) => b.score - a.score);
  const playersList = () => [...game.players.values()].map((p) => ({ name: p.name, avatar: p.avatar, connected: p.connected }));
  const send = (p, ev, data) => { try { if (p.conn && p.conn.open) p.conn.send({ t: 'ev', ev, data }); } catch {} };
  const sendAll = (ev, data) => { for (const p of game.players.values()) send(p, ev, data); };

  function startQuestion() {
    const q = game.quiz.questions[game.qIndex];
    if (q.type === 'order') q._shuffled = shuffle(q.items.map((t, i) => ({ id: i, text: t })));
    game.state = 'intro';
    for (const p of game.players.values()) p.answer = null;
    const info = { index: game.qIndex, total: game.quiz.questions.length, type: q.type, text: q.text };
    local('q:intro', info); sendAll('p:intro', info);
    clearTimeout(game.timer);
    game.timer = setTimeout(() => {
      game.state = 'question'; game.qStart = Date.now();
      local('q:start', { index: game.qIndex, total: game.quiz.questions.length, q: publicQuestion(q, false) });
      sendAll('p:start', { index: game.qIndex, q: publicQuestion(q, true) });
      if (q.type !== 'slide') game.timer = setTimeout(reveal, (q.time || 20) * 1000 + 300);
    }, q.type === 'slide' ? 0 : 4000);
  }

  function reveal() {
    if (!game || game.state !== 'question') return;
    clearTimeout(game.timer); game.state = 'reveal';
    const q = game.quiz.questions[game.qIndex];
    const players = [...game.players.values()];
    const before = ranking().map((p) => p.key);
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
        p.lastPoints = pts; p.score += pts;
      } else p.streak = 0;
    }
    const stats = {};
    if (['quiz', 'truefalse', 'poll'].includes(q.type)) {
      const counts = Array(q.type === 'truefalse' ? 2 : q.options.length).fill(0);
      for (const p of players) if (p.answer) (Array.isArray(p.answer.value) ? p.answer.value : [p.answer.value]).forEach((i) => { if (counts[i] !== undefined) counts[i]++; });
      stats.counts = counts;
    } else if (q.type === 'type') {
      const m = {}; for (const p of players) if (p.answer) { const k = String(p.answer.value).trim(); m[k] = (m[k] || 0) + 1; }
      stats.top = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6);
    } else if (q.type === 'slider') {
      const vals = players.filter((p) => p.answer).map((p) => Number(p.answer.value));
      stats.values = vals; stats.avg = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
    }
    stats.answered = players.filter((p) => p.answer).length;
    stats.correctCount = players.filter((p) => p.lastCorrect).length;
    stats.total = players.length;
    const ranked = ranking();
    ranked.forEach((p, i) => { p.prevRank = before.indexOf(p.key) + 1; p.rank = i + 1; });
    local('q:reveal', { index: game.qIndex, q: publicQuestion(q, false), stats, correct: {
      correct: q.correct, accept: q.accept, answer: q.answer, tolerance: q.tolerance, items: q.type === 'order' ? q.items : undefined, explain: q.explain || '' } });
    for (const p of players) {
      const above = ranked[p.rank - 2];
      send(p, 'p:result', { type: q.type, correct: p.lastCorrect, answered: !!p.answer, points: p.lastPoints, score: p.score, streak: p.streak || 0,
        rank: p.rank, total: ranked.length, behind: above ? { name: above.name, by: above.score - p.score } : null, explain: q.explain || '' });
    }
  }

  function leaderboard() {
    game.state = 'leaderboard';
    local('leaderboard', { top: ranking().slice(0, 5).map((p) => ({ name: p.name, avatar: p.avatar, score: p.score, rank: p.rank, prevRank: p.prevRank, streak: p.streak || 0 })),
      last: game.qIndex >= game.quiz.questions.length - 1 });
  }

  function podium() {
    game.state = 'end'; clearTimeout(game.timer);
    const ranked = ranking();
    local('podium', { all: ranked.map((p, i) => ({ name: p.name, avatar: p.avatar, score: p.score, rank: i + 1 })) });
    ranked.forEach((p, i) => send(p, 'p:final', { rank: i + 1, score: p.score, total: ranked.length }));
  }

  function next() {
    if (!game) return;
    const q = game.quiz.questions[game.qIndex];
    const last = game.qIndex >= game.quiz.questions.length - 1;
    if (game.state === 'lobby' || game.state === 'leaderboard' || (game.state === 'question' && q && q.type === 'slide')) {
      if (last) return podium();
      game.qIndex++; startQuestion();
    } else if (game.state === 'question') reveal();
    else if (game.state === 'reveal') {
      if (q.type === 'poll' || q.type === 'slide') { if (last) return podium(); game.qIndex++; return startQuestion(); }
      leaderboard();
    }
  }

  // ---- входящие от игроков ----
  function onPlayerMsg(conn, msg) {
    if (!msg || msg.t !== 'emit') return;
    const reply = (res) => { try { conn.send({ t: 'ack', id: msg.id, res }); } catch {} };
    const d = msg.data || {};
    if (msg.ev === 'player:join') {
      let name = String(d.name || '').trim().slice(0, 18);
      if (!name) return reply({ error: 'Введи имя' });
      let p = d.key && game.players.get(d.key), key = d.key;
      if (!p) {
        if (game.locked) return reply({ error: 'Игра закрыта ведущим' });
        if ([...game.players.values()].some((x) => x.name.toLowerCase() === name.toLowerCase() && x.connected)) return reply({ error: 'Это имя уже занято' });
        key = Math.random().toString(36).slice(2) + Date.now().toString(36);
        p = { key, name, avatar: d.avatar || '🙂', score: 0, streak: 0, answer: null };
        game.players.set(key, p);
      }
      p.conn = conn; p.connected = true; conn._key = key;
      local('lobby', playersList());
      reply({ ok: true, key, name: p.name, title: game.quiz.title, score: p.score, state: game.state });
      if (game.state === 'question' && !p.answer) {
        const q = game.quiz.questions[game.qIndex];
        send(p, 'p:start', { index: game.qIndex, q: publicQuestion(q, true) });
      }
    } else if (msg.ev === 'player:answer') {
      if (game.state !== 'question') return reply({ late: true });
      const p = game.players.get(conn._key); if (!p || p.answer) return reply({ dup: true });
      const q = game.quiz.questions[game.qIndex]; if (q.type === 'slide') return;
      p.answer = { value: d.value, ms: Date.now() - game.qStart };
      reply({ ok: true });
      const answered = [...game.players.values()].filter((x) => x.answer).length;
      local('answers', { answered, total: game.players.size });
      if (answered >= [...game.players.values()].filter((x) => x.connected).length) setTimeout(reveal, 400);
    }
  }

  function onConn(conn) {
    conn.on('data', (m) => onPlayerMsg(conn, m));
    const gone = () => {
      const p = conn._key && game && game.players.get(conn._key);
      if (p && p.conn === conn) {
        p.connected = false;
        if (game.state === 'lobby') game.players.delete(conn._key);
        local('lobby', playersList());
      }
    };
    conn.on('close', gone); conn.on('error', gone);
  }

  function create(quizId, cb, tries = 0) {
    Store.get(quizId).then((raw) => {
      const quiz = cleanQuiz(raw);
      if (!quiz || !quiz.questions.length) return cb({ error: 'Викторина пустая или не найдена' });
      if (peer) { try { peer.destroy(); } catch {} }
      const pin = String(Math.floor(100000 + Math.random() * 900000));
      peer = new Peer(PEER_PREFIX + pin, PEER_OPTS);
      let opened = false;
      peer.on('open', () => {
        opened = true;
        game = { pin, quiz, players: new Map(), state: 'lobby', qIndex: -1, locked: false };
        cb({ pin, title: quiz.title, count: quiz.questions.length });
      });
      peer.on('connection', onConn);
      peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
      peer.on('error', (e) => {
        if (e.type === 'unavailable-id' && tries < 5) return create(quizId, cb, tries + 1);
        if (!opened) cb({ error: 'Нет связи с сервером соединений. Проверь интернет и обнови страницу. (' + e.type + ')' });
      });
    });
  }

  addEventListener('beforeunload', () => { if (game) sendAll('p:hostleft'); });

  return {
    on(ev, fn) { handlers[ev] = fn; },
    emit(ev, data, cb) {
      if (ev === 'host:create') return create(data.quizId, cb || (() => {}));
      if (!game) return;
      if (ev === 'host:next') next();
      else if (ev === 'host:end') podium();
      else if (ev === 'host:lock') game.locked = !!data;
      else if (ev === 'host:kick') {
        for (const [k, p] of game.players) if (p.name === data) { send(p, 'p:kicked'); game.players.delete(k); }
        local('lobby', playersList());
      }
    },
  };
}

// ================= ИГРОК =================
function PlayerSocket() {
  const handlers = {}, pending = {};
  let peer = null, conn = null, pin = null, seq = 0, connecting = null, wasConnected = false;
  const fire = (ev, d) => { if (handlers[ev]) handlers[ev](d); };

  function ensurePeer() {
    if (peer && !peer.destroyed) return Promise.resolve(peer);
    return new Promise((res, rej) => {
      peer = new Peer(PEER_OPTS);
      peer.on('open', () => res(peer));
      peer.on('error', (e) => {
        if (e.type === 'peer-unavailable') { connecting = null; const f = pending.__connect; delete pending.__connect; f && f(new Error('nogame')); }
        else rej(e);
      });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
    });
  }

  function connect(p) {
    if (conn && conn.open && pin === p) return Promise.resolve();
    if (connecting && pin === p) return connecting;
    pin = p;
    connecting = ensurePeer().then(() => new Promise((res, rej) => {
      const c = peer.connect(PEER_PREFIX + p, { reliable: true });
      const timer = setTimeout(() => { delete pending.__connect; rej(new Error('timeout')); }, 12000);
      pending.__connect = (err) => { clearTimeout(timer); rej(err); };
      c.on('open', () => {
        clearTimeout(timer); delete pending.__connect; conn = c; connecting = null;
        if (wasConnected) setTimeout(() => fire('connect'), 50);
        wasConnected = true; res();
      });
      c.on('data', (m) => {
        if (!m) return;
        if (m.t === 'ack' && pending[m.id]) { pending[m.id](m.res); delete pending[m.id]; }
        else if (m.t === 'ev') fire(m.ev, m.data);
      });
      c.on('close', () => { if (conn === c) { conn = null; setTimeout(() => connect(pin).catch(() => {}), 1500); } });
    })).catch((e) => { connecting = null; throw e; });
    return connecting;
  }

  return {
    on(ev, fn) { handlers[ev] = fn; },
    emit(ev, data, cb) {
      const go = () => {
        const id = ++seq; if (cb) pending[id] = cb;
        try { conn.send({ t: 'emit', ev, id, data }); } catch { cb && cb({ error: 'Связь потеряна' }); }
      };
      if (ev === 'player:join') {
        connect(String(data.pin)).then(go).catch((e) => cb && cb({ error: e.message === 'nogame' || e.message === 'timeout' ? 'Игра с таким PIN не найдена' : 'Нет связи. Проверь интернет.' }));
      } else if (conn && conn.open) go();
      else connect(pin).then(go).catch(() => cb && cb({ error: 'Связь потеряна' }));
    },
  };
}
