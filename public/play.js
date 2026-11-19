{
  const socket = io();
  let pin = '', me = { name: '', avatar: AVATARS[(Math.random() * AVATARS.length) | 0], score: 0 };
  let timeInt = null, answered = false, curType = '';

  const bg = $('#bg');
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('span'); const z = 30 + Math.random() * 60;
    s.style.cssText = `left:${Math.random() * 100}%;width:${z}px;height:${z}px;animation-delay:${-Math.random() * 18}s`;
    s.innerHTML = SHAPES[i % 4]; bg.appendChild(s);
  }
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
    $('#footer').style.display = ['sPin', 'sName', 'sEnd'].includes(id) ? 'none' : 'flex';
  }
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

  // PIN из ссылки / QR
  const urlPin = new URLSearchParams(location.search).get('pin');
  if (urlPin) $('#pinIn').value = urlPin;

  $('#pinForm').onsubmit = (e) => {
    e.preventDefault(); FX.unlock();
    pin = $('#pinIn').value.replace(/\D/g, '');
    if (pin.length !== 6) { $('#pinErr').textContent = 'PIN — 6 цифр'; return; }
    // попытка переподключения
    const saved = store.get('kx-' + pin);
    if (saved) {
      const s = JSON.parse(saved);
      return join(s.name, s.avatar, s.key, true);
    }
    $('#pinErr').textContent = '';
    show('sName'); setTimeout(() => $('#nameIn').focus(), 100);
  };

  const av = $('#avatars');
  av.innerHTML = AVATARS.map((a) => `<button type="button" class="${a === me.avatar ? 'sel' : ''}">${a}</button>`).join('');
  av.querySelectorAll('button').forEach((b) => b.onclick = () => { me.avatar = b.textContent; av.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b)); FX.pop(); });
  const savedName = store.get('kx-name'); if (savedName) $('#nameIn').value = savedName;

  $('#nameForm').onsubmit = (e) => { e.preventDefault(); join($('#nameIn').value, me.avatar, null, false); };

  function join(name, avatar, key, silent) {
    socket.emit('player:join', { pin, name, avatar, key }, (res) => {
      if (res.error) {
        if (silent) { store.set('kx-' + pin, ''); show('sName'); return; }
        const err = silent ? $('#pinErr') : ($('#sName').classList.contains('on') ? $('#nameErr') : $('#pinErr'));
        err.textContent = res.error; FX.wrong(); FX.vibrate(200);
        if (res.error.includes('PIN')) show('sPin');
        return;
      }
      me.name = res.name; me.avatar = avatar; me.score = res.score || 0;
      store.set('kx-' + pin, JSON.stringify({ name: res.name, avatar, key: res.key }));
      store.set('kx-name', res.name);
      $('#fName').textContent = avatar + ' ' + res.name; $('#fScore').textContent = me.score;
      $('#waitTitle').textContent = res.title;
      FX.correct(); FX.vibrate(60);
      if (res.state === 'lobby') show('sWait'); else if (!$('#sAns').classList.contains('on')) show('sSent');
    });
  }
  socket.on('connect', () => {
    // переподключение после обрыва сети
    const saved = pin && store.get('kx-' + pin);
    if (saved && me.name) { const s = JSON.parse(saved); join(s.name, s.avatar, s.key, true); }
  });

  socket.on('p:intro', (d) => {
    $('#iNum').textContent = `Вопрос ${d.index + 1} из ${d.total}`;
    $('#iType').textContent = TYPE_NAMES[d.type] || '';
    if (d.type !== 'slide') show('sIntro');
    FX.vibrate(40);
  });

  socket.on('p:start', ({ index, q }) => {
    answered = false; curType = q.type;
    if (q.type === 'slide') { show('sWait'); $('#waitTitle').textContent = 'Смотри на экран'; return; }
    $('#aNum').textContent = `Вопрос ${index + 1}`;
    $('#aText').textContent = q.text;
    const end = Date.now() + q.time * 1000;
    clearInterval(timeInt);
    const tick = () => { const s = Math.max(0, Math.ceil((end - Date.now()) / 1000)); $('#aTime').textContent = s + ' с'; if (!s) clearInterval(timeInt); };
    tick(); timeInt = setInterval(tick, 250);
    renderInput(q);
    show('sAns');
  });

  function send(value) {
    if (answered) return; answered = true;
    clearInterval(timeInt);
    FX.send(); FX.vibrate(30);
    socket.emit('player:answer', { value }, (r) => {
      if (r && r.late) $('#sentLine').textContent = 'Время вышло…';
    });
    $('#sentLine').textContent = ['Ты быстрый!', 'Ждём остальных…', 'Интересно, угадал ли ты?', 'Держим кулачки!'][(Math.random() * 4) | 0];
    show('sSent');
  }

  function renderInput(q) {
    const body = $('#aBody');
    if (q.type === 'quiz' || q.type === 'truefalse' || q.type === 'poll') {
      const tf = q.type === 'truefalse';
      const multi = q.multi;
      const sel = new Set();
      body.innerHTML = `<div class="grid ${q.options.length <= 2 && !tf ? 'one' : ''}">${q.options.map((o, i) => {
        const ci = tf ? (i === 0 ? 1 : 0) : i;
        return `<button class="ans a${ci}" data-i="${i}"><span class="shape">${SHAPES[tf ? (i === 0 ? 1 : 0) : i]}</span><span>${esc(o)}</span></button>`;
      }).join('')}</div>${multi ? '<div style="text-align:center;font-weight:800;margin-top:8px">Можно выбрать несколько</div><button class="btn primary submit" id="mSend">Ответить</button>' : ''}`;
      body.querySelectorAll('.ans').forEach((b) => b.onclick = () => {
        const i = Number(b.dataset.i);
        if (!multi) return send(i);
        sel.has(i) ? sel.delete(i) : sel.add(i);
        b.classList.toggle('sel'); FX.tick();
      });
      if (multi) $('#mSend').onclick = () => { if (sel.size) send([...sel]); };
    } else if (q.type === 'type') {
      body.innerHTML = `<form id="tf" style="display:grid;gap:12px;margin-top:20px"><input class="typein" id="tIn" maxlength="40" autocomplete="off" placeholder="Твой ответ"><button class="btn primary submit">Ответить</button></form>`;
      setTimeout(() => $('#tIn').focus(), 100);
      $('#tf').onsubmit = (e) => { e.preventDefault(); const v = $('#tIn').value.trim(); if (v) send(v); };
    } else if (q.type === 'slider') {
      const mid = Math.round(((q.min + q.max) / 2) / q.step) * q.step;
      body.innerHTML = `<div class="slval" id="sv">${mid}</div><div style="text-align:center;font-weight:800">${esc(q.unit)}</div>
        <input type="range" class="sl" id="sl" min="${q.min}" max="${q.max}" step="${q.step}" value="${mid}">
        <div style="display:flex;justify-content:space-between;font-weight:800"><span>${q.min}</span><span>${q.max}</span></div>
        <div style="display:flex;gap:10px;margin-top:14px"><button class="btn ghost" id="minus" style="flex:1">−</button><button class="btn ghost" id="plus" style="flex:1">+</button></div>
        <button class="btn primary submit" id="sSend">Ответить</button>`;
      const sl = $('#sl'), sv = $('#sv');
      const upd = () => { sv.textContent = sl.value; };
      sl.oninput = () => { upd(); };
      $('#minus').onclick = () => { sl.stepDown(); upd(); FX.tick(); };
      $('#plus').onclick = () => { sl.stepUp(); upd(); FX.tick(); };
      $('#sSend').onclick = () => send(Number(sl.value));
    } else if (q.type === 'order') {
      let items = q.items.slice();
      const draw = () => {
        body.innerHTML = `<div style="font-weight:800;text-align:center;margin-bottom:8px">Сверху — первое</div><div class="ord">${items.map((it, i) => `
          <div class="it"><span class="n">${i + 1}</span><span class="t">${esc(it.text)}</span>
          <button data-u="${i}" ${i === 0 ? 'disabled style="opacity:.3"' : ''} aria-label="Вверх">▲</button><button data-d="${i}" ${i === items.length - 1 ? 'disabled style="opacity:.3"' : ''} aria-label="Вниз">▼</button></div>`).join('')}</div>
          <button class="btn primary submit" id="oSend">Ответить</button>`;
        body.querySelectorAll('[data-u]').forEach((b) => b.onclick = () => { const i = +b.dataset.u; [items[i - 1], items[i]] = [items[i], items[i - 1]]; FX.tick(); draw(); });
        body.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { const i = +b.dataset.d; [items[i + 1], items[i]] = [items[i], items[i + 1]]; FX.tick(); draw(); });
        $('#oSend').onclick = () => send(items.map((x) => x.id));
      };
      draw();
    }
  }

  socket.on('p:result', (r) => {
    clearInterval(timeInt);
    me.score = r.score; $('#fScore').textContent = r.score;
    const box = $('#resBox');
    if (r.type === 'poll') {
      box.className = 'result neutral';
      box.innerHTML = `<div class="icon">✓</div><p class="big">Голос учтён</p><div class="rankline">Ты на ${r.rank} месте</div>`;
      show('sRes'); FX.pop(); return;
    }
    box.className = 'result ' + (r.correct ? 'ok' : 'bad');
    const title = r.correct ? ['Правильно!', 'В точку!', 'Отлично!', 'Супер!'][(Math.random() * 4) | 0] : (r.answered ? 'Неправильно' : 'Время вышло');
    box.innerHTML = `<div class="icon">${r.correct ? '✔' : '✖'}</div><p class="big">${title}</p>
      ${r.streak >= 2 ? `<div class="streak">Серия ответов: ${r.streak}</div><br>` : ''}
      <div class="pts">+ ${r.points}</div>
      <div class="rankline">Ты на ${r.rank} месте из ${r.total}</div>
      ${r.behind ? `<div style="opacity:.9;margin-top:4px">Отстаёшь от ${esc(r.behind.name)} на ${r.behind.by} очков</div>` : (r.rank === 1 ? '<div style="margin-top:4px">Ты лидер!</div>' : '')}
      ${r.explain ? `<div class="explain"><b>А ты знал?</b> ${esc(r.explain)}</div>` : ''}`;
    show('sRes');
    if (r.correct) { FX.correct(); FX.vibrate([40, 40, 40]); if (r.streak >= 3) { FX.streak(); FX.confetti(60); } }
    else { FX.wrong(); FX.vibrate(300); }
  });

  socket.on('p:final', (r) => {
    $('#endPlace').textContent = r.rank + ' место';
    $('#endLine').textContent = `${r.score} очков · игроков: ${r.total}`;
    show('sEnd');
    if (r.rank <= 3) { FX.fanfare(); FX.confetti(220); } else FX.pop();
    store.set('kx-' + pin, '');
  });

  socket.on('p:kicked', () => { store.set('kx-' + pin, ''); show('sPin'); $('#pinErr').textContent = 'Ведущий убрал тебя из игры'; });
  socket.on('p:hostleft', () => { store.set('kx-' + pin, ''); show('sPin'); $('#pinErr').textContent = 'Ведущий закрыл игру'; });
}
