/* SANPO LOG — js/records.js
   記録 — memos, places and walks kept on this device (Store), the index built from them,
   and photos (kept only on this device, never sent anywhere).
   The files load in this order (see index.html): base → parts → records → sync → map → memo → screens → start.
   They share one scope: a name made in an earlier file can be used in any later one, but code that runs
   while the page loads may only use names from its own file and the earlier ones. */
'use strict';

/* ---------- records: places · notes · walks (+ tags) ----------
   place : { n: name, l: full label, ll:[lng,lat], v: visited flag, u }
   note  : { id, k: place key, d:'YYYY-MM-DD', at:'HH:MM', t: memo, x: detail, p:[photo urls], loc:[lat,lng,acc], s:{n,a,u} shop, tags:[], u }
   walk  : { d, title, sum, tags:[], u }   — one walk = one day, made from that day's notes
   Everything lives in one JSON object; a server can later store the same three tables. */
const LS = 'sanpo-log-v2', LS_OLD = 'sanpo-log-v1';
const FORMAT = 3;   // 記録の形の版。3 = お店（s）が入った形。README の「記録の形」に書いてある
const enc = s => Array.from(s).map(c => c.codePointAt(0).toString(36)).join('.').slice(0, 180);
const tKey = (mc, name) => 't' + mc + '_' + enc(name);
const okKey = k => /^(p\d{2}|m\d{5}|t\d{5}_[0-9a-z.]+)$/.test(k);
const normTag = s => String(s || '').normalize('NFKC').replace(/^[#＃]+/, '').replace(/\s+/g, '').toLowerCase().slice(0, 24);
const hashtags = s => [...String(s || '').normalize('NFKC').matchAll(/#([^\s#、。，,．.!！?？「」（）()\[\]]+)/g)].map(m => normTag(m[1])).filter(Boolean);
const uniq = a => [...new Set(a.filter(Boolean))];
function cleanPlace(r) {
  const o = { n: String(r.n || ''), l: String(r.l || ''), v: !!r.v, u: +r.u || 0 };
  if (Array.isArray(r.ll) && r.ll.length === 2 && r.ll.every(v => Number.isFinite(+v))) o.ll = r.ll.map(Number);
  return o;
}
function cleanNote(x) {
  const o = { id: String(x.id), k: String(x.k), d: /^\d{4}-\d{2}-\d{2}$/.test(x.d) ? x.d : today(), t: String(x.t || '') };
  if (x.at) o.at = String(x.at).slice(0, 5);
  if (x.x) o.x = String(x.x);
  const p = Array.isArray(x.p) ? x.p.map(String).filter(u => /^https?:\/\//.test(u)).slice(0, 12) : [];
  if (p.length) o.p = p;
  const im = Array.isArray(x.im) ? x.im.map(String).filter(v => /^t[a-z0-9]{6,40}$/.test(v)).slice(0, 8) : [];
  if (im.length) o.im = im;
  if (Array.isArray(x.loc) && x.loc.length >= 2 && x.loc.slice(0, 3).every(v => Number.isFinite(+v))) o.loc = x.loc.slice(0, 3).map(Number);
  const tags = uniq((Array.isArray(x.tags) ? x.tags : []).map(normTag));
  if (tags.length) o.tags = tags;
  if (x.s && typeof x.s === 'object') {   // お店: name, address, map link
    const sn = String(x.s.n || '').slice(0, 80), sa = String(x.s.a || '').slice(0, 160), su = String(x.s.u || '').slice(0, 800);
    if (sn || mapUrl(su)) o.s = { ...(sn ? { n: sn } : {}), ...(sa ? { a: sa } : {}), ...(mapUrl(su) ? { u: su } : {}) };
  }
  if (x.w && typeof x.w === 'object' && x.w.u && x.w.i) {   // わたしも行った: whose memo, and whether it was the same outing
    const wn = String(x.w.n || '').slice(0, 20);
    o.w = { u: String(x.w.u).slice(0, 64), i: String(x.w.i).slice(0, 40), ...(wn ? { n: wn } : {}), ...(x.w.y ? { y: 1 } : {}) };
  }
  o.u = +x.u || Date.now();
  return o;
}
function cleanWalk(w) {
  const o = { d: w.d, title: String(w.title || '').slice(0, 80), sum: String(w.sum || ''), tags: uniq((Array.isArray(w.tags) ? w.tags : []).map(normTag)), u: +w.u || Date.now() };
  // 道のり: encoded line pieces joined by spaces (≈1–3KB a walk), distance, first/last time, towns passed
  if (typeof w.trk === 'string' && w.trk.length < 300000 && /^[\x3f-\x7e]+( [\x3f-\x7e]+)*$/.test(w.trk.trim())) {
    o.trk = w.trk.trim();
    if (+w.km > 0) o.km = Math.round(+w.km * 100) / 100;
    if (/^\d{2}:\d{2}$/.test(w.t0 || '')) o.t0 = w.t0;
    if (/^\d{2}:\d{2}$/.test(w.t1 || '')) o.t1 = w.t1;
  }
  if (Array.isArray(w.tw)) { const tw = w.tw.map(String).filter(k => /^[tmp]\d{2,}/.test(k)).slice(0, 400); if (tw.length) o.tw = tw; }
  return o;
}
const Store = {
  places: new Map(), notes: new Map(), walks: new Map(), deleted: new Map(), ready: true,   // deleted: 'n:<id>' / 'w:<date>' -> time
  init() {
    try {
      const o = JSON.parse(localStorage.getItem(LS) || 'null');
      if (o) this.absorb(o);
      else {
        const old = JSON.parse(localStorage.getItem(LS_OLD) || 'null');   // earlier version: migrate once, keep the old copy
        if (old && old.r) { this.absorb(old); this.save(); }
      }
    } catch (e) {}
    reindex();
  },
  dump() {   // canonical order, so the same records always serialize to the same text
    const sorted = m => Object.fromEntries([...m.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return { app: 'sanpo-log', v: FORMAT, places: sorted(this.places), notes: sorted(this.notes), walks: sorted(this.walks), deleted: sorted(this.deleted) };
  },
  save() { try { localStorage.setItem(LS, JSON.stringify(this.dump())); } catch (e) { toast('保存できませんでした（ブラウザの容量がいっぱいかもしれません）'); } },
  commit() { this.save(); reindex(); changed(); if (GR.anyOn()) GR.refresh(); Sync.soon(); FB.soon(); GR.soon(); },
  /* import / migrate — v1 {r:{key:{n,l,ll,v,e:[]}}}, v2/v3 {places,notes,walks,deleted}; the newer copy of each item wins.
     A record from a newer app (v > FORMAT) is still read: unknown fields are dropped, nothing is lost that this version knows. */
  absorb(o) {
    let n = 0;
    if (+o.v > FORMAT) this.newer = true;
    const newer = (a, b) => !a || (+b.u || 0) > (+a.u || 0);
    if (o.r && typeof o.r === 'object') for (const k in o.r) {
      const r = o.r[k]; if (!okKey(k) || !r || typeof r !== 'object') continue;
      const pl = cleanPlace(r); if (newer(this.places.get(k), pl)) this.places.set(k, pl);
      for (const e of (Array.isArray(r.e) ? r.e : [])) {
        if (!e || !e.id) continue;
        const nt = cleanNote({ ...e, k, tags: hashtags((e.t || '') + ' ' + (e.x || '')) });
        if (newer(this.notes.get(nt.id), nt)) { this.notes.set(nt.id, nt); n++; }
      }
    }
    for (const k in (o.places || {})) { if (!okKey(k) || !o.places[k]) continue; const pl = cleanPlace(o.places[k]); if (newer(this.places.get(k), pl)) this.places.set(k, pl); }
    for (const id in (o.notes || {})) { const x = o.notes[id]; if (!x || !x.id || !okKey(String(x.k))) continue; const nt = cleanNote(x); if (newer(this.notes.get(nt.id), nt)) { this.notes.set(nt.id, nt); n++; } }
    for (const d in (o.walks || {})) { if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !o.walks[d]) continue; const w = cleanWalk({ ...o.walks[d], d }); if (newer(this.walks.get(d), w)) this.walks.set(d, w); }
    // deletions travel too, so a memo deleted on one device does not come back from another
    for (const key in (o.deleted || {})) { const u = +o.deleted[key] || 0; if (/^[nw]:/.test(key) && u > (this.deleted.get(key) || 0)) this.deleted.set(key, u); }
    for (const [key, u] of this.deleted) {
      const id = key.slice(2), m = key[0] === 'n' ? this.notes : this.walks, x = m.get(id);
      if (x && (+x.u || 0) <= u) { m.delete(id); if (key[0] === 'n') n = Math.max(0, n - 1); }
    }
    return n;
  },
  place(k) { return this.places.get(k); },
  ensurePlace(k) {   // cache name/label so lists work without loading that area's map data
    const cur = this.places.get(k), info = placeInfo(k);
    if (!info) return cur;
    const pl = { v: false, u: 0, ...(cur || {}), n: info.n, l: info.l, ll: info.ll.map(v => Math.round(v * 1e5) / 1e5) };
    this.places.set(k, pl); return pl;
  },
  setVisited(k, v) { const pl = this.ensurePlace(k) || cleanPlace({}); this.places.set(k, { ...pl, v: !!v, u: Date.now() }); this.commit(); },
  setVisitedMany(keys) { for (const k of keys) { const pl = this.ensurePlace(k); if (pl && !pl.v) this.places.set(k, { ...pl, v: true, u: Date.now() }); } this.commit(); },
  putNote(n) { this.ensurePlace(n.k); this.notes.set(n.id, cleanNote({ ...n, u: Date.now() })); this.commit(); },
  delNote(id) { this.notes.delete(id); this.deleted.set('n:' + id, Date.now()); this.commit(); },
  putWalk(d, w) {
    const c = cleanWalk({ ...(this.walks.get(d) || {}), ...w, d, u: Date.now() });
    if (!c.title && !c.sum && !c.tags.length && !c.trk) { if (this.walks.delete(d)) this.deleted.set('w:' + d, Date.now()); } else this.walks.set(d, c);
    this.commit();
  },
  renameTag(from, to) {   // to = '' deletes the tag; renaming onto an existing tag merges them
    to = normTag(to);
    const fix = tags => uniq((tags || []).map(t => t === from ? to : t));
    for (const [id, n] of this.notes) if ((n.tags || []).includes(from)) this.notes.set(id, cleanNote({ ...n, tags: fix(n.tags), u: Date.now() }));
    for (const [d, w] of this.walks) if ((w.tags || []).includes(from)) this.walks.set(d, cleanWalk({ ...w, tags: fix(w.tags), u: Date.now() }));
    this.commit();
  }
};

/* ---------- index (rebuilt on every change; cheap) ---------- */
let IX = { byPlace: new Map(), byDate: new Map(), tagN: new Map(), visited: new Set(), raw: 0 };
const byTime = (a, b) => (a.at || '') < (b.at || '') ? -1 : (a.at || '') > (b.at || '') ? 1 : 0;
const newestFirst = (a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : -byTime(a, b);
function reindex() {
  const byPlace = new Map(), byDate = new Map(), tagN = new Map(), visited = new Set();
  const push = (m, k, v) => { const a = m.get(k); a ? a.push(v) : m.set(k, [v]); };
  let raw = 0;
  for (const n of Store.notes.values()) {
    push(byPlace, n.k, n); push(byDate, n.d, n); visited.add(n.k);
    if (!n.x) raw++;
    for (const t of n.tags || []) tagN.set(t, (tagN.get(t) || 0) + 1);
  }
  for (const [k, p] of Store.places) if (p.v) visited.add(k);
  for (const w of Store.walks.values()) for (const t of w.tags || []) tagN.set(t, (tagN.get(t) || 0) + 1);
  for (const a of byDate.values()) a.sort(byTime);
  for (const a of byPlace.values()) a.sort(newestFirst);
  IX = { byPlace, byDate, tagN, visited, raw };
}
const isV = k => IX.visited.has(k);
const within = (parent, k) => k !== parent && (parent[0] === 'p' ? k.slice(1, 3) === parent.slice(1) : parent[0] === 'm' ? k[0] === 't' && k.slice(1, 6) === parent.slice(1) : false);
function placeInfo(k) {
  const pc = k.slice(1, 3), P = D.prefInfo[pc];
  if (!P) return null;
  if (k[0] === 'p') { const f = D.japanFeats && D.japanFeats.find(f => f.c === pc); return f ? { n: P.n, l: P.n, ll: unproj(f.lp[0], f.lp[1], pc === '47') } : null; }
  const mc = k.slice(1, 6), M = D.muni[mc];
  if (!M) return null;
  if (k[0] === 'm') return { n: M.n, l: `${P.n} ${M.n}`, ll: unproj(M.lp[0], M.lp[1], pc === '47') };
  const t = (D.towns[mc] || []).find(t => t.k === k);
  return t ? { n: t.n, l: `${P.n} ${M.n} ${t.n}`, ll: t.ll } : null;
}
const placeName = k => ((Store.place(k) || {}).n) || ((placeInfo(k) || {}).n) || '';
const placeLabel = k => ((Store.place(k) || {}).l) || ((placeInfo(k) || {}).l) || '';
function ancestors(k) {
  const pc = k.slice(1, 3);
  if (k[0] === 'p') return [k];
  return k[0] === 'm' ? [k, 'p' + pc] : [k, 'm' + k.slice(1, 6), 'p' + pc];
}
const STARTER = ['神社', '寺', '公園', '坂', '川', '商店街', 'カフェ', '路地', '紅葉', '桜', '海', '夜景'];
function tagSuggestions(q) {
  const used = [...IX.tagN.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const all = uniq([...GR.live().map(G => G.gtag()), ...used, ...STARTER.filter(s => !IX.tagN.has(s))]);   // the group tags first
  return q ? all.filter(t => t.includes(q)) : all;
}


/* ---------- photos: kept only in this browser (IndexedDB) — never sent to the cloud or the group.
   Each has a sharp copy (d, about 800px) and a small one (s, about 240px) for lists. ---------- */
const idbReq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const Thumbs = {
  db: null, mem: new Map(), memS: new Map(), moving: false,
  open() {
    if (!this.db) this.db = new Promise((res, rej) => { const r = indexedDB.open('sanpo-thumbs', 1); r.onupgradeneeded = () => r.result.createObjectStore('t'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return this.db;
  },
  async os(mode) { return (await this.open()).transaction('t', mode || 'readonly').objectStore('t'); },
  newId: () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
  async src(x) {
    if (!x) return null;
    if (/^data:image\//.test(x)) return x;
    if (this.mem.has(x)) return this.mem.get(x);
    try { const v = await idbReq((await this.os()).get(x)); if (v && v.d) { this.mem.set(x, v.d); if (v.s) this.memS.set(x, v.s); return v.d; } } catch (e) {}
    return null;   // not on this device (photos are not copied between devices)
  },
  async small(x) {
    if (!x) return null;
    if (/^data:image\//.test(x)) return x;
    if (this.memS.has(x)) return this.memS.get(x);
    const d = await this.src(x); if (!d) return null;
    if (this.memS.has(x)) return this.memS.get(x);
    let s = d;
    if (d.length > 20000) {   // a sharp one without its small copy (read from a backup): make it once
      try { s = await shrinkPhoto(d, 240, 15000); } catch (e) { return null; }
      try { const o = await this.os('readwrite'), v = await idbReq(o.get(x)); if (v) await idbReq((await this.os('readwrite')).put({ ...v, s }, x)); } catch (e) {}
    }
    this.memS.set(x, s);
    return s;
  },
  async put(id, d, up, s) {
    this.mem.set(id, d); if (s) this.memS.set(id, s);
    try { await idbReq((await this.os('readwrite')).put(s ? { d, s } : { d }, id)); } catch (e) {}
  },
  async del(ids) {
    for (const id of ids || []) {
      this.mem.delete(id); this.memS.delete(id);
      try { await idbReq((await this.os('readwrite')).delete(id)); } catch (e) {}
    }
  },
  async count() { try { return await idbReq((await this.os()).count()); } catch (e) { return 0; } },
  async keys() { try { return await idbReq((await this.os()).getAllKeys()); } catch (e) { return []; } },
  async entries() {
    try { const o = await this.os(), kq = o.getAllKeys(), vq = o.getAll(); const ks = await idbReq(kq), vs = await idbReq(vq); return ks.map((k, i) => [k, vs[i] || {}]); } catch (e) { return []; }
  },
  async all() { const out = {}; for (const [k, v] of await this.entries()) if (v.d) out[k] = v.d; return out; },
  // until 2.3.1 photos were also copied to your cloud space: bring them down to this device, then remove them there.
  // A cloud copy is removed only after it is safely stored here.
  async migrate() {
    if (!FB.user || !FB.sdk || !FB.sdk.getDocs || this.moving) return;
    const s = FB.sdk, uid = FB.user.uid;
    try { if (localStorage.getItem('sanpo-thumbs-moved') === uid) return; } catch (e) {}
    this.moving = true;
    let got = 0, left = 0;
    try {
      const snap = await s.getDocs(s.collection(FB.db, 'users', uid, 'thumbs'));
      for (const doc of snap.docs) {
        const o = doc.data() || {}, id = doc.id;
        let have = null; try { have = await idbReq((await this.os()).get(id)); } catch (e) {}
        if ((!have || !have.d) && /^t[a-z0-9]{6,40}$/.test(id) && /^data:image\//.test(o.d || '')) {
          await this.put(id, o.d, true, /^data:image\//.test(o.s || '') ? o.s : null);
          let back = null; try { back = await idbReq((await this.os()).get(id)); } catch (e) {}
          if (!back || back.d !== o.d) { left++; continue; }
          got++;
        }
        await s.deleteDoc(doc.ref);
      }
      if (!left) try { localStorage.setItem('sanpo-thumbs-moved', uid); } catch (e) {}
      if (got) { toast(`クラウドにあった写真 ${got} 枚を、この端末に移しました`, 3600); refreshPanels(); }
    } catch (e) {} finally { this.moving = false; }
  }
};
// a photo from the phone becomes two copies: about 800px (60–120KB, sharp even on a full screen) and
// about 240px (8–15KB, for lists and the group). Drawing it again also drops the GPS data inside the file.
function drawJpeg(src, max, cap) {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height);
  let q = max > 400 ? .82 : .74, d = c.toDataURL('image/jpeg', q);
  while (d.length > cap && q > .4) { q -= .08; d = c.toDataURL('image/jpeg', q); }
  return d;
}
const loadImg = u => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = u; });
async function makeThumb(file) {
  let src;
  try { src = await createImageBitmap(file); }
  catch (e) { src = await loadImg(URL.createObjectURL(file)); }
  return { d: drawJpeg(src, 800, 160000), s: drawJpeg(src, 240, 15000) };
}
async function shrinkPhoto(d, max, cap) { return drawJpeg(await loadImg(d), max, cap); }
function pickPhotos(max, done) {   // must start inside a tap
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true; inp.hidden = true;
  document.body.appendChild(inp);
  inp.onchange = async () => {
    const fs = [...inp.files].slice(0, Math.max(1, max)); inp.remove();
    if (!fs.length) return;
    toast('写真を、のこす大きさにしています…');
    const out = []; for (const f of fs) { try { out.push(await makeThumb(f)); } catch (e) {} }
    out.length ? done(out) : toast('この写真は読み込めませんでした');
  };
  inp.click();
}
