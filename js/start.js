/* SANPO LOG — js/start.js
   起動 — keys and window size, redrawing after a change, then start (this file runs last).
   The files load in this order (see index.html): base → parts → records → sync → map → memo → screens → start.
   They share one scope: a name made in an earlier file can be used in any later one, but code that runs
   while the page loads may only use names from its own file and the earlier ones. */
'use strict';

addEventListener('keydown', e => {
  if (e.target.matches('input,textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key === 'Escape') up();
  else if (IG.on()) { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); IG.step(e.key === 'ArrowLeft' ? -1 : 1); } }
  else if (e.key === '/' ) { e.preventDefault(); openDrawer('list'); setTimeout(() => $('#dFilter').focus(), 50); }
});
const setSP = () => document.body.classList.toggle('sp', W < 720 || H < 520);
addEventListener('resize', () => { W = innerWidth; H = innerHeight; setSP(); if (D.japanFeats) counters(); else logBadge(); applyView(); settle(); });
// iPhone: after the keyboard closes the page can stay shifted; put it back
addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement || !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) window.scrollTo(0, 0); }, 80));
setSP();
addEventListener('hashchange', route);

/* ---------- re-render on data change ---------- */
let chT;
function changed() {
  clearTimeout(chT);
  chT = setTimeout(() => {
    if (!D.japanFeats) return;
    paint(); refreshMemoBtn(); intro(); refreshPanels(); drawRoute();
    if (!anim) drawLabels();
  }, 30);
}

function refreshPanels() {
  if (S.sel && $('#sheet').classList.contains('open')) { renderEntries(); paintStat(selInfo()); fTags.refresh(); }
  if (curWalk && $('#wsheet').classList.contains('open')) renderWalk();
  if ($('#drawer').classList.contains('open')) { const f = document.activeElement === $('#dFilter'); renderDrawer(); if (f) $('#dFilter').focus(); }
}

/* ---------- boot ---------- */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
/* 写真のリンクを貼る: the post's own time picks the memo it belongs to */
const noteTime = n => new Date(n.d + 'T' + (n.at || '12:00') + ':00').getTime();
function attachLink(u) {
  if ((String(u || '').match(URL_RE) || []).some(mapUrl)) return shopFromOutside(u);   // a shop, not a photo
  const ls = parseLinks(u); if (!ls.length) return toast('リンクが見つかりませんでした');
  const url = ls[0], when = postTime(url), mine = [...Store.notes.values()];
  if (!mine.length) return toast('まずメモをのこしてから、写真を付けてください');
  const c = mine.slice().sort(when ? (a, b) => Math.abs(noteTime(a) - when) - Math.abs(noteTime(b) - when) : (a, b) => noteTime(b) - noteTime(a)).slice(0, 6);
  const p = photoPost(url);
  $('#attWhen').textContent = when ? `${p ? (p.svc === 'x' ? 'X' : 'Instagram') + ' の投稿 · ' : ''}${new Date(when).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '新しいメモから順に出しています';
  const box = $('#attList'); box.innerHTML = '';
  c.forEach((n, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cand' + (i === 0 && when && Math.abs(noteTime(n) - when) < 36e5 * 36 ? ' best' : '');
    b.innerHTML = '<b></b><span></span>';
    b.querySelector('b').textContent = n.d.replace(/-/g, '.') + (n.at ? ' ' + n.at : '') + ' · ' + (placeName(n.k) || '');
    b.querySelector('span').textContent = n.t || n.x || withText(n) || '（メモなし）';
    b.onclick = () => {
      Store.putNote({ ...n, p: parseLinks([...(n.p || []), url].join(' ')) });
      closePanel('attach'); toast('写真のリンクを付けました'); openWalk(n.d);
    };
    box.appendChild(b);
  });
  $('#attach').classList.add('open');
}
function attachAsk() {   // when the clipboard can't be read: paste by hand
  $('#attWhen').textContent = 'コピーした写真のリンク（Instagram・X）を、下の欄に貼り付けてください。';
  const box = $('#attList'); box.innerHTML = '';
  const inp = document.createElement('input'); inp.type = 'url'; inp.placeholder = 'ここに貼り付け（長押し →「ペースト」）'; inp.className = 'attIn';
  box.appendChild(inp); box.appendChild(mkBtn('付けるメモをさがす', 'btn', () => attachLink(inp.value)));
  $('#attach').classList.add('open'); inp.focus();
}
$('#attach').addEventListener('click', e => { if (e.target.id === 'attach') closePanel('attach'); });
document.addEventListener('paste', e => {   // PC: paste a link anywhere on the map
  if (e.target.closest && e.target.closest('input,textarea,[contenteditable]')) return;
  const txt = e.clipboardData ? e.clipboardData.getData('text') : '', ls = parseLinks(txt);
  if (ls.some(mapUrl)) { e.preventDefault(); return shopFromOutside(txt); }
  if (ls.length) { e.preventDefault(); attachLink(ls[0]); }
});
let pendingAdd = '';
(function catchAdd() {   // ?add=<link> (for an iPhone shortcut from the share menu)
  const m = location.search.match(/[?&]add=([^&]+)/);
  if (!m) return;
  try { pendingAdd = decodeURIComponent(m[1]); } catch (e) {}
  history.replaceState(null, '', location.pathname + location.hash);
})();
(function catchInvite() {   // ?g=<group id>  ->  remember it, tidy the address bar
  const m = location.search.match(/[?&]g=([A-Za-z0-9]{12,40})/);
  if (!m) return;
  try { localStorage.setItem('sanpo-join', m[1]); localStorage.removeItem('sanpo-join-ok'); } catch (e) {}
  history.replaceState(null, '', location.pathname + location.hash);
})();
(async function boot() {
  progress(true);
  try {
    const J = await loadData('japan');
    D.P = J.P;
    for (const [pc, n, m, t] of J.P) { D.prefInfo[pc] = { n, m, t }; TOT.m += m; TOT.t += t; }
    D.japanFeats = topoFeatures(J, 'p').map(f => ({ c: f.c, ...prep(f.polys, f.c === '47') }));
    const ok = D.japanFeats.find(f => f.c === '47').bb;
    JAPAN_BB = [Math.min(PX(129.3), ok[0] - 10), PY(45.55), Math.max(PX(145.85), ok[2]), Math.max(PY(31.0), ok[3] + 10)];
    renderPrefs(); drawMe();
    Store.init();
    Sync.load(); Sync.paint();
    try { if (FB.enabled() && (localStorage.getItem('sanpo-fb') || GR.pending())) FB.load().catch(() => {}); } catch (e) {}
    Object.assign(V, fitView(JAPAN_BB)); V.s *= 1.6; applyView();
    aggregate();
  } catch (e) { toast('地図データを読み込めませんでした'); console.error(e); return; }
  finally { progress(false); }
  await route();
  Sync.soon(0);
  if (pendingAdd) setTimeout(() => attachLink(pendingAdd), 400);
  else setTimeout(shopResume, 600);
  Rec.load();
  if (Rec.st) {
    const last = Math.max(Rec.st.t, ...Rec.pts().map(q => q[2]));
    if (Rec.st.d !== today() && Date.now() - last > 3 * 36e5) Rec.finish(true);   // left running from an earlier day
    else { Rec.watch(); Rec.paint(); drawRec(); }
  }
})();
