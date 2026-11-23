/* SANPO LOG — js/memo.js
   メモ — choosing a place and its sheet, writing and fixing a memo (photos, links, date, place, 共有),
   おかえり after a walk, お店 from Google Maps.
   The files load in this order (see index.html): base → parts → records → sync → map → memo → screens → start.
   They share one scope: a name made in an earlier file can be used in any later one, but code that runs
   while the page loads may only use names from its own file and the earlier ones. */
'use strict';

/* ---------- selection + memo sheet ---------- */
let pendingSel = null;
function select(sel) {
  S.sel = sel;
  if (!sel) { $('#selp').removeAttribute('d'); return; }
}
function selectTown(i, fly) {
  const t = townData.towns[i];
  S.sel = { lv: 't', key: t.k, mc: townData.mc, i };
  $('#selp').setAttribute('d', townNodes[i].getAttribute('d'));
  openSheet();
  if (!fly && W < 720) {
    const [x, y] = t.pts[0], [, sy] = toScreen(x, y), band = H * (1 - (SHEET.small.sheet ? .45 : .8));
    if (sy > band - 20 || sy < 70) flyTo({ cx: x, cy: y + liftPx('sheet') * V.s, s: V.s }, 620);
  }
  if (fly) {
    const b = t.bb, cur = V.s;
    const T = fitView([b[0] - (b[2] - b[0]), b[1] - (b[3] - b[1]), b[2] + (b[2] - b[0]), b[3] + (b[3] - b[1])]);
    if (T.s > cur) T.s = cur;
    if (W >= 720) T.cx += 210 * T.s; else T.cy = (b[1] + b[3]) / 2 + liftPx('sheet') * T.s;
    flyTo(T, 700);
  }
}
function selectByKey(k) {
  if (k[0] === 't' && townData) { const i = townData.towns.findIndex(t => t.k === k); if (i >= 0) return selectTown(i, true); }
  if (k[0] === 'm' || k[0] === 'p') { S.sel = { lv: k[0], key: k, mc: k[0] === 'm' ? k.slice(1) : undefined }; $('#selp').removeAttribute('d'); openSheet(); }
}
function currentAreaSel() {
  S.sel = S.level === 'pref' ? { lv: 'p', key: 'p' + S.pc } : { lv: 'm', key: 'm' + S.mc, mc: S.mc };
  $('#selp').removeAttribute('d');
  openSheet();
}
function selInfo() {
  const s = S.sel, info = placeInfo(s.key) || { n: placeName(s.key), l: placeLabel(s.key), ll: [0, 0] };
  const pc = s.key.slice(1, 3);
  if (s.lv === 't') {
    const f = GR.showing() && GX.first.get(s.key);
    const who = f ? [...f.entries()].sort((a, b) => a[1][0] < b[1][0] ? -1 : a[1][0] > b[1][0] ? 1 : a[1][1] - b[1][1]).map(([u, [d]]) => [u, d]) : null;
    const stat = who ? 'ここを歩いた人　' + who.map(([u, d]) => `${GR.name(u)} ${mdy(d)}`).join('　') : '';
    return { eyebrow: `${D.prefInfo[pc].n} ${D.muni[s.mc].n}`, ...info, stat, who };
  }
  if (s.lv === 'm') {
    const mc = s.key.slice(1), a = AG.muni.get(mc), T = (D.pref[pc] && D.pref[pc].T[mc]) || 0;
    return { eyebrow: D.prefInfo[pc].n, ...info, stat: T ? `歩いた町 ${a ? a.towns : 0} / ${T}` : '' };
  }
  const a = AG.pref.get(pc), P = D.prefInfo[pc];
  return { eyebrow: '日本', ...info, stat: `歩いた市区町村 ${a ? a.munis.size : 0} / ${P.m}　町 ${a ? a.towns : 0} / ${P.t.toLocaleString('en')}` };
}
function paintStat(info) {
  const el = $('#sStat'); el.textContent = '';
  if (!info.who) { el.textContent = info.stat; return; }
  el.appendChild(el2('span', 'wl', 'ここを歩いた人'));
  for (const [u, d] of info.who) { const c = whoChip(u); if (u === GR.me()) c.lastChild.textContent = 'あなた'; c.appendChild(el2('span', 'wd', mdy(d))); el.appendChild(c); }
}
const fmtLL = ll => `${Math.abs(ll[1]).toFixed(4)}°${ll[1] >= 0 ? 'N' : 'S'}  ${ll[0].toFixed(4)}°E`;
const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const fmtDay = d => { const [y, m, dd] = d.split('-'); return `${y === today().slice(0, 4) ? '' : y + '年'}${+m}月${+dd}日（${'日月火水木金土'[new Date(d + 'T12:00:00').getDay()]}）`; };
function openSheet() {
  if (!S.sel) return;
  Pane.before('sheet');
  const info = selInfo();
  $('#sEyebrow').textContent = info.eyebrow;
  $('#sName').textContent = info.n;
  $('#sCoord').textContent = fmtLL(info.ll);
  paintStat(info);
  editing = null;
  renderEntries();
  buildScope();
  if (!$('#fDate').value) $('#fDate').value = today();
  fTags.set([]);
  setFormLoc(quickNext);
  if (formShop && formShop.k !== S.sel.key && !(pendingShop && pendingShop.k === S.sel.key)) {
    if (formShop.sure) { setFormShop(null); toast('町が変わったので、お店ははずしました'); }
    else { formShop.k = S.sel.key; fShop.show(formShop, formShop.k); paintWhere(); }
  }
  paintShare();
  const has = hasMemosHere();
  $('#sForm').classList.toggle('canfold', has);
  $('#sForm').classList.toggle('collapsed', has && !quickNext);
  paintWbar();
  if (quickNext) setTimeout(() => $('#fText').focus(), 350);
  quickNext = null;
  $('#sheet').classList.add('open'); document.body.classList.add('sheet-open');
  Pane.after('sheet');
  if (Pane.scrollTo != null) { const y = Pane.scrollTo; Pane.scrollTo = null; setTimeout(() => { $('#sheet .pbody').scrollTop = y; }, 30); }
  shopAfterOpen();
}

/* where a new memo goes: this town, its city, or its prefecture (and, maybe, which shop) */
let formKey = null, formShop = null, pendingShop = null;
function scopeChips(box, keys, cur, onPick) {
  box.innerHTML = '';
  const lab = document.createElement('span'); lab.textContent = '場所'; box.appendChild(lab);
  keys.forEach(k => {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'sc' + (k === cur ? ' on' : '');
    b.textContent = placeName(k) || k;
    b.onclick = () => { box.querySelectorAll('.sc').forEach(x => x.classList.toggle('on', x === b)); onPick(k); };
    box.appendChild(b);
  });
}
function buildScope() {
  formKey = S.sel.key;
  scopeChips($('#fScope'), ancestors(S.sel.key), formKey, k => { formKey = k; paintWhere(); });
  $('#fWhereBox').classList.remove('open'); $('#fPhotoBox').classList.remove('open'); paintWhere(); paintPick();
}
function paintWhere() {   // 場所：稲村ガ崎四丁目 ▾ — where this memo goes (and whether it has your position)
  const b = $('#fWhere'); if (!b || !formKey) return;
  b.textContent = `場所：${formShop ? (formShop.n || 'お店') + '・' : ''}${placeName(formKey) || ''}${formLoc && !formShop ? '・位置あり' : ''} ▾`;
  b.classList.toggle('on', !!formShop);
  b.setAttribute('aria-expanded', $('#fWhereBox').classList.contains('open') ? 'true' : 'false');
}
$('#fWhere').onclick = () => { $('#fWhereBox').classList.toggle('open'); $('#fPhotoBox').classList.remove('open'); paintWhere(); paintPick(); };   // one box at a time
// the photos on this memo: each as the same mark a memo shows (写真 ▸ IG), with × to take it off
function paintLinks(fresh) {
  const row = $('#fLinksRow'), ls = parseLinks($('#fLinks').value);
  row.querySelectorAll('.lkc').forEach(x => x.remove());
  ls.forEach(u => {
    const w = document.createElement('span'); w.className = 'lkc' + (u === fresh ? ' new' : '');
    w.appendChild(chips([u]));
    w.appendChild(mkBtn('×', 'lkx', () => { $('#fLinks').value = parseLinks($('#fLinks').value).filter(x => x !== u).join(' '); paintLinks(); }, 'この写真をはずす'));
    row.appendChild(w);
  });
  row.hidden = !ls.length; paintPick();
}
function paintPick() {   // 写真 ▾ → 写真 2 ▾ once something is on
  const b = $('#fPick'); if (!b) return;
  const n = (typeof formThumbs === 'undefined' ? 0 : formThumbs.length) + parseLinks($('#fLinks').value).length, open = $('#fPhotoBox').classList.contains('open');
  b.textContent = '写真' + (n ? ' ' + n : '') + ' ▾';
  b.setAttribute('aria-expanded', open ? 'true' : 'false'); b.classList.toggle('on', n > 0);
}

const fTags = tagInput($('#fTags'), []);

/* ---------- 写真をまとめて: pick the day's photos; each goes to the memo nearest to when (and where) it was taken ---------- */
// the time, and the place if the photo picker was asked to keep it, that the camera wrote inside a JPEG
function exifRead(b, t0, out) {
  const le = b.getUint16(t0) === 0x4949, u16 = o => b.getUint16(t0 + o, le), u32 = o => b.getUint32(t0 + o, le);
  const ifd = o => { const n = u16(o), m = new Map(); for (let i = 0; i < n && i < 400; i++) { const e = o + 2 + i * 12; m.set(u16(e), { cnt: u32(e + 4), at: e + 8 }); } return m; };
  const str = e => { const at = e.cnt > 4 ? u32(e.at) : e.at; let s = ''; for (let i = 0; i < e.cnt - 1 && i < 40; i++) s += String.fromCharCode(b.getUint8(t0 + at + i)); return s; };
  const rat = (e, i) => { const at = u32(e.at) + i * 8; return u32(at) / (u32(at + 4) || 1); };
  const i0 = ifd(u32(4));
  const ex = i0.has(0x8769) ? ifd(u32(i0.get(0x8769).at)) : new Map();
  const dt = ex.get(0x9003) || ex.get(0x9004) || i0.get(0x0132);
  if (dt) { const m = str(dt).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/); if (m && +m[1] > 1990) out.t = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`; }
  if (i0.has(0x8825)) {
    const g = ifd(u32(i0.get(0x8825).at)), deg = k => { const e = g.get(k); return e && e.cnt >= 3 ? rat(e, 0) + rat(e, 1) / 60 + rat(e, 2) / 3600 : null; };
    let lat = deg(2), lng = deg(4);
    if (lat != null && lng != null && (lat || lng)) {
      if (g.has(1) && str(g.get(1))[0] === 'S') lat = -lat;
      if (g.has(3) && str(g.get(3))[0] === 'W') lng = -lng;
      out.ll = [lat, lng];
    }
  }
}
async function photoMeta(file) {
  const out = { t: null, ll: null };
  try {
    const b = new DataView(await file.slice(0, 262144).arrayBuffer());
    if (b.getUint16(0) === 0xFFD8) for (let p = 2; p + 10 < b.byteLength;) {
      const mk = b.getUint16(p), len = b.getUint16(p + 2);
      if (mk === 0xFFE1 && b.getUint32(p + 4) === 0x45786966) { exifRead(b, p + 10, out); break; }
      if ((mk & 0xFF00) !== 0xFF00 || mk === 0xFFDA) break;
      p += 2 + len;
    }
  } catch (e) {}
  if (!out.t) { const m = String(file.name || '').match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})[ _T-]?(\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/); if (m && +m[2] <= 12 && +m[3] <= 31 && +m[4] < 24) out.t = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`; }
  return out;
}
const hmMin = s => /^\d{2}:\d{2}/.test(s || '') ? +s.slice(0, 2) * 60 + +s.slice(3, 5) : null;
function photoHome(x) {   // the memo this photo most likely belongs to: the same day, the nearest time, the same town counts extra
  if (!x.t) return null;
  const d = x.t.slice(0, 10), pm = hmMin(x.t.slice(11));
  let best = null, bs = Infinity;
  for (const n of Store.notes.values()) {
    if (n.d !== d || (n.im || []).length >= 8) continue;
    const nm = hmMin(n.at), here = !!x.k && (n.k === x.k || within(n.k, x.k));
    const gap = nm == null ? 150 : Math.abs(nm - pm);
    if (gap > 180 && !here) continue;
    const sc = gap - (here ? 60 : 0);
    if (sc < bs) { bs = sc; best = n; }
  }
  return best;
}
function pickBulk(onDone) {   // must start inside a tap
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true; inp.hidden = true;
  document.body.appendChild(inp);
  inp.onchange = async () => {
    const all = [...inp.files], fs = all.slice(0, 40); inp.remove();
    if (!fs.length) return;
    const ph = [];
    for (let i = 0; i < fs.length; i++) {
      toast(`写真を読んでいます… ${i + 1} / ${fs.length}`, 8000);
      try { const [m, th] = await Promise.all([photoMeta(fs[i]), makeThumb(fs[i])]); ph.push({ ...m, ...th }); } catch (e) {}
    }
    if (!ph.length) return toast('写真を読み込めませんでした');
    if (ph.some(x => x.ll)) toast('撮った場所を調べています…', 8000);
    for (const x of ph) if (x.ll) { try { x.k = (await townsPassed([[[x.ll[0], x.ll[1]]]]))[0] || null; } catch (e) {} }
    clearTimeout(toastT); $('#toast').classList.remove('show');
    bulkDlg(ph, all.length - fs.length, onDone);
  };
  inp.click();
}
function bulkDlg(ph, over, onDone) {
  ph.sort((a, b) => (a.t || '9999') < (b.t || '9999') ? -1 : (a.t || '9999') > (b.t || '9999') ? 1 : 0);   // unknown times last
  const rows = [], list = el2('div', 'bulk');
  const recent = [...Store.notes.values()].sort(newestFirst).slice(0, 20);
  for (const x of ph) {
    const r = el2('div', 'brow'), im = new Image(); im.src = x.s; im.alt = ''; r.appendChild(im);
    const info = el2('div', 'bi'), day = x.t ? x.t.slice(0, 10) : null, sel = el2('select');
    info.appendChild(el2('b', '', x.t ? `${x.t.slice(5, 10).replace('-', '/')}  ${x.t.slice(11, 16)}` : '撮った時刻：不明'));
    const ns = day ? [...Store.notes.values()].filter(n => n.d === day).sort((a, b) => (a.at || '').localeCompare(b.at || '')) : recent;
    const opt = (v, t) => { const o = el2('option', '', t); o.value = v; sel.appendChild(o); };
    for (const n of ns) opt('n:' + n.id, `${day ? '' : n.d.slice(5).replace('-', '/') + ' '}${n.at || '--:--'}  ${placeName(n.k)}${n.t ? '・' + n.t.slice(0, 16) : ''}${(n.im || []).length >= 8 ? '（写真いっぱい）' : ''}`);
    if (x.k) opt('new:' + x.k, `＋ 新しいメモ（${placeName(x.k)}）`);
    opt('', 'のこさない');
    const home = photoHome(x);
    sel.value = home ? 'n:' + home.id : x.k ? 'new:' + x.k : '';
    info.appendChild(sel);
    if (!home && !x.k) info.appendChild(el2('small', '', x.t ? 'この時刻の近くに、メモがありません' : '撮った時刻が分からない写真です。メモをえらんでください'));
    r.appendChild(info); list.appendChild(r); rows.push([x, sel, r]);
  }
  const count = () => rows.filter(([, sel]) => sel.value).length;
  const paint = () => { rows.forEach(([, sel, r]) => r.classList.toggle('off', !sel.value)); const b = $('#rtActs').firstChild; if (b) { b.textContent = `のこす（${count()} 枚）`; b.disabled = !count(); } };
  rows.forEach(([, sel]) => sel.onchange = paint);
  const go = async () => {
    closeRoute();
    const toNote = new Map(), toNew = new Map(); let saved = 0, full = 0;
    const push = (m, key, x) => { const a = m.get(key); a ? a.push(x) : m.set(key, [x]); };
    for (const [x, sel] of rows) {
      const v = sel.value; if (!v) continue;
      if (v.startsWith('n:')) push(toNote, v.slice(2), x);
      else push(toNew, v.slice(4) + '|' + (x.t ? x.t.slice(0, 10) : today()), x);
    }
    for (const [id, xs] of toNote) {
      const n = Store.notes.get(id); if (!n) { full += xs.length; continue; }
      const use = xs.slice(0, Math.max(0, 8 - (n.im || []).length)); full += xs.length - use.length;
      if (!use.length) continue;
      const ids = await saveThumbs(use), cur = Store.notes.get(id);
      Store.putNote({ ...cur, im: [...(cur.im || []), ...ids] }); saved += ids.length;
    }
    for (const [key, xs] of toNew) {   // one new memo per town and day (8 photos each)
      const [k, d] = key.split('|');
      for (let i = 0; i < xs.length; i += 8) {
        const part = xs.slice(i, i + 8), f = part[0], ids = await saveThumbs(part);
        Store.putNote({ id: newId(), k, d, at: f.t ? f.t.slice(11, 16) : '', t: '', im: ids, ...(f.ll ? { loc: [+f.ll[0].toFixed(6), +f.ll[1].toFixed(6)] } : {}) });
        saved += ids.length;
      }
    }
    toast(`写真 ${saved} 枚を、メモにのこしました` + (full ? `（${full} 枚は、メモがいっぱいでした。1つのメモに8枚まで）` : ''), 3600);
    if (onDone) onDone();
  };
  routeDlg('写真を、メモへ', [
    `${ph.length} 枚。撮った時刻で、近いメモに分けました。ちがっていたら、えらびなおしてください。`,
    over ? el2('p', '', `一度に入れられるのは40枚までです（のこりの ${over} 枚は、もう一度どうぞ）。`) : null,
    list,
    el2('p', '', '写真は、この端末の中だけに置きます。写真に入っていた場所の情報は、分けるのに使ったら消します。')
  ], [['のこす', 'btn', go], ['やめる', 'btn ghost', () => { closeRoute(); if (onDone) onDone(); }]]);
  paint();
}
// the towns of a day, and the ones walked for the very first time that day
function dayTowns(d) {
  const set = new Set(); for (const n of IX.byDate.get(d) || []) if (n.k[0] === 't') set.add(n.k);
  const w = Store.walks.get(d); for (const k of (w && w.tw) || []) set.add(k);
  return [...set];
}
function firstDays() {
  const m = new Map(), put = (k, d) => { if (k[0] !== 't') return; const p = m.get(k); if (!p || d < p) m.set(k, d); };
  for (const n of Store.notes.values()) put(n.k, n.d);
  for (const [d, w] of Store.walks) for (const k of w.tw || []) put(k, d);
  return m;
}
let welcomeDay = null;
function okaeri(d, nm) {   // おかえり: the day's own page, with a welcome on top; the new towns light up one by one
  d = d || today();
  welcomeDay = d;
  try { localStorage.setItem('sanpo-okaeri', d); } catch (e) {}
  $('#okPill').hidden = true;
  photoInfo();   // so バックアップする is ready inside the tap
  openWalk(d);
  const fd = firstDays(), fresh = dayTowns(d).filter(k => fd.get(k) === d);
  fresh.slice(0, 12).forEach((k, i) => setTimeout(() => burst(k), 700 + i * 380));
  if (nm) setTimeout(() => shopAddDlg(d, nm), 500);   // came back from the map app with a shop
}
function okaeriPill() {   // in the evening of a day with something written: a quiet way in
  let seen = ''; try { seen = localStorage.getItem('sanpo-okaeri') || ''; } catch (e) {}
  const d = today(), has = (IX.byDate.get(d) || []).length || ((Store.walks.get(d) || {}).trk);
  $('#okPill').hidden = !(has && new Date().getHours() >= 16 && seen !== d && !Rec.st && !document.body.classList.contains('first'));
}
$('#okPill').onclick = () => okaeri(today());
document.addEventListener('visibilitychange', () => { if (!document.hidden) okaeriPill(); });
setTimeout(okaeriPill, 2500);
async function saveThumbs(ds) { const ids = []; for (const o of ds) { const id = Thumbs.newId(); await Thumbs.put(id, o.d || o, false, o.s); ids.push(id); } return ids; }
function tagChips(tags) {
  const f = document.createDocumentFragment();
  const gt = GR.allTags(), gc = GR.anyOn() ? (GR.cur() || GR.live()[0]).color(GR.me()) : null;
  (tags || []).forEach(t => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'htag'; b.textContent = '#' + t; b.onclick = () => openTag(t);
    if (gt.includes(t)) { b.classList.add('shared'); b.title = 'グループに共有中'; }
    f.appendChild(b);
  });
  return f;
}
const fmtLoc = l => `${l[0].toFixed(4)}N ${l[1].toFixed(4)}E` + (l[2] ? ` ±${Math.round(l[2])}m` : '');
const mkBtn = (txt, cls, fn, title) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = txt; if (title) b.title = title; b.onclick = fn; return b; };
function entryNode(n, opt = {}) {
  if (opt.other) return otherEntry(n, opt);
  const d = document.createElement('div'); d.className = 'entry'; d.dataset.id = n.id;
  d.innerHTML = `<div class="meta"><span class="d"></span></div><div class="acts"><button class="ad" type="button" aria-label="写真を足す">＋写真</button><button class="ed" type="button">なおす</button></div><div class="pl"></div><div class="t"></div><div class="dx"></div><div class="shr"></div><div class="ph"></div><div class="tg"></div>`;
  d.classList.add('own');
  d.querySelector('.d').textContent = (opt.timeOnly ? (n.at || '--:--') : fmtDay(n.d) + (n.at ? '  ' + n.at : ''));
  const meta = d.querySelector('.meta');
  if (!opt.timeOnly) meta.appendChild(mkBtn('この日の散歩 ›', 'tag', () => openWalk(n.d), 'この日の散歩を見る'));
  if (n.loc) meta.appendChild(mkBtn('地図で見る', 'tag', () => showPin(n.loc, n.k), fmtLoc(n.loc) + '（押すと、書いた場所を地図で見る）'));
  const sg = GR.sharedTo(n);
  if (sg.length) { const sh = whoChip(GR.me()); sh.firstChild.style.background = sg[0].color(GR.me()); sh.lastChild.textContent = '共有中'; sh.title = `「${sg.map(G => G.g.name).join('」「')}」に共有しています`; meta.appendChild(sh); }
  const pl = d.querySelector('.pl');
  if (opt.place) { pl.appendChild(mkBtn(placeLabel(n.k) + ' ›', 'plink', () => jumpTo(n.k))); } else pl.remove();
  d.querySelector('.t').textContent = n.t || (n.x ? '' : n.w ? withText(n) : (n.im || []).length ? '（写真だけ）' : '（メモなし）');
  if (n.w && n.t) d.querySelector('.t').before(el2('div', 'wline', withText(n)));
  d.querySelector('.dx').textContent = n.x || '';
  if (n.s) d.querySelector('.shr').appendChild(shopChip(n.s, n.k)); else d.querySelector('.shr').remove();
  d.querySelector('.ph').appendChild(chips(n.p, n));
  d.insertBefore(thumbStrip(n), d.querySelector('.ph'));
  d.querySelector('.tg').appendChild(tagChips(n.tags));
  const wr = GR.on() && withRow(n, GR.me()); if (wr) d.appendChild(wr);
  d.querySelector('.ed').onclick = e => { e.stopPropagation(); editEntry(d, n); };
  d.querySelector('.ad').onclick = e => { e.stopPropagation(); addPhotoUI(d, n); };
  d.onclick = e => {   // anywhere on the card: show it on the map
    if (e.target.closest('button,a,input,textarea,label,.addph,.edit') || d.querySelector('.edit') || String(getSelection ? getSelection() : '').length) return;
    showNote(n);
  };
  return d;
}
function showNote(n) {
  if (n.loc) return showPin(n.loc, n.k);
  const p = placePoint(n.k); if (!p) return;
  const s = Math.max(V.s * .9, Math.min(V.s, .02));
  flyTo({ cx: p[0] + (W >= 720 ? 230 * s : 0), cy: p[1] + (W < 720 ? liftPx() * s : 0), s }, 700);
  setTimeout(() => burst(n.k, p), 420);
}
/* ＋写真 on a memo: paste a link, or pick photos from the phone */
function addPhotoUI(node, n) {
  const old = node.querySelector('.addph'); if (old) return old.remove();
  const box = document.createElement('div'); box.className = 'addph';
  const go = links => {
    const ls = parseLinks(links.join(' '));
    if (!ls.length) return toast('リンクが見つかりませんでした');
    const cur = Store.notes.get(n.id) || n;
    Store.putNote({ ...cur, p: parseLinks([...(cur.p || []), ...ls].join(' ')) });
    const pp = photoPost(ls[0]); toast(pp ? `${pp.svc === 'x' ? 'X' : 'Instagram'} の写真を付けました` : 'リンクを付けました');
  };
  const paste = mkBtn('Instagram・X のリンクを貼る', 'pgo', async () => {
    let t = null; try { t = await navigator.clipboard.readText(); } catch (e) {}
    if (t != null) { const ls = parseLinks(t); if (ls.length) return go(ls); return toast('コピーされたリンクが見つかりませんでした。Instagram で投稿の「…」→「リンクをコピー」してから、もう一度押してください', 4200); }
    if (!box.querySelector('input')) {   // clipboard not readable here: paste by hand
      const inp = document.createElement('input'); inp.type = 'url'; inp.placeholder = 'ここに貼り付け（長押し →「ペースト」）';
      const ok = mkBtn('付ける', 'pgo', () => go([inp.value]));
      box.appendChild(inp); box.appendChild(ok); inp.focus();
    }
  });
  const pick = mkBtn('スマホの写真を選ぶ', 'pgo', () => pickPhotos(8 - ((Store.notes.get(n.id) || n).im || []).length, async ds => {
    const ids = await saveThumbs(ds), cur = Store.notes.get(n.id) || n;
    Store.putNote({ ...cur, im: [...(cur.im || []), ...ids].slice(0, 8) });
    toast('写真をのこしました');
  }));
  box.append(pick, paste);
  node.appendChild(box);
}
function otherEntry(n, opt) {   // someone else's memo in the group: read only, no GPS
  const d = document.createElement('div'); d.className = 'entry other';
  d.innerHTML = `<div class="meta"></div><div class="acts"></div><div class="pl"></div><div class="t"></div><div class="dx"></div><div class="shr"></div><div class="ph"></div><div class="tg"></div>`;
  const meta = d.querySelector('.meta');
  meta.appendChild(whoChip(n.by));
  const dt = document.createElement('span'); dt.className = 'd'; dt.textContent = fmtDay(n.d) + (n.at ? '  ' + n.at : ''); meta.appendChild(dt);
  const pl = d.querySelector('.pl');
  if (opt.place) pl.appendChild(mkBtn(placeLabel(n.k) + ' ›', 'plink', () => jumpTo(n.k))); else pl.remove();
  d.querySelector('.t').textContent = n.t || (n.x ? '' : withText(n));
  if (n.w && n.t) d.querySelector('.t').before(el2('div', 'wline', withText(n)));
  d.querySelector('.dx').textContent = n.x || '';
  d.querySelector('.dx').style.borderLeftColor = GR.color(n.by);
  if (n.s && typeof n.s === 'object') d.querySelector('.shr').appendChild(shopChip({ n: String(n.s.n || '').slice(0, 80), u: mapUrl(n.s.u) ? n.s.u : '', a: String(n.s.a || '').slice(0, 160) }, n.k)); else d.querySelector('.shr').remove();
  const nph = +n.ph || (Array.isArray(n.imd) ? n.imd.length : 0);
  if (nph) d.querySelector('.ph').appendChild(el2('span', 'phnote', `写真 ${nph} 枚は、本人の手もとに`));
  d.querySelector('.ph').appendChild(chips(noteLinks(n), n));
  d.querySelector('.tg').appendChild(tagChips(Array.isArray(n.tags) ? n.tags : []));
  const wr = withRow(n, n.by); if (wr) d.appendChild(wr);
  return d;
}
let editing = null;
// phone: while a memo (or a day) is being fixed, 保存 / キャンセル ride just above the keyboard
function editBar(edit, onSave, onCancel) {
  const bar = $('#editBar'), vv = window.visualViewport;
  document.body.classList.add('editing');
  if (W >= 720) { const mo = new MutationObserver(() => { if (!edit.isConnected) { document.body.classList.remove('editing'); mo.disconnect(); } }); mo.observe(document.body, { childList: true, subtree: true }); return; }
  const place = () => {
    const h = bar.offsetHeight, kb = !!vv && vv.height < innerHeight - 120;
    bar.classList.toggle('kb', kb);
    bar.style.top = Math.round((vv ? vv.offsetTop + vv.height : innerHeight) - h) + 'px';
  };
  const done = () => { bar.hidden = true; document.body.classList.remove('editing'); if (vv) { vv.removeEventListener('resize', place); vv.removeEventListener('scroll', place); } mo.disconnect(); };
  const mo = new MutationObserver(() => { if (!edit.isConnected) done(); });
  mo.observe(document.body, { childList: true, subtree: true });
  $('#ebSave').onclick = () => onSave();
  $('#ebCancel').onclick = () => onCancel();
  bar.hidden = false; place();
  if (vv) { vv.addEventListener('resize', place); vv.addEventListener('scroll', place); }
  setTimeout(place, 350);
}
function editEntry(node, n) {   // なおす: the same order and words as writing — 写真 · 日付 · 場所 ▾, then ひとこと, くわしく, タグ
  editing = n.id;
  node.innerHTML = `<div class="edit ew">
    <div class="ftools"><button type="button" class="tl ePick" aria-expanded="false"></button><button type="button" class="tl eWhen" aria-expanded="false"></button><button type="button" class="tl where eWhere" aria-expanded="false"></button></div>
    <div class="ebox ePhotoBox"><span class="lab">写真</span><div class="eI"></div><div class="eL"></div><div class="pbtns"><button type="button" class="pgo ePhone">スマホの写真を選ぶ</button><button type="button" class="pgo eIg">Instagram・X のリンクを貼る</button></div><div class="shin eIgIn" hidden><input type="url" placeholder="ここに貼り付け（長押し →「ペースト」）"></div></div>
    <div class="ebox eWhenBox"><div class="erow"><div><label>日付</label><input type="date" class="eD"></div><div><label>時刻</label><input type="time" class="eA"></div></div></div>
    <div class="ebox eWhereBox"><div class="scope eK"></div><div class="eShop"></div></div>
    <label>ひとこと</label><textarea class="eT" rows="2"></textarea>
    <label>くわしく</label><textarea class="eX big" placeholder="道順、見つけたもの、天気、寄ったお店、気づいたこと…"></textarea>
    <label>タグ</label><div class="eG"></div>
    <div class="eShare" hidden></div>
    <div class="row"><button class="btn eS" type="button">保存</button><button class="btn ghost eC" type="button">キャンセル</button><button class="eDel" type="button">このメモをけす</button></div></div>`;
  const q = c => node.querySelector(c);
  let k = n.k, links = (n.p || []).slice(), im = (n.im || []).slice(), gone = [];
  let shop = n.s ? { ...n.s } : null, eloc = n.loc || null;
  const BOX = { ePick: '.ePhotoBox', eWhen: '.eWhenBox', eWhere: '.eWhereBox' };
  const openBox = which => { for (const b in BOX) { const on = b === which && !q(BOX[b]).classList.contains('open'); q(BOX[b]).classList.toggle('open', on); q('.' + b).setAttribute('aria-expanded', on ? 'true' : 'false'); } };   // one box at a time, like writing
  for (const b in BOX) q('.' + b).onclick = () => openBox(b);
  const paintChips = () => {
    const np = im.length + links.length, d = q('.eD').value || n.d, a = q('.eA').value;
    q('.ePick').textContent = '写真' + (np ? ' ' + np : '') + ' ▾'; q('.ePick').classList.toggle('on', np > 0);
    q('.eWhen').textContent = '日付：' + (d === today() ? '今日' : (d.slice(0, 4) === today().slice(0, 4) ? '' : d.slice(0, 4) + '/') + `${+d.slice(5, 7)}/${+d.slice(8)}`) + (a ? ' ' + a : '');
    q('.eWhere').textContent = '場所：' + (placeName(k) || '') + (shop && shop.n ? '・' + shop.n : '') + ' ▾';
  };
  const paintLinksE = () => {
    const box = q('.eL'); box.innerHTML = '';
    links.forEach(u => { const w = el2('span', 'lkc'); w.appendChild(chips([u])); w.appendChild(mkBtn('×', 'lkx', () => { links = links.filter(x => x !== u); paintLinksE(); paintChips(); }, 'この写真をはずす')); box.appendChild(w); });
  };
  scopeChips(q('.eK'), ancestors(n.k), n.k, x => { k = x; paintChips(); });
  q('.eD').value = n.d; q('.eA').value = n.at || ''; q('.eT').value = n.t || ''; q('.eX').value = n.x || '';
  ['.eD', '.eA'].forEach(c => q(c).addEventListener('input', paintChips));
  const tg = tagInput(q('.eG'), n.tags);
  const paintES = () => {   // 共有 here sets or clears the group's tag; a day shared with a group shares its memos too
    const wd = Store.walks.get(q('.eD').value || n.d), dayTo = G => !!(wd && (wd.tags || []).some(t => G.gtags().includes(t)));
    shareChips(q('.eShare'), '共有', G => tg.get().some(t => G.gtags().includes(t)) || dayTo(G), G => {
      const now = tg.get();
      if (!G) tg.set(now.filter(t => !GR.allTags().includes(t)));
      else if (now.some(t => G.gtags().includes(t))) tg.set(now.filter(t => !G.gtags().includes(t)));
      else if (!dayTo(G)) tg.set(uniq([...now, G.gtag()]));
      else toast(`この日ごと「${G.g.name}」に共有しています（日のページで変えられます）`, 3600);
      paintES();
    });
  };
  paintES(); q('.eG').addEventListener('click', () => setTimeout(paintES, 0)); q('.eG').addEventListener('keyup', () => setTimeout(paintES, 0));
  const addLinks = txt => {   // the same as writing: Instagram・X → a photo; a map link → the shop
    const ls = parseLinks(txt); if (!ls.length) return false;
    if (ls.every(mapUrl)) { sf.take(txt); openBox('eWhere'); return true; }
    const ps = ls.filter(u => !mapUrl(u)); links = parseLinks([...links, ...ps].join(' '));
    paintLinksE(); paintChips(); q('.eIgIn').hidden = true;
    const pp = photoPost(ps[0]); toast(pp ? `${pp.svc === 'x' ? 'X' : 'Instagram'} の写真を付けました` : 'リンクを付けました');
    return true;
  };
  q('.eIg').onclick = async () => {
    let t = null; try { t = await navigator.clipboard.readText(); } catch (e) {}
    if (t == null) { const w = q('.eIgIn'), i = w.querySelector('input'); w.hidden = false; i.value = ''; i.focus(); return; }   // can't read here: paste by hand
    if (!addLinks(t)) toast('コピーされたリンクが見つかりませんでした。Instagram で投稿の「…」→「リンクをコピー」してから、もう一度押してください', 4200);
  };
  q('.eIgIn input').addEventListener('input', e => { if ((e.target.value.match(URL_RE) || []).length) addLinks(e.target.value); });
  const sf = shopField({
    name: () => firstLine(q('.eT').value), k: () => k, ctx: () => ({ kind: 'note', id: n.id }),
    onShop: async p => {
      if (!p) { if (shop && shop.ll && eloc && eloc[0] === shop.ll[0]) eloc = null; shop = null; sf.show(null); return; }
      const res = await resolveShop(p), name = p.n || 'お店';
      shop = p;
      if (p.ll) eloc = [p.ll[0], p.ll[1], 0];
      if (res && res.key !== k && (sure(res) || !within(res.key, k))) {   // in another town: the memo moves there
        k = res.key; scopeChips(q('.eK'), ancestors(k), k, x => { k = x; paintChips(); });
        if (!p.ll && eloc) eloc = null;
        toast(`${name} を付けました（${placeName(k)} に移します）`, 3000);
      } else toast(sure(res) || (res && res.key === k) ? `${name} を付けました` : `${name} を付けました。町だけ、たしかめてください`, 3000);
      if (!q('.eT').value.trim()) q('.eT').value = name;
      sf.show(shop, k); paintChips();
    }
  });
  q('.eShop').appendChild(sf.el); sf.show(shop, k);
  q('.eT').addEventListener('input', () => sf.fill());
  const paintIm = () => {
    const box = q('.eI'); box.innerHTML = '';
    if (!im.length) return;
    const st = thumbStrip({ im }, id => { im = im.filter(v => v !== id); gone.push(id); paintIm(); paintChips(); }); st.classList.add('edit'); box.appendChild(st);
  };
  q('.ePhone').onclick = () => { if (im.length >= 8) return toast('写真は8枚までです'); pickPhotos(8 - im.length, async ds => { im = im.concat(await saveThumbs(ds)).slice(0, 8); paintIm(); paintChips(); }); };
  paintIm(); paintLinksE(); paintChips();
  q('.eDel').onclick = () => delNoteUndo(n);
  const save = () => {
    const T = pullLinks(q('.eT').value), X = pullLinks(q('.eX').value), t = T.text, x = X.text;
    const all = parseLinks([...links, ...T.links, ...X.links].join(' ')), ml = all.find(mapUrl);
    if (!shop && ml) shop = { u: ml, n: urlName(ml) || firstLine(t) };   // a map link written in the memo is its shop
    editing = null; shopDone();
    Store.putNote({ ...n, k, d: q('.eD').value || n.d, at: q('.eA').value || '', t: t || (shop && shop.n) || '', x, im, p: all.filter(u => !mapUrl(u)), loc: eloc || undefined, s: shopOut(shop), tags: uniq([...tg.get(), ...hashtags(t + ' ' + x)]) });
    if (gone.length) Thumbs.del(gone);
    toast(k === n.k ? '保存しました' : `${placeName(k)} に移しました`);
  };
  q('.eS').onclick = save;
  q('.eC').onclick = () => { editing = null; shopDone(); refreshPanels(); };
  editBar(node.querySelector('.edit'), save, () => q('.eC').click());
  node.querySelectorAll('textarea').forEach(t => t.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } }));
  (W < 720 ? q('.eT') : q('.eX')).focus();
}
function renderEntries() {
  if (!S.sel || editing) return;
  const k = S.sel.key, own = IX.byPlace.get(k) || [];
  const tg = $('#sToggle');
  tg.classList.toggle('on', isV(k));
  tg.disabled = own.length > 0;
  tg.title = own.length ? 'メモがあるので「行った」になっています' : '';
  tg.querySelector('span').textContent = '行った'; tg.querySelector('i').textContent = isV(k) ? '✓' : ''; tg.setAttribute('aria-pressed', isV(k) ? 'true' : 'false');
  if (!own.length) tg.title = isV(k) ? '押すと「まだ」にもどります' : '歩いたことがあれば、押してください';
  const raw = own.filter(x => !x.x).length;
  $('#sCount').textContent = `メモ ${own.length}`;
  photosBtn($('#sCount'), own);
  const box = $('#sEntries'); box.innerHTML = '';
  const grp = GR.showing(), theirs = grp && GX.others.has(k) ? GX.others.get(k).filter(n => !bareWith(n, k)) : [];
  const hereW = k[0] === 't' ? '町' : k[0] === 'p' ? '県' : '市', writeW = W < 720 ? '下の欄に、ひとこと。' : '下の「ここに、ひとこと」から。';
  if (!own.length && theirs.length) {   // nothing of yours yet: the group's memos come first
    $('#sCount').textContent = `みんなのメモ ${theirs.length}`; photosBtn($('#sCount'), theirs);
    theirs.forEach(n => box.appendChild(entryNode(n, { other: true })));
    const e = el2('div', 'empty mine'); e.innerHTML = `あなたのメモは、まだありません。<br>行ったことがあれば「わたしも行った」、書くなら${writeW}`; box.appendChild(e);
  } else if (!own.length) box.innerHTML = `<div class="empty">まだ、この${hereW}の話はありません。<br>${writeW}</div>`;
  own.forEach(n => box.appendChild(entryNode(n)));
  if (own.length && theirs.length) {
    const os = theirs;
    const r = document.createElement('div'); r.className = 'rule'; r.textContent = `みんなのメモ ${os.length}`; photosBtn(r, os); box.appendChild(r);
    os.forEach(n => box.appendChild(entryNode(n, { other: true })));
  }
  // memos written somewhere inside this prefecture / city
  if (k[0] !== 't') {
    const inner = [];
    for (const n of Store.notes.values()) if (within(k, n.k)) inner.push(n);
    if (grp) for (const n of GX.feed) if (within(k, n.k)) inner.push(n);
    if (inner.length) {
      inner.sort(newestFirst);
      const r = document.createElement('div'); r.className = 'rule'; r.textContent = `この中のメモ ${inner.length}`; box.appendChild(r);
      inner.slice(0, 80).forEach(n => {
        const b = document.createElement('button'); b.className = 'mlog';
        b.innerHTML = '<span class="d"></span><span class="p"></span><span class="t"></span>';
        b.querySelector('.d').textContent = n.d.slice(5).replace('-', '.');
        if (grp) { const w = whoChip(n.by || GR.me()); w.lastChild.remove(); b.querySelector('.d').prepend(w); }
        b.querySelector('.p').textContent = placeName(n.k);
        b.querySelector('.t').textContent = n.t || n.x || withText(n);
        b.onclick = () => jumpTo(n.k);
        box.appendChild(b);
      });
    }
  }
}
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const nowHM = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
$('#sToggle').onclick = () => {
  if (!S.sel) return;
  const k = S.sel.key;
  if ((IX.byPlace.get(k) || []).length) return;
  const v = !isV(k);
  Store.setVisited(k, v);
  if (v) burst();
};
$('#memoHere').onclick = currentAreaSel;
/* reading and writing take turns: memos first; the form unfolds only when you mean to write */
function bareWith(n, k) {   // only "いっしょ", no words or photos, and the memo it answers is shown here
  if (!n.w || !n.w.y || n.t || n.x || +n.ph || (n.p && n.p.length) || n.s) return false;
  const o = n.w.u === GR.me() ? Store.notes.get(n.w.i) : GR.docs.notes.get(n.w.u + '_' + n.w.i);
  return !!o && o.k === k;
}
const hasMemosHere = () => !!S.sel && ((IX.byPlace.get(S.sel.key) || []).length > 0 || (GR.showing() && GX.others && GX.others.has(S.sel.key)));
function paintWbar() {
  const t = $('#fText').value.trim(), b = $('#fOpen');
  b.classList.toggle('draft', !!t);
  b.querySelector('span').textContent = t ? '書きかけ：' + t : (W < 720 ? 'ここに、ひとこと' : 'ここに、ひとこと（新しいメモ）');
}
function unfoldForm() {
  const f = $('#sForm'); f.classList.remove('collapsed'); f.classList.add('opening');
  setTimeout(() => f.classList.remove('opening'), 300);
  $('#fText').focus();
}
function foldForm() { if (!hasMemosHere()) return; $('#sForm').classList.add('collapsed'); paintWbar(); document.activeElement && document.activeElement.blur && document.activeElement.blur(); }
$('#fOpen').onclick = unfoldForm;
$('#fFold').onclick = foldForm;
function shareGids() {   // 書く: which groups see what you write today (back to 自分だけ tomorrow)
  if (!GR.anyOn()) return [];
  let o = null; try { o = JSON.parse(localStorage.getItem('sanpo-share') || 'null'); } catch (e) {}
  let gids = o && o.d === today() && Array.isArray(o.gids) ? o.gids : [];
  if (!o) { try { if (localStorage.getItem('sanpo-share-day') === today() && GR.live()[0]) gids = [GR.live()[0].gid]; } catch (e) {} }   // the one-group switch of 2.10
  return gids.filter(g => GR.list.has(g) && GR.list.get(g).on());
}
function setShareGids(gids) { try { localStorage.setItem('sanpo-share', JSON.stringify({ d: today(), gids })); localStorage.removeItem('sanpo-share-day'); } catch (e) {} }
const shareOn = () => shareGids().length > 0;
function shareChips(host, label, sel, onPick) {   // 共有：自分だけ / group / group — the same row when writing, fixing and on a day
  const gs = GR.live(); host.innerHTML = ''; host.hidden = !gs.length; if (!gs.length) return;
  const me = GR.me(), any = gs.some(G => sel(G));
  host.appendChild(el2('span', 'lab', label));
  const own = mkBtn('自分だけ', 'shc' + (any ? '' : ' on'), () => onPick(null)); own.setAttribute('aria-pressed', any ? 'false' : 'true'); host.appendChild(own);
  gs.forEach(G => {
    const on = sel(G), c = mkBtn(G.g.name, 'shc g' + (on ? ' on' : ''), () => onPick(G)), col = G.color(me);
    c.style.setProperty('--gc', col); if (on && isLight(col)) c.classList.add('lt'); c.setAttribute('aria-pressed', on ? 'true' : 'false');
    c.title = on ? `「${G.g.name}」のみんなにも見えます` : `押すと「${G.g.name}」にも見えます`;
    host.appendChild(c);
  });
}
function paintShare() {
  const b = $('#fShare'); if (!b) return;
  const on = shareGids();
  shareChips(b, '共有', G => on.includes(G.gid), G => { setShareGids(!G ? [] : on.includes(G.gid) ? on.filter(x => x !== G.gid) : [...on, G.gid]); paintShare(); });
  b.title = on.length ? '今日はこの選び方のまま。明日になると「自分だけ」に戻ります' : '';
  paintSave();
}
function paintSave() {   // when what you write will also reach a group, the button says so
  const f = $('#sForm'), txt = $('#fText').value + ' ' + $('#fDetail').value;
  let ft = []; try { ft = fTags.get(); } catch (e) {}
  const tags = [...ft, ...hashtags(txt)], on = shareGids();
  const to = GR.live().filter(G => on.includes(G.gid) || tags.some(t => G.gtags().includes(t)));
  $('#fSave').textContent = to.length ? 'のこす（みんなにも）' : 'のこす';
  f.classList.toggle('sharing', !!to.length);
  if (to.length) f.style.setProperty('--gc', to[0].color(GR.me())); else f.style.removeProperty('--gc');
}
['#fText', '#fDetail'].forEach(id => $(id).addEventListener('input', () => { if (GR.anyOn()) paintSave(); }));
$('#sForm').onsubmit = ev => {
  ev.preventDefault();
  if (!S.sel) return;
  const pc = W >= 720;
  // a link written into the memo itself is taken out and kept as a photo link
  const T = pullLinks($('#fText').value), X = pullLinks(pc ? $('#fDetail').value : '');
  const all = parseLinks([$('#fLinks').value, ...T.links, ...X.links].join(' ')), links = all.filter(u => !mapUrl(u)), ml = all.find(mapUrl);
  const shop = formShop ? shopOut(formShop) : ml ? shopOut({ u: ml, n: urlName(ml) || firstLine(T.text) }) : undefined;   // a map link written in the memo is its shop
  const t = T.text || (shop && shop.n) || '', x = X.text;
  const shareTo = GR.live().filter(G => shareGids().includes(G.gid));
  const tags = uniq([...(pc ? fTags.get() : []), ...hashtags(t + ' ' + x), ...shareTo.map(G => G.gtag())]);
  if (!t && !x && !links.length && !formThumbs.length && !shop) { $('#fText').focus(); toast('メモを書いてください'); return; }
  const custom = pc || $('#fWhenRow').classList.contains('open');   // phone: only when ◷ was opened
  const d = custom ? ($('#fDate').value || today()) : today();
  const at = custom && $('#fTime').value ? $('#fTime').value : (d === today() ? nowHM() : '');
  const k = formKey || S.sel.key;
  const sp = spreadPrep(k), pt = placePoint(k, formLoc);
  const nid = newId(), ds = formThumbs.slice();
  Store.putNote({ id: nid, k, d, at, t, x, p: links, loc: formLoc, tags, s: shop });
  if (ds.length) saveThumbs(ds).then(im => { const n = Store.notes.get(nid); if (n) Store.putNote({ ...n, im }); });
  spread(sp, pt);
  $('#fText').value = ''; $('#fDetail').value = ''; $('#fLinks').value = ''; $('#fWhereBox').classList.remove('open'); $('#fPhotoBox').classList.remove('open'); fTags.set([]); formThumbs = []; paintFormThumbs(); paintLinks(); paintSave();
  setFormLoc(null); setFormShop(null); fShop.clear(); shopDone();
  $('#fTime').value = ''; if (!pc) { $('#fDate').value = today(); $('#fWhenRow').classList.remove('open'); } paintWhen();
  toast((d !== today() ? `${d.slice(5).replace('-', '/')}の分として、` : '') + (k === S.sel.key ? 'のこしました' : `${placeName(k)} にのこしました`) + (shareTo.length ? `（${shareTo.map(G => G.g.name).join('・')} のみんなにも）` : ''));
  burst(k, pt);
  $('#sForm').classList.add('canfold', 'collapsed'); paintWbar();   // just saved one here: back to reading
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
};
[$('#fText'), $('#fDetail')].forEach(t => t.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#sForm').requestSubmit(); } }));
const URL_RE = /https?:\/\/[^\s<>"'、。）)」]+/g;
const pullLinks = s => { s = String(s || ''); return { links: s.match(URL_RE) || [], text: s.replace(URL_RE, ' ').replace(/[ \t\u3000]{2,}/g, ' ').trim() }; };
let formThumbs = [];
function paintFormThumbs() {
  const box = $('#fThumbs'); box.innerHTML = '';
  formThumbs.forEach((o, i) => box.appendChild(thumbStrip({ imd: [o.s || o] }, () => { formThumbs.splice(i, 1); paintFormThumbs(); }).firstChild));
  paintPick();
}
$('#fPick').onclick = () => { $('#fPhotoBox').classList.toggle('open'); $('#fWhereBox').classList.remove('open'); $('#fIgIn').hidden = true; paintPick(); paintWhere(); };
$('#fPhone').onclick = () => pickPhotos(6 - formThumbs.length, ds => { formThumbs = formThumbs.concat(ds).slice(0, 6); paintFormThumbs(); $('#fPhotoBox').classList.remove('open'); paintPick(); });
// Instagram・X: copy the post's link there, come back, one tap
function addPhotoLinks(txt) {
  const ls = parseLinks(txt);
  if (!ls.length) return false;
  if (ls.every(mapUrl)) { fShop.take(txt); $('#fPhotoBox').classList.remove('open'); paintPick(); return true; }   // a map link is a shop
  const ps = ls.filter(u => !mapUrl(u)), had = parseLinks($('#fLinks').value);
  $('#fLinks').value = parseLinks([...had, ...ps].join(' ')).join(' ');
  paintLinks(ps.find(u => !had.includes(u)));
  const p = photoPost(ps[0]);
  toast(p ? `${p.svc === 'x' ? 'X' : 'Instagram'} の写真を付けました` : 'リンクを付けました');
  $('#fIgIn').hidden = true; $('#fIgPaste').classList.remove('ready'); $('#fPhotoBox').classList.remove('open'); paintPick();
  shopDone();
  return true;
}
$('#fIgPaste').onclick = async () => {
  let t = null; try { t = await navigator.clipboard.readText(); } catch (e) {}
  if (t == null) { const w = $('#fIgIn'), i = w.querySelector('input'); w.hidden = false; i.value = ''; i.focus(); return; }   // can't read here: paste by hand
  if (!addPhotoLinks(t)) toast('コピーされたリンクが見つかりませんでした。Instagram で投稿の「…」→「リンクをコピー」してから、もう一度押してください', 4200);
};
$('#fIgIn input').addEventListener('input', e => { if ((e.target.value.match(URL_RE) || []).length) addPhotoLinks(e.target.value); });
$('#fIgOpen').onclick = () => {   // remember the memo, like when going to Google Maps
  shopGo = { t: Date.now(), kind: 'form', box: 'photo', sel: S.sel && S.sel.key, text: $('#fText').value, detail: $('#fDetail').value, date: $('#fDate').value, time: $('#fTime').value, when: $('#fWhenRow').classList.contains('open'), links: $('#fLinks').value };
  try { localStorage.setItem('sanpo-shopgo', JSON.stringify(shopGo)); } catch (e) {}
  window.open('https://www.instagram.com/', '_blank', 'noopener');
};
$('#fText').addEventListener('paste', e => {   // pasting a link into the memo puts it where photo links go
  const raw = (e.clipboardData || {}).getData ? e.clipboardData.getData('text') : '', P = pullLinks(raw);
  if (!P.links.length) return;
  e.preventDefault();
  if (P.links.some(mapUrl)) { if (fShop.take(raw) && !$('#fText').value.trim()) $('#fText').value = (parseShop(raw) || {}).n || ''; return; }
  const had = parseLinks($('#fLinks').value);
  $('#fLinks').value = parseLinks([...had, ...P.links].join(' ')).join(' ');
  if (P.text) document.execCommand('insertText', false, P.text);
  paintLinks(P.links.find(u => !had.includes(u)));
  const pp = photoPost(P.links[0]); toast(pp ? `${pp.svc === 'x' ? 'X' : 'Instagram'} の写真を付けました` : 'リンクを付けました');
});
function paintWhen() {
  const d = $('#fDate').value || today(), t = $('#fTime').value, open = $('#fWhenRow').classList.contains('open');
  const b = $('#fWhen'); b.textContent = '日付：' + (d === today() ? '今日' : d.slice(5).replace('-', '/')) + (t ? ' ' + t : '');
  b.classList.toggle('on', open && (d !== today() || !!t));
}
$('#fWhen').onclick = () => { const r = $('#fWhenRow'); r.classList.toggle('open'); if (!$('#fDate').value) $('#fDate').value = today(); paintWhen(); if (r.classList.contains('open')) $('#fDate').focus(); };
['#fDate', '#fTime'].forEach(id => $(id).addEventListener('input', paintWhen));

/* the moment of saving: a newly walked place fills with orange from where you stood (0.64s) */
function placePoint(k, loc) {
  if (loc) return proj(loc[1], loc[0], k.slice(1, 3) === '47');
  if (k[0] === 't' && townData) { const t = townData.towns.find(t => t.k === k); return t && t.pts[0]; }
  if (k[0] === 'm' && D.muni[k.slice(1)]) return D.muni[k.slice(1)].lp;
  if (k[0] === 'p') { const f = D.japanFeats.find(f => f.c === k.slice(1)); return f && f.lp; }
  return null;
}
function spreadPrep(k) {
  if (isV(k) || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  let node = null;
  if (k[0] === 't' && townData) { const i = townData.towns.findIndex(t => t.k === k); node = i >= 0 ? townNodes[i] : null; }
  else if (k[0] === 'm') node = muniNodes.get(k.slice(1)) || null;
  else if (k[0] === 'p') node = prefNodes.get(k.slice(1)) || null;
  if (!node || !node.isConnected || !node.getAttribute('d') || node.classList.contains('hidden')) return null;
  const cs = getComputedStyle(node);
  return { node, fill: cs.fill, stroke: cs.stroke, sw: cs.strokeWidth };
}
function spread(sp, p) {
  if (!sp || !p) return;
  const { node } = sp, bb = node.getBBox(), id = 'spr' + Date.now();
  const box = { x: bb.x - 1, y: bb.y - 1, width: bb.width + 2, height: bb.height + 2 };
  const mask = el('mask', { id, maskUnits: 'userSpaceOnUse', ...box });
  mask.appendChild(el('rect', { ...box, fill: '#fff' }));
  const c = el('circle', { cx: p[0], cy: p[1], r: 0, fill: '#000' }); mask.appendChild(c);
  const g = el('g', { style: 'pointer-events:none' });
  g.appendChild(mask);
  g.appendChild(el('path', { d: node.getAttribute('d'), mask: `url(#${id})`, style: `fill:${sp.fill};stroke:${sp.stroke};stroke-width:${sp.sw}` }));
  node.parentNode.appendChild(g);
  const R = Math.max(...[[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(q => Math.hypot(q[0] - p[0], q[1] - p[1])));
  const t0 = performance.now();
  const step = now => { const t = Math.min(1, Math.max(0, now - t0) / 640), e = 1 - Math.pow(1 - t, 3); c.setAttribute('r', R * e); if (t < 1) requestAnimationFrame(step); else g.remove(); };
  requestAnimationFrame(step);
}
/* small burst at the place that was just recorded */
function burst(k, p) {
  k = k || (S.sel && S.sel.key); if (!k) return;
  p = p || placePoint(k);
  if (!p) return;
  const g = el('g', {});
  svg.appendChild(g);
  const t0 = performance.now();
  const rings = [0, 1, 2].map(() => { const c = el('circle', { cx: p[0], cy: p[1], fill: 'none', stroke: '#ff4f00' }); g.appendChild(c); return c; });
  const step = now => {
    let alive = false;
    rings.forEach((c, i) => {
      const t = Math.max(0, Math.min(1, (now - t0 - i * 120) / 700));
      if (t < 1) alive = true;
      const e = 1 - Math.pow(1 - t, 3);
      c.setAttribute('r', (4 + e * 46) * V.s); c.setAttribute('stroke-width', 1.2 * V.s); c.setAttribute('opacity', t ? 1 - t : 0);
    });
    if (alive) requestAnimationFrame(step); else g.remove();
  };
  requestAnimationFrame(step);
}

/* ---- location attached to the memo form (SP) ---- */
let formLoc = null, quickNext = null;
function setFormLoc(l) {
  formLoc = l;
  const b = $('#fLoc');
  b.classList.toggle('on', !!l);
  b.textContent = l ? (l[2] ? `位置あり ±${Math.round(l[2])}m（押すと、はずす）` : 'お店の位置あり（押すと、はずす）') : 'いまの位置も付ける';
  paintWhere();
}
$('#fLoc').onclick = async () => {
  if (formLoc) return setFormLoc(null);
  $('#fLoc').textContent = '位置を調べています…';
  try { const p = await getPos(); setFormLoc([+p.lat.toFixed(5), +p.lng.toFixed(5), Math.round(p.acc)]); }
  catch (e) { setFormLoc(null); geoErr(e, () => $('#fLoc').onclick()); }
};

/* ---------- お店: find it in Google Maps, copy, come back, attach (v2.6.0) ----------
   note.s = { n: name, a: address, u: map link }. The name and link may go to the group with a shared memo; GPS never does. */
const PIN_SVG = '<svg viewBox="0 0 11 13" aria-hidden="true"><path d="M5.5 12.2S1.3 7.9 1.3 5.2a4.2 4.2 0 0 1 8.4 0c0 2.7-4.2 7-4.2 7z"/><circle cx="5.5" cy="5.2" r="1.4"/></svg>';
function mapUrl(u) {   // only real map links are kept (and opened)
  let x; try { x = new URL(String(u || '')); } catch (e) { return false; }
  if (x.protocol !== 'https:' && x.protocol !== 'http:') return false;
  const h = x.hostname.replace(/^www\./, '');
  if (h === 'maps.app.goo.gl' || /^maps\.google\.[a-z.]+$/.test(h) || /^maps\.apple(\.com)?$/.test(h)) return true;
  if (h === 'goo.gl' || /^google\.[a-z.]+$/.test(h)) return /^\/maps(\/|$)/.test(x.pathname);
  return false;
}
const inJapan = (lat, lng) => lat > 20 && lat < 46.5 && lng > 122 && lng < 154.5;
function urlLL(u) {   // a PC address bar link carries the position; a phone's short link does not
  let s = String(u); try { s = decodeURIComponent(s); } catch (e) {}
  const ok = (a, b) => { const lat = +a, lng = +b; return inJapan(lat, lng) ? [+lat.toFixed(6), +lng.toFixed(6)] : null; };
  let m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/); if (m) return ok(m[1], m[2]);
  m = s.match(/[?&](?:ll|sll|q|query|center|daddr|destination|coordinate)=(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/); if (m) return ok(m[1], m[2]);
  m = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/); if (m) return ok(m[1], m[2]);
  return null;
}
function urlName(u) {
  let x; try { x = new URL(u); } catch (e) { return ''; }
  let n = '';
  const m = x.pathname.match(/\/maps\/place\/([^/]+)/);
  if (m) { try { n = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { n = ''; } }
  else n = x.searchParams.get('name') || (/^maps\.apple/.test(x.hostname) ? x.searchParams.get('q') || '' : '');
  n = n.trim();
  return /^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(n) ? '' : n.slice(0, 80);
}
const PREF_HEAD = /^(北海道|東京都|大阪府|京都府|\S{2,3}県)/;
const isAddr = s => { s = String(s || '').normalize('NFKC').replace(/\s+/g, '').replace(/^(日本|Japan)[、,]?/, ''); return /^〒?\d{3}-\d{4}/.test(s) || /^(北海道|東京都|大阪府|京都府|\S{2,3}県)\S*?(市|区|町|村|郡)/.test(s); };
// what was copied in the map app: a link, and maybe the name and address on the lines around it
function parseShop(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const u = (raw.match(URL_RE) || []).find(mapUrl) || '';
  const segs = raw.replace(URL_RE, '\n').split(/\n|\s[·•|]\s/).map(x => x.trim()).filter(Boolean);
  let a = '', n = '';
  for (const s0 of segs) {
    if (!a && isAddr(s0)) { a = s0.normalize('NFKC').replace(/^(日本|Japan)[、,]?\s*/, '').replace(/^〒?\s?\d{3}-\d{4}\s*/, '').trim(); continue; }
    if (!n && s0.length <= 60 && !/^[★☆\d.,()（）\s]+$/.test(s0) && !/^google\s?(マップ|maps)?$/i.test(s0)) n = s0;
  }
  if (!n && u) n = urlName(u);
  const ll = u ? urlLL(u) : null;
  if (!u && !a) return null;
  return { u, n: n.slice(0, 80), a: a.slice(0, 160), ll };
}
const shopOut = s => s ? { ...(s.n ? { n: s.n } : {}), ...(s.a ? { a: s.a } : {}), ...(s.u && mapUrl(s.u) ? { u: s.u } : {}) } : undefined;
// address → town: 都道府県, then the longest city name, then the town (丁目 written as 1丁目, 一丁目 or 1-2-3)
const KD = { '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
const kanNum = s => s.replace(/[〇一二三四五六七八九十]+/g, m => { let n = 0, c = 0; for (const ch of m) { if (ch === '十') { n += (c || 1) * 10; c = 0; } else c = c * 10 + KD[ch]; } return String(n + c); });
const addrNorm = s => kanNum(String(s || '').normalize('NFKC').replace(/\s+/g, '').replace(/[ヶヵケがガ]/g, 'ケ').replace(/の/g, 'ノ')).replace(/^大字/, '');
function townIn(towns, rest) {
  const r = addrNorm(rest), m = r.match(/^(\D+?)(\d+)(?:[-‐−ー－]|番|$)/);
  const cands = m ? [r, m[1] + m[2] + '丁目' + r.slice(m[0].length)] : [r];
  let best = null;
  for (const t of towns) { const tn = addrNorm(t.n); if (tn && cands.some(c => c.startsWith(tn)) && (!best || tn.length > best.len)) best = { t, len: tn.length }; }
  if (best) return best.t;
  for (const t of towns) { const base = addrNorm(t.n).replace(/\d+丁目$/, ''); if (base.length >= 2 && r.startsWith(base)) return t; }   // no 丁目 in the address
  return null;
}
async function addrKey(a) {
  let s = String(a || '').normalize('NFKC').replace(/\s+/g, '').replace(/^(日本|Japan)[、,]?/, '').replace(/^〒?\d{3}-\d{4}/, '');
  const pc = Object.keys(D.prefInfo).find(c => s.startsWith(D.prefInfo[c].n));
  if (!pc) return null;
  s = s.slice(D.prefInfo[pc].n.length);
  const P = await ensurePref(pc);
  let best = null;
  for (const r of [s, s.replace(/^\S{1,6}?郡/, '')]) for (const f of P.feats) if (f.n && r.startsWith(f.n) && (!best || f.n.length > best.n.length)) best = { mc: f.c, n: f.n, r: r.slice(f.n.length) };
  if (!best) return { key: 'p' + pc, how: 'pref' };
  const t = townIn(await ensureTowns(best.mc), best.r);
  return t ? { key: t.k, how: 'addr' } : { key: 'm' + best.mc, how: 'muni' };
}
async function resolveShop(p) {   // → { key, how: 'll' | 'addr' | 'muni' | 'pref' } or null
  try {
    if (p.ll) { const r = await whereIs(p.ll[1], p.ll[0]); return { key: r.key, how: r.key[0] === 't' ? 'll' : 'muni' }; }
    if (p.a) return await addrKey(p.a);
  } catch (e) {}
  return null;
}
const sure = r => !!r && (r.how === 'll' || r.how === 'addr');
const shopSearch = q => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
const shopHref = s => s && s.u && mapUrl(s.u) ? s.u : shopSearch([s && s.n, s && s.a].filter(Boolean).join(' '));
function shopQuery(name, k) {   // the shop's name and the city it is probably in
  const P = k ? D.prefInfo[k.slice(1, 3)] : null, M = k && k[0] !== 'p' ? D.muni[k.slice(1, 6)] : null;
  return [name, P ? P.n + (M ? M.n : '') : ''].filter(Boolean).join(' ');
}
function shopChip(s, k, cls) {
  const a = document.createElement('a'); a.className = 'shop' + (cls ? ' ' + cls : '');
  a.href = shopHref(s); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = 'お店を開く（地図アプリ）';
  a.innerHTML = PIN_SVG + '<b></b>';
  a.querySelector('b').textContent = s.n || 'お店';
  const sub = (k && placeName(k)) || '';
  if (sub && sub !== s.n) { const sm = document.createElement('small'); sm.textContent = sub; a.appendChild(sm); }
  a.addEventListener('click', e => e.stopPropagation());
  return a;
}
const firstLine = s => String(s || '').split('\n')[0].replace(URL_RE, ' ').replace(/[#＃][^\s#＃]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 40);
// leaving for the map app: remember what we were doing (the page may be reloaded while we are away)
const SHOPGO = 'sanpo-shopgo';
let shopGo = null;
function goFind(name, k, ctx) {
  shopGo = { t: Date.now(), name, ...ctx };
  try { localStorage.setItem(SHOPGO, JSON.stringify(shopGo)); } catch (e) {}
  window.open(shopSearch(shopQuery(name, k)), '_blank', 'noopener');
}
function shopDone() { shopGo = null; try { localStorage.removeItem(SHOPGO); } catch (e) {} }
function shopBack() {   // back from the map app: the button to attach rises, once
  if (!shopGo || shopGo.shown || Date.now() - shopGo.t > 6e5) return;
  const b = [...document.querySelectorAll(shopGo.box === 'photo' ? '#fIgPaste' : '.shopf .shpaste')].find(x => x.offsetParent);
  if (!b) return;
  shopGo.shown = true;
  b.classList.remove('ready'); void b.offsetWidth; b.classList.add('ready');
  b.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(shopBack, 300); });
// one field, used in the memo form, in なおす, after a walk, and in 「＋ お店」
function shopField(o) {
  const box = document.createElement('div'); box.className = 'shopf';
  box.innerHTML = '<span class="lab">お店</span><div class="shq"><input class="shn" type="text" maxlength="60" placeholder="お店の名前" autocomplete="off" enterkeyhint="search"><button type="button" class="shgo">Googleマップで探す</button></div>' +
    '<button type="button" class="shpaste">コピーしたお店を、付ける</button><div class="shin" hidden><input type="text" placeholder="ここに貼り付け（長押し →「ペースト」）" autocomplete="off"></div><div class="shv"></div>';
  const q = c => box.querySelector(c), inp = q('.shn');
  if (o.init) inp.value = o.init;
  const sug = () => (o.name ? o.name() : '') || '';
  const fill = () => { inp.placeholder = sug() || 'お店の名前'; };   // a suggestion from the memo, in grey: never taken for something you typed
  const go = () => {
    const n = inp.value.trim() || sug();
    if (!n) { inp.focus(); toast('先に、お店の名前を書いてください'); return; }
    goFind(n, o.k ? o.k() : null, o.ctx ? o.ctx(n) : {});
  };
  q('.shgo').onclick = go;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); go(); } });
  const take = txt => {
    const p = parseShop(txt);
    if (!p) { toast('地図のリンクが見つかりませんでした。もう一度コピーしてみてください', 3400); return false; }
    if (!p.n) p.n = inp.value.trim() || sug();
    q('.shin').hidden = true; q('.shpaste').classList.remove('ready');
    shopDone();
    o.onShop(p);
    return true;
  };
  const ask = () => { const w = q('.shin'), i = w.querySelector('input'); w.hidden = false; i.value = ''; i.focus(); };
  q('.shin input').addEventListener('input', e => { const v = e.target.value; if ((v.match(URL_RE) || []).length || isAddr(v)) take(v); });
  q('.shpaste').onclick = async () => {
    let t = null; try { t = await navigator.clipboard.readText(); } catch (e) {}
    if (t == null) return ask();   // the clipboard can't be read here: paste by hand
    take(t);
  };
  inp.addEventListener('paste', e => {   // a map link pasted into the name: that is the shop
    const t = e.clipboardData && e.clipboardData.getData('text');
    if (t && (t.match(URL_RE) || []).some(mapUrl)) { e.preventDefault(); take(t); }
  });
  const show = (s, k) => {
    const v = q('.shv'); v.innerHTML = ''; box.classList.toggle('has', !!s);
    if (!s) { fill(); return; }
    v.appendChild(shopChip(s, k, 'new'));
    v.appendChild(mkBtn('はずす', 'shx', () => o.onShop(null), 'このお店を、メモからはずす'));
  };
  fill();
  const clear = () => { inp.value = ''; q('.shin').hidden = true; q('.shpaste').classList.remove('ready'); fill(); };
  return { el: box, show, fill, take, clear, name: v => { inp.value = v || ''; } };
}
// the memo form: 場所 ▾ → お店
function dropPin(loc, key) {
  if (!loc || !key) { $('#pin').removeAttribute('d'); $('#pinRing').removeAttribute('d'); return; }
  const [x, y] = proj(loc[1], loc[0], key.slice(1, 3) === '47'), d = `M${x} ${y}h0`;
  $('#pin').setAttribute('d', d); $('#pinRing').setAttribute('d', d);
}
function setFormShop(s, k) {
  const was = formShop;
  if (!s && was && was.ll) dropPin(null);
  formShop = s ? { ...s, k: k || (S.sel && S.sel.key) } : null;
  if (!s && was && was.ll && formLoc && formLoc[0] === was.ll[0] && formLoc[1] === was.ll[1]) setFormLoc(null);   // its position leaves with it
  fShop.show(formShop, formShop && formShop.k);
  paintWhere();
}
const fShop = shopField({
  name: () => firstLine($('#fText').value),
  k: () => formKey || (S.sel && S.sel.key) || null,
  ctx: () => ({ kind: 'form', sel: S.sel && S.sel.key, text: $('#fText').value, detail: $('#fDetail').value, date: $('#fDate').value, time: $('#fTime').value, when: $('#fWhenRow').classList.contains('open') }),
  onShop: p => p ? attachToForm(p) : setFormShop(null)
});
$('#fWhereBox').appendChild(fShop.el);
$('#fText').addEventListener('input', () => fShop.fill());
async function attachToForm(p) {
  const res = await resolveShop(p), k0 = S.sel && S.sel.key;
  const name = p.n || 'お店';
  p.sure = sure(res);
  const here = k0 && (!res || res.key === k0 || (!sure(res) && within(res.key, k0)));
  if (here) {   // the town in front of you
    setFormShop(p, k0);
    if (p.ll) { setFormLoc([p.ll[0], p.ll[1], 0]); dropPin(p.ll, k0); }
    if (!$('#fText').value.trim()) { $('#fText').value = name; paintWbar(); }
    $('#sForm').classList.remove('collapsed'); $('#fWhereBox').classList.add('open'); paintWhere();
    toast(sure(res) || res && res.key === k0 ? `${name} を付けました` : `${name} を付けました。町だけ、たしかめてください`, 3000);
    setTimeout(() => burst(k0, placePoint(k0, formLoc)), 200);
    return;
  }
  if (!res) { toast('町がわからなかったので、地図で町をえらんでから、付けてください', 3600); return; }
  // the shop is in another town: go there, the memo comes along
  pendingShop = { p, k: res.key, drop: !!formLoc && !p.ll, sure: sure(res) };
  jumpTo(res.key);
}
let pendingDraft = null, pendingEdit = null;
function shopAfterOpen() {   // the sheet has opened: finish what was waiting for it
  if (!S.sel) return;
  if (pendingDraft && pendingDraft.sel === S.sel.key) {   // back after a reload: the memo you were writing
    const g = pendingDraft; pendingDraft = null;
    if (g.text && !$('#fText').value) $('#fText').value = g.text;
    if (g.detail && !$('#fDetail').value) $('#fDetail').value = g.detail;
    if (g.date) $('#fDate').value = g.date;
    if (g.time) $('#fTime').value = g.time;
    if (g.when) $('#fWhenRow').classList.add('open');
    if (g.links && !$('#fLinks').value) { $('#fLinks').value = g.links; paintLinks(); }
    fShop.name(g.name); paintWhen(); paintWbar();
    $('#sForm').classList.remove('collapsed'); $(g.box === 'photo' ? '#fPhotoBox' : '#fWhereBox').classList.add('open'); paintWhere(); paintPick();
  }
  if (pendingShop && pendingShop.k === S.sel.key) {
    const ps = pendingShop; pendingShop = null;
    setFormShop(ps.p, ps.k);
    if (ps.p.ll) { setFormLoc([ps.p.ll[0], ps.p.ll[1], 0]); dropPin(ps.p.ll, ps.k); }
    if (!$('#fText').value.trim()) $('#fText').value = ps.p.n || '';
    $('#sForm').classList.remove('collapsed'); $('#fWhereBox').classList.add('open'); paintWhere(); paintWbar();
    setTimeout(() => { burst(ps.k, placePoint(ps.k, formLoc)); toast(`${ps.p.n || 'お店'} を付けました。${placeName(ps.k)} にしました` + (ps.drop ? '（いまの位置は、はずしました）' : '') + (ps.sure ? '' : '。町だけ、たしかめてください'), 3400); }, 650);
  }
  if (pendingEdit) {
    const id = pendingEdit; pendingEdit = null;
    const node = document.querySelector(`#sEntries .entry[data-id="${id}"]`), n = Store.notes.get(id);
    if (node && n) editEntry(node, n);
  }
}
function shopResume() {   // the page was reloaded while you were in the map app
  let g = null; try { g = JSON.parse(localStorage.getItem(SHOPGO) || 'null'); } catch (e) {}
  if (!g || !(Date.now() - g.t < 6e5)) return shopDone();
  shopGo = { ...g, shown: false };
  if (g.kind === 'form' && g.sel) { pendingDraft = g; jumpTo(g.sel); }
  else if (g.kind === 'note') { const n = Store.notes.get(g.id); if (n) { pendingEdit = n.id; jumpTo(n.k); } }
  else if (g.kind === 'day') okaeri(g.d, g.name);
  else if (g.kind === 'add') setTimeout(() => shopAddDlg(g.d, g.name), 300);
  setTimeout(shopBack, 1500);
}
// after the walk: a shop becomes a memo of that day, in the town it is in
const recentTowns = () => uniq([...Store.notes.values()].sort(newestFirst).map(n => n.k).filter(k => k[0] === 't')).slice(0, 6);
async function addShopDay(d, p, host, done) {
  const res = await resolveShop(p);
  const put = k => {
    host.innerHTML = '';
    const n = { id: newId(), k, d, at: '', t: p.n || 'お店', s: shopOut(p), ...(p.ll ? { loc: [p.ll[0], p.ll[1], 0] } : {}) };
    Store.putNote(n);
    setTimeout(() => burst(k, placePoint(k, n.loc)), 120);
    toast(`${n.t} を、${placeName(k) || 'この町'} にのこしました`, 2800);
    if (done) done(Store.notes.get(n.id) || n);
  };
  if (sure(res)) return put(res.key);
  // the town is not clear: most likely one you walked that day
  const area = res ? res.key : null, ins = k => !area || k === area || within(area, k);
  const ks = uniq([...dayTowns(d).filter(ins), ...(area ? [area] : []), ...dayTowns(d), ...recentTowns()]).slice(0, 10);
  if (!ks.length) { toast('町がわからなかったので、地図で町をえらんでから、メモの「場所」で付けてください', 3800); return; }
  host.innerHTML = '';
  host.appendChild(Object.assign(document.createElement('span'), { className: 'lab', textContent: `${p.n || 'このお店'}は、どの町でしたか？` }));
  ks.forEach(k => host.appendChild(mkBtn(placeName(k) || '（この町）', 'sc', () => put(k))));
  host.lastChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
const okStep = (n, title, node) => { const r = el2('div', 'okstep'); r.append(el2('b', '', n), el2('span', '', title)); if (node) r.appendChild(node); return r; };
const yday = () => { const x = new Date(today() + 'T12:00:00'); x.setDate(x.getDate() - 1); return x.toISOString().slice(0, 10); };
const dayLabel = d => d === today() ? '今日' : d === yday() ? '昨日' : `${+d.slice(5, 7)}/${+d.slice(8)}`;
function pickDay() {   // ＋ 日をえらんで足す: choose the day, then its page does the rest
  let d = today();
  const di = el2('input'); di.type = 'date'; di.value = d; di.max = today(); di.setAttribute('aria-label', '日付');
  const chips = el2('div', 'pick'), days = uniq([today(), yday(), ...walkDays()]).filter(x => x <= today()).slice(0, 4);
  const paint = () => { chips.innerHTML = ''; days.forEach(x => chips.appendChild(mkBtn(dayLabel(x), 'sc' + (x === d ? ' on' : ''), () => { d = x; di.value = x; paint(); }))); };
  di.onchange = () => { if (di.value) { d = di.value; paint(); } };
  const w1 = el2('div', 'okday'); w1.append(chips, di); paint();
  routeDlg('どの日に足しますか', [el2('p', '', '写真・お店・写真のリンクを足す日をえらぶと、その日のページが開きます。'), w1],
    [['この日を開く', 'btn', () => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > today()) return toast('今日までの日をえらんでください'); closeRoute(); openWalk(d); }], ['やめる', 'btn ghost', closeRoute]]);
}
let theirDay = null;
function openTheirDay(by, d) {   // someone's shared day, to read: what they wrote and the towns they passed — never the line
  if (by === GR.me()) return openWalk(d);
  const w = GX && GX.days.find(x => x.by === by && x.d === d); if (!w) return;
  Replay.stop(); Pane.before('wsheet');
  if (S.sel) select(null);
  curWalk = null; theirDay = { by, d }; editing = null;
  const ns = GX.feed.filter(n => n.by === by && n.d === d).sort(byTime);
  $('#wEyebrow').textContent = `${GR.name(by)}・${fmtDay(d)}の散歩`;
  const ti = $('#wTitle'); ti.textContent = w.title || '名前のない散歩'; ti.classList.toggle('auto', !w.title);
  $('#wStat').textContent = [w.km ? fmtKm(w.km) + (w.t0 && w.t1 ? ` ${w.t0}〜${w.t1}` : '') : '', w.tw.length ? `通った町 ${w.tw.length}` : '', `メモ ${ns.length}`].filter(Boolean).join(' · ');
  const wt = $('#wTags'); wt.innerHTML = ''; wt.appendChild(tagChips(w.tags));
  const body = $('#wBody'); body.innerHTML = '';
  if (w.sum) { const sm = el2('div', 'wsum'), p = el2('div', 'dx', w.sum); p.style.borderLeftColor = GR.color(by); sm.appendChild(p); body.appendChild(sm); }
  if (w.tw.length) {
    body.appendChild(el2('div', 'rule', `通った町 ${w.tw.length}`));
    const box = el2('div', 'twlist'); w.tw.forEach(k => box.appendChild(mkBtn(placeName(k) + ' ›', 'plink', () => jumpTo(k)))); body.appendChild(box);
  }
  body.appendChild(el2('div', 'rule', `メモ ${ns.length}`));
  if (!ns.length) body.appendChild(el2('div', 'empty', 'この日のメモはありません。'));
  ns.forEach(n => body.appendChild(entryNode(n, { other: true, place: true })));
  $('#wsheet').classList.add('open'); document.body.classList.add('wsheet-open');
  Pane.after('wsheet');
  const keys = uniq([...ns.map(n => n.k), ...w.tw]);
  setHighlight({ kind: 'their', label: `${GR.name(by)}・${fmtDay(d)}の散歩`, keys });
  focusKeys(keys, true);
}
function shopAddDlg(d0, nm) {   // 記録 → ＋ お店: any day, even one with nothing written
  let d = d0 || today();
  const di = el2('input'); di.type = 'date'; di.value = d; di.max = today(); di.setAttribute('aria-label', '日付');
  const chips = el2('div', 'pick'), days = uniq([today(), yday(), ...walkDays()]).filter(x => x <= today()).slice(0, 4);
  const paintDays = () => { chips.innerHTML = ''; days.forEach(x => chips.appendChild(mkBtn(dayLabel(x), 'sc' + (x === d ? ' on' : ''), () => { d = x; di.value = x; paintDays(); }))); };
  di.onchange = () => { if (di.value) { d = di.value; paintDays(); } };
  const pick = el2('div', 'pick'), got = el2('div', 'okshops');
  const sf = shopField({ init: nm, k: () => dayTowns(d)[0] || (S.sel && S.sel.key) || recentTowns()[0] || null, ctx: () => ({ kind: 'add', d }),
    onShop: p => { if (p) addShopDay(d, p, pick, n => { sf.clear(); got.appendChild(shopChip(n.s, n.k, 'new')); }); } });
  const w1 = el2('div', 'okday'); w1.append(chips, di);
  const w2 = el2('div', 'okshop'); w2.append(sf.el, pick);
  routeDlg('お店を、あとから足す', [
    el2('p', '', 'Googleマップでお店を開いて「共有」→「コピー」。戻ってきて「コピーしたお店を、付ける」を押すと、その日のメモになります。'),
    okStep('1', 'いつ？', w1), okStep('2', 'どのお店？', w2), got
  ], [['おわる', 'btn', () => { closeRoute(); if (got.children.length) openWalk(d); }]]);
  $('#routeDlg').classList.add('ok');
  paintDays();
}
function shopFromOutside(text) {   // a map link pasted on the map (PC), or sent by a shortcut
  const p = parseShop(text);
  if (!p) return toast('地図のリンクが見つかりませんでした');
  attachToForm(p);
}
