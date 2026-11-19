{
  const socket = io();
  let quizId = null, total = 0, curQ = null, tInt = null, musicWanted = true;

  // фон
  const bg = $('#bg');
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('span'); const z = 40 + Math.random() * 90;
    s.style.cssText = `left:${Math.random() * 100}%;width:${z}px;height:${z}px;animation-delay:${-Math.random() * 18}s;animation-duration:${14 + Math.random() * 12}s`;
    s.innerHTML = SHAPES[i % 4]; bg.appendChild(s);
  }

  function show(id) { document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === id)); }

  // управление звуком
  const muteBtn = $('#mute');
  const syncMute = () => { muteBtn.textContent = FX.isMuted() ? '🔇' : '🔊'; };
  syncMute();
  muteBtn.onclick = () => { FX.setMuted(!FX.isMuted()); syncMute(); };
  $('#music').onclick = () => { musicWanted = !musicWanted; if (!musicWanted) FX.stopMusic(); else if ($('#sLobby').classList.contains('on')) FX.startMusic('lobby'); $('#music').style.opacity = musicWanted ? 1 : 0.4; };
  $('#full').onclick = () => { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch {} };

  // ----- выбор викторины -----
  fetch('/api/quizzes').then((r) => r.json()).then((list) => {
    const el = $('#qlist');
    if (!list.length) { el.innerHTML = '<div class="card">Пока нет викторин. Создай первую в редакторе.</div>'; return; }
    el.innerHTML = list.map((q) => `
      <div class="qcard">
        <div class="cov" style="${q.cover ? `background-image:url('${esc(q.cover)}')` : ''}"></div>
        <div class="bd"><h3>${esc(q.title)}</h3><p>${esc(q.description)}</p>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><small>${q.count} вопросов</small>
        <button class="btn primary" data-id="${esc(q.id)}">Играть</button></div></div>
      </div>`).join('');
    el.querySelectorAll('button[data-id]').forEach((b) => b.onclick = () => create(b.dataset.id));
  });

  function create(id) {
    quizId = id; FX.unlock();
    socket.emit('host:create', { quizId: id }, (res) => {
      if (res.error) return alertBox(res.error);
      total = res.count;
      $('#pin').textContent = res.pin.replace(/(\d{3})(\d{3})/, '$1 $2');
      $('#lobbyTitle').textContent = res.title;
      $('#players').innerHTML = ''; $('#pcount').textContent = '0 игроков';
      $('#lockBtn').textContent = 'Закрыть вход'; locked = false;
      show('sLobby');
      if (musicWanted) FX.startMusic('lobby');
      fetch('/api/info?pin=' + res.pin).then((r) => r.json()).then((info) => {
        $('#joinUrl').textContent = info.base.replace(/^http:\/\//, '');
        if (info.qr) $('#qr').src = info.qr;
      });
    });
  }
  function alertBox(msg) { const d = document.createElement('div'); d.className = 'card'; d.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99'; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 3500); }

  let locked = false, lastCount = 0;
  $('#lockBtn').onclick = () => { locked = !locked; socket.emit('host:lock', locked); $('#lockBtn').textContent = locked ? 'Открыть вход' : 'Закрыть вход'; };

  socket.on('lobby', (players) => {
    const el = $('#players');
    el.innerHTML = players.map((p) => `<div class="pl" title="Нажми, чтобы убрать игрока" data-n="${esc(p.name)}" style="${p.connected ? '' : 'opacity:.4'}">${esc(p.avatar)} ${esc(p.name)}</div>`).join('');
    el.querySelectorAll('.pl').forEach((d) => d.onclick = () => socket.emit('host:kick', d.dataset.n));
    $('#pcount').textContent = players.length + ' ' + plural(players.length, 'игрок', 'игрока', 'игроков');
    $('#waiting').style.display = players.length ? 'none' : '';
    if (players.length > lastCount) FX.pop();
    lastCount = players.length;
  });
  function plural(n, a, b, c) { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; }

  const next = () => socket.emit('host:next');
  $('#startBtn').onclick = () => { FX.stopMusic(); FX.go(); next(); };
  $('#skipBtn').onclick = next;
  $('#lbNext').onclick = next;
  $('#again').onclick = () => create(quizId);
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea')) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
      if ($('#sPick').classList.contains('on') || $('#sPod').classList.contains('on') || $('#sIntro').classList.contains('on')) return;
      e.preventDefault(); if ($('#sLobby').classList.contains('on')) $('#startBtn').click(); else next();
    }
  });

  // ----- вступление -----
  socket.on('q:intro', (d) => {
    clearInterval(tInt); FX.stopMusic();
    $('#iNum').textContent = `Вопрос ${d.index + 1} из ${d.total}`;
    $('#iText').textContent = d.text;
    $('#iType').textContent = TYPE_NAMES[d.type] || '';
    const bar = $('#iBar'); bar.classList.remove('run'); void bar.offsetWidth; bar.classList.add('run');
    show('sIntro'); FX.whoosh();
    if (d.type !== 'slide') [0, 1, 2].forEach((i) => setTimeout(() => FX.count(), 1000 + i * 1000));
  });

  // ----- вопрос -----
  socket.on('q:start', (d) => {
    curQ = d.q;
    const q = d.q;
    const sec = $('#sQ'); sec.classList.remove('reveal');
    $('#qNum').textContent = `${d.index + 1} / ${d.total}`;
    $('#qType').textContent = (TYPE_NAMES[q.type] || '') + (q.points === 'double' ? ' · ×2 очка' : q.points === 'none' ? ' · без очков' : '');
    $('#qText').textContent = q.text;
    $('#aCount').textContent = '0';
    $('#explainBox').innerHTML = ''; $('#statsLine').textContent = '';
    $('#skipBtn').textContent = q.type === 'slide' ? 'Дальше ▶' : 'Пропустить ⏭';
    const isSlide = q.type === 'slide';
    $('#timer').style.visibility = isSlide ? 'hidden' : '';
    $('#counter').style.visibility = isSlide ? 'hidden' : '';
    document.querySelector('.qmid').classList.toggle('slide', isSlide && !q.image);

    // картинка / подсказка
    let media = q.image ? `<img src="${esc(q.image)}" alt="">` : '';
    if (!media) {
      const hints = { type: 'Напиши ответ на телефоне', slider: 'Выбери число на телефоне', order: 'Расставь по порядку на телефоне', poll: 'Голосуй на телефоне' };
      media = hints[q.type] ? `<div class="hint">${hints[q.type]}</div>` : '';
    }
    $('#media').innerHTML = media;

    renderAnswers(q, null, null);
    show('sQ');
    if (isSlide) return;
    if (musicWanted) FX.startMusic('think');
    // таймер
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

  socket.on('answers', ({ answered }) => { $('#aCount').textContent = answered; FX.tick(); });

  function renderAnswers(q, correct, stats) {
    const area = $('#answerArea');
    if (q.type === 'quiz' || q.type === 'truefalse' || q.type === 'poll') {
      const opts = q.options;
      const tf = q.type === 'truefalse';
      const totalVotes = stats ? Math.max(1, stats.counts.reduce((a, b) => a + b, 0)) : 1;
      area.innerHTML = `<div class="opts" style="${opts.length > 4 ? 'grid-template-columns:repeat(3,minmax(0,1fr))' : ''}">${opts.map((o, i) => {
        const ci = tf ? (i === 0 ? 1 : 0) : i; // правда синяя, миф красная
        let cls = '';
        if (stats && correct && q.type !== 'poll') cls = (correct.correct || []).includes(i) ? 'yes' : 'no';
        const cnt = stats ? stats.counts[i] : 0;
        return `<div class="opt a${ci} ${cls}"><span class="shape">${SHAPES[tf ? (i === 0 ? 1 : 0) : i]}</span><span class="txt">${esc(o)}</span><span class="cnt">${cls === 'yes' ? '✔ ' : ''}${cnt}</span><span class="bar" data-w="${(cnt / totalVotes) * 100}"></span></div>`;
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
        inner += `<div class="mark" style="left:${pos(correct.answer)}%"></div><div class="ans" style="left:${pos(correct.answer)}%">${esc(correct.answer)} ${esc(q.unit)}</div>`;
      }
      area.innerHTML = `<div class="sliderview"><div class="scale">${inner}</div><div class="scaleLbl"><span>${esc(q.min)}</span><span>${stats && stats.avg != null ? 'Среднее: ' + stats.avg : ''}</span><span>${esc(q.max)}</span></div></div>`;
    } else if (q.type === 'type') {
      if (!correct) { area.innerHTML = ''; return; }
      const acc = (correct.accept || []).map((a) => a.toLowerCase());
      area.innerHTML = `<div style="text-align:center;font-size:30px;font-weight:900;margin-bottom:12px">Правильно: <span style="background:#26890c;padding:4px 14px;border-radius:10px">${esc((correct.accept || [])[0] || '')}</span></div>
        <div class="typed">${(stats.top || []).map(([t, n]) => `<span class="${acc.includes(t.toLowerCase().replace(/ё/g, 'е')) || acc.includes(t.toLowerCase()) ? 'ok' : ''}">${esc(t)} · ${n}</span>`).join('')}</div>`;
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
    if (d.correct.explain) $('#explainBox').innerHTML = `<div class="explain"><b>А вы знали?</b><span>${esc(d.correct.explain)}</span></div>`;
    const s = d.stats;
    $('#statsLine').textContent = d.q.type === 'poll' ? `Проголосовали: ${s.answered} из ${s.total}` : `Ответили: ${s.answered} из ${s.total} · Правильно: ${s.correctCount}`;
    $('#skipBtn').textContent = 'Дальше ▶';
  });

  // ----- лидеры -----
  socket.on('leaderboard', (d) => {
    FX.whoosh();
    $('#lb').innerHTML = d.top.length ? d.top.map((p, i) => {
      const up = p.prevRank && p.prevRank > p.rank ? `<span class="up">▲ ${p.prevRank - p.rank}</span>` : '';
      const fl = p.streak >= 3 ? `<span class="fl">серия ${p.streak}</span>` : '';
      return `<div class="lbrow" style="animation-delay:${i * 0.12}s"><span class="rk">${i + 1}</span><span>${esc(p.avatar)}</span><span class="nm">${esc(p.name)} ${up} ${fl}</span><span>${p.score}</span></div>`;
    }).join('') : '<div class="card">Пока нет игроков</div>';
    $('#lbNext').textContent = d.last ? 'К победителям 🏆' : 'Следующий вопрос ▶';
    show('sLB');
  });

  // ----- подиум -----
  socket.on('podium', (d) => {
    clearInterval(tInt); FX.stopMusic();
    show('sPod');
    const cols = { 1: $('#c1'), 2: $('#c2'), 3: $('#c3') };
    Object.values(cols).forEach((c) => { c.classList.remove('show'); c.innerHTML = ''; });
    $('#rest').innerHTML = d.all.slice(3).map((p) => `<span>${p.rank}. ${esc(p.name)} — ${p.score}</span>`).join('');
    const place = (n, delay) => setTimeout(() => {
      const p = d.all[n - 1]; const c = cols[n]; if (!p) return;
      c.innerHTML = `<div class="av">${esc(p.avatar)}</div><div class="who">${esc(p.name)}</div><div class="blk"><span class="pl1">${n}</span><span>${p.score}</span></div>`;
      c.classList.add('show');
      if (n === 1) { FX.fanfare(); FX.confetti(260); setTimeout(() => FX.confetti(160, { burst: true, x: 0.5, y: 0.6 }), 600); }
      else FX.pop();
    }, delay);
    FX.drumroll(3);
    place(3, 1000); place(2, 2200); place(1, 3400);
  });
}
