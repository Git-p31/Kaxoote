// Хранилище викторин в браузере (localStorage) + встроенные викторины из папки quizzes/
const Store = (() => {
  const KEY = 'kx-quizzes', HID = 'kx-hidden';
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || d); } catch { return JSON.parse(d); } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  let builtins = null;

  async function getBuiltins() {
    if (builtins) return builtins;
    builtins = {};
    try {
      const ids = await fetch('quizzes/index.json', { cache: 'no-cache' }).then((r) => r.json());
      await Promise.all(ids.map(async (id) => {
        try { builtins[id] = await fetch('quizzes/' + id + '.json', { cache: 'no-cache' }).then((r) => r.json()); } catch {}
      }));
    } catch {}
    return builtins;
  }

  async function list() {
    const b = await getBuiltins(), mine = read(KEY, '{}'), hidden = read(HID, '[]');
    const all = { ...b, ...mine };
    return Object.entries(all).filter(([id]) => !hidden.includes(id)).map(([id, q]) => ({
      id, title: q.title || id, description: q.description || '', count: (q.questions || []).length, cover: q.cover || '',
      builtin: id in b && !(id in mine),
    }));
  }

  async function get(id) {
    const mine = read(KEY, '{}');
    if (mine[id]) return { id, ...JSON.parse(JSON.stringify(mine[id])) };
    const b = await getBuiltins();
    return b[id] ? { id, ...JSON.parse(JSON.stringify(b[id])) } : null;
  }

  async function save(q) {
    const id = q.id || 'quiz-' + Date.now().toString(36);
    const { id: _drop, ...data } = q;
    const mine = read(KEY, '{}'); mine[id] = data;
    try { write(KEY, mine); } catch { throw new Error('Мало места в браузере. Удали лишние картинки или викторины.'); }
    const hidden = read(HID, '[]').filter((x) => x !== id); write(HID, hidden);
    return id;
  }

  async function del(id) {
    const mine = read(KEY, '{}'); delete mine[id]; write(KEY, mine);
    const b = await getBuiltins();
    if (id in b) { const h = read(HID, '[]'); if (!h.includes(id)) h.push(id); write(HID, h); }
  }

  // Картинка -> уменьшенная JPEG data:URL (чтобы влезало в память браузера)
  function imageToDataURL(file, max = 1100) {
    return new Promise((res, rej) => {
      if (!file || !/^image\//.test(file.type)) return rej(new Error('Нужна картинка'));
      const fr = new FileReader();
      fr.onload = () => {
        if (file.type === 'image/gif' && file.size < 1.5e6) return res(fr.result); // анимацию не трогаем
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => rej(new Error('Не получилось открыть картинку'));
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  return { list, get, save, del, imageToDataURL };
})();
