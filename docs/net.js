// Сеть без своего сервера: браузер ведущего = игровой сервер, сообщения идут через публичный MQTT-брокер (WebSocket).
// Объекты HostSocket / PlayerSocket повторяют интерфейс socket.io: on(ev, fn) и emit(ev, data, cb).
// Связь через бесплатный публичный MQTT-брокер по защищённому WebSocket (порт 443-подобный, проходит через любые сети).
const KX_NS = 'kaxoote/v2/';
const BROKERS = window.KX_BROKERS || [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
function mqttConnect(url, opts) {
  return new Promise((res, rej) => {
    const c = mqtt.connect(url, { connectTimeout: 6000, reconnectPeriod: 2000, keepalive: 20, clean: true, ...opts });
    const t = setTimeout(() => { c.end(true); rej(new Error('timeout')); }, 7000);
    c.once('connect', () => { clearTimeout(t); res(c); });
    c.once('error', () => {});
  });
}
async function firstBroker(opts) {
  for (const url of BROKERS) { try { return { client: await mqttConnect(url, opts), url }; } catch {} }
  throw new Error('nobroker');
}
const enc = (o) => JSON.stringify(o);
const dec = (b) => { try { return JSON.parse(b.toString()); } catch { return null; } };

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
      else scheduleAuto(game.autoSec * 1000);
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
    scheduleAuto(game.autoSec * 1000);
  }

  // Автопереход: ведущему не нужно нажимать «Дальше»
  function scheduleAuto(ms) {
    clearTimeout(game.autoT);
    if (!game.autoSec || !ms) { local('auto', { ms: 0 }); return; }
    game.autoT = setTimeout(next, ms);
    local('auto', { ms });
  }

  function leaderboard() {
    game.state = 'leaderboard';
    local('leaderboard', { top: ranking().slice(0, 5).map((p) => ({ name: p.name, avatar: p.avatar, score: p.score, rank: p.rank, prevRank: p.prevRank, streak: p.streak || 0 })),
      last: game.qIndex >= game.quiz.questions.length - 1 });
    scheduleAuto(Math.min(game.autoSec, 8) * 1000);
  }

  function podium() {
    game.state = 'end'; clearTimeout(game.timer); clearTimeout(game.autoT); local('auto', { ms: 0 });
    const ranked = ranking();
    local('podium', { all: ranked.map((p, i) => ({ name: p.name, avatar: p.avatar, score: p.score, rank: i + 1 })) });
    ranked.forEach((p, i) => send(p, 'p:final', { rank: i + 1, score: p.score, total: ranked.length }));
  }

  function next() {
    if (!game) return;
    clearTimeout(game.autoT); local('auto', { ms: 0 });
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
        p = { key, name, avatar: String(d.avatar || 'a0').slice(0, 8), score: 0, streak: 0, answer: null };
        game.players.set(key, p);
      }
      p.conn = conn; p.connected = true; conn._key = key;
      local('lobby', playersList());
      reply({ ok: true, key, name: p.name, title: game.quiz.title, score: p.score, state: game.state });
      if (game.state === 'question' && !p.answer) {
        const q = game.quiz.questions[game.qIndex];
        send(p, 'p:start', { index: game.qIndex, q: publicQuestion(q, true) });
      }
    } else if (msg.ev === 'player:react') {
      const p = game.players.get(conn._key); const e = String(d.e || '');
      if (!p || !REACTIONS.includes(e)) return;
      const now = Date.now(); if (now - (p.lastReact || 0) < 500) return; p.lastReact = now;
      local('react', { name: p.name, avatar: p.avatar, e });
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

  let mq = null; const conns = new Map(); let autoSecPref = 15;
  function connFor(cid) {
    let c = conns.get(cid);
    if (!c) {
      c = { cid, open: true, send: (m) => { if (mq && c.open) mq.publish(KX_NS + game.pin + '/dn/' + cid, enc(m), { qos: 1 }); } };
      conns.set(cid, c);
    }
    c.open = true; return c;
  }
  function gone(cid) {
    const c = conns.get(cid); if (!c) return; c.open = false;
    const p = c._key && game && game.players.get(c._key);
    if (p && p.conn === c) {
      p.connected = false;
      if (game.state === 'lobby') game.players.delete(c._key);
      local('lobby', playersList());
    }
  }

  async function create(quizId, cb) {
    const raw = await Store.get(quizId);
    const quiz = cleanQuiz(raw);
    if (!quiz || !quiz.questions.length) return cb({ error: 'Викторина пустая или не найдена' });
    if (mq) { try { mq.publish(KX_NS + game.pin + '/alive', '', { retain: true }); mq.end(true); } catch {} mq = null; }
    conns.clear();
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    const alive = KX_NS + pin + '/alive';
    try {
      const r = await firstBroker({ clientId: 'kxh_' + rid(), will: { topic: alive, payload: '', retain: true, qos: 1 } });
      mq = r.client;
    } catch { return cb({ error: 'Нет связи с сервером игры. Проверь интернет и обнови страницу.' }); }
    game = { pin, quiz, players: new Map(), state: 'lobby', qIndex: -1, locked: false, autoSec: autoSecPref };
    mq.on('message', (topic, payload) => {
      if (topic !== KX_NS + pin + '/up') return;
      const m = dec(payload); if (!m || !m.from) return;
      if (m.t === 'bye') return gone(m.from);
      if (m.t === 'ping') { connFor(m.from).send({ t: 'pong' }); return; }
      onPlayerMsg(connFor(m.from), m);
    });
    mq.on('connect', () => { // после переподключения
      mq.subscribe(KX_NS + pin + '/up', { qos: 1 });
      mq.publish(alive, enc({ t: Date.now() }), { retain: true, qos: 1 });
    });
    mq.subscribe(KX_NS + pin + '/up', { qos: 1 }, () => {
      mq.publish(alive, enc({ t: Date.now() }), { retain: true, qos: 1 }, () => cb({ pin, title: quiz.title, count: quiz.questions.length }));
    });
  }

  addEventListener('beforeunload', () => { if (game && mq) { sendAll('p:hostleft'); mq.publish(KX_NS + game.pin + '/alive', '', { retain: true }); } });

  return {
    on(ev, fn) { handlers[ev] = fn; },
    emit(ev, data, cb) {
      if (ev === 'host:create') return create(data.quizId, cb || (() => {}));
      if (ev === 'host:auto' && !game) { autoSecPref = Number(data) || 0; return; }
      if (!game) return;
      if (ev === 'host:next') next();
      else if (ev === 'host:end') podium();
      else if (ev === 'host:lock') game.locked = !!data;
      else if (ev === 'host:auto') { autoSecPref = game.autoSec = Number(data) || 0; if (!game.autoSec) scheduleAuto(0); }
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
  const cid = 'kxp_' + rid();
  let mq = null, pin = null, seq = 0, joining = null, everJoined = false;
  const fire = (ev, d) => { if (handlers[ev]) handlers[ev](d); };
  const up = () => KX_NS + pin + '/up';

  function onMsg(topic, payload) {
    const m = dec(payload); if (!m) return;
    if (m.t === 'ack' && pending[m.id]) { pending[m.id](m.res); delete pending[m.id]; }
    else if (m.t === 'ev') fire(m.ev, m.data);
  }

  // Ищем игру: на каком брокере есть отметка «ведущий онлайн»
  async function findGame(p) {
    for (const url of BROKERS) {
      let c;
      try { c = await mqttConnect(url, { clientId: cid, will: { topic: KX_NS + p + '/up', payload: enc({ t: 'bye', from: cid }), qos: 1 } }); } catch { continue; }
      const found = await new Promise((res) => {
        const t = setTimeout(() => res(false), 3500);
        c.on('message', (topic, payload) => { if (topic === KX_NS + p + '/alive') { clearTimeout(t); res(payload.length > 0); } });
        c.subscribe(KX_NS + p + '/alive', { qos: 1 });
      });
      if (found) {
        c.unsubscribe(KX_NS + p + '/alive');
        c.removeAllListeners('message');
        c.on('message', onMsg);
        c.on('connect', () => { c.subscribe(KX_NS + p + '/dn/' + cid, { qos: 1 }); if (everJoined) setTimeout(() => fire('connect'), 300); });
        await new Promise((res) => c.subscribe(KX_NS + p + '/dn/' + cid, { qos: 1 }, res));
        return c;
      }
      c.end(true);
    }
    return null;
  }

  function send(ev, data, cb) {
    const id = ++seq;
    if (cb) {
      pending[id] = cb;
      setTimeout(() => { if (pending[id]) { delete pending[id]; cb({ error: 'Ведущий не отвечает. Проверь, что игра открыта.' }); } }, 10000);
    }
    mq.publish(up(), enc({ t: 'emit', ev, id, data, from: cid }), { qos: 1 });
  }

  addEventListener('pagehide', () => { if (mq && pin) mq.publish(up(), enc({ t: 'bye', from: cid })); });

  return {
    on(ev, fn) { handlers[ev] = fn; },
    emit(ev, data, cb) {
      if (ev === 'player:join') {
        const p = String(data.pin);
        const ready = mq && pin === p ? Promise.resolve(mq) : (joining = (async () => {
          if (mq) { try { mq.end(true); } catch {} mq = null; }
          const c = await findGame(p); if (!c) throw new Error('nogame');
          mq = c; pin = p; return c;
        })());
        ready.then(() => send(ev, data, (res) => { if (res && res.ok) everJoined = true; cb && cb(res); }))
          .catch(() => cb && cb({ error: 'Игра с таким PIN не найдена. Проверь PIN — ведущий должен быть открыт на этом же сайте.' }));
      } else if (mq) send(ev, data, cb);
      else cb && cb({ error: 'Связь потеряна' });
    },
  };
}
