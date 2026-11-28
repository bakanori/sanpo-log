/* SANPO LOG — js/screens.js
   画面 — where am I (GPS), ノート (list · walks · tags · group), the day page, 道のり (GPX and recording),
   バックアップ and 設定.
   The files load in this order (see index.html): base → parts → records → sync → map → memo → screens → start.
   They share one scope: a name made in an earlier file can be used in any later one, but code that runs
   while the page loads may only use names from its own file and the earlier ones. */
'use strict';

/* ---------- GPS: where am I? ---------- */
let me = null;
function getPos() {
  return new Promise((res, rej) => {
    if (!window.isSecureContext) return rej(new Error('insecure'));
    if (!('geolocation' in navigator)) return rej(new Error('nogeo'));
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy || 0 }),
      e => rej(e), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}
let geoRetry = null;
function geoHelp() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const inApp = /Instagram|FBAN|FBAV|Line\/|Twitter|MicroMessenger/.test(ua);
  const app = /CriOS/.test(ua) ? 'Chrome' : /EdgiOS/.test(ua) ? 'Edge' : /FxiOS/.test(ua) ? 'Firefox' : null;
  let why = 'このブラウザで位置情報が「許可しない」になっています。', steps;
  if (inApp) {
    why = 'アプリの中のブラウザでは、現在地が使えないことがあります。';
    steps = ['右上（または右下）の <b>…</b> から <b>「ブラウザで開く」</b> を選ぶ', '開いたブラウザで、もう一度 <b>◎ HERE</b> か <b>＋</b> を押して <b>「許可」</b>'];
  } else if (ios && app) {
    steps = [`iPhoneの <b>「設定」</b> を開き、<b>「アプリ」→「${app}」→「位置情報」</b>`,
      '<b>「このAppの使用中」</b> を選ぶ（<b>「正確な位置情報」</b> もオン）',
      `${app}に戻ってこのページを再読み込みし、<b>「もう一度ためす」</b> → <b>「許可」</b>`,
      '<li class="note">設定の一覧に「アプリ」がない場合は、そのまま「' + app + '」を探してください。</li>'];
  } else if (ios) {
    steps = ['iPhoneの <b>「設定」</b> を開き、<b>「アプリ」→「Safari」→「位置情報」</b> を <b>「確認」</b> か <b>「許可」</b> にする',
      '<b>「設定」→「プライバシーとセキュリティ」→「位置情報サービス」→「Safari Webサイト」</b> を <b>「このAppの使用中」</b> にする',
      'Safariに戻ってこのページを再読み込みし、<b>「もう一度ためす」</b> → <b>「許可」</b>',
      '<li class="note">アドレスバーの <b>ぁあ</b> →「Webサイトの設定」→「位置情報」でも変えられます。</li>'];
  } else if (/Android/.test(ua)) {
    steps = ['アドレスバー左のアイコン → <b>「権限」</b>（または「サイトの設定」）→ <b>「位置情報」</b> を許可',
      'スマホ本体の <b>位置情報</b>（画面上から下に引いて出るクイック設定）がオンか確認',
      'このページを再読み込みして <b>「もう一度ためす」</b>'];
  } else {
    steps = ['アドレスバー左のアイコン（鍵や設定のマーク）→ <b>「位置情報」</b> を <b>「許可」</b>', 'このページを再読み込みして <b>「もう一度ためす」</b>'];
  }
  $('#geoWhy').textContent = why;
  $('#geoSteps').innerHTML = steps.map(x => x.startsWith('<li') ? x : `<li>${x}</li>`).join('');
  $('#geo').classList.add('open');
}
$('#geoRetry').onclick = () => { closePanel('geo'); const f = geoRetry; if (f) f(); };
$('#geoMap').onclick = () => { closePanel('geo'); toast(S.level === 'muni' ? '地図で町を押すと、その町にメモできます' : '地図を押して、歩いた町まで進んでください', 3200); };
$('#geo').addEventListener('click', e => { if (e.target.id === 'geo') closePanel('geo'); });
function geoErr(e, retry) {
  if (e && e.code === 1) { geoRetry = retry || null; return geoHelp(); }
  toast(e && e.code === 3 ? '現在地の取得に時間がかかっています。空の見える場所で、もう一度試してください'
    : e && e.code === 2 ? '現在地を特定できませんでした（屋内では時間がかかることがあります）'
    : e && e.message === 'insecure' ? '現在地は https のページでだけ使えます（GitHub Pagesで開いてください）'
    : e && e.message === 'outside' ? '日本の外にいるようです'
    : '現在地を取得できませんでした');
}
function exactHits(feats, lng, lat, oki) {
  const hits = [];
  for (const f of feats) {
    const p = proj(lng, lat, oki(f));
    for (const part of f.parts || []) {
      const b = part.bb;
      if (p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3] && inside(p, part.ring)) hits.push({ f, a: part.area });
    }
  }
  return hits.sort((a, b) => a.a - b.a).map(h => h.f);   // smallest first (enclaves win)
}
function nearest(feats, lng, lat, oki) {
  let best = null;
  for (const f of feats) {
    const p = proj(lng, lat, oki(f));
    for (const part of f.parts || []) for (const q of part.ring) {
      const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
      if (!best || d < best.d) best = { f, d };
    }
  }
  return best && { f: best.f, d: Math.sqrt(best.d) };
}
async function locate() {
  const pos = await getPos();
  const r = await whereIs(pos.lng, pos.lat);
  me = { ...pos, x: r.p[0], y: r.p[1] };
  drawMe();
  return { pc: r.pc, mc: r.mc, key: r.key, name: r.name, loc: [+pos.lat.toFixed(5), +pos.lng.toFixed(5), Math.round(pos.acc)] };
}
async function whereIs(lng, lat) {
  const pos = { lng, lat };
  const isOki = f => f.c === '47';
  // coarse prefecture outlines first, then confirm with detailed city outlines (handles borders & coasts)
  const exact = exactHits(D.japanFeats, pos.lng, pos.lat, isOki).map(f => f.c);
  const near = D.japanFeats.map(f => ({ c: f.c, d: (nearest([f], pos.lng, pos.lat, isOki) || { d: 1e9 }).d }))
    .filter(x => x.d < 40 && !exact.includes(x.c)).sort((a, b) => a.d - b.d).map(x => x.c);
  const cands = [...exact, ...near].slice(0, 4);
  if (!cands.length) throw new Error('outside');
  let mc = null, pc = null, fallback = null;
  for (const c of cands) {
    const P = await ensurePref(c);
    const o = () => c === '47';
    const hit = exactHits(P.feats, pos.lng, pos.lat, o)[0];
    if (hit) { mc = hit.c; pc = c; break; }
    const n = nearest(P.feats, pos.lng, pos.lat, o);
    if (n && (!fallback || n.d < fallback.d)) fallback = { c, mc: n.f.c, d: n.d };
  }
  if (!mc) { if (!fallback || fallback.d > 20) throw new Error('outside'); pc = fallback.c; mc = fallback.mc; }
  const towns = await ensureTowns(mc);
  const p = proj(pos.lng, pos.lat, pc === '47');
  let ti = -1, bd = Infinity;
  towns.forEach((t, i) => t.pts.forEach(q => { const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d < bd) { bd = d; ti = i; } }));
  return { pc, mc, p, key: ti >= 0 ? towns[ti].k : 'm' + mc, name: ti >= 0 ? towns[ti].n : D.muni[mc].n };
}
const metersToUnits = (m, lat) => m / (1113.2 * Math.cos(lat * Math.PI / 180));
function drawMe() {
  const g = $('#gMe');
  if (!me) { g.style.display = 'none'; return; }
  g.style.display = '';
  const a = $('#meAcc');
  a.setAttribute('cx', me.x); a.setAttribute('cy', me.y); a.setAttribute('r', metersToUnits(Math.max(me.acc, 5), me.lat));
  const d = `M${me.x} ${me.y}h0`;
  $('#meRing').setAttribute('d', d); $('#meCore').setAttribute('d', d);
}
function showPin(loc, key) {
  const pc = key.slice(1, 3);
  const [x, y] = proj(loc[1], loc[0], pc === '47');
  const d = `M${x} ${y}h0`;
  $('#pin').setAttribute('d', d); $('#pinRing').setAttribute('d', d);
  const s = Math.min(V.s, .012);
  flyTo({ cx: x + (W >= 720 ? 230 * s : 0), cy: y + (W < 720 ? liftPx() * s : 0), s }, 700);
}
let locBusy = false;
async function goHere(withMemo) {
  if (locBusy) return;
  locBusy = true;
  $('#fab').style.opacity = .5;
  toast('現在地を確認しています…');
  try {
    const r = await locate();
    started();
    toast('いまの場所：' + D.muni[r.mc].n + ' ' + (r.key[0] === 't' ? r.name : ''));
    if (withMemo) { quickNext = r.loc; jumpTo(r.key); }
    else {
      origin = null;
      const T = { cx: me.x, cy: me.y + (W < 720 ? 0 : 0), s: Math.min(V.s, .01) };
      if (location.hash.slice(1) === r.mc) flyTo(T, 800);
      else { pendingFly = T; go(r.mc); }
    }
  } catch (e) { geoErr(e, () => goHere(withMemo)); }
  finally { locBusy = false; $('#fab').style.opacity = ''; }
}
let pendingFly = null;
$('#fab').onclick = () => goHere(true);
$('#bLoc').onclick = () => goHere(false);

/* ---------- drawer: LIST · WALKS · TAGS ---------- */
let dTab = 'walks', dRaw = false, dTag = null, dMore = false;
function walkDays() {
  const s = new Set([...IX.byDate.keys(), ...Store.walks.keys()]);
  return [...s].sort().reverse();
}
function autoTitle(d) {
  const ns = IX.byDate.get(d) || [];
  const short = x => x && x.replace(/^(.+)市$/, '$1').replace(/^(.{2,})区$/, '$1').replace(/^(.{2,3})県$/, '$1');   // 柏市→柏, 千代田区→千代田, 千葉県→千葉
  const names = uniq(ns.map(n => short(n.k[0] === 'p' ? placeName(n.k) : placeName('m' + n.k.slice(1, 6)) || placeLabel(n.k).split(' ')[1])).filter(Boolean));
  const wd = '日月火水木金土'[new Date(d + 'T12:00:00').getDay()] + '曜の';
  if (!names.length) return wd + '散歩';
  return wd + names.slice(0, 2).join('・') + (names.length > 2 ? ' ほか' : '');
}
/* one year at a glance: a dot per day, orange where you walked; tap to open that day */
function yearCal(days) {
  const has = new Map(days.map(d => [d, (IX.byDate.get(d) || []).length]));
  const ymd = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const now = new Date(today() + 'T12:00:00'), WK = 53, C = 6.4, R = C / 2, top = 13;
  const start = new Date(now); start.setDate(now.getDate() - now.getDay() - (WK - 1) * 7);
  let dots = '', hits = '', labels = '', n = 0, lastM = -1;
  for (let i = 0; i < WK * 7; i++) {
    const x = new Date(start); x.setDate(start.getDate() + i);
    if (x > now) break;
    const w = Math.floor(i / 7), r = i % 7, key = ymd(x), cx = (w * C + R).toFixed(1), cy = (top + r * C + R).toFixed(1);
    if (x.getMonth() !== lastM && (x.getDate() <= 7) && r === 0 && w < WK - 2) { labels += `<text x="${(w * C + .5).toFixed(1)}" y="8">${x.getMonth() + 1}</text>`; lastM = x.getMonth(); }
    if (has.has(key)) {
      n++; const c = has.get(key);
      dots += `<circle class="on" cx="${cx}" cy="${cy}" r="${Math.min(R - .25, 1.7 + c * .4).toFixed(2)}"/>`;
      hits += `<rect x="${(w * C).toFixed(1)}" y="${(top + r * C).toFixed(1)}" width="${C}" height="${C}" data-d="${key}"><title>${key.replace(/-/g, '.')}${c ? ' · メモ ' + c : ''}</title></rect>`;
    } else dots += `<circle cx="${cx}" cy="${cy}" r=".75"/>`;
    if (key === today()) dots += `<circle class="today" cx="${cx}" cy="${cy}" r="${(R - .2).toFixed(2)}"/>`;
  }
  const box = document.createElement('div'); box.className = 'ycal';
  box.innerHTML = `<div class="ycl"><span>この1年で</span><b>${n}</b><span>日 歩きました</span></div><svg viewBox="0 0 ${WK * C} ${top + 7 * C}" role="img" aria-label="この1年の散歩カレンダー">${labels}${dots}${hits}</svg>`;
  box.querySelector('svg').addEventListener('click', e => { const r = e.target.closest('rect[data-d]'); if (r) openWalk(r.dataset.d); });
  return box;
}
function walkStat(d) {
  const ns = IX.byDate.get(d) || [];
  const towns = uniq(ns.filter(n => n.k[0] === 't').map(n => n.k)).length;
  const raw = (Store.walks.get(d) || {}).sum ? 0 : 1;   // まだ書いていない日 = この日のことを、まだ書いていない
  return { ns, towns, raw };
}
function renderDrawer() {
  const body = $('#dBody'), q = $('#dFilter').value.trim();
  ['list', 'walks', 'tags', 'group'].forEach(t => { const b = $('#t_' + t); b.classList.toggle('on', dTab === t); b.setAttribute('aria-selected', dTab === t ? 'true' : 'false'); });
  tabBar();
  $('#dFilter').placeholder = dTab === 'list' ? '名前で絞り込み' : dTab === 'walks' || dTab === 'group' ? '散歩・メモを検索' : 'タグを検索';
  $('#dFilter').style.display = dTab === 'tags' && dTag ? 'none' : '';
  body.innerHTML = '';
  const frag = document.createDocumentFragment();
  const empty = s => { const d = document.createElement('div'); d.className = 'empty'; d.textContent = s; frag.appendChild(d); };
  if (dTab === 'list') {
    let rows = [];
    if (S.level === 'japan') rows = D.P.map(([pc, n, m]) => { const a = AG.pref.get(pc); return { n, c: a ? `${a.munis.size}/${m}` : `0/${m}`, f: a ? a.munis.size / m : 0, v: !!a, memo: IX.byPlace.has('p' + pc), go: () => { origin = null; go(pc); } }; });
    else if (S.level === 'pref') rows = D.pref[S.pc].feats.slice().sort((a, b) => a.c < b.c ? -1 : 1).map(f => { const a = AG.muni.get(f.c), T = D.pref[S.pc].T[f.c] || 0; return { n: f.n, c: `${a ? a.towns : 0}/${T}`, f: T && a ? a.towns / T : (a ? 1 : 0), v: !!a, memo: IX.byPlace.has('m' + f.c), go: () => { origin = null; go(f.c); } }; });
    else if (townData) rows = townData.towns.map((t, i) => ({ n: t.n, c: (IX.byPlace.get(t.k) || []).length || '', v: visK(t.k), go: () => selectTown(i, true) }));
    const unit = S.level === 'japan' ? '都道府県' : S.level === 'pref' ? '市区町村' : '町';
    let shown = rows.filter(r => !q || r.n.includes(q));
    if (!q && shown.some(r => r.v) && shown.some(r => !r.v)) {   // walked first; the others behind one line
      const rest = shown.filter(r => !r.v);
      shown = shown.filter(r => r.v);
      if (dMore) shown = shown.concat(rest);
      setTimeout(() => {
        const t = mkBtn(dMore ? `まだ歩いていない${unit}を、たたむ` : `まだ歩いていない${unit} ${rest.length} ▾`, 'more', () => { dMore = !dMore; renderDrawer(); });
        const vs = body.querySelectorAll('.li.v'); const last = vs[vs.length - 1];
        last ? last.after(t) : body.prepend(t);
      });
    }
    shown.slice(0, 3000).forEach(r => {
      const b = document.createElement('button'); b.className = 'li' + (r.v ? ' v' : '');
      b.innerHTML = `<span class="n"><i></i><span></span>${r.memo ? '<em>メモ</em>' : ''}</span><span class="c"></span>` + (r.f !== undefined ? `<span class="b"><i style="width:${Math.round(r.f * 100)}%"></i></span>` : '');
      b.querySelector('.n span').textContent = r.n; b.querySelector('.c').textContent = r.c;
      b.onclick = () => { Pane.leave(); r.go(); };
      frag.appendChild(b);
    });
  } else if (dTab === 'walks') {
    const days = walkDays();
    if (!q) {
      const ar = document.createElement('div'); ar.className = 'addrow';
      ar.appendChild(mkBtn('＋ 日をえらんで足す', 'addq addday', () => pickDay(), '写真・お店・写真のリンクを、えらんだ日に足す（その日のページが開きます）'));
      ar.appendChild(mkBtn('＋ 道のり（GPX）', 'addq', pickGPX, 'ほかのアプリで記録した道のり（GPXファイル）を読みこむ'));
      frag.appendChild(ar);
      frag.appendChild(yearCal(days));
    }
    const nraw = days.filter(d => walkStat(d).raw).length;
    const seg = document.createElement('div'); seg.className = 'seg';
    seg.innerHTML = `<button data-r="0">すべて ${days.length}</button><button data-r="1">まだ書いていない日 ${nraw}</button>`;
    seg.querySelectorAll('button').forEach(b => { b.classList.toggle('on', +b.dataset.r === +dRaw); b.onclick = () => { dRaw = !!+b.dataset.r; renderDrawer(); }; });
    frag.appendChild(seg);
    let month = '';
    const hit = d => {
      if (!q) return true;
      const w = Store.walks.get(d) || {};
      return (w.title || '').includes(q) || (w.sum || '').includes(q) || (w.tags || []).some(t => t.includes(q)) ||
        (IX.byDate.get(d) || []).some(n => (n.t || '').includes(q) || (n.x || '').includes(q) || (n.s && ((n.s.n || '') + (n.s.a || '')).includes(q)) || placeLabel(n.k).includes(q) || (n.tags || []).some(t => t.includes(q)));
    };
    const list = days.filter(d => (!dRaw || walkStat(d).raw) && hit(d));
    if (!list.length) empty(q ? '見つかりませんでした' : dRaw ? 'まだ書いていない日はありません。ぜんぶ書けています' : 'まだ散歩の記録はありません');
    list.forEach(d => {
      if (d.slice(0, 7) !== month) { month = d.slice(0, 7); const r = document.createElement('div'); r.className = 'rule'; r.textContent = month.replace('-', '.'); frag.appendChild(r); }
      const w = Store.walks.get(d) || {}, st = walkStat(d);
      const b = document.createElement('button'); b.className = 'walk' + (curWalk === d ? ' cur' : '');
      b.innerHTML = '<div class="d"><span></span><b></b></div><div class="ti"></div><div class="tags"></div>';
      b.querySelector('.d span').textContent = fmtDay(d);
      b.querySelector('.d b').textContent = (w.km ? fmtKm(w.km) + ' · ' : '') + `メモ ${st.ns.length}` + (st.towns ? ` · 町 ${st.towns}` : '');
      const ti = b.querySelector('.ti'); ti.textContent = w.title || autoTitle(d); ti.classList.toggle('auto', !w.title);
      const tg = b.querySelector('.tags');
      if (w.sum) { const s = el2('div', 'sm', w.sum.replace(/\s+/g, ' ').slice(0, 60)); b.insertBefore(s, tg); }
      (w.tags || []).forEach(t => { const s = document.createElement('span'); s.className = 'tag'; s.textContent = '#' + t; tg.appendChild(s); });
      b.onclick = () => openWalk(d);
      frag.appendChild(b);
    });
  } else if (dTab === 'group') {
    if (!GR.on() || !GX) empty('グループに入っていません。設定からグループを作るか、招待リンクを開いてください。');
    else {
      if (GR.live().length > 1) {   // several groups: choose whose notes (the map follows)
        const pk = el2('div', 'pick gpick');
        GR.live().forEach(G => pk.appendChild(mkBtn(G.g.name, 'sc' + (GR.cur() === G ? ' on' : ''), () => { GR.view = G.gid; GR.saveView(); groupIndex(); paintGroup(); changed(); renderDrawer(); })));
        frag.appendChild(pk);
      }
      const me = GR.me();
      const dayRows = GX.days.map(w => ({ ...w, day: true })).filter(w => !q || w.title.includes(q) || w.sum.includes(q) || GR.name(w.by).includes(q));
      const all = [...[...Store.notes.values()].filter(n => GR.isShared(n)).map(n => ({ ...n, by: me })), ...GX.feed]
        .filter(n => !q || (n.t || '').includes(q) || (n.x || '').includes(q) || placeLabel(n.k).includes(q) || GR.name(n.by).includes(q)).sort(newestFirst).slice(0, 200);
      for (const w of dayRows) { const i = all.findIndex(n => n.d <= w.d); all.splice(i < 0 ? all.length : i, 0, w); }   // a day sits above its memos
      if (!all.length) empty(q ? '見つかりませんでした' : `まだ「${GR.g.name}」に共有されたメモはありません。書くときの「共有」で「${GR.g.name}」を選ぶと、ここに出ます。`);
      let month = '';
      all.forEach(n => {
        if (n.d.slice(0, 7) !== month) { month = n.d.slice(0, 7); const r = document.createElement('div'); r.className = 'rule'; r.textContent = month.replace('-', '.'); frag.appendChild(r); }
        if (n.day) {   // a shared day: its name, and how many towns it passed
          const b = document.createElement('button'); b.className = 'log dayrow';
          b.innerHTML = '<div class="d"></div><div class="p"></div><div class="t"></div>';
          b.querySelector('.d').append(whoChip(n.by), document.createTextNode(fmtDay(n.d) + ' の散歩'));
          b.querySelector('.p').textContent = (n.title || '名前のない散歩') + (n.tw.length ? `（通った町 ${n.tw.length}）` : '');
          b.querySelector('.t').textContent = n.sum.replace(/\s+/g, ' ').slice(0, 60);
          b.onclick = () => openTheirDay(n.by, n.d);
          frag.appendChild(b); return;
        }
        const b = document.createElement('button'); b.className = 'log';
        b.innerHTML = '<div class="d"></div><div class="p"></div><div class="t"></div>';
        b.querySelector('.d').append(whoChip(n.by), document.createTextNode(fmtDay(n.d) + (n.at ? '  ' + n.at : '')));
        b.querySelector('.p').textContent = placeLabel(n.k);
        const nph = +n.ph || (n.im || []).length || (Array.isArray(n.imd) ? n.imd.length : 0);
        b.querySelector('.t').textContent = n.t || n.x || withText(n) || (nph ? (n.by === me ? `写真 ${nph} 枚（この端末に）` : `写真 ${nph} 枚は、本人の手もとに`) : '');
        b.onclick = () => { Pane.leave(); jumpTo(n.k); };
        frag.appendChild(n.by === me && Store.notes.has(n.id) ? swipeRow(b, Store.notes.get(n.id)) : b);   // けす: only your own
      });
    }
  } else if (!dTag) {
    const tags = [...IX.tagN.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).filter(([t]) => !q || t.includes(normTag(q)));
    if (!tags.length) empty(q ? '見つかりませんでした' : 'まだタグはありません。メモに「#紅葉」のように書くか、PCのメモ編集でタグを付けられます。');
    const box = document.createElement('div'); box.className = 'tagcloud';
    tags.forEach(([t, c]) => { const b = mkBtn('', 'tagrow', () => openTag(t)); b.innerHTML = '<span></span><em></em>'; b.firstChild.textContent = '#' + t; b.lastChild.textContent = c; box.appendChild(b); });
    frag.appendChild(box);
  } else {
    const t = dTag;
    const head = document.createElement('div'); head.className = 'taghead';
    head.appendChild(mkBtn('← タグ', 'back', () => { dTag = null; if (HL && HL.kind === 'tag') setHighlight(null); renderDrawer(); }));
    const h = document.createElement('div'); h.className = 'big'; h.textContent = '#' + t; head.appendChild(h);
    const acts = document.createElement('div'); acts.className = 'acts';
    acts.appendChild(mkBtn('名前を変える', 'tag', () => {
      acts.innerHTML = '';
      const inp = document.createElement('input'); inp.className = 'tin'; inp.value = t;
      const ok = () => { const to = normTag(inp.value); if (!to || to === t) return renderDrawer(); const merge = IX.tagN.has(to); Store.renameTag(t, to); dTag = to; openTag(to); toast(merge ? `#${to} にまとめました` : `#${to} に変更しました`); };
      inp.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) ok(); if (e.key === 'Escape') renderDrawer(); };
      acts.appendChild(inp); acts.appendChild(mkBtn('OK', 'tag', ok)); inp.focus(); inp.select();
    }, '名前を変える（既にあるタグ名にするとまとめられます）'));
    const del = mkBtn('はずす', 'tag', () => {
      const ns = [...Store.notes.values()].filter(n => (n.tags || []).includes(t)).map(n => ({ ...n })), ws = [...Store.walks.values()].filter(w => (w.tags || []).includes(t)).map(w => ({ ...w }));
      Store.renameTag(t, ''); dTag = null; setHighlight(null); renderDrawer();
      toast(`#${t} を外しました`, 5200, ['もどす', () => {
        for (const n of ns) if (Store.notes.has(n.id)) Store.notes.set(n.id, cleanNote({ ...Store.notes.get(n.id), tags: n.tags, u: Date.now() }));
        for (const w of ws) if (Store.walks.has(w.d)) Store.walks.set(w.d, cleanWalk({ ...Store.walks.get(w.d), tags: w.tags, u: Date.now() }));
        Store.commit(); openTag(t); toast('もどしました');
      }]);
    }, 'このタグをすべてのメモから外す（メモは消えません）');
    acts.appendChild(del);
    head.appendChild(acts);
    frag.appendChild(head);
    const ws = [...Store.walks.values()].filter(w => (w.tags || []).includes(t)).sort((a, b) => a.d < b.d ? 1 : -1);
    const ns = [...Store.notes.values()].filter(n => (n.tags || []).includes(t)).sort(newestFirst);
    if (ws.length) {
      const r = document.createElement('div'); r.className = 'rule'; r.textContent = `散歩 ${ws.length}`; frag.appendChild(r);
      ws.forEach(w => { const b = document.createElement('button'); b.className = 'walk'; b.innerHTML = '<div class="d"><span></span></div><div class="ti"></div>'; b.querySelector('.d span').textContent = fmtDay(w.d); b.querySelector('.ti').textContent = w.title || autoTitle(w.d); b.onclick = () => openWalk(w.d); frag.appendChild(b); });
    }
    const r = document.createElement('div'); r.className = 'rule'; r.textContent = `メモ ${ns.length}`; frag.appendChild(r);
    ns.forEach(n => {
      const b = document.createElement('button'); b.className = 'mlog';
      b.innerHTML = '<span class="d"></span><span class="p"></span><span class="t"></span>';
      b.querySelector('.d').textContent = n.d.replace(/-/g, '.');
      b.querySelector('.p').textContent = placeLabel(n.k);
      b.querySelector('.t').textContent = n.t || n.x || '';
      b.onclick = () => { Pane.leave(); jumpTo(n.k); };
      frag.appendChild(swipeRow(b, n));
    });
  }
  body.appendChild(frag);
}
function jumpTo(k) {
  pendingSel = k;
  const h = k[0] === 'p' ? k.slice(1) : k.slice(1, 6);
  origin = null;
  if (location.hash.slice(1) === h) { pendingSel = null; selectByKey(k); } else go(h);
}
function openDrawer(tab) {
  if ($('#drawer').classList.contains('open') && dTab === tab) return closePanel('drawer');
  dTab = tab; $('#dFilter').value = ''; $('#dBody').classList.remove('swap');   // opening: the panel's own entrance, not the tab's
  renderDrawer();
  showDrawer();
}
function showDrawer() {
  if ($('#drawer').classList.contains('open')) return syncTools();
  Pane.before('drawer');
  $('#drawer').classList.add('open'); document.body.classList.add('drawer-open');
  syncTools(); Pane.after('drawer');
}

['list', 'walks', 'tags', 'group'].forEach(t => $('#t_' + t).onclick = () => {
  const moved = dTab !== t;
  dTab = t; if (t !== 'tags') dTag = null; $('#dFilter').value = ''; renderDrawer(); syncTools();
  if (moved) { const b = $('#dBody'); b.classList.remove('swap'); void b.offsetWidth; b.classList.add('swap'); }   // the new list arrives softly
});
// the underline: as wide as the word, under the tab you are on
function tabBar() {
  const box = document.querySelector('#drawer .tabs'), bar = box && box.querySelector('.bar'), on = box && box.querySelector('button.on');
  if (!bar || !on) return;
  const bb = box.getBoundingClientRect(); if (!bb.width) return;
  const r = document.createRange(); r.selectNodeContents(on); const tr = r.getBoundingClientRect();
  const first = !bar.style.width;
  if (first) bar.style.transition = 'none';
  bar.style.width = Math.round(tr.width) + 'px';
  bar.style.transform = `translateX(${Math.round(tr.left - bb.left)}px)`;
  if (first) { void bar.offsetWidth; bar.style.transition = ''; }
}
addEventListener('resize', () => { const b = document.querySelector('#drawer .tabs .bar'); if (b) { b.style.width = ''; tabBar(); } });
$('#dFilter').oninput = () => renderDrawer();
$('#bList').onclick = () => openDrawer('list');
$('#bLog').onclick = () => { if ($('#drawer').classList.contains('open')) { Pane.clear(); closePanel('drawer'); } else openDrawer(dTab || 'walks'); };
$('#bUp').onclick = up;
function whereText() {
  const cnt = `メモ ${Store.notes.size} 件・散歩 ${walkDays().length} 日`;
  $('#mWhere').textContent = FB.user ? `記録はこの端末と、Googleアカウントのクラウドに保存されています（${cnt}）。スマホとPCで自動で同じになります。写真だけは、クラウドに送らず、この端末の中に置いています。`
    : FB.enabled() ? `記録は今、このブラウザの中だけに保存されています（${cnt}）。「Googleでログイン」をすると、クラウドにも保存されて、スマホとPCで同じになります（写真だけは、ログインしてもこの端末の中です）。`
    : `記録はこのブラウザの中に保存されています（${cnt}）。ブラウザのデータを消すと記録も消えるので、時々「バックアップする」を押してください。スマホ→PCへ移すときも、バックアップ→「バックアップから戻す」でOKです。`;
}
function a2hsText() {
  const ua = navigator.userAgent, standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const phone = ios || /Android/.test(ua);
  $('#a2hsBox').hidden = standalone || !phone;
  if (standalone || !phone) return;
  const how = ios && /CriOS/.test(ua) ? 'アドレスバー右の共有ボタン（□に↑）→「ホーム画面に追加」→「追加」。'
    : ios ? '共有ボタン（□に↑。見当たらなければ「…」の中）→「ホーム画面に追加」→「追加」。'
    : '右上の︙ →「ホーム画面に追加」（または「アプリをインストール」）。';
  $('#a2hs').textContent = how + 'アイコンから開くと、ブラウザのバーのない全画面で開きます。ホーム画面版は保存場所がブラウザと別なので、最初に1回「Googleでログイン」をしてください。';
}
function home() { ['ig', 'join', 'geo', 'modal', 'sheet', 'wsheet', 'drawer'].forEach(id => { if ($('#' + id).classList.contains('open')) closePanel(id, true); }); origin = null; go(''); }
$('#bHome').onclick = home; $('#brand').onclick = home;

/* ---------- walk (one day) ---------- */
let curWalk = null;
function openWalk(d) {
  Replay.stop();
  Pane.before('wsheet');
  if (S.sel) { select(null); }
  curWalk = d; editing = null;
  renderWalk();
  $('#wsheet').classList.add('open'); document.body.classList.add('wsheet-open');
  Pane.after('wsheet');
  const ns = IX.byDate.get(d) || [], w = Store.walks.get(d) || {};
  const keys = uniq([...ns.map(n => n.k), ...(w.tw || [])]);   // towns passed on the route count too
  setHighlight({ kind: 'walk', label: fmtDay(d) + 'の散歩', keys, route: ns, d, trk: !!w.trk });
  focusKeys(keys, true);
  if ($('#drawer').classList.contains('open')) renderDrawer();
}
function renderWalk() {
  const d = curWalk; if (!d || editing) return;
  const w = Store.walks.get(d) || {}, st = walkStat(d);
  $('#wEyebrow').textContent = fmtDay(d) + 'の散歩';
  const ti = $('#wTitle'); ti.textContent = w.title || autoTitle(d); ti.classList.toggle('auto', !w.title);
  const places = uniq(st.ns.map(n => n.k[0] === 'p' ? placeName(n.k) : placeName('m' + n.k.slice(1, 6))));
  $('#wStat').textContent = [w.km ? fmtKm(w.km) + (w.t0 && w.t1 ? ` ${w.t0}〜${w.t1}` : '') : '', places.join('・'), st.towns ? `町 ${st.towns}` : '', w.tw ? `通った町 ${w.tw.length}` : '', `メモ ${st.ns.length}`].filter(Boolean).join(' · ');
  const wt = $('#wTags'); wt.innerHTML = ''; wt.appendChild(tagChips(w.tags));
  const body = $('#wBody'); body.innerHTML = '';
  if (welcomeDay === d) {   // おかえり
    const all = dayTowns(d), fd = firstDays(), fresh = all.filter(k => fd.get(k) === d);
    const wl = el2('div', 'welcome');
    wl.appendChild(el2('div', 'wh', 'おかえりなさい'));
    const big = el2('div', 'big2', String(all.length)); big.appendChild(el2('small', '', '町を歩きました')); wl.appendChild(big);
    if (fresh.length) wl.appendChild(el2('p', 'fresh', `はじめての町 ${fresh.length}：` + fresh.slice(0, 8).map(k => placeName(k)).join('、') + (fresh.length > 8 ? ` ほか ${fresh.length - 8}` : '')));
    const bk = mkBtn('写真ごと、バックアップする', 'btn ghost', () => { $('#mPics').value = 'big'; (W < 720 && navigator.canShare ? $('#mShare') : $('#mDown')).onclick(); });
    wl.appendChild(bk); unbackedPhotos().then(n => { if (!n) bk.remove(); });   // only when photos are waiting
    body.appendChild(wl);
  }
  // summary
  const sum = document.createElement('div'); sum.className = 'wsum';
  if (w.sum) { const p = document.createElement('div'); p.className = 'dx'; p.textContent = w.sum; sum.appendChild(p); }
  const row = document.createElement('div'); row.className = 'wrow';
  row.appendChild(mkBtn(w.title || w.sum ? 'この日のことを、なおす' : 'この日のことを書く', w.title || w.sum ? 'tag' : 'btn ghost', () => editWalk(sum, d)));
  if (Replay.items(d).length > 1 || w.trk) row.appendChild(mkBtn('▶ たどる', w.title || w.sum ? 'tag' : 'btn ghost', () => Replay.start(d), 'この日の散歩を、メモの順にたどる'));
  sum.appendChild(row);
  body.appendChild(sum);
  if (GR.anyOn()) {   // この日を共有: the day, its memos and the towns passed (never the line)
    const row = el2('div', 'dayshare'), wt = w.tags || [], sel = G => G.gtags().some(t => wt.includes(t));
    shareChips(row, 'この日を共有', sel, G => {
      const cur = (Store.walks.get(d) || {}).tags || [];
      Store.putWalk(d, { tags: !G ? cur.filter(t => !GR.allTags().includes(t)) : sel(G) ? cur.filter(t => !G.gtags().includes(t)) : uniq([...cur, G.gtag()]) });
    });
    sum.appendChild(row);
    const to = GR.live().filter(sel);
    if (to.length) sum.appendChild(el2('p', 'shnote', `「${to.map(G => G.g.name).join('」「')}」のみんなにも見えます：名前・この日のこと・この日のメモ・通った町（道の線は出ません）`));
  }
  const add = el2('div', 'addday');   // この日に足す: what used to sit on top of ノート, now where the day is already chosen
  add.appendChild(el2('span', 'lab', 'この日に足す'));
  add.append(mkBtn('＋ 写真をまとめて', 'pgo', () => pickBulk(() => openWalk(d)), 'この日の写真をまとめて選ぶと、撮った時刻で近いメモに振り分けます'),
    mkBtn('＋ お店', 'pgo', () => shopAddDlg(d), '寄ったお店を、この日のメモに（Googleマップで探して、コピーして、付ける）'),
    mkBtn('＋ 写真のリンク', 'pgo', async () => { try { const ls = parseLinks(await navigator.clipboard.readText()); if (ls.length) return attachLink(ls[0]); } catch (e) {} attachAsk(); }, 'コピーした Instagram・X のリンクを、投稿の時刻に近いメモに付けます'));
  body.appendChild(add);
  const r = document.createElement('div'); r.className = 'rule'; r.textContent = `メモ ${st.ns.length}`; photosBtn(r, st.ns); body.appendChild(r);
  if (!st.ns.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'この日のメモはありません。'; body.appendChild(e); }
  st.ns.forEach(n => body.appendChild(swipeRow(entryNode(n, { place: true, timeOnly: true }), n)));
}
function editWalk(node, d) {
  editing = 'walk';
  const w = Store.walks.get(d) || {};
  node.innerHTML = `<div class="edit"><label>タイトル</label><input class="wT" placeholder="${autoTitle(d)}">
    <label>まとめ</label><textarea class="wS big" placeholder="この日の散歩をふりかえって（コース、天気、印象に残ったこと…）"></textarea>
    <label>タグ</label><div class="wG"></div>
    <div class="row"><button class="btn wOk" type="button">保存</button><button class="btn ghost wNo" type="button">キャンセル</button>${w.trk ? '<button class="eDel wTrk" type="button">道のりをけす</button>' : ''}</div></div>`;
  const q = c => node.querySelector(c);
  q('.wT').value = w.title || ''; q('.wS').value = w.sum || '';
  const tg = tagInput(q('.wG'), w.tags);
  const save = () => { editing = null; const s = q('.wS').value.trim(); Store.putWalk(d, { title: q('.wT').value.trim(), sum: s, tags: uniq([...tg.get(), ...hashtags(s)]) }); toast('保存しました'); };
  q('.wOk').onclick = save;
  q('.wNo').onclick = () => { editing = null; renderWalk(); };
  editBar(node.querySelector('.edit'), save, () => q('.wNo').click());
  const wt = q('.wTrk');
  if (wt) wt.onclick = () => {
    const w0 = Store.walks.get(d) || {}, keep = { trk: w0.trk, km: w0.km, t0: w0.t0, t1: w0.t1, tw: w0.tw };
    editing = null; Store.putWalk(d, { trk: '', km: 0, t0: '', t1: '', tw: [] }); openWalk(d);
    toast('道のりを、けしました', 5200, ['もどす', () => { Store.putWalk(d, keep); openWalk(d); toast('もどしました'); }]);
  };
  q('.wS').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } });
  (W < 720 ? q('.wT') : q('.wS')).focus();
}
function openTag(t) {
  dTab = 'tags'; dTag = t; $('#dFilter').value = '';
  const keys = [];
  for (const n of Store.notes.values()) if ((n.tags || []).includes(t)) keys.push(n.k);
  for (const w of Store.walks.values()) if ((w.tags || []).includes(t)) for (const n of (IX.byDate.get(w.d) || [])) keys.push(n.k);
  setHighlight({ kind: 'tag', label: '#' + t, keys: uniq(keys) });
  renderDrawer(); showDrawer();
  focusKeys(uniq(keys), false);
}

/* ---------- 道のり (routes) — from another app's GPX, or recorded lightly while this app is open ----------
   Kept on the day's walk as an encoded line. Never copied to the group (a route shows where you live). */
const Poly = {
  num(v) { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); },
  enc(pts) { let o = '', a0 = 0, b0 = 0; for (const p of pts) { const a = Math.round(p[0] * 1e5), b = Math.round(p[1] * 1e5); o += this.num(a - a0) + this.num(b - b0); a0 = a; b0 = b; } return o; },
  dec(s) {
    const out = []; let i = 0, a = 0, b = 0;
    while (i < s.length) {
      const v = [0, 0];
      for (let k = 0; k < 2; k++) { let r = 0, sh = 0, c; do { c = s.charCodeAt(i++) - 63; r |= (c & 0x1f) << sh; sh += 5; } while (c >= 0x20 && i < s.length); v[k] = r & 1 ? ~(r >> 1) : r >> 1; }
      a += v[0]; b += v[1]; out.push([a / 1e5, b / 1e5]);
    }
    return out;
  }
};
const segsOf = trk => String(trk || '').split(' ').filter(Boolean).map(x => Poly.dec(x));
const hav = (a, b) => { const r = Math.PI / 180, dla = (b[0] - a[0]) * r, dlo = (b[1] - a[1]) * r, h = Math.sin(dla / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dlo / 2) ** 2; return 12742e3 * Math.asin(Math.min(1, Math.sqrt(h))); };
const segKm = g => g.reduce((s, p, i) => i ? s + hav(g[i - 1], p) : 0, 0) / 1000;
const isOkiLL = (lat, lng) => lat < 27 && lat > 23.5 && lng > 122.5 && lng < 131.5;
const projLL = p => proj(p[1], p[0], isOkiLL(p[0], p[1]));
const hmOf = ms => { const x = new Date(ms); return String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0'); };
const ymdOf = ms => { const x = new Date(ms); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const fmtKm = km => (km < 10 ? km.toFixed(1) : Math.round(km)) + 'km';
const fmtDur = m => m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? (m % 60) + '分' : ''}` : `${Math.max(1, Math.round(m))}分`;
// keep a point every ~12m, then drop the ones a straight line already covers (±6m)
function thin(seg) {
  const a = []; for (const p of seg) if (!a.length || hav(a[a.length - 1], p) >= 12) a.push(p);
  if (seg.length > 1 && a[a.length - 1] !== seg[seg.length - 1]) a.push(seg[seg.length - 1]);
  if (a.length < 3) return a;
  const off = (p, s, e) => {
    const k = Math.cos(s[0] * Math.PI / 180) * 111320, m = 110540;
    const ax = (e[1] - s[1]) * k, ay = (e[0] - s[0]) * m, px = (p[1] - s[1]) * k, py = (p[0] - s[0]) * m, L = ax * ax + ay * ay;
    const t = L ? Math.max(0, Math.min(1, (px * ax + py * ay) / L)) : 0;
    return Math.hypot(px - t * ax, py - t * ay);
  };
  const keep = new Uint8Array(a.length); keep[0] = keep[a.length - 1] = 1;
  const st = [[0, a.length - 1]];
  while (st.length) {
    const [s0, e0] = st.pop(); let md = 0, mi = -1;
    for (let i = s0 + 1; i < e0; i++) { const d = off(a[i], a[s0], a[e0]); if (d > md) { md = d; mi = i; } }
    if (md > 6) { keep[mi] = 1; st.push([s0, mi], [mi, e0]); }
  }
  return a.filter((_, i) => keep[i]);
}
// which city / town is this point in (the same answer as the map's own town cells)
async function placeAt(lng, lat, hint) {
  if (hint && exactHits([hint.f], lng, lat, () => hint.pc === '47').length) return hint;
  for (const c of exactHits(D.japanFeats, lng, lat, f => f.c === '47').map(f => f.c)) {
    const P = await ensurePref(c), hit = exactHits(P.feats, lng, lat, () => c === '47')[0];
    if (hit) return { pc: c, mc: hit.c, f: hit };
  }
  return null;
}
async function townsPassed(segs, tick) {
  const out = new Set(); let hint = null, n = 0;
  for (const g of segs) for (let i = 0; i < g.length; i++) {
    const a = g[i], b = g[i + 1], steps = b ? Math.max(1, Math.round(hav(a, b) / 30)) : 1;   // look about every 30m
    for (let s = 0; s < steps; s++) {
      const lat = b ? a[0] + (b[0] - a[0]) * s / steps : a[0], lng = b ? a[1] + (b[1] - a[1]) * s / steps : a[1];
      const at = await placeAt(lng, lat, hint); if (!at) continue; hint = at;
      const towns = await ensureTowns(at.mc);
      if (!towns.length) { out.add('m' + at.mc); continue; }
      const p = proj(lng, lat, at.pc === '47'); let ti = -1, bd = Infinity;
      towns.forEach((t, j) => t.pts.forEach(q => { const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d < bd) { bd = d; ti = j; } }));
      if (ti >= 0) out.add(towns[ti].k);
      if (tick && ++n % 25 === 0) tick(out.size);
    }
  }
  return [...out];
}
function saveRoute(d, segs, o) {
  const w = Store.walks.get(d) || {};
  const enc = segs.filter(g => g.length > 1).map(g => Poly.enc(g));
  if (!enc.length) return 0;
  const all = [...(o.replace ? [] : String(w.trk || '').split(' ').filter(Boolean)), ...enc];
  const km = segsOf(all.join(' ')).reduce((s, g) => s + segKm(g), 0);
  const ts = segs.flat().map(p => p[2]).filter(Boolean);
  let t0 = o.replace ? '' : w.t0, t1 = o.replace ? '' : w.t1;
  if (ts.length) { const a = hmOf(Math.min(...ts)), b = hmOf(Math.max(...ts)); if (!t0 || a < t0) t0 = a; if (!t1 || b > t1) t1 = b; }
  Store.putWalk(d, { trk: all.join(' '), km: +km.toFixed(2), t0, t1, tw: uniq([...(o.replace ? [] : (w.tw || [])), ...(o.towns || [])]) });
  if (o.visit && o.towns && o.towns.length) Store.setVisitedMany(o.towns);
  return km;
}
function trackPts(d) {   // projected pieces of a day's route
  const w = Store.walks.get(d); return w && w.trk ? segsOf(w.trk).map(g => g.map(projLL)) : [];
}
function drawTrack() {
  const segs = HL && HL.kind === 'walk' && HL.d ? trackPts(HL.d) : [];
  const line = segs.filter(g => g.length > 1).map(g => 'M' + g.map(p => f3(p[0]) + ' ' + f3(p[1])).join('L')).join('');
  const gaps = segs.slice(1).map((g, i) => { const a = segs[i][segs[i].length - 1], b = g[0]; return a && b ? `M${f3(a[0])} ${f3(a[1])}L${f3(b[0])} ${f3(b[1])}` : ''; }).join('');
  ['#track', '#trackHalo'].forEach(id => line ? $(id).setAttribute('d', line) : $(id).removeAttribute('d'));
  gaps ? $('#trackGap').setAttribute('d', gaps) : $('#trackGap').removeAttribute('d');
  if (line) $('#route').removeAttribute('d');   // the real route replaces the straight memo-to-memo line
}

/* the dialog every route step uses: one card, written in plain words */
function routeDlg(title, body, acts) {
  $('#routeDlg').classList.remove('ok');
  $('#rtTitle').textContent = title;
  const b = $('#rtBody'); b.innerHTML = ''; (Array.isArray(body) ? body : [body]).forEach(x => x && b.appendChild(typeof x === 'string' ? Object.assign(document.createElement('p'), { textContent: x }) : x));
  const a = $('#rtActs'); a.innerHTML = ''; acts.forEach(([t, cls, fn]) => a.appendChild(mkBtn(t, cls, fn)));
  $('#routeDlg').classList.add('open');
}
const closeRoute = () => $('#routeDlg').classList.remove('open', 'ok');
$('#routeDlg').addEventListener('click', e => { if (e.target.id === 'routeDlg') closeRoute(); });
const el2 = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
// shared last step: show the day(s), find the towns passed, ask before painting them
async function confirmRoute(days, title, onDone) {
  const rows = days.map(x => {
    const r = el2('div', 'rday');
    if (x.d) r.appendChild(el2('b', '', `${x.d.slice(5).replace('-', '/')}（${'日月火水木金土'[new Date(x.d + 'T12:00:00').getDay()]}）`));
    else { const i = el2('input'); i.type = 'date'; i.value = today(); i.onchange = () => { x.d = i.value; }; x.d = today(); r.append(el2('span', '', '日付の入っていない道のりです。何日の散歩ですか？'), i); }
    r.appendChild(el2('span', '', [fmtKm(x.km), x.t0 && x.t1 ? `${x.t0}〜${x.t1}` : ''].filter(Boolean).join(' · ')));
    const tw = el2('span', 'tw', '通った町を調べています…'); r.appendChild(tw); x.twEl = tw;
    if (x.d && (Store.walks.get(x.d) || {}).trk) r.appendChild(el2('span', '', 'この日の道のりに、足します'));
    return r;
  });
  const chk = el2('label', 'chk'); const cb = el2('input'); cb.type = 'checkbox'; cb.checked = true; chk.append(cb, el2('span', '', '通った町を「行った」にする'));
  let busy = true;
  routeDlg(title, [...rows, chk, el2('p', 'note', '道のりは自分だけのものです。グループには出しません（家の場所が分かってしまうため）。')], [
    ['のこす', 'btn', () => { if (busy) return toast('通った町を調べています。少しお待ちください'); closeRoute(); onDone(days, cb.checked); }],
    ['やめる', 'btn ghost', closeRoute]
  ]);
  for (const x of days) { try { x.towns = await townsPassed(x.segs, k => { x.twEl.textContent = `通った町 ${k}…`; }); } catch (e) { x.towns = []; } x.twEl.textContent = `通った町 ${x.towns.length}`; }
  busy = false;
}
function keepDays(days, visit, how) {
  let km = 0;
  for (const x of days) km += saveRoute(x.d, x.segs, { towns: x.towns, visit });
  if (!km) return toast('道のりが短すぎて、のこせませんでした');
  toast(`${how}道のり ${fmtKm(km)} を、のこしました`);
  openWalk(days[0].d);
}

/* ほかのアプリの道のり (GPX) */
function readGPX(text) {
  const x = new DOMParser().parseFromString(text, 'application/xml');
  if (x.querySelector('parsererror') || !x.querySelector('gpx')) return null;
  const pieces = [...x.querySelectorAll('trkseg'), ...x.querySelectorAll('rte')].map(g => [...g.querySelectorAll('trkpt, rtept')].map(p => {
    const t = p.querySelector('time'), ms = t ? Date.parse(t.textContent) : NaN;
    return [+p.getAttribute('lat'), +p.getAttribute('lon'), isNaN(ms) ? 0 : ms];
  }).filter(q => isFinite(q[0]) && isFinite(q[1]) && Math.abs(q[0]) <= 90)).filter(g => g.length > 1);
  const byDay = new Map();
  for (const g of pieces) {
    let cur = null, key = null;
    for (const q of g) { const k = q[2] ? ymdOf(q[2]) : ''; if (k !== key) { key = k; cur = []; (byDay.get(k) || byDay.set(k, []).get(k)).push(cur); } cur.push(q); }
  }
  return [...byDay.entries()].sort().map(([d, segs]) => {
    const th = segs.map(thin).filter(g => g.length > 1), ts = segs.flat().map(q => q[2]).filter(Boolean);
    return { d, segs: th, km: th.reduce((s, g) => s + segKm(g), 0), t0: ts.length ? hmOf(Math.min(...ts)) : '', t1: ts.length ? hmOf(Math.max(...ts)) : '' };
  }).filter(x => x.segs.length);
}
function importGPX(text) {
  const days = readGPX(text);
  if (!days) return toast('GPXファイルとして読めませんでした');
  if (!days.length) return toast('このファイルには道のりが入っていませんでした');
  confirmRoute(days.slice(0, 14), '道のりを読みこみました', (ds, visit) => keepDays(ds, visit, ''));
}
function pickGPX() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.hidden = true; document.body.appendChild(inp);
  inp.onchange = () => { const f = inp.files[0]; inp.remove(); if (f) f.text().then(importGPX); };
  inp.click();
}

/* さんぽ、はじめる — records only while this app is open (no extra battery); the closed stretches become straight lines */
const Rec = {
  K: 'sanpo-rec', st: null, wid: null, saved: 0,
  load() { try { this.st = JSON.parse(localStorage.getItem(this.K) || 'null'); } catch (e) { this.st = null; } },
  save(now) { if (!this.st) { try { localStorage.removeItem(this.K); } catch (e) {} return; } if (now || Date.now() - this.saved > 15000) { this.saved = Date.now(); try { localStorage.setItem(this.K, JSON.stringify(this.st)); } catch (e) {} } },
  pts() { return this.st ? this.st.segs.flat() : []; },
  km() { return this.st ? this.st.segs.reduce((s, g) => s + segKm(g), 0) : 0; },
  mins() { return this.st ? (Date.now() - this.st.t) / 6e4 : 0; },
  start() {
    this.st = { d: today(), t: Date.now(), segs: [[]] }; this.save(true);
    this.watch(); this.paint(); toast('さんぽ、はじめました。アプリを開いている間、道のりをのこします');
  },
  watch() {
    if (this.wid != null || !this.st || document.hidden || !navigator.geolocation) return;
    if (this.st.segs[this.st.segs.length - 1].length) this.st.segs.push([]);   // after a pause: a new piece
    this.wid = navigator.geolocation.watchPosition(p => this.add(p), e => { if (e.code === 1) { this.unwatch(); geoErr(e, () => this.watch()); } }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  },
  unwatch() { if (this.wid != null) navigator.geolocation.clearWatch(this.wid); this.wid = null; this.save(true); },
  add(p) {
    const c = p.coords; if (!this.st || !c || c.accuracy > 60) return;
    const g = this.st.segs[this.st.segs.length - 1], q = [+c.latitude.toFixed(6), +c.longitude.toFixed(6), Date.now()], last = g[g.length - 1];
    const xy = projLL(q); me = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, x: xy[0], y: xy[1] }; drawMe();
    if (last && hav(last, q) < 10) return;
    g.push(q); this.save(); this.paint(); drawRec();
  },
  paint() {
    const b = $('#recBtn'), on = !!this.st;
    b.classList.toggle('on', on); document.body.classList.toggle('rec', on);
    b.querySelector('span').innerHTML = on ? 'さんぽ中 <b></b>' : 'さんぽ<small>、はじめる</small>';
    if (on) b.querySelector('b').textContent = `${fmtKm(this.km())} · ${fmtDur(Math.round(this.mins()))}`;
    b.setAttribute('aria-label', on ? 'さんぽを、おわりにする' : 'さんぽの道のりを記録する');
  },
  clear() { this.unwatch(); this.st = null; this.save(true); this.paint(); drawRec(); },
  ask() {
    if (!this.st) {
      let seen = false; try { seen = !!localStorage.getItem('sanpo-rec-seen'); } catch (e) {}
      if (seen) return this.start();
      return routeDlg('さんぽの道のりを、のこします', [
        '電池をほとんど使わないように、このアプリを開いている間だけ記録します。',
        '画面を消したり、ほかのアプリを開いたりしていた間は、まっすぐの線でつなぎます。',
        el2('p', 'note', '道をきっちりのこしたい日は、記録アプリの道のり（GPX）を LOG から読みこめます。')
      ], [['はじめる', 'btn', () => { try { localStorage.setItem('sanpo-rec-seen', '1'); } catch (e) {} closeRoute(); this.start(); }], ['やめておく', 'btn ghost', closeRoute]]);
    }
    const big = el2('div', 'big2', fmtKm(this.km())); big.appendChild(el2('small', '', fmtDur(Math.round(this.mins()))));
    let armed = false;
    routeDlg('さんぽを、おわりにしますか？', [big], [
      ['おわる', 'btn', () => this.finish()],
      ['つづける', 'btn ghost', closeRoute],
      ['すてる', 'btn ghost', function () { if (!armed) { armed = true; this.textContent = 'ほんとに？（もう一度）'; return; } Rec.clear(); closeRoute(); toast('道のりを、すてました'); }]
    ]);
  },
  finish(quiet) {
    const st = this.st; if (!st) return;
    this.unwatch();
    const segs = st.segs.map(thin).filter(g => g.length > 1);
    if (!segs.length) { this.clear(); closeRoute(); return toast('道のりが短すぎて、のこせませんでした'); }
    const ts = segs.flat().map(q => q[2]);
    const day = { d: st.d, segs, km: segs.reduce((s, g) => s + segKm(g), 0), t0: hmOf(Math.min(...ts)), t1: hmOf(Math.max(...ts)) };
    if (quiet) { saveRoute(day.d, day.segs, {}); this.clear(); return toast(`前のさんぽの道のり ${fmtKm(day.km)} を、のこしました`); }
    confirmRoute([day], 'さんぽ、おつかれさまでした', (ds, visit) => { this.clear(); keepDays(ds, visit, ds[0].d === today() ? '今日の' : ''); if (ds[0].d === today()) setTimeout(() => okaeri(ds[0].d), 900); });
  }
};
function drawRec() {
  const g = Rec.st ? Rec.st.segs.filter(x => x.length > 1).map(x => 'M' + x.map(q => { const p = projLL(q); return f3(p[0]) + ' ' + f3(p[1]); }).join('L')).join('') : '';
  ['#recLine', '#recHalo'].forEach(id => g ? $(id).setAttribute('d', g) : $(id).removeAttribute('d'));
}
$('#recBtn').onclick = () => Rec.ask();
document.addEventListener('visibilitychange', () => { if (!Rec.st) return; if (document.hidden) Rec.unwatch(); else { Rec.watch(); Rec.paint(); } });
addEventListener('pagehide', () => Rec.save(true));
setInterval(() => { if (Rec.st && !document.hidden) Rec.paint(); }, 30000);

/* ---------- data modal ---------- */
let exportThumbs = {}, exportSmall = {};   // read when DATA opens, so saving/sharing stays inside the tap
const picMode = () => $('#mPics').value || 'big';
function exportJSON() { const m = picMode(); return JSON.stringify({ ...Store.dump(), thumbs: m === 'big' ? exportThumbs : m === 'small' ? exportSmall : {}, exported: new Date().toISOString() }, null, 1); }
const MB = n => n < 1e6 ? `${Math.max(.1, n / 1e6).toFixed(1)}MB` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}MB`;
let lastOut = 0; try { lastOut = +localStorage.getItem('sanpo-exported') || 0; } catch (e) {}
function exported() {   // a file with the photos in it was made: remember which photos it holds
  if (picMode() === 'none') return;
  lastOut = Date.now();
  try {
    localStorage.setItem('sanpo-exported', String(lastOut));
    localStorage.setItem(BK_IDS, Object.keys(picMode() === 'small' ? exportSmall : exportThumbs).join(' '));
    localStorage.removeItem(BK_LATER);
  } catch (e) {}
  $('#bkPill').hidden = true;
  photoInfo();
}
const BK_IDS = 'sanpo-backed', BK_LATER = 'sanpo-backup-later';
const mdj = t => { const x = new Date(t); return `${x.getMonth() + 1}月${x.getDate()}日`; };
async function unbackedPhotos() {   // photos on this device that no backup holds yet
  const ks = await Thumbs.keys();
  let set = null; try { const v = localStorage.getItem(BK_IDS); if (v) set = new Set(v.split(' ')); } catch (e) {}
  if (set) return ks.filter(k => !set.has(k)).length;
  if (!lastOut) return ks.length;
  const after = new Set(); for (const x of Store.notes.values()) if (x.im && (+x.u || 0) > lastOut) x.im.forEach(i => after.add(i));   // before 2.7: the memos changed since
  return ks.filter(k => after.has(k)).length;
}
// once a month, when photos are waiting: a quiet card above the buttons (never while walking or writing)
let bkTries = 0;
async function backupPill() {
  const p = $('#bkPill'); if (!p || !p.hidden) return;
  let later = 0; try { later = +localStorage.getItem(BK_LATER) || 0; } catch (e) {}
  if (Date.now() - later < 7 * 864e5) return;
  const MONTH = 30 * 864e5, n = await unbackedPhotos();
  if (!n) return;
  if (lastOut && Date.now() - lastOut < MONTH) return;
  if (!lastOut) {   // never backed up: once the first photo memo is a month old, or ten photos are waiting
    const ds = [...Store.notes.values()].filter(x => x.im && x.im.length).map(x => Date.parse(x.d + 'T12:00:00'));
    if (!(n >= 10 || (ds.length && Date.now() - Math.min(...ds) >= MONTH))) return;
  }
  const b = document.body.classList;
  if (b.contains('first') || b.contains('sheet-open') || b.contains('wsheet-open') || b.contains('drawer-open') || b.contains('rec') || Rec.st || $('#modal').classList.contains('open') || !$('#okPill').hidden) {
    if (++bkTries < 15) setTimeout(backupPill, 20000);   // busy now: ask again a little later
    return;
  }
  const m = lastOut ? Math.max(1, Math.floor((Date.now() - lastOut) / MONTH)) : 0;
  $('#bkTxt').textContent = lastOut ? `前のバックアップから${m}か月たちました。まだの写真が${n}枚あります。` : `まだ一度もバックアップしていません。この端末にだけある写真が${n}枚あります。`;
  photoInfo();   // read the photos now, so one tap can save them
  p.hidden = false;
}
$('#bkGo').onclick = () => {
  if (!Object.keys(exportThumbs).length) { $('#bData').onclick(); setTimeout(() => $('#mBackup').scrollIntoView({ block: 'start', behavior: 'smooth' }), 300); return; }   // photos not read yet: open the backup in 設定
  $('#mPics').value = 'big';
  (W < 720 && navigator.canShare ? $('#mShare') : $('#mDown')).click();
};
$('#bkLater').onclick = () => {
  try { localStorage.setItem(BK_LATER, String(Date.now())); } catch (e) {}
  $('#bkPill').hidden = true; toast('1週間後に、もう一度お知らせします');
};
setTimeout(backupPill, 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(backupPill, 1500); });
async function photoInfo() {
  const es = (await Thumbs.entries()).filter(([, v]) => v.d);
  exportThumbs = {}; exportSmall = {}; let big = 0, small = 0;
  for (const [k, v] of es) { exportThumbs[k] = v.d; big += v.d.length; const sm = v.s || (v.d.length <= 20000 ? v.d : null); if (sm) { exportSmall[k] = sm; small += sm.length; } }
  const yet = await unbackedPhotos();
  const when = lastOut ? `最後のバックアップ：${mdj(lastOut)}。${yet ? `まだの写真が ${yet} 枚あります。` : ''}` : (es.length ? 'まだ一度もバックアップしていません。' : '');
  $('#mPhotos').textContent = `この端末の写真 ${es.length} 枚（約 ${MB(big)}）。写真はクラウドにも、グループにも送らず、この端末の中だけに置いています。${when}`;
  const o = $('#mPics').options; o[0].textContent = `写真もいっしょに（約 ${MB(big)}）`; o[1].textContent = `写真は小さくして（約 ${MB(small)}）`;
  for (const [k, v] of es) if (!exportSmall[k]) Thumbs.small(k).then(sm => { if (sm) exportSmall[k] = sm; });   // old backups without a small copy
}
$('#verTxt').textContent = `SANPO LOG v${VERSION}（${VERSION_DATE}）`;
$('#bData2').onclick = () => $('#bData').onclick();
$('#bData').onclick = () => {
  const sp = W < 720;
  $('#mShare').textContent = 'バックアップする（保存先を選ぶ）';
  $('#mDown').textContent = sp ? 'この端末にダウンロード' : 'バックアップする';
  $('#mDown').classList.toggle('ghost', sp);
  photoInfo();
  if (FB.enabled() && !FB.sdk) FB.load().then(() => Sync.paint()).catch(() => {});
  Sync.paint();
  whereText(); a2hsText();
  $('#mText').value = '';
  $('#modal').classList.add('open');
};
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closePanel('modal'); });
$('#mDown').onclick = () => {
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportJSON()], { type: 'application/json' }));
    a.download = `sanpo-log-${today()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    toast('バックアップしました（保存されない場合は「コピー」を）'); exported();
  } catch (e) { toast('この環境では保存できません。「コピー」を使ってください'); }
};
$('#mCopy').onclick = async () => {
  const s = exportJSON();
  try { await navigator.clipboard.writeText(s); toast('コピーしました'); exported(); }
  catch (e) { $('#mText').value = s; $('#mText').select(); toast('下の欄を選択してコピーしてください'); }
};
function importText(s) {
  try {
    const o = JSON.parse(s);
    if (!o || (typeof o.r !== 'object' && typeof o.notes !== 'object' && typeof o.places !== 'object')) throw 0;
    const n = Store.absorb(o);
    if (o.thumbs && typeof o.thumbs === 'object') for (const [id, d] of Object.entries(o.thumbs)) if (/^t[a-z0-9]{6,40}$/.test(id) && /^data:image\//.test(d)) Thumbs.put(id, d);
    Store.commit();
    toast(Store.newer ? `メモ ${n} 件を戻しました（新しいアプリで作られた記録です。アプリを開き直すと、すべて読めます）` : `バックアップから、メモ ${n} 件を戻しました`, 4000); closePanel('modal');
  } catch (e) { toast('読み込めませんでした（形式を確認してください）'); }
}
$('#mShare').onclick = async () => {
  try {
    const file = new File([exportJSON()], `sanpo-log-${today()}.json`, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'SANPO LOG' }); toast('バックアップしました'); exported(); }
    else $('#mDown').click();
  } catch (e) { if (e && e.name !== 'AbortError') toast('送れませんでした。「この端末にダウンロード」を使ってください'); }
};
let dragN = 0;
addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragN++; $('#drop').classList.add('on'); } });
addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('#drop').classList.remove('on'); } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
  e.preventDefault(); dragN = 0; $('#drop').classList.remove('on');
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (f) f.text().then(t => /\.gpx$/i.test(f.name) || /<gpx[\s>]/.test(t.slice(0, 2000)) ? importGPX(t) : importText(t));
});
$('#mFile').onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(importText); e.target.value = ''; };
$('#mPaste').onclick = () => importText($('#mText').value);

$('#ghConnect').onclick = async () => {
  const t = $('#ghToken').value.trim();
  if (!t) { toast('合鍵を貼り付けてください'); return; }
  $('#ghConnect').disabled = true; $('#ghConnect').textContent = '確認中…';
  const ok = await Sync.connect(t, $('#ghRepo').value);
  $('#ghConnect').disabled = false; $('#ghConnect').textContent = '接続する';
  if (ok) { $('#ghToken').value = ''; toast('GitHubと同期しました'); }
};
$('#ghNow').onclick = () => Sync.run();
$('#fbIn').onclick = () => {
  if (!FB.sdk) { toast('準備しています…もう一度押してください'); FB.load().catch(() => toast('Firebaseを読み込めませんでした')); return; }
  FB.signIn().catch(e => { FB.msg = e && e.code === 'auth/popup-closed-by-user' ? '' : 'ログインできませんでした（' + (e && e.code || 'error') + '）'; Sync.paint(); });
};
$('#fbOut').onclick = () => { FB.signOut(); toast('ログアウトしました（記録はこの端末に残っています）'); };
$('#grMake').onclick = async () => {
  const name = $('#grName').value.trim();
  if (!name) { $('#grName').focus(); toast('グループ名を入れてください'); return; }
  $('#grMake').disabled = true;
  try { await GR.create(name); $('#grName').value = ''; toast(`グループ「${name}」を作りました。招待リンクを送りましょう`, 3600); }
  catch (e) { toast(e && e.code === 'too-many' ? `グループは${GMAX}つまでです` : '作れませんでした（' + (e && e.code || 'error') + '）'); }
  finally { $('#grMake').disabled = false; }
};
$('#grInvite').onclick = async () => {
  const G = GR.boxG(); if (!G || !G.on()) return;
  const url = G.link(), text = `散歩の地図「${G.g.name}」に招待します。開いて「参加する」を押してください。`;
  if (navigator.share && (W < 720 || H < 520)) { try { await navigator.share({ title: 'SANPO LOG', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text + '\n' + url); toast('招待リンクをコピーしました。LINEやメールに貼って送ってください', 3600); }
  catch (e) { $('#mText').value = text + '\n' + url; $('#mText').select(); toast('下の欄の招待リンクをコピーして送ってください', 3600); }
};
$('#grLeave').onclick = () => {
  const b = $('#grLeave');
  if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = '本当に抜ける？'; setTimeout(() => { b.classList.remove('arm'); b.textContent = 'このグループを抜ける'; }, 3000); return; }
  b.classList.remove('arm'); b.textContent = 'このグループを抜ける';
  GR.leave(GR.boxG()).catch(() => toast('抜けられませんでした。少しあとで試してください'));
};
$('#grGName').onchange = () => {
  const G = GR.boxG(), v = $('#grGName').value.trim(); if (!v || !G || !G.on() || v === G.g.name) return;
  G.renameGroup(v).then(() => toast(`グループ名を「${v}」にしました（タグも #${normTag(v)} になります）`, 3600)).catch(() => toast('変えられませんでした'));
};
$('#grMyName').onchange = () => { const G = GR.boxG(), v = $('#grMyName').value.trim(); if (v && G && G.on()) G.rename(v).then(() => toast('表示名を変えました')).catch(() => toast('変えられませんでした')); };
$('#gvMe').onclick = () => { GR.view = 'me'; GR.saveView(); groupIndex(); paintGroup(); changed(); };
$('#joinOk').onclick = () => {
  const gid = GR.pending(); if (!gid) return closePanel('join');
  if (FB.user) return GR.doJoin(gid);
  if (!FB.sdk) { toast('準備しています…もう一度押してください'); FB.load().catch(() => toast('読み込めませんでした')); return; }
  try { localStorage.setItem('sanpo-join-ok', '1'); } catch (e) {}
  closePanel('join');
  FB.signIn().catch(e => { try { localStorage.removeItem('sanpo-join-ok'); } catch (x) {} if (!(e && e.code === 'auth/popup-closed-by-user')) toast('ログインできませんでした'); setTimeout(() => GR.joinPending(), 300); });
};
$('#joinNo').onclick = () => { GR.clearPending(); closePanel('join'); };
$('#join').addEventListener('click', e => { if (e.target.id === 'join') closePanel('join'); });
$('#fbNow').onclick = () => FB.push();
$('#ghOff').onclick = () => { Sync.off(); toast('この端末の接続を解除しました（記録はこの端末に残っています）'); };
addEventListener('visibilitychange', () => {
  if (!Sync.on()) return;
  if (document.visibilityState === 'visible') { if (Date.now() - Sync.last > 20000) Sync.soon(0); }
  else if (Sync.t) Sync.soon(0);   // leaving the page with unsent changes: send now
});
addEventListener('online', () => { Sync.soon(0); FB.soon(0); });
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && FB.t) FB.soon(0); });

async function delNoteUndo(n) {   // けす: gone at once, with 5 seconds to take it back (photos too)
  editing = null;
  const keep = { ...n }, pics = [], to = GR.sharedTo(n).map(G => G.g.name);
  for (const id of n.im || []) { try { const d = await Thumbs.src(id); if (d) pics.push([id, d, await Thumbs.small(id)]); } catch (e) {} }
  Store.delNote(n.id); Thumbs.del(n.im);
  toast(to.length ? `メモをけしました（${to.join('・')}からも）` : 'メモをけしました', 5200, ['もどす', () => {
    Store.deleted.delete('n:' + keep.id);
    for (const [id, d, sm] of pics) Thumbs.put(id, d, false, sm || undefined);
    Store.putNote(keep); toast('もどしました');
  }]);
}
