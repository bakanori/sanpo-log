/* SANPO LOG — js/parts.js
   部品 — pieces every screen uses: the tag input, links and photos on a memo card, the photo viewer,
   one panel at a time (‹ back, sheets you pull down), and the short message at the bottom (toast).
   The files load in this order (see index.html): base → parts → records → sync → map → memo → screens → start.
   They share one scope: a name made in an earlier file can be used in any later one, but code that runs
   while the page loads may only use names from its own file and the earlier ones. */
'use strict';

/* ---- tag input: chips + suggestions (used tags first, then a few starters) ---- */
function tagInput(host, init) {
  let tags = uniq((init || []).map(normTag));
  host.classList.add('tagin');
  host.innerHTML = '<div class="tsel"></div><input class="tin" placeholder="＃タグ（Enterで追加）" autocomplete="off"><div class="tsug"></div>';
  const sel = host.querySelector('.tsel'), inp = host.querySelector('.tin'), sug = host.querySelector('.tsug');
  const add = s => { const t = normTag(s); if (t && !tags.includes(t)) tags.push(t); };
  const render = () => {
    sel.innerHTML = '';
    tags.forEach(t => { const b = document.createElement('button'); b.type = 'button'; b.className = 'tchip on'; b.textContent = '#' + t + ' ×'; b.onclick = () => { tags = tags.filter(x => x !== t); render(); }; sel.appendChild(b); });
    sug.innerHTML = '';
    tagSuggestions(normTag(inp.value)).filter(t => !tags.includes(t)).slice(0, 10).forEach(t => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tchip'; b.textContent = '#' + t;
      b.onclick = () => { add(t); inp.value = ''; render(); }; sug.appendChild(b);
    });
  };
  inp.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' || e.key === ',' || e.key === '、') {
      e.preventDefault();
      if (inp.value.trim()) { add(inp.value); inp.value = ''; render(); }
    } else if (e.key === 'Backspace' && !inp.value && tags.length) { tags.pop(); render(); }
  });
  inp.addEventListener('input', render);
  render();
  return { get: () => { if (inp.value.trim()) { add(inp.value); inp.value = ''; } return tags.slice(); }, set: v => { tags = uniq((v || []).map(normTag)); inp.value = ''; render(); }, refresh: render };
}


/* ---- one memo card (used in place sheet, walk timeline) ---- */
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
function linkLabel(u) {
  const h = host(u);
  if (/(^|\.)instagram\.com$/.test(h)) return 'INSTAGRAM';
  if (/^photos\.(app\.goo\.gl|google\.com)$/.test(h) || h === 'goo.gl') return 'GOOGLE PHOTOS';
  if (/(^|\.)(x|twitter)\.com$/.test(h)) return 'X';
  if (/(^|\.)threads\.(net|com)$/.test(h)) return 'THREADS';
  if (/(^|\.)flickr\.com$|flic\.kr$/.test(h)) return 'FLICKR';
  if (/(^|\.)icloud\.com$/.test(h)) return 'ICLOUD';
  return (h || 'LINK').toUpperCase();
}
const parseLinks = s => [...new Set(String(s || '').match(/https?:\/\/[^\s<>"'、。）)]+/g) || [])].slice(0, 12);
/* Photos. Instagram and X posts open inside the app through their own embed pages — loaded only
   when tapped, thrown away on close. Small photos picked from the phone live in the app itself. */
function photoPost(u) {
  let x; try { x = new URL(u); } catch (e) { return null; }
  const h = x.hostname.replace(/^(www|m|mobile)\./, '');
  if (h === 'instagram.com' || h === 'instagr.am') {
    const m = x.pathname.match(/^\/(?:[\w.]+\/)?(p|reels?|tv)\/([\w-]{5,})/);
    if (!m) return null;
    const kind = m[1] === 'p' ? 'p' : m[1] === 'tv' ? 'tv' : 'reel';
    return { svc: 'ig', name: 'INSTAGRAM', mark: 'IG', code: m[2], url: `https://www.instagram.com/${kind}/${m[2]}/`, embed: `https://www.instagram.com/p/${m[2]}/embed/?cr=1&v=14` };
  }
  if (h === 'x.com' || h === 'twitter.com') {
    const m = x.pathname.match(/^\/(?:\w{1,20}|i\/web|i)\/status(?:es)?\/(\d{5,25})/);
    if (!m) return null;
    return { svc: 'x', name: 'X', mark: 'X', code: m[1], url: `https://x.com/i/status/${m[1]}`, embed: `https://platform.twitter.com/embed/Tweet.html?id=${m[1]}&dnt=true&lang=ja&theme=light` };
  }
  return null;
}
const igPost = photoPost;
/* when was it posted? both services keep the time inside the post number */
function postTime(u) {
  const p = photoPost(u); if (!p) return null;
  try {
    if (p.svc === 'x') return Number((BigInt(p.code) >> 22n) + 1288834974657n);
    if (p.code.length < 10) return null;
    let n = 0n;
    for (const c of p.code) { const v = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(c); if (v < 0) return null; n = n * 64n + BigInt(v); }
    const t = Number((n >> 23n) + 1314220021721n);
    return t > Date.UTC(2012, 0, 1) && t < Date.now() + 864e5 ? t : null;
  } catch (e) { return null; }
}
const noteLinks = n => Array.isArray(n.p) ? n.p.filter(u => /^https?:\/\//.test(u)) : [];
const capOf = n => [n.d ? n.d.slice(5).replace('-', '.') + (n.at ? ' ' + n.at : '') : '', n.k ? placeName(n.k) : '', n.t].filter(Boolean).join(' · ');
// what the viewer shows for one memo: its own small photos first, then posts that open inside
const noteItems = n => (n.im || []).map(img => ({ img, cap: capOf(n), nid: n.id, by: n.by }))
  .concat(noteLinks(n).filter(photoPost).map(u => ({ u, cap: capOf(n), nid: n.id, by: n.by })));
// a memo of mine (not someone else's in the group) that still has room for photos
const keepNote = it => { const n = it && it.nid && Store.notes.get(it.nid); return n && (!it.by || it.by === GR.me()) && (n.im || []).length < 8 ? n : null; };
const igItems = ns => ns.flatMap(noteItems);
const IG = {
  list: [], i: 0, f: null, t: 0,
  on: () => $('#ig').classList.contains('open'),
  open(list, i) {
    if (!list.length) return;
    this.list = list; this.i = i || 0;
    $('#ig').classList.add('open'); document.body.classList.add('ig-open');
    this.show();
  },
  show() {
    const it = this.list[this.i], many = this.list.length > 1, box = $('#igBox'), L = $('#igL'), out = $('#igOut'), hint = $('#igH');
    $('#igN').textContent = many ? `${this.i + 1} / ${this.list.length}` : '';
    $('#igPrev').hidden = $('#igNext').hidden = !many;
    $('#igCap').textContent = it.cap || '';
    this.clear();
    $('#igActs').hidden = !!it.img; $('#igKeep').hidden = !!it.img || !keepNote(it);
    if (it.img) {   // a photo kept in the app
      box.classList.add('pic'); out.hidden = true; hint.hidden = true;
      const im = new Image(); im.className = 'igImg'; im.alt = it.cap || '写真';
      box.appendChild(im); this.f = im;
      Thumbs.src(it.img).then(d => { if (this.f !== im) return; if (d) im.src = d; else L.textContent = 'この写真は、入れた端末の中にあります\n（写真は、端末どうしでコピーしません）'; });
      return;
    }
    const p = photoPost(it.u);
    box.classList.remove('pic'); out.hidden = true; hint.hidden = false;   // the big button below does the opening
    out.href = p.url; out.textContent = p.name + ' ↗';
    const svc = p.svc === 'x' ? 'X' : 'Instagram';
    $('#igGo').href = p.url; $('#igGo').textContent = `${svc} で見る ↗`;
    hint.textContent = `出てこないときは、鍵をかけた${p.svc === 'x' ? 'ポスト' : '投稿'}かもしれません。鍵つきのものは ${svc} のきまりで、ここには出せません（自分のものでも）。「${svc} で見る」で開いて、見終わったら${W < 720 ? '左上の ◀ で' : 'このタブに'}戻ってください。`;
    L.textContent = '読みこんでいます…';
    // a new frame each time: changing an iframe's src would add a Back-button step
    const f = document.createElement('iframe');
    f.title = p.svc === 'x' ? 'X' : 'Instagram'; f.allow = 'autoplay; encrypted-media; picture-in-picture; clipboard-write'; f.allowFullscreen = true;
    const w = Math.max(326, Math.min(540, box.clientWidth - 2 || 360));
    f.style.height = Math.round(p.svc === 'x' ? w * 1.1 + 190 : w * 1.25 + 200) + 'px';
    f.onload = () => { if (this.f !== f) return; clearTimeout(this.t); f.classList.add('on'); L.textContent = ''; };
    f.src = p.svc === 'ig' ? p.embed + '&wp=' + w : p.embed;   // with these, the embed reports its real height
    box.appendChild(f); box.scrollTop = 0; this.f = f;
    this.t = setTimeout(() => { if (this.f === f && !f.classList.contains('on')) L.textContent = `読み込めませんでした\n「${svc} で見る」から開いてください`; }, 15000);
  },
  step(d) { if (this.list.length < 2) return; this.i = (this.i + d + this.list.length) % this.list.length; this.show(); },
  keep() {   // pick the same photo from the phone: it goes onto the memo, and shows here right away
    const it = this.list[this.i], n = keepNote(it); if (!n) return;
    pickPhotos(8 - (n.im || []).length, async ds => {
      const ids = await saveThumbs(ds), cur = Store.notes.get(n.id); if (!cur) return;
      Store.putNote({ ...cur, im: [...(cur.im || []), ...ids].slice(0, 8) });
      if (this.on() && this.list[this.i] === it) {
        this.list.splice(this.i, 0, ...ids.map(img => ({ img, cap: it.cap, nid: it.nid, by: it.by })));
        this.show();
      }
      toast('のこしました。次からは、この写真がすぐに出ます', 3200);
    });
  },
  clear() { clearTimeout(this.t); if (this.f) { this.f.remove(); this.f = null; } $('#igL').textContent = ''; }
};
// the embed pages tell their parent how tall they are
addEventListener('message', e => {
  if (!IG.f || e.source !== IG.f.contentWindow) return;
  let m; try { m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (er) { return; }
  let h = 0;
  if (/^https:\/\/(www\.)?instagram\.com$/.test(e.origin)) h = m && m.type === 'MEASURE' && m.details ? +m.details.height : 0;
  else if (/^https:\/\/platform\.(twitter|x)\.com$/.test(e.origin)) { const r = m && m['twttr.embed']; if (r && r.method === 'twttr.private.resize' && r.params && r.params[0]) h = +r.params[0].height; }
  if (h > 120 && h < 6000) IG.f.style.height = Math.ceil(h) + 'px';
});
$('#igPrev').onclick = () => IG.step(-1);
$('#igKeep').onclick = () => IG.keep();
$('#igNext').onclick = () => IG.step(1);
$('#ig').addEventListener('click', e => { if (e.target.id === 'ig') closePanel('ig'); });
{ let x0 = null, y0 = 0;   // swipe sideways (outside the photo itself) for the next one
  $('#ig').addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  $('#ig').addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) IG.step(dx < 0 ? 1 : -1); }, { passive: true }); }
function photosBtn(rule, ns) {
  const it = igItems(ns);
  if (it.length) rule.appendChild(mkBtn(`写真 ${it.length} ▸`, 'rl', () => IG.open(it, 0), 'この中の写真をまとめて見る'));
}
function chips(urls, n) {
  const f = document.createDocumentFragment();
  const posts = (urls || []).filter(photoPost);
  const list = n ? noteItems(n) : posts.map(u => ({ u, cap: '' })), off = list.length - posts.length;
  let k = 0;
  (urls || []).forEach(u => {
    const a = document.createElement('a'); a.className = 'chip'; a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer';
    const p = photoPost(u);
    if (p) {
      const i = k++;
      a.textContent = '写真' + (posts.length > 1 ? ' ' + (i + 1) : '') + ' ▸';
      const mk = document.createElement('i'); mk.className = 'svc'; mk.textContent = p.mark; a.appendChild(mk);
      a.title = `${p.svc === 'x' ? 'X' : 'Instagram'} の投稿を、アプリの中で見る`;
      a.onclick = e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); IG.open(list, off + i); };
    } else a.textContent = linkLabel(u) + ' ↗';
    f.appendChild(a);
  });
  return f;
}
function thumbStrip(n, edit) {
  const ids = [...(n.im || []), ...(Array.isArray(n.imd) ? n.imd : [])];
  const box = document.createElement('div'); box.className = 'thumbs';
  const list = noteItems(n);
  ids.forEach((id, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'th'; b.setAttribute('aria-label', '写真を大きく見る');
    const im = new Image(); im.alt = ''; im.decoding = 'async'; b.appendChild(im);
    Thumbs.small(id).then(d => d || Thumbs.src(id)).then(d => { if (d) im.src = d; else b.classList.add('miss'); });
    b.onclick = e => { e.stopPropagation(); if (!edit) IG.open(list, i); };
    if (edit) { const rm = document.createElement('span'); rm.className = 'rm'; rm.textContent = '×'; rm.setAttribute('aria-label', 'この写真をはずす'); b.appendChild(rm); b.onclick = e => { e.stopPropagation(); edit(id); }; }
    box.appendChild(b);
  });
  return box;
}

/* one panel at a time — ノート, a place, a day. Opening one from another remembers where you were, so ‹ takes you back as it was. */
const PANES = ['drawer', 'sheet', 'wsheet'];
const Pane = {
  stack: [], soon: null, backTo: null, backT: 0, mode: '',
  open() { return PANES.find(id => $('#' + id).classList.contains('open')) || null; },
  snap(id) {
    const y = $('#' + id).querySelector('.pbody').scrollTop;
    if (id === 'drawer') return { id, tab: dTab, tag: dTag, q: $('#dFilter').value, y, label: 'ノート' };
    if (id === 'sheet' && S.sel) return { id, key: S.sel.key, y, label: placeName(S.sel.key) || 'この場所' };
    if (id === 'wsheet' && curWalk) return { id, d: curWalk, y, label: mdy(curWalk) };
    if (id === 'wsheet' && theirDay) return { id, their: { ...theirDay }, y, label: `${GR.name(theirDay.by)} ${mdy(theirDay.d)}` };
    return null;
  },
  still(id) { const p = $('#' + id); p.classList.add('still'); setTimeout(() => p.classList.remove('still'), 80); },   // a swap, not a slide
  before(to) {   // just before a panel opens
    const from = this.open(), going = this.backTo === to && Date.now() - this.backT < 9000;
    if (going) { this.backTo = null; this.mode = from && from !== to ? 'back' : ''; }
    else if (from && from !== to) {
      const s = this.snap(from), top = this.stack[this.stack.length - 1];
      if (s && !(top && top.id === s.id && top.key === s.key && top.d === s.d)) this.stack.push(s);
      if (this.stack.length > 8) this.stack.shift();
      this.mode = 'swap';
    } else if (!from) { this.stack = this.soon && Date.now() - this.soon.t < 9000 ? [this.soon.s] : []; this.mode = ''; }
    this.soon = null;
    if (from && from !== to) { this.still(from); this.still(to); closePanel(from, true); }
  },
  after(to) {   // just after: ‹ says where it goes, and the page turns
    const p = $('#' + to), b = p.querySelector('.back'), top = this.stack[this.stack.length - 1];
    b.hidden = !top;
    if (top) { b.lastChild.textContent = top.label; b.setAttribute('aria-label', `${top.label} にもどる`); }
    if (this.mode) {
      p.classList.remove('turn', 'turnb'); void p.offsetWidth;
      const c = this.mode === 'back' ? 'turnb' : 'turn'; p.classList.add(c); setTimeout(() => p.classList.remove(c), 420);
    }
    this.mode = '';
  },
  leave() {   // a row in ノート: on a phone the map has to be seen, so ノート steps aside now and waits behind ‹
    const f = this.open(); if (!f || W >= 720) return;
    const s = this.snap(f); if (s) this.soon = { s, t: Date.now() };
    closePanel(f, true);
  },
  back() {
    const s = this.stack.pop(); if (!s) return;
    this.backTo = s.id; this.backT = Date.now();
    if (s.id === 'drawer') { dTab = s.tab; dTag = s.tag; $('#dFilter').value = s.q || ''; renderDrawer(); showDrawer(); $('#dBody').scrollTop = s.y; }
    else if (s.id === 'wsheet') { if (s.their) openTheirDay(s.their.by, s.their.d); else openWalk(s.d); $('#wBody').scrollTop = s.y; }
    else if (s.id === 'sheet') {   // the map goes there first, then the page comes back
      if (W < 720) { const f = this.open(); if (f) closePanel(f, true); }
      jumpTo(s.key); this.scrollTo = s.y;
    }
  },
  clear() { this.stack = []; this.soon = null; this.backTo = null; }
};
document.querySelectorAll('.panel .back').forEach(b => b.onclick = e => { e.stopPropagation(); Pane.back(); });
function syncTools() {
  const open = $('#drawer').classList.contains('open');
  $('#bList').classList.toggle('on', open && dTab === 'list');
  $('#bLog').classList.toggle('on', open);
}
function closePanel(id, quiet) {
  const p = $('#' + id); p.classList.remove('open');
  document.body.classList.remove(id + '-open');
  if (id === 'sheet' || id === 'wsheet') { $('#editBar').hidden = true; document.body.classList.remove('editing'); }
  if (id === 'sheet' && !quiet) { select(null); }
  if (id === 'wsheet') { curWalk = null; theirDay = null; editing = null; Replay.stop(); welcomeDay = null; }
  if (id === 'drawer') syncTools();
  if (id === 'ig') IG.clear();
  if (['sheet', 'wsheet', 'drawer'].includes(id) && SHEET.small[id]) {   // next time it opens at 80% again (after it has slid away)
    SHEET.small[id] = false; sheetBody();
    setTimeout(() => { if (!p.classList.contains('open')) p.classList.remove('small'); }, 320);
  }
}
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { if (PANES.includes(b.dataset.close)) Pane.clear(); closePanel(b.dataset.close); });
/* phones: a sheet opens to 80%. Pull its head down to 45% (to see the map), down again to close; up to come back.
   It follows the finger, then settles by where and how fast you let go — fast, with a long soft ending. */
const SETTLE = 'transform var(--t-move) var(--ease-out)';
function settleSheet(panel) {
  panel.style.transition = SETTLE; panel.style.transform = 'translateY(0)';
  const done = () => { panel.style.transition = ''; panel.style.transform = ''; panel.removeEventListener('transitionend', done); };
  panel.addEventListener('transitionend', done); setTimeout(done, 600);
}
function sheetTo(id, small) {   // 80% ⇄ 45% without a jump: swap the height, then glide from where it is now
  const panel = $('#' + id); if (!panel.classList.contains('open') || W >= 720) return;
  const was = !!SHEET.small[id]; if (was === small && !panel.style.transform) return;
  const liftBefore = liftPx();
  const top0 = panel.getBoundingClientRect().top;
  panel.style.transition = 'none'; panel.style.transform = '';
  SHEET.small[id] = small; panel.classList.toggle('small', small); sheetBody();
  const top1 = panel.getBoundingClientRect().top;
  panel.style.transform = `translateY(${top0 - top1}px)`;
  void panel.offsetHeight;
  settleSheet(panel);
  const d = liftPx() - liftBefore;   // the map moves with it, so the place stays in the open part
  if (Math.abs(d) > 4) flyTo({ cx: V.cx, cy: V.cy + d * V.s, s: V.s }, 480);
}
function sheetBody() { document.body.classList.toggle('sheet-small', ['sheet', 'wsheet', 'drawer'].some(x => SHEET.small[x] && $('#' + x).classList.contains('open'))); }
['sheet', 'wsheet', 'drawer'].forEach(id => {
  const panel = $('#' + id), head = panel.querySelector('.phead'); if (!head) return;
  let y0 = null, dy = 0, lastY = 0, lastT = 0, vy = 0, moved = false;
  head.addEventListener('touchstart', e => {
    if (W >= 720 || e.touches.length !== 1 || e.target.closest('input,textarea')) return;
    y0 = lastY = e.touches[0].clientY; lastT = performance.now(); dy = 0; vy = 0; moved = false;
  }, { passive: true });
  head.addEventListener('touchmove', e => {
    if (y0 == null) return;
    const y = e.touches[0].clientY, now = performance.now();
    vy = vy * .4 + .6 * (y - lastY) / Math.max(1, now - lastT); lastY = y; lastT = now;   // px/ms, smoothed
    dy = y - y0;
    if (!moved && Math.abs(dy) < 6) return;
    moved = true;
    const small = !!SHEET.small[id];
    const t = dy >= 0 ? dy : small ? Math.max(dy, -H * .35 - 30) + (dy < -H * .35 - 30 ? (dy + H * .35 + 30) * .2 : 0) : dy * .22;   // up: from 45% it follows to 80%; at 80% it only gives a little
    panel.style.transition = 'none'; panel.style.transform = `translateY(${t}px)`;
  }, { passive: true });
  const end = () => {
    if (y0 == null) return; y0 = null;
    if (!moved) return;
    const small = !!SHEET.small[id], v = vy;
    let to;
    if (!small) to = dy > H * .5 || (dy > 160 && v > 1.2) ? 'close' : dy > H * .12 || (dy > 24 && v > .45) ? 'small' : 'stay';
    else to = dy > H * .14 || (dy > 24 && v > .45) ? 'close' : dy < -H * .08 || (dy < -24 && v < -.45) ? 'big' : 'stay';
    if (to === 'close') { panel.style.transition = ''; panel.style.transform = ''; closePanel(id); }
    else if (to === 'small') sheetTo(id, true);
    else if (to === 'big') sheetTo(id, false);
    else settleSheet(panel);
  };
  head.addEventListener('touchend', end); head.addEventListener('touchcancel', end);
});

let toastT;
function toast(s, ms, act) {   // act: [label, fn] — one button, e.g. もどす
  const t = $('#toast'); t.textContent = s; t.classList.toggle('act', !!act);
  if (act) { const b = document.createElement('button'); b.type = 'button'; b.className = 'tact'; b.textContent = act[0]; b.onclick = e => { e.stopPropagation(); clearTimeout(toastT); t.classList.remove('show', 'act'); act[1](); }; t.appendChild(b); }
  t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show', 'act'), ms || 2400);
}
