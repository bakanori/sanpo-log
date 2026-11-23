// In-memory stand-in for the Firebase SDK functions the app uses (auth + firestore), for local tests only.
window.__FBMOCK = (() => {
  const store = new Map();                 // 'a/b/c/d' -> data
  const listeners = new Set();
  const clone = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
  const DEL = { __del: true };
  let user = window.__MOCKUSER || null, authCb = null;
  const log = window.__FSLOG = [];
  const isDocPath = p => p.split('/').length % 2 === 0;
  const member = (gid) => { const g = store.get('groups/' + gid); return !!(user && g && g.members && g.members[user.uid]); };
  const canRead = path => {
    const s = path.split('/');
    if (s[0] === 'users') return !!user && s[1] === user.uid;
    if (s[0] === 'groups') return member(s[1]);
    return false;
  };
  function emitAll() { setTimeout(() => listeners.forEach(l => l.run()), 5); }
  const snapDoc = path => ({ id: path.split('/').pop(), exists: () => store.has(path), data: () => clone(store.get(path)), metadata: { hasPendingWrites: false } });
  const m = {
    __store: store, __DEL: DEL,
    __setUser(u) { user = u; if (authCb) setTimeout(() => authCb(u), 5); },
    __write(path, data) { store.set(path, clone(data)); emitAll(); },
    __remove(path) { store.delete(path); emitAll(); },
    initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({ db: true }),
    onAuthStateChanged: (a, cb) => { authCb = cb; setTimeout(() => cb(user), 10); },
    GoogleAuthProvider: function () {},
    signInWithPopup: async () => { user = window.__LOGINAS || { uid: 'u1', displayName: 'たろう', email: 'taro@example.com' }; setTimeout(() => authCb && authCb(user), 5); return { user }; },
    signOut: async () => { user = null; setTimeout(() => authCb && authCb(null), 5); },
    collection: (db, ...segs) => ({ type: 'col', path: segs.join('/') }),
    doc: (base, ...segs) => {
      if (base && base.type === 'col') return { type: 'doc', path: base.path + '/' + (segs.length ? segs.join('/') : Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12)), get id() { return this.path.split('/').pop(); } };
      const path = segs.join('/'); return { type: 'doc', path, id: path.split('/').pop() };
    },
    deleteField: () => DEL,
    async setDoc(ref, data) {
      const s = ref.path.split('/');
      if (s[0] === 'groups' && s.length === 2 && !store.has(ref.path) && (!user || data.owner !== user.uid)) throw { code: 'permission-denied' };
      log.push(['set', ref.path]); store.set(ref.path, clone(data)); emitAll();
    },
    async updateDoc(ref, up) {
      if (!store.has(ref.path)) throw { code: 'not-found' };
      const cur = clone(store.get(ref.path));
      for (const key in up) {
        const parts = key.split('.'); let o = cur;
        for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; }
        if (up[key] === DEL) delete o[parts[parts.length - 1]]; else o[parts[parts.length - 1]] = clone(up[key]);
      }
      log.push(['update', ref.path, Object.keys(up).join(',')]); store.set(ref.path, cur); emitAll();
    },
    async deleteDoc(ref) { log.push(['delete', ref.path]); store.delete(ref.path); emitAll(); },
    async getDoc(ref) { return snapDoc(ref.path); },
    writeBatch: () => { const ops = []; return { set: (r, d) => ops.push(['set', r.path, clone(d)]), delete: r => ops.push(['del', r.path]), commit: async () => {
      for (const [o, p, d] of ops) {
        const s = p.split('/');
        if (s[0] === 'groups' && (!member(s[1]) || (o === 'set' && d.by !== user.uid))) throw { code: 'permission-denied' };
        if (o === 'set') store.set(p, d); else store.delete(p);
      }
      log.push(['batch', ops.length]); emitAll();
    } }; },
    onSnapshot(ref, next, err) {
      const l = { known: new Map(), dead: false, first: true };
      l.run = () => {
        if (l.dead) return;
        if (!canRead(ref.path)) { if (!l.denied) { l.denied = true; err && err({ code: 'permission-denied' }); } return; }
        l.denied = false;
        if (ref.type === 'doc') { const cur = JSON.stringify(store.get(ref.path) || null); if (!l.first && cur === l.last) return; l.first = false; l.last = cur; next(snapDoc(ref.path)); return; }
        const pre = ref.path + '/', now = new Map();
        for (const [p, d] of store) if (p.startsWith(pre) && !p.slice(pre.length).includes('/')) now.set(p.slice(pre.length), JSON.stringify(d));
        const ch = [];
        for (const [id, s] of now) if (!l.known.has(id)) ch.push({ type: 'added', id, s }); else if (l.known.get(id) !== s) ch.push({ type: 'modified', id, s });
        for (const id of l.known.keys()) if (!now.has(id)) ch.push({ type: 'removed', id });
        l.known = now;
        if (!ch.length && !l.first) return;
        l.first = false;
        next({ docChanges: () => ch.map(c => ({ type: c.type, doc: { id: c.id, data: () => c.s ? JSON.parse(c.s) : null, metadata: { hasPendingWrites: false } } })) });
      };
      listeners.add(l); setTimeout(l.run, 5);
      return () => { l.dead = true; listeners.delete(l); };
    }
  };
  return m;
})();
