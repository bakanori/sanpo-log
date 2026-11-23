/* SANPO LOG — js/sync.js
   同期 — GitHub (one private file), Firebase (sign in with Google) and groups (shared maps).
   The files load in this order (see index.html): base → parts → records → sync → map → memo → screens → start.
   They share one scope: a name made in an earlier file can be used in any later one, but code that runs
   while the page loads may only use names from its own file and the earlier ones. */
'use strict';

/* ---------- GitHub sync: one JSON file in a private repository ----------
   GET → merge (newest copy of each item wins; deletions travel as tombstones) → PUT with the file's sha.
   The token stays in this browser only (localStorage) and is sent to api.github.com only. */
const Sync = {
  KEY: 'sanpo-gh', PATH: 'sanpo-log.json', API: 'https://api.github.com',
  cfg: null, state: 'off', msg: '', last: 0, busy: false, again: false, t: null,
  load() { try { this.cfg = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { this.cfg = null; } this.state = this.cfg ? 'idle' : 'off'; },
  on() { return !!(this.cfg && this.cfg.token); },
  h(extra) { return { Authorization: 'Bearer ' + this.cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(extra || {}) }; },
  async api(path, opt = {}) {
    const r = await fetch(this.API + path, { ...opt, headers: this.h(opt.headers), cache: 'no-store' });
    if (r.status === 401) throw Object.assign(new Error('auth'), { code: 401 });
    return r;
  },
  async connect(token, repo) {
    this.cfg = { token: token.trim(), repo: (repo || 'sanpo-data').trim() };
    try {
      const u = await this.api('/user');
      if (!u.ok) throw new Error('user');
      this.cfg.owner = (await u.json()).login;
      const r = await this.api(`/repos/${this.cfg.owner}/${this.cfg.repo}`);
      if (r.status === 404) throw Object.assign(new Error('repo'), { code: 404 });
      const info = await r.json();
      if (!info.private && !confirm2()) throw Object.assign(new Error('public'), { code: 'public' });
      localStorage.setItem(this.KEY, JSON.stringify(this.cfg));
      this.state = 'idle'; this.paint();
      await this.run();
      return true;
    } catch (e) {
      this.cfg = null; this.state = 'off';
      this.msg = e.code === 401 ? '合鍵が正しくないか、期限が切れています。' : e.code === 404 ? `リポジトリ「${repo}」が見つかりません。合鍵の対象にこのリポジトリを選んだか確認してください。` : e.code === 'public' ? '公開リポジトリには保存しません。非公開（Private）のリポジトリを使ってください。' : 'GitHubにつながりませんでした。通信を確認してください。';
      this.paint();
      return false;
    }
  },
  off() { localStorage.removeItem(this.KEY); this.cfg = null; this.state = 'off'; this.msg = ''; this.paint(); },
  soon(ms) { if (!this.on()) return; clearTimeout(this.t); this.t = setTimeout(() => this.run(), ms == null ? 2500 : ms); },
  async run() {
    if (!this.on()) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true; this.state = 'busy'; this.paint();
    const { owner, repo } = this.cfg, url = `/repos/${owner}/${repo}/contents/${this.PATH}`;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const g = await this.api(url);
        let sha = null, remoteText = null;
        if (g.ok) {
          const meta = await g.json();
          sha = meta.sha;
          if (meta.content && meta.encoding === 'base64') remoteText = b64dec(meta.content);
          else { const raw = await this.api(url, { headers: { Accept: 'application/vnd.github.raw+json' } }); remoteText = await raw.text(); }
        } else if (g.status !== 404) throw new Error('get ' + g.status);
        if (remoteText) {
          const before = JSON.stringify(Store.dump());
          Store.absorb(JSON.parse(remoteText));
          if (JSON.stringify(Store.dump()) !== before) { Store.save(); reindex(); changed(); }
        }
        const local = JSON.stringify(Store.dump());
        if (remoteText === local) break;   // already the same on both sides
        const p = await this.api(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `sanpo-log ${new Date().toISOString().slice(0, 16)} (${W < 720 ? 'phone' : 'pc'})`, content: b64enc(local), ...(sha ? { sha } : {}) }) });
        if (p.ok) break;
        if (p.status === 409 || p.status === 422) continue;   // someone else saved first: fetch again and merge
        throw new Error('put ' + p.status);
      }
      this.state = 'ok'; this.last = Date.now(); this.msg = '';
    } catch (e) {
      this.state = 'err';
      this.msg = e.code === 401 ? '合鍵の期限が切れたようです。新しい合鍵を作って接続し直してください。' : navigator.onLine === false ? 'オフラインです。つながったら自動で同期します。' : '同期できませんでした。少しあとでもう一度試します。';
      if (e.code !== 401) this.soon(60000);
    } finally {
      this.busy = false; this.paint();
      if (this.again) { this.again = false; this.soon(500); }
    }
  },
  paint() {
    const st = $('#store'); if (!st) return;
    st.classList.remove('ok', 'busy', 'err');
    const hm = this.last ? new Date(this.last).toTimeString().slice(0, 5) : '';
    let txt = 'この端末に保存';
    if (FB.user) {
      const fm = FB.last ? new Date(FB.last).toTimeString().slice(0, 5) : '';
      if (FB.state === 'busy') { txt = '同期しています…'; st.classList.add('busy'); }
      else if (FB.state === 'err') { txt = '同期できませんでした'; st.classList.add('err'); }
      else { txt = '同期しました' + (fm ? ' ' + fm : ''); st.classList.add('ok'); }
    } else if (this.on()) {
      if (this.state === 'busy') { txt = '同期しています…'; st.classList.add('busy'); }
      else if (this.state === 'err') { txt = '同期できませんでした'; st.classList.add('err'); }
      else { txt = '同期しました（GitHub）' + (hm ? ' ' + hm : ''); st.classList.add('ok'); }
    }
    st.querySelector('span').textContent = txt;
    const b2 = $('#bData2'); if (b2) { b2.className = st.className; b2.title = txt; }
    const fb = $('#fbBox');
    if (fb) {
      fb.hidden = !FB.enabled();
      $('#fbIn').style.display = FB.user ? 'none' : '';
      $('#fbOut').style.display = $('#fbNow').style.display = FB.user ? '' : 'none';
      const fm = FB.last ? new Date(FB.last).toTimeString().slice(0, 5) : '';
      $('#fbState').textContent = FB.user ? `ログイン中：${FB.user.email || FB.user.uid}${fm ? `（最終同期 ${fm}）` : ''}${FB.msg ? '　' + FB.msg : ''}`
        : (FB.msg || 'Googleアカウントでログインすると、スマホとPCの記録が自動で同じになります。記録はあなた専用の場所に保存され、ほかの人からは見えません。');
      $('#ghRule').textContent = FB.enabled() ? 'ほかの同期方法：GitHub（使わなくてOK）' : 'GitHubと同期';
      if (!FB.enabled() || this.on()) $('#ghWrap').open = true;
      if ($('#modal').classList.contains('open')) whereText();
    }
    grPaintBox();
    const box = $('#ghBox'); if (!box) return;
    $('#ghSetup').style.display = this.on() ? 'none' : '';
    $('#ghActs').style.display = this.on() ? '' : 'none';
    $('#ghState').innerHTML = '';
    const p = $('#ghState');
    if (this.on()) {
      p.append('接続中：', Object.assign(document.createElement('b'), { textContent: `${this.cfg.owner}/${this.cfg.repo}` }));
      p.append(hm ? `（最終同期 ${hm}）` : '');
      if (this.msg) p.append(document.createElement('br'), this.msg);
    } else p.textContent = this.msg || '記録用の非公開リポジトリと、その合鍵（Fine-grained token）を使って、スマホとPCの記録を同じにします。合鍵はこの端末の中だけに保存されます。';
  }
};
/* ---------- Firebase sync: sign in with Google, data under users/{uid}/(notes|places|walks|deleted) ----------
   The SDK is loaded only when this is used. Each item is its own document; the newest copy wins. */
const FIREBASE_CONFIG = (typeof firebaseConfig !== 'undefined' && firebaseConfig && firebaseConfig.apiKey) ? firebaseConfig : null;   // from firebase-config.js (if present)
const FB_VER = '13.3.0';
const FB = {
  sdk: null, app: null, auth: null, db: null, user: null, state: 'off', msg: '', last: 0, ready: false, busy: false, again: false, t: null, unsubs: [],
  remote: { notes: new Map(), places: new Map(), walks: new Map(), deleted: new Map() },
  enabled() { return !!FIREBASE_CONFIG; },
  load() {
    if (this.loading) return this.loading;
    const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
    this.loading = (window.__FBMOCK ? Promise.resolve(window.__FBMOCK) :
      Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]).then(m => Object.assign({}, ...m)))
      .then(s => {
        this.sdk = s;
        this.app = s.initializeApp(FIREBASE_CONFIG);
        this.auth = s.getAuth(this.app);
        this.db = s.getFirestore(this.app);
        s.onAuthStateChanged(this.auth, u => this.onUser(u));
        if (s.getRedirectResult) s.getRedirectResult(this.auth).catch(() => {});
        return s;
      }).catch(e => { this.loading = null; throw e; });
    return this.loading;
  },
  signIn() {   // must run inside the click: no await before the popup opens
    const s = this.sdk, p = new s.GoogleAuthProvider();
    return s.signInWithPopup(this.auth, p).catch(e => {
      if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) return s.signInWithRedirect(this.auth, p);
      throw e;
    });
  },
  signOut() { return this.sdk && this.sdk.signOut(this.auth); },
  onUser(u) {
    this.unsubs.forEach(f => f()); this.unsubs = [];
    Object.values(this.remote).forEach(m => m.clear());
    const same = this.user && u && this.user.uid === u.uid;
    this.user = u; this.ready = false; this.known = true;
    try { u ? localStorage.setItem('sanpo-fb', '1') : localStorage.removeItem('sanpo-fb'); } catch (e) {}
    if (!same) GR.stop();
    if (!u) { this.state = 'off'; Sync.paint(); GR.joinPending(); return; }
    this.state = 'busy'; this.msg = ''; Sync.paint();
    const s = this.sdk, first = new Set();
    // which group am I in? (a small pointer in my own space, so every device knows)
    let firstPtr = true;
    this.unsubs.push(s.onSnapshot(s.doc(this.db, 'users', u.uid, 'meta', 'group'), snap => {
      const d = snap.exists() ? snap.data() : {};
      GR.setGroups(Array.isArray(d.gids) ? d.gids : d.gid ? [d.gid] : []);
      if (firstPtr) { firstPtr = false; GR.joinPending(); }
    }, () => { if (firstPtr) { firstPtr = false; GR.joinPending(); } }));
    ['places', 'notes', 'walks', 'deleted'].forEach(c => {
      this.unsubs.push(s.onSnapshot(s.collection(this.db, 'users', u.uid, c), snap => {
        const inc = {};
        snap.docChanges().forEach(ch => {
          const id = ch.doc.id;
          if (ch.type === 'removed') { this.remote[c].delete(id); return; }
          const data = ch.doc.data();
          this.remote[c].set(id, +data.u || 0);
          if (!ch.doc.metadata.hasPendingWrites) inc[id] = c === 'deleted' ? (+data.u || 0) : data;
        });
        if (Object.keys(inc).length) {
          const before = JSON.stringify(Store.dump());
          Store.absorb({ [c]: inc });
          if (JSON.stringify(Store.dump()) !== before) { Store.save(); reindex(); changed(); GR.soon(); }
        }
        if (!first.has(c)) { first.add(c); if (first.size === 4) { this.ready = true; this.push(); } }
      }, err => { this.state = 'err'; this.msg = '同期できませんでした（' + (err && err.code || 'error') + '）'; Sync.paint(); }));
    });
  },
  soon(ms) { if (!this.user || !this.ready) return; clearTimeout(this.t); this.t = setTimeout(() => this.push(), ms == null ? 1500 : ms); },
  async push() {
    if (!this.user || !this.ready) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true; this.state = 'busy'; Sync.paint();
    try {
      const s = this.sdk, uid = this.user.uid, ops = [];
      const scan = (c, m) => { for (const [id, x] of m) { const lu = c === 'deleted' ? +x : (+x.u || 0), ru = this.remote[c].get(id); if (ru === undefined || lu > ru) ops.push(['set', c, id, c === 'deleted' ? { u: lu } : JSON.parse(JSON.stringify(x))]); } };
      scan('places', Store.places); scan('notes', Store.notes); scan('walks', Store.walks); scan('deleted', Store.deleted);
      for (const key of Store.deleted.keys()) {   // remove documents that were deleted here
        const id = key.slice(2), c = key[0] === 'n' ? 'notes' : 'walks';
        if (this.remote[c].has(id) && !(c === 'notes' ? Store.notes : Store.walks).has(id)) ops.push(['del', c, id]);
      }
      for (let i = 0; i < ops.length; i += 400) {
        const b = s.writeBatch(this.db);
        for (const [op, c, id, data] of ops.slice(i, i + 400)) { const ref = s.doc(this.db, 'users', uid, c, id); op === 'set' ? b.set(ref, data) : b.delete(ref); }
        await b.commit();
      }
      for (const [op, c, id, data] of ops) op === 'set' ? this.remote[c].set(id, +data.u || 0) : this.remote[c].delete(id);
      this.state = 'ok'; this.last = Date.now(); this.msg = '';
      Thumbs.migrate();
    } catch (e) {
      this.state = 'err'; this.msg = navigator.onLine === false ? 'オフラインです。つながったら自動で同期します。' : '同期できませんでした。少しあとでもう一度試します。';
      this.soon(60000);
    } finally {
      this.busy = false; Sync.paint();
      if (this.again) { this.again = false; this.soon(300); }
    }
  }
};

const b64enc = s => { const b = new TextEncoder().encode(s); let x = ''; for (let i = 0; i < b.length; i += 0x8000) x += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(x); };
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
/* ---------- group: one shared map ----------
   groups/{gid}            : { name, owner, created, members: { uid: { name, c: colour index, joined } } }
   groups/{gid}/notes|places|walks/{uid}_{id} : a copy of each member's own records (written only by that member, no GPS).
   Anyone who opens the invite link (?g=gid) can join; the group id is long and random. */
const GCOL = ['#1f3bff', '#ee1c25', '#00a651', '#ffc400', '#e5007e', '#00a3e0', '#7b2fd6', '#8c8c86'];   // 群青 赤 緑 黄 マゼンタ 空 紫 (+灰)
const isLight = h => { const [r, g, b] = hexRGB(h); return .299 * r + .587 * g + .114 * b > 170; };
const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const dayOf = u => u ? new Date(u - new Date(u).getTimezoneOffset() * 6e4).toISOString().slice(0, 10) : '9999-99-99';
/* groups: you can be in a few at once (up to GMAX). Each keeps its own members, colours and shared copies. */
const GMAX = 5;
function makeGroup(gid) {
  return {
    gid, g: null, unsubs: [], ready: false, busy: false, again: false, t: null,
    docs: { notes: new Map(), places: new Map(), walks: new Map() },
    on() { const me = GR.me(); return !!(me && this.g && this.g.members && this.g.members[me]); },
    members() { return this.g ? Object.entries(this.g.members).map(([uid, m]) => ({ uid, ...m })).sort((a, b) => (a.joined || 0) - (b.joined || 0)) : []; },
    color(uid) {   // a member who has not picked a colour yet gets the first free one (same on every screen)
      const m = this.g && this.g.members[uid]; if (!m) return GCOL[7];
      if (m.c >= 0) return GCOL[m.c % (GCOL.length - 1)];
      const used = new Set(Object.values(this.g.members).filter(x => x.c >= 0).map(x => x.c));
      for (const x of this.members()) { if (x.c >= 0) continue; let c = 0; while (used.has(c) && c < GCOL.length - 1) c++; used.add(c); if (x.uid === uid) return GCOL[c]; }
      return GCOL[7];
    },
    name(uid) { const m = this.g && this.g.members[uid]; return (m && m.name) || '…'; },
    link() { return location.origin + location.pathname + '?g=' + this.gid; },
    gtag() { return this.g ? normTag(this.g.name) : ''; },
    gtags() { return this.g ? uniq([normTag(this.g.name), ...(Array.isArray(this.g.tags) ? this.g.tags.map(normTag) : [])]) : []; },   // current name + earlier names
    isShared(n) {   // private by default: only memos chosen for this group (its tag), or on a day shared with it
      const ts = this.gtags(); if (!ts.length) return false;
      if ((n.tags || []).some(t => ts.includes(t))) return true;
      const w = Store.walks.get(n.d); return !!(w && (w.tags || []).some(t => ts.includes(t)));
    },
    syncTagName() {   // the group was renamed: follow it in my own tags (old names keep working anyway)
      const cur = this.gtag(); if (!cur) return;
      const olds = this.gtags().filter(t => t !== cur && IX.tagN.has(t));
      if (olds.length) olds.forEach(o => Store.renameTag(o, cur));
    },
    renameGroup(name) {
      const s = FB.sdk, nm = name.trim().slice(0, 24);
      return s.updateDoc(s.doc(FB.db, 'groups', this.gid), { name: nm, tags: uniq([...this.gtags(), normTag(nm)]) });
    },
    rename(name) { const s = FB.sdk; return s.updateDoc(s.doc(FB.db, 'groups', this.gid), { ['members.' + GR.me() + '.name']: name.slice(0, 20) }); },
    start() {
      const s = FB.sdk, db = FB.db, first = new Set(), gid = this.gid;
      this.unsubs.push(s.onSnapshot(s.doc(db, 'groups', gid), snap => {
        if (!snap.exists()) return GR.lost(this, 'グループが見つかりませんでした（解散したのかもしれません）');
        this.g = snap.data();
        if (!this.g.members || !this.g.members[GR.me()]) return GR.lost(this, 'グループから外れました');
        this.fixColour();
        this.syncTagName();
        GR.refresh();
      }, err => GR.lost(this, err && err.code === 'permission-denied' ? 'グループに参加していません' : null)));
      ['notes', 'places', 'walks'].forEach(c => this.unsubs.push(s.onSnapshot(s.collection(db, 'groups', gid, c), snap => {
        snap.docChanges().forEach(ch => { if (ch.type === 'removed') this.docs[c].delete(ch.doc.id); else this.docs[c].set(ch.doc.id, ch.doc.data()); });
        if (!first.has(c)) { first.add(c); if (first.size === 3) { this.ready = true; this.soon(300); } }
        GR.refresh();
      }, () => {})));
    },
    stop() {
      this.unsubs.forEach(f => f()); this.unsubs = [];
      this.g = null; this.ready = false; clearTimeout(this.t);
      Object.values(this.docs).forEach(m => m.clear());
    },
    fixColour() {   // a new member picks the first colour nobody uses yet
      const me = GR.me(), mine = this.g.members[me];
      const used = Object.entries(this.g.members).filter(([u]) => u !== me).map(([, m]) => m.c);
      if (mine.c >= 0 && !used.includes(mine.c)) return;
      let c = 0; while (used.includes(c) && c < GCOL.length - 1) c++;
      const s = FB.sdk; s.updateDoc(s.doc(FB.db, 'groups', this.gid), { ['members.' + me + '.c']: c }).catch(() => {});
    },
    /* my shared records -> this group (copies without GPS); everything else stays mine only */
    want() {
      const me = GR.me(), ts = this.gtags(), out = { notes: new Map(), places: new Map(), walks: new Map() };
      for (const n of Store.notes.values()) if (this.isShared(n)) {
        const { loc, im, imd, ...r } = n;
        if (im && im.length) r.ph = im.length;   // only how many: the photos themselves stay on your device
        out.notes.set(me + '_' + n.id, { ...r, by: me });
      }
      for (const w of Store.walks.values()) if ((w.tags || []).some(t => ts.includes(t))) { const { trk, ...r } = w; out.walks.set(me + '_' + w.d, { ...r, by: me }); }   // the towns passed go too; the line itself stays here
      return out;
    },
    soon(ms) { if (!this.on() || !this.ready) return; clearTimeout(this.t); this.t = setTimeout(() => this.push(), ms == null ? 1500 : ms); },
    async push() {
      if (!this.on() || !this.ready) return;
      if (this.busy) { this.again = true; return; }
      this.busy = true;
      try {
        const s = FB.sdk, me = GR.me(), gid = this.gid, want = this.want(), ops = [];
        for (const c of ['notes', 'places', 'walks']) {
          for (const [id, x] of want[c]) { const r = this.docs[c].get(id); if (!r || (+x.u || 0) > (+r.u || 0) || r.imd) ops.push(['set', c, id, JSON.parse(JSON.stringify(x))]); }   // r.imd: photos copied by 2.3.1 or older are taken back out
          for (const [id, r] of this.docs[c]) if (r.by === me && !want[c].has(id)) ops.push(['del', c, id]);
        }
        for (let i = 0; i < ops.length; i += 400) {
          const b = s.writeBatch(FB.db);
          for (const [op, c, id, data] of ops.slice(i, i + 400)) { const ref = s.doc(FB.db, 'groups', gid, c, id); op === 'set' ? b.set(ref, data) : b.delete(ref); }
          await b.commit();
        }
        if (this.unsubs.length) for (const [op, c, id, data] of ops) op === 'set' ? this.docs[c].set(id, data) : this.docs[c].delete(id);
      } catch (e) { this.soon(60000); }
      finally { this.busy = false; if (this.again) { this.again = false; this.soon(300); } }
    },
    async remove(uid) {   // owner only
      const s = FB.sdk, gid = this.gid, ids = [];
      for (const c of ['notes', 'places', 'walks']) for (const [id, x] of this.docs[c]) if (x.by === uid) ids.push([c, id]);
      await s.updateDoc(s.doc(FB.db, 'groups', gid), { ['members.' + uid]: s.deleteField() });
      for (let i = 0; i < ids.length; i += 400) {
        const b = s.writeBatch(FB.db);
        ids.slice(i, i + 400).forEach(([c, id]) => b.delete(s.doc(FB.db, 'groups', gid, c, id)));
        await b.commit();
      }
    }
  };
}
const NO_DOCS = { notes: new Map(), places: new Map(), walks: new Map() };
const GR = {
  list: new Map(), rt: null, msg: '', joining: false, box: null,
  view: (() => { try { return localStorage.getItem('sanpo-gview') || 'group'; } catch (e) { return 'group'; } })(),   // 'me', a group id (or 'group' from 2.10: the first group)
  me() { return FB.user ? FB.user.uid : null; },
  myName() { const u = FB.user; return ((u && (u.displayName || (u.email || '').split('@')[0])) || 'わたし').slice(0, 20); },
  groups() { return [...this.list.values()]; },
  live() { return this.groups().filter(G => G.on()); },
  gids() { return [...this.list.keys()]; },
  cur() {   // the group the map and ノート → みんな show (when 自分 is chosen: the first one, for the lists)
    const v = this.view !== 'me' && this.list.get(this.view);
    return v || this.live()[0] || this.groups()[0] || null;
  },
  get gid() { const c = this.cur(); return c ? c.gid : null; },
  get g() { const c = this.cur(); return c ? c.g : null; },
  get docs() { const c = this.cur(); return c ? c.docs : NO_DOCS; },
  on() { const c = this.cur(); return !!(c && c.on()); },
  anyOn() { return this.live().length > 0; },
  showing() { return this.view !== 'me' && this.on() && !!GX; },
  members() { const c = this.cur(); return c ? c.members() : []; },
  color(uid) { const c = this.cur(); return c ? c.color(uid) : GCOL[7]; },
  name(uid) { const c = this.cur(); return c ? c.name(uid) : '…'; },
  link() { const c = this.cur(); return c ? c.link() : ''; },
  gtag() { const c = this.cur(); return c ? c.gtag() : ''; },
  gtags() { const c = this.cur(); return c ? c.gtags() : []; },
  isShared(n) { const c = this.cur(); return !!c && c.isShared(n); },
  sharedTo(n) { return this.live().filter(G => G.isShared(n)); },
  allTags() { return uniq(this.live().flatMap(G => G.gtags())); },
  setGroups(gids) {   // from my pointer (any device): start the new groups, let go of the old
    gids = uniq(gids.map(String).filter(Boolean)).slice(0, GMAX);
    for (const [gid, G] of this.list) if (!gids.includes(gid)) { G.stop(); this.list.delete(gid); }
    for (const gid of gids) if (!this.list.has(gid)) { const G = makeGroup(gid); this.list.set(gid, G); G.start(); }
    if (this.view !== 'me' && !this.list.has(this.view)) this.view = gids[0] || 'group';
    this.refresh();
  },
  stop() { for (const G of this.list.values()) G.stop(); this.list.clear(); this.refresh(); },
  lost(G, msg) {   // removed, deleted or no access: forget that group on every device
    G.stop(); this.list.delete(G.gid);
    if (msg) { this.msg = msg; if (this.me()) this.setPointer(this.gids()).catch(() => {}); }
    this.refresh();
  },
  refresh() { clearTimeout(this.rt); this.rt = setTimeout(() => { groupIndex(); paintGroup(); changed(); }, 40); },
  setPointer(gids) { const s = FB.sdk; return s.setDoc(s.doc(FB.db, 'users', this.me(), 'meta', 'group'), { gid: gids[0] || '', gids, u: Date.now() }); },   // gid: for 2.10 and older
  async create(name) {
    if (this.list.size >= GMAX) throw { code: 'too-many' };
    const s = FB.sdk, me = this.me(), now = Date.now();
    const ref = s.doc(s.collection(FB.db, 'groups'));
    await s.setDoc(ref, { name: name.slice(0, 24), tags: [normTag(name)], owner: me, created: now, members: { [me]: { name: this.myName(), c: 0, joined: now } } });
    await this.setPointer(uniq([...this.gids(), ref.id]));
    this.view = ref.id; this.box = ref.id; this.saveView();
  },
  async join(gid) {
    const s = FB.sdk, me = this.me();
    await s.updateDoc(s.doc(FB.db, 'groups', gid), { ['members.' + me]: { name: this.myName(), c: -1, joined: Date.now() } });
    await this.setPointer(uniq([...this.gids(), gid]));
    this.view = gid; this.box = gid; this.saveView();
  },
  async leave(G, quiet) {
    const s = FB.sdk, me = this.me(), gid = G && G.gid, g = G && G.g;
    if (!gid || !g) return;
    const mine = [];
    for (const c of ['notes', 'places', 'walks']) for (const [id, x] of G.docs[c]) if (x.by === me) mine.push([c, id]);
    G.stop(); this.list.delete(gid); this.refresh();
    for (let i = 0; i < mine.length; i += 400) {
      const b = s.writeBatch(FB.db);
      mine.slice(i, i + 400).forEach(([c, id]) => b.delete(s.doc(FB.db, 'groups', gid, c, id)));
      await b.commit();
    }
    const others = Object.keys(g.members).filter(u => u !== me).sort((a, b) => (g.members[a].joined || 0) - (g.members[b].joined || 0));
    if (g.owner === me && !others.length) await s.deleteDoc(s.doc(FB.db, 'groups', gid));
    else {
      const up = { ['members.' + me]: s.deleteField() };
      if (g.owner === me) up.owner = others[0];   // hand the group to the next member
      await s.updateDoc(s.doc(FB.db, 'groups', gid), up);
    }
    await this.setPointer(this.gids());
    if (!quiet) toast(`「${g.name}」から抜けました（自分の記録はそのまま残っています）`);
  },
  boxG() { const gs = this.groups(); return this.list.get(this.box) || (this.box === 'new' ? null : this.cur() || gs[0] || null); },   // the group shown in 設定 → みんなで
  want() { const c = this.cur(); return c ? c.want() : { notes: new Map(), places: new Map(), walks: new Map() }; },   // what the group being looked at gets (tests, older callers)
  saveView() { try { localStorage.setItem('sanpo-gview', this.view); } catch (e) {} },
  soon(ms) { for (const G of this.list.values()) G.soon(ms); },
  /* invite links: ?g=<group id> */
  pending() { try { return localStorage.getItem('sanpo-join') || ''; } catch (e) { return ''; } },
  clearPending() { try { localStorage.removeItem('sanpo-join'); localStorage.removeItem('sanpo-join-ok'); } catch (e) {} },
  joinPending() {
    const gid = this.pending();
    if (!gid || !FB.enabled() || !FB.known || this.joining) return;
    if (this.list.has(gid)) { this.clearPending(); closePanel('join'); this.view = gid; this.saveView(); this.refresh(); toast('このグループに参加しています'); return; }
    if (this.list.size >= GMAX) { this.clearPending(); closePanel('join'); toast(`グループは${GMAX}つまでです。設定の「みんなで」から、どれかを抜けてから開いてください`, 4600); return; }
    let ok = false; try { ok = localStorage.getItem('sanpo-join-ok') === '1'; } catch (e) {}
    if (FB.user && ok) return this.doJoin(gid);
    $('#joinText').textContent = (FB.user ? '' : '参加するには、Googleでログインしてください（スマホとPCの同期と同じログインです）。') +
      (this.list.size ? '今入っているグループは、そのままです。もう1つ参加します。' : 'みんなの歩いた町が、1枚の地図に色分けで重なります。');
    $('#joinOk').textContent = FB.user ? '参加する' : 'Googleでログインして参加';
    $('#join').classList.add('open');
  },
  async doJoin(gid) {
    this.joining = true; closePanel('join');
    toast('グループに参加しています…');
    try { await this.join(gid); this.clearPending(); toast('グループに参加しました'); }
    catch (e) { this.clearPending(); toast('参加できませんでした（招待リンクが古いか、まちがっているかもしれません）', 4200); }
    finally { this.joining = false; }
  }
};
let GX = null;
function groupIndex() {
  if (!GR.on()) { GX = null; return; }
  const me = GR.me(), M = GR.g.members, first = new Map(), others = new Map(), feed = [], towns = new Map(), together = new Map(), mine = new Map();
  const add = (k, uid, d, ct) => { let m = first.get(k); if (!m) first.set(k, m = new Map()); const p = m.get(uid); if (!p || d < p[0] || (d === p[0] && ct < p[1])) m.set(uid, [d, ct]); };
  const ct = x => x.w && x.w.y ? Infinity : idTime(x.id);   // "いっしょ" never takes the colour from the memo it answers
  const link = (x, uid) => {   // わたしも行った: remember whose memo it answers
    if (!x.w || !x.w.u || !x.w.i) return;
    const key = x.w.u + '_' + x.w.i;
    if (uid === me) mine.set(key, x.id);
    if (x.w.y) { let a = together.get(key); if (!a) together.set(key, a = []); if (!a.includes(uid)) a.push(uid); }
  };
  for (const n of Store.notes.values()) if (GR.isShared(n)) { add(n.k, me, n.d, ct(n)); link(n, me); }   // the group map shows only what was shared
  for (const x of GR.docs.notes.values()) if (x.by !== me && M[x.by] && okKey(String(x.k))) { add(x.k, x.by, x.d, ct(x)); link(x, x.by); const a = others.get(x.k); a ? a.push(x) : others.set(x.k, [x]); feed.push(x); }
  const days = [], gts = GR.gtags();   // days shared with the group: their towns passed count as walked
  const addDay = (w, by) => {
    const tw = (Array.isArray(w.tw) ? w.tw : []).map(String).filter(k => k[0] === 't' && okKey(k));
    for (const k of tw) add(k, by, w.d, Infinity);
    days.push({ by, d: w.d, title: String(w.title || '').slice(0, 80), sum: String(w.sum || ''), tw, km: +w.km || 0, t0: String(w.t0 || ''), t1: String(w.t1 || ''), tags: Array.isArray(w.tags) ? w.tags.map(String) : [] });
  };
  for (const w of Store.walks.values()) if ((w.tags || []).some(t => gts.includes(t))) addDay(w, me);
  for (const x of GR.docs.walks.values()) if (x.by !== me && M[x.by] && /^\d{4}-\d{2}-\d{2}$/.test(String(x.d || ''))) addDay(x, x.by);
  days.sort((a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : 0);
  const order = uid => (M[uid] && M[uid].joined) || 0;
  const own = new Map();
  let multi = 0;
  for (const [k, m] of first) {   // the colour: who went first; on the same day, who wrote it first
    let best = null;
    for (const [uid, [d, ct]] of m) if (!best || d < best.d || (d === best.d && (ct < best.ct || (ct === best.ct && order(uid) < order(best.uid))))) best = { uid, d, ct };
    own.set(k, best.uid);
    if (k[0] === 't') { for (const uid of m.keys()) towns.set(uid, (towns.get(uid) || 0) + 1); if (m.size > 1) multi++; }
  }
  for (const a of others.values()) a.sort(newestFirst);
  GX = { first, own, others, feed, towns, together, mine, multi, days, visited: new Set(first.keys()) };
}
const idTime = id => { const m = /^[0-9a-z]{8}/.exec(String(id || '')), t = m ? parseInt(m[0], 36) : NaN; return t > 1.5e12 && t < Date.now() + 864e5 ? t : Infinity; };   // when a memo was first written (its id)
const deep = hex => { const v = parseInt(String(hex).slice(1), 16), f = c => Math.round(c * .6).toString(16).padStart(2, '0'); return '#' + f(v >> 16) + f(v >> 8 & 255) + f(v & 255); };
function townFill(k) {   // group map: the first one's colour; deeper where two or more went
  const u = GX.own.get(k); if (!u) return null;
  const c = GR.color(u), m = GX.first.get(k);
  return m && m.size > 1 ? deep(c) : c;
}
const withName = w => w.u === GR.me() ? 'あなた' : (GR.g && GR.g.members && GR.g.members[w.u] && GR.g.members[w.u].name) || w.n || '…';
const withText = n => !n.w ? '' : n.w.y ? (withName(n.w) === 'あなた' ? 'あなたと、いっしょに' : `${withName(n.w)}さんと、いっしょに`) : 'わたしも行った';
const mdy = d => { const [y, m, dd] = d.split('-'); return `${y === today().slice(0, 4) ? '' : y + '年'}${+m}月${+dd}日`; };
function withRow(n, by) {   // under a memo: who came along (いっしょ), and for others' memos: わたしも行った
  const row = el2('div', 'also');
  const ws = GR.showing() && GX.together.get(by + '_' + n.id);
  if (ws && ws.length) { row.appendChild(el2('span', 'wl', 'いっしょ')); ws.forEach(u => { const c = whoChip(u); if (u === GR.me()) c.lastChild.textContent = 'あなた'; row.appendChild(c); }); }
  if (by !== GR.me() && !n.w && GR.showing() && n.id) {
    const have = GX.mine.get(by + '_' + n.id), b = mkBtn(have ? 'わたしも行った ✓' : 'わたしも行った', 'pgo' + (have ? ' on' : ''), () => alsoWent(n));
    b.setAttribute('aria-pressed', have ? 'true' : 'false'); row.appendChild(b);
  }
  return row.childNodes.length ? row : null;
}
function alsoWent(n) {   // someone's memo: I was there too — that day with them, or another day
  const key = n.by + '_' + n.id, have = GX && GX.mine.get(key), mn = have && Store.notes.get(have), who = GR.name(n.by), place = placeName(n.k);
  const head = el2('p', '', `${who}さんの ${mdy(n.d)} のメモ（${place}）`);
  if (mn) return routeDlg('わたしも行った', [head, el2('p', '', mn.w && mn.w.y ? `${mdy(mn.d)}、${who}さんと、いっしょに行ったことになっています。` : `${mdy(mn.d)} に、わたしも行ったことになっています。`)],
    [['取り消す', 'btn ghost', () => { Store.delNote(have); closeRoute(); toast('取り消しました'); }], ['とじる', 'btn', closeRoute]]);
  const make = (d, y) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return toast('日付を選んでください');
    if (d > today()) return toast('まだ来ていない日です。今日までの日付を選んでください');
    const tag = GR.gtag();   // the group you are looking at
    Store.putNote({ id: newId(), k: n.k, d, ...(y && n.at ? { at: n.at } : {}), t: '', w: { u: n.by, i: n.id, n: who, ...(y ? { y: 1 } : {}) }, tags: tag ? [tag] : [] });
    closeRoute();
    toast(y ? `${who}さんと、いっしょに行ったことにしました` : `${mdy(d)} に、わたしも行ったことにしました`);
    if (townData && n.k[0] === 't' && townData.towns.some(t => t.k === n.k)) setTimeout(() => burst(n.k), 250);
  };
  const other = () => {
    const di = el2('input'); di.type = 'date'; di.max = today(); di.value = today(); di.setAttribute('aria-label', '行った日');
    const r = el2('div', 'rday'); r.append(el2('b', '', '行った日'), di);
    routeDlg('別の日に行った', [head, el2('p', '', 'いつ行きましたか？（だいたいでOK）'), r], [['のこす', 'btn', () => make(di.value, false)], ['もどる', 'btn ghost', () => alsoWent(n)]]);
  };
  routeDlg('わたしも行った', [head, el2('p', 'note', 'あなたの記録として、グループにも出ます。あとから取り消せます。')],
    [[`${mdy(n.d)}に、いっしょに行った`, 'btn', () => make(n.d, true)], ['別の日に行った', 'btn ghost', other], ['やめる', 'btn ghost', closeRoute]]);
}
const visK = k => GR.showing() ? GX.visited.has(k) : isV(k);
function whoChip(uid) {
  const s = document.createElement('span'); s.className = 'who';
  const i = document.createElement('i'); i.style.background = GR.color(uid);
  s.append(i, document.createTextNode(GR.name(uid)));
  return s;
}
function paintGroup() {
  const on = GR.on();
  $('#grp').hidden = !GR.anyOn();
  $('#t_group').hidden = !GR.anyOn();
  if (!on && dTab === 'group') dTab = 'walks';
  if (on) {
    const seg = $('#grp .gseg'); seg.querySelectorAll('.gv').forEach(b => b.remove());
    $('#gvMe').classList.toggle('on', !GR.showing());
    GR.live().forEach((G, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'gv' + (GR.showing() && GR.cur() === G ? ' on' : ''); b.textContent = G.g.name || 'みんな'; b.title = `「${G.g.name}」のみんなの地図`;
      if (i === 0) b.id = 'gvAll';
      b.onclick = () => { GR.view = G.gid; GR.saveView(); groupIndex(); paintGroup(); changed(); };
      seg.appendChild(b);
    });
    const lg = $('#gLegend'); lg.innerHTML = '';
    if (GR.showing()) {
      const me = GR.me(), memos = new Map();
      for (const n of GX.feed) memos.set(n.by, (memos.get(n.by) || 0) + 1);
      for (const n of Store.notes.values()) if (GR.isShared(n)) memos.set(me, (memos.get(me) || 0) + 1);
      GR.members().forEach(m => {
        const sp = document.createElement('span'), i = document.createElement('i'), b = document.createElement('b');
        i.style.background = GR.color(m.uid); b.textContent = `町${GX.towns.get(m.uid) || 0}・メモ${memos.get(m.uid) || 0}`;
        sp.title = `${m.name || ''}：歩いた町 ${GX.towns.get(m.uid) || 0}、共有したメモ ${memos.get(m.uid) || 0}`;
        sp.append(i, document.createTextNode(m.name || '…'), b); lg.appendChild(sp);
      });
      if (GX.multi) { const sp = el2('span', 'deep'); sp.title = '2人以上が歩いた町は、最初に行った人の色を濃くしています'; sp.append(el2('i'), document.createTextNode('濃い色＝2人以上')); lg.appendChild(sp); }
    }
  }
  grPaintBox(); paintShare();
}
function grPaintBox() {
  const box = $('#grBox'); if (!box) return;
  box.hidden = !FB.enabled();
  const st = $('#grState'), tabs = $('#grTabs'), gs = GR.groups();
  if (!FB.user) { st.textContent = 'Googleでログインすると、グループを作ったり、招待されたグループに参加したりできます。'; tabs.hidden = true; $('#grNew').hidden = true; $('#grIn').hidden = true; return; }
  const bx = !gs.length ? 'new' : GR.box === 'new' || GR.list.has(GR.box) ? GR.box : (GR.cur() || gs[0]).gid;   // which one is shown (a group still loading falls back to the current one)
  tabs.hidden = !gs.length; tabs.innerHTML = '';
  gs.forEach(G => tabs.appendChild(mkBtn(G.g ? G.g.name : '…', 'sc' + (bx === G.gid ? ' on' : ''), () => { GR.box = G.gid; grPaintBox(); })));
  if (gs.length && gs.length < GMAX) tabs.appendChild(mkBtn('＋ 新しく作る', 'sc' + (bx === 'new' ? ' on' : ''), () => { GR.box = 'new'; grPaintBox(); setTimeout(() => $('#grName').focus(), 50); }));
  const G = GR.list.get(bx);
  $('#grNew').hidden = bx !== 'new' || gs.length >= GMAX;
  $('#grIn').hidden = !G || !G.on();
  st.textContent = gs.length ? '参加中：' + gs.map(x => x.g ? `「${x.g.name}」${Object.keys(x.g.members || {}).length}人` : '読み込んでいます…').join('　') : (GR.msg ? GR.msg + '　' : '') + 'グループを作って招待リンクを送ると、みんなの歩いた町が1枚の地図に色分けで重なります。招待されたときは、そのリンクを開いてください。';
  if (!G || !G.on()) return;
  const me = GR.me(), owner = G.g.owner === me, ms = G.members();
  const list = $('#grMembers'); list.innerHTML = '';
  ms.forEach(m => {
    const row = document.createElement('div'); row.className = 'mem';
    const i = document.createElement('i'); i.style.background = G.color(m.uid);
    const n = document.createElement('span'); n.textContent = m.name || '…';
    row.append(i, n);
    if (m.uid === me) row.append(Object.assign(document.createElement('small'), { textContent: '自分' }));
    if (m.uid === G.g.owner) row.append(Object.assign(document.createElement('small'), { textContent: '作成者' }));
    row.append(Object.assign(document.createElement('em'), { textContent: GX && GR.cur() === G ? `町 ${GX.towns.get(m.uid) || 0}` : '' }));
    if (owner && m.uid !== me) {
      const b = mkBtn('外す', '', () => {
        if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = '本当に？'; setTimeout(() => { b.classList.remove('arm'); b.textContent = '外す'; }, 2500); return; }
        G.remove(m.uid).then(() => toast(`${m.name} さんを「${G.g.name}」から外しました`)).catch(() => toast('外せませんでした'));
      }, 'この人をグループから外す（その人の記録はその人の手元に残ります）');
      row.append(b);
    }
    list.appendChild(row);
  });
  const inp = $('#grMyName'); if (document.activeElement !== inp) inp.value = G.name(me);
  const gn = $('#grGName'); $('#grNameRow').hidden = !owner; if (document.activeElement !== gn) gn.value = G.g.name || '';
  $('#grWhat').textContent = `メモは基本「自分だけ」です。「${G.g.name}」に見えるのは、書くときの「共有」で「${G.g.name}」を選んだメモと、日のページの「この日を共有」で選んだ日（その日のメモと通った町）だけ。正確な位置と道の線は出ません。`;
}

let confirmPublic = false;
const confirm2 = () => confirmPublic;
