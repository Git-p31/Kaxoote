{
  const socket = HostSocket();
  let quizId = null, curQ = null, tInt = null, musicWanted = true, pin = '';
  applyIcons();

  // фон
  const bg = $('#bg');
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('span'); const z = 40 + Math.random() * 90;
    s.style.cssText = `left:${Math.random() * 100}%;width:${z}px;height:${z}px;animation-delay:${-Math.random() * 18}s;animation-duration:${14 + Math.random() * 12}s`;
    s.innerHTML = SHAPES[i % 4]; bg.appendChild(s);
  }

  const show = (id) => document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
  const isOn = (id) => $('#' + id).classList.contains('on');
  const avw = (a) => `<span class="avw">${avatarSVG(a)}</span>`;
  const setBtn = (el, icon, text) => { el.innerHTML = ic(icon) + `<span>${text}</span>`; };

  // ----- звук / музыка / экран -----
  const syncCtrl = () => {
    $('#mute').innerHTML = ic(FX.isMuted() ? 'mute' : 'sound');
    $('#music').innerHTML = ic('music'); $('#music').classList.toggle('off', !musicWanted);
    $('#full').innerHTML = ic('full');
  };
  syncCtrl();
  $('#mute').onclick = () => { FX.setMuted(!FX.isMuted()); syncCtrl(); };
  $('#music').onclick = () => { musicWanted = !musicWanted; if (!musicWanted) FX.stopMusic(); else if (isOn('sLobby')) FX.startMusic('lobby'); syncCtrl(); };
  $('#full').onclick = () => { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch {} };

  // ----- выбор викторины -----
  Store.list().then((list) => {
    const el = $('#qlist');
    if (!list.length) { el.innerHTML = '<div class="card">Пока нет викторин. Создай первую в редакторе.</div>'; return; }
    el.innerHTML = list.map((q) => `
      <div class="qcard">
        <div class="cov" style="${q.cover ? `background-image:url('${esc(q.cover)}')` : ''}"><span class="tag">${ic('list')}${q.count} вопросов</span></div>
        <div class="bd"><h3>${esc(q.title)}</h3><p>${esc(q.description)}</p>
        <div style="display:flex;justify-content:flex-end"><button class="btn primary ib" data-id="${esc(q.id)}">${ic('play')}Играть</button></div></div>
      </div>`).join('');
    el.querySelectorAll('button[data-id]').forEach((b) => b.onclick = () => create(b.dataset.id));
  });

  let autoSec = 15;
  try { const v = localStorage.getItem('kx-auto'); if (v !== null) autoSec = +v; } catch {}
  $('#autoSel').value = String(autoSec);
  socket.emit('host:auto', autoSec);
  $('#autoSel').onchange = (e) => { autoSec = +e.target.value; socket.emit('host:auto', autoSec); try { localStorage.setItem('kx-auto', autoSec); } catch {} };

  function create(id) {
    quizId = id; FX.unlock();
    socket.emit('host:create', { quizId: id }, (res) => {
      if (res.error) return alertBox(res.error);
      pin = res.pin;
      socket.emit('host:auto', autoSec);
      $('#pin').textContent = res.pin.replace(/(\d{3})(\d{3})/, '$1 $2');
      $('#lobbyTitle').textContent = res.title;
      $('#players').innerHTML = ''; setCount(0); lastCount = 0;
      locked = false; syncLock();
      show('sLobby');
      if (musicWanted) FX.startMusic('lobby');
      const base = new URL('play.html', location.href).href;
      $('#joinUrl').textContent = base.replace(/^https?:\/\//, '');
      try { const qr = qrcode(0, 'M'); qr.addData(base + '?pin=' + res.pin); qr.make(); $('#qr').src = qr.createDataURL(6, 2); } catch {}
    });
  }
  function alertBox(msg) { const d = document.createElement('div'); d.className = 'card'; d.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99'; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 3500); }

  let locked = false, lastCount = 0;
  const syncLock = () => setBtn($('#lockBtn'), locked ? 'lock' : 'unlock', locked ? 'Открыть вход' : 'Закрыть вход');
  $('#lockBtn').onclick = () => { locked = !locked; socket.emit('host:lock', locked); syncLock(); };
  $('#botsBtn').onclick = () => { if (pin) { Bots.spawn(pin, 4); FX.pop(); } };

  function plural(n, a, b, c) { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; }
  const setCount = (n) => { $('#pcount').innerHTML = ic('users') + n + ' ' + plural(n, 'игрок', 'игрока', 'игроков'); };

  socket.on('lobby', (players) => {
    const el = $('#players');
    el.innerHTML = players.map((p) => `<div class="pl ${p.name.startsWith('Бот ') ? 'bot' : ''}" title="Нажми, чтобы убрать игрока" data-n="${esc(p.name)}" style="${p.connected ? '' : 'opacity:.4'}">${avw(p.avatar)}${esc(p.name)}</div>`).join('');
    el.querySelectorAll('.pl').forEach((d) => d.onclick = () => socket.emit('host:kick', d.dataset.n));
    setCount(players.length);
    $('#waiting').style.display = players.length ? 'none' : '';
    if (players.length > lastCount && isOn('sLobby')) FX.pop();
    lastCount = players.length;
  });

  const next = () => socket.emit('host:next');
  $('#startBtn').onclick = () => { FX.stopMusic(); FX.go(); next(); };
  $('#skipBtn').onclick = next;
  $('#lbNext').onclick = next;
  $('#again').onclick = () => create(quizId);
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea,select')) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
      if (isOn('sPick') || isOn('sPod') || isOn('sIntro')) return;
      e.preventDefault(); if (isOn('sLobby')) $('#startBtn').click(); else next();
    }
  });

  // ----- автопереход: полоса на кнопке «Дальше» -----
  socket.on('auto', ({ ms }) => {
    document.querySelectorAll('.autobar').forEach((b) => b.remove());
    document.querySelectorAll('.autoing').forEach((b) => b.classList.remove('autoing'));
    if (!ms) return;
    const btn = isOn('sLB') ? $('#lbNext') : $('#skipBtn');
    btn.classList.add('autoing');
    const bar = document.createElement('i'); bar.className = 'autobar';
    bar.style.animation = `autofill ${ms}ms linear forwards`;
    btn.appendChild(bar);
  });

  // ----- эмоции игроков -----
  let rxCount = 0;
  socket.on('react', ({ name, avatar, e }) => {
    const box = $('#reacts');
    if (box.childElementCount > 40) return;
    const d = document.createElement('div'); d.className = 'rx';
    d.style.left = (6 + Math.random() * 86) + '%';
    d.style.animationDuration = (2.8 + Math.random() * 1.4) + 's';
    d.innerHTML = `<span class="e">${esc(e)}</span><span class="n">${avw(avatar)}${esc(name)}</span>`;
    box.appendChild(d);
    d.addEventListener('animationend', (ev) => { if (ev.target === d) d.remove(); });
    setTimeout(() => d.remove(), 5000);
    rxCount++; $('#rxbar').style.display = ''; $('#rxbar').innerHTML = ic('smile') + rxCount;
    if (!isOn('sQ') || $('#sQ').classList.contains('reveal')) FX.tick();
  });

  // ----- вступление -----
  socket.on('q:intro', (d) => {
    clearInterval(tInt); FX.stopMusic();
    $('#iIcon').innerHTML = ic(TYPE_ICONS[d.type] || 'grid');
    $('#iNum').innerHTML = ic('list') + `Вопрос ${d.index + 1} из ${d.total}`;
    $('#iText').textContent = d.text;
    $('#iType').innerHTML = ic(TYPE_ICONS[d.type] || 'grid') + (TYPE_NAMES[d.type] || '');
    const bar = $('#iBar'); bar.classList.remove('run'); void bar.offsetWidth; bar.classList.add('run');
    show('sIntro'); FX.whoosh();
    if (d.type !== 'slide') [0, 1, 2].forEach((i) => setTimeout(() => FX.count(), 1000 + i * 1000));
  });

  // ----- вопрос -----
  socket.on('q:start', (d) => {
    curQ = d.q;
    const q = d.q;
    const sec = $('#sQ'); sec.classList.remove('reveal');
    $('#qNum').innerHTML = ic('list') + `${d.index + 1} / ${d.total}`;
    $('#qType').innerHTML = ic(TYPE_ICONS[q.type] || 'grid') + (TYPE_NAMES[q.type] || '') + (q.points === 'double' ? ' · ×2' : q.points === 'none' ? ' · без очков' : '');
    $('#qText').textContent = q.text;
    $('#aCount').textContent = '0';
    $('#explainBox').innerHTML = ''; $('#statsLine').innerHTML = '';
    const isSlide = q.type === 'slide';
    setBtn($('#skipBtn'), isSlide ? 'next' : 'skip', isSlide ? 'Дальше' : 'Пропустить');
    $('#timer').style.visibility = isSlide ? 'hidden' : '';
    $('#counter').style.visibility = isSlide ? 'hidden' : '';
    document.querySelector('.qmid').classList.toggle('slide', isSlide && !q.image);

    let media = q.image ? `<img src="${esc(q.image)}" alt="">` : '';
    if (!media) {
      const hints = { type: ['keyboard', 'Напиши ответ на телефоне'], slider: ['sliders', 'Выбери число на телефоне'], order: ['listol', 'Расставь по порядку на телефоне'], poll: ['poll', 'Голосуй на телефоне'] };
      media = hints[q.type] ? `<div class="hint">${ic(hints[q.type][0])}${hints[q.type][1]}</div>` : '';
    }
    $('#media').innerHTML = media;
    renderAnswers(q, null, null);
    show('sQ');
    if (isSlide) return;
    if (musicWanted) FX.startMusic('think');
    const end = Date.now() + q.time * 1000; const arc = $('#tArc'); const C = 327;
    clearInterval(tInt);
    let lastS = -1;
    const tick = () => {
      const left = Math.max(0, end - Date.now()); const s = Math.ceil(left / 1000);
      $('#tNum').textContent = s;
      arc.style.strokeDashoffset = C * (1 - left / (q.time * 1000));
      $('#timer').classList.toggle('urgent', s <= 5);
      if (s !== lastS && s <= 5 && s > 0) FX.tickUrgent();
      lastS = s;
      if (left <= 0) clearInterval(tInt);
    };
    tick(); tInt = setInterval(tick, 100);
  });

  socket.on('answers', ({ answered }) => {
    const b = $('#aCount'); b.textContent = answered;
    b.classList.add('bump'); setTimeout(() => b.classList.remove('bump'), 180); FX.tick();
  });

  function renderAnswers(q, correct, stats) {
    const area = $('#answerArea');
    if (q.type === 'quiz' || q.type === 'truefalse' || q.type === 'poll') {
      const opts = q.options, tf = q.type === 'truefalse';
      const totalVotes = stats ? Math.max(1, stats.counts.reduce((a, b) => a + b, 0)) : 1;
      area.innerHTML = `<div class="opts" style="${opts.length > 4 ? 'grid-template-columns:repeat(3,minmax(0,1fr))' : ''}">${opts.map((o, i) => {
        const ci = tf ? (i === 0 ? 1 : 0) : i;
        let cls = '';
        if (stats && correct && q.type !== 'poll') cls = (correct.correct || []).includes(i) ? 'yes' : 'no';
        const cnt = stats ? stats.counts[i] : 0;
        return `<div class="opt a${ci} ${cls}"><span class="shape">${SHAPES[ci === 1 && tf ? 1 : tf ? 0 : i]}</span><span class="txt">${esc(o)}</span><span class="cnt">${cls === 'yes' ? ic('check') : cls === 'no' ? ic('cross') : ic('users')}${cnt}</span><span class="bar" data-w="${(cnt / totalVotes) * 100}"></span></div>`;
      }).join('')}</div>`;
      if (stats) requestAnimationFrame(() => area.querySelectorAll('.bar').forEach((b) => b.style.width = b.dataset.w + '%'));
    } else if (q.type === 'order') {
      const items = correct ? correct.items.map((t) => ({ text: t })) : q.items;
      area.innerHTML = `<div class="orderlist">${items.map((it, i) => `<div class="${correct ? 'a3' : ''}" style="${correct ? `animation:slidein .4s ${i * 0.12}s both` : ''}"><b>${correct ? i + 1 : '•'}</b>${esc(it.text)}</div>`).join('')}</div>`;
    } else if (q.type === 'slider') {
      const span = (q.max - q.min) || 1, pos = (v) => ((v - q.min) / span) * 100;
      let inner = '';
      if (correct) {
        const tol = Number(correct.tolerance || 0);
        inner += `<div class="tol" style="left:${pos(correct.answer - tol)}%;width:${(2 * tol / span) * 100}%"></div>`;
        (stats.values || []).forEach((v) => inner += `<div class="dot" style="left:${pos(v)}%"></div>`);
        inner += `<div class="mark" style="left:${pos(correct.answer)}%"></div><div class="ans" style="left:${pos(correct.answer)}%">${ic('check')}${esc(correct.answer)} ${esc(q.unit)}</div>`;
      }
      area.innerHTML = `<div class="sliderview"><div class="scale">${inner}</div><div class="scaleLbl"><span>${esc(q.min)}</span><span>${stats && stats.avg != null ? 'Среднее: ' + stats.avg : ''}</span><span>${esc(q.max)}</span></div></div>`;
    } else if (q.type === 'type') {
      if (!correct) { area.innerHTML = ''; return; }
      const nrm = (t) => t.toLowerCase().replace(/ё/g, 'е').trim();
      const acc = (correct.accept || []).map(nrm);
      area.innerHTML = `<div style="text-align:center;font-size:30px;font-weight:900;margin-bottom:12px" class="ib">${ic('check')}Правильно: <span style="background:#26890c;padding:4px 14px;border-radius:10px">${esc((correct.accept || [])[0] || '')}</span></div>
        <div class="typed">${(stats.top || []).map(([t, n]) => { const ok = acc.includes(nrm(t)); return `<span class="${ok ? 'ok' : ''}">${ic(ok ? 'check' : 'cross')}${esc(t)} · ${n}</span>`; }).join('')}</div>`;
    } else if (q.type === 'slide') {
      area.innerHTML = q.body ? `<div class="slidebody">${esc(q.body)}</div>` : '';
    }
  }

  // ----- показ ответа -----
  socket.on('q:reveal', (d) => {
    clearInterval(tInt); FX.stopMusic(); FX.gong();
    $('#sQ').classList.add('reveal');
    $('#tNum').textContent = '0';
    renderAnswers(d.q, d.correct, d.stats);
    if (d.correct.explain) $('#explainBox').innerHTML = `<div class="explain">${ic('info')}<div><b>А вы знали? </b>${esc(d.correct.explain)}</div></div>`;
    const s = d.stats;
    $('#statsLine').innerHTML = d.q.type === 'poll'
      ? `<span>${ic('poll')}Проголосовали: ${s.answered} из ${s.total}</span>`
      : `<span>${ic('users')}Ответили: ${s.answered} из ${s.total}</span><span>${ic('check')}Правильно: ${s.correctCount}</span>`;
    setBtn($('#skipBtn'), 'next', 'Дальше');
  });

  // ----- лидеры -----
  socket.on('leaderboard', (d) => {
    FX.whoosh();
    $('#lb').innerHTML = d.top.length ? d.top.map((p, i) => {
      const up = p.prevRank && p.prevRank > p.rank ? `<span class="up">${ic('up')}${p.prevRank - p.rank}</span>` : '';
      const fl = p.streak >= 2 ? `<span class="fl">${ic('flame')}${p.streak}</span>` : '';
      return `<div class="lbrow" style="animation-delay:${i * 0.12}s"><span class="rk">${i === 0 ? ic('trophy') : i + 1}</span>${avw(p.avatar)}<span class="nm">${esc(p.name)} ${up} ${fl}</span><span class="sc">${ic('star')}${p.score}</span></div>`;
    }).join('') : '<div class="card">Пока нет игроков</div>';
    setBtn($('#lbNext'), d.last ? 'trophy' : 'next', d.last ? 'К победителям' : 'Следующий вопрос');
    show('sLB');
  });

  // ----- подиум -----
  socket.on('podium', (d) => {
    clearInterval(tInt); FX.stopMusic();
    show('sPod');
    const cols = { 1: $('#c1'), 2: $('#c2'), 3: $('#c3') };
    Object.values(cols).forEach((c) => { c.classList.remove('show'); c.innerHTML = ''; });
    $('#rest').innerHTML = d.all.slice(3).map((p) => `<span>${avw(p.avatar)}${p.rank}. ${esc(p.name)} · ${p.score}</span>`).join('');
    const place = (n, delay) => setTimeout(() => {
      const p = d.all[n - 1]; const c = cols[n]; if (!p) return;
      c.innerHTML = `${avw(p.avatar)}<div class="who">${esc(p.name)}</div><div class="blk">${n === 1 ? ic('trophy') : ic('medal')}<span class="pl1">${n}</span><span class="ib">${ic('star')}${p.score}</span></div>`;
      c.classList.add('show');
      if (n === 1) { FX.fanfare(); FX.confetti(260); setTimeout(() => FX.confetti(160, { burst: true, x: 0.5, y: 0.6 }), 600); }
      else FX.pop();
    }, delay);
    FX.drumroll(3);
    place(3, 1000); place(2, 2200); place(1, 3400);
  });
}
