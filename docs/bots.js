// Тестовые боты: настоящие «игроки», которые подключаются через ту же сеть, что и телефоны.
// Нужны, чтобы проверить игру под нагрузкой без живых людей.
const Bots = (() => {
  const NAMES = ['Пётр', 'Мария', 'Иоанн', 'Марфа', 'Андрей', 'Анна', 'Фома', 'Лидия', 'Павел', 'Руфь', 'Давид', 'Сарра', 'Иаков', 'Есфирь', 'Лука', 'Ревекка'];
  const list = [];
  let n = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];

  function answerFor(q) {
    switch (q.type) {
      case 'quiz': case 'poll': {
        const k = q.options.length;
        if (q.multi) { const s = new Set([(Math.random() * k) | 0]); if (Math.random() < 0.6) s.add((Math.random() * k) | 0); return [...s]; }
        return (Math.random() * k) | 0;
      }
      case 'truefalse': return Math.random() < 0.5 ? 0 : 1;
      case 'type': return pick(['Пётр', 'Аарон', 'Вифлеем', 'Синай', 'Иоанн', 'не знаю']);
      case 'slider': { const v = q.min + Math.random() * (q.max - q.min); return Math.round(v / q.step) * q.step; }
      case 'order': { const ids = q.items.map((i) => i.id); return Math.random() < 0.35 ? ids.slice().sort((a, b) => a - b) : ids; }
      default: return null;
    }
  }

  function spawn(pin, count = 4) {
    for (let i = 0; i < count; i++) {
      const id = n++;
      const name = 'Бот ' + NAMES[id % NAMES.length] + (id >= NAMES.length ? ' ' + (Math.floor(id / NAMES.length) + 1) : '');
      const s = PlayerSocket();
      const bot = { s, name, timers: [] };
      list.push(bot);
      const later = (fn, ms) => bot.timers.push(setTimeout(fn, ms));
      const react = () => s.emit('player:react', { e: pick(REACTIONS) });
      s.on('p:start', ({ q }) => {
        if (q.type === 'slide') return;
        const limit = (q.time || 20) * 1000;
        later(() => s.emit('player:answer', { value: answerFor(q) }), rnd(800, Math.min(limit * 0.8, 9000)));
      });
      s.on('p:intro', () => { if (Math.random() < 0.3) later(react, rnd(200, 2500)); });
      s.on('p:result', (r) => { if (r.correct && Math.random() < 0.6) later(react, rnd(300, 2000)); });
      // небольшая задержка, чтобы боты заходили не все в одну миллисекунду
      later(() => s.emit('player:join', { pin, name, avatar: AVATAR_IDS[id % AVATAR_IDS.length] }, (res) => {
        if (res && res.ok) for (let k = 0; k < 3; k++) later(react, rnd(1000, 8000));
      }), i * 250);
    }
  }
  return { spawn, count: () => list.length };
})();
