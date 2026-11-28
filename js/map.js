/* SANPO LOG — js/map.js
   地図 — painting the map (prefectures, cities, towns, dots, labels), moving it, the header path,
   highlighting a walk or a tag (and replaying a walk), and the finger / mouse on the map.
   The files load in this order (see index.html): base → parts → records → sync → map → memo → screens → start.
   They share one scope: a name made in an earlier file can be used in any later one, but code that runs
   while the page loads may only use names from its own file and the earlier ones. */
'use strict';

/* ---------- aggregates ---------- */
let AG = null;
function aggregate() {
  const pref = new Map(), muni = new Map();
  const P = pc => pref.get(pc) || (pref.set(pc, { direct: false, munis: new Set(), towns: 0, who: new Map() }), pref.get(pc));
  const M = mc => muni.get(mc) || (muni.set(mc, { direct: false, towns: 0, who: new Map() }), muni.get(mc));
  const grp = GR.showing(), bump = (m, u) => m.set(u, (m.get(u) || 0) + 1);
  for (const k of (grp ? GX.visited : IX.visited)) {
    let p, m = null;
    if (k[0] === 'p') { p = P(k.slice(1)); p.direct = true; }
    else {
      const mc = k.slice(1, 6); p = P(mc.slice(0, 2)); m = M(mc);
      p.munis.add(mc);
      if (k[0] === 'm') m.direct = true; else { m.towns++; p.towns++; }
    }
    if (grp) for (const u of GX.first.get(k).keys()) { bump(p.who, u); if (m) bump(m.who, u); }
  }
  let towns = 0; for (const m of muni.values()) towns += m.towns;
  AG = { pref, muni, towns };
}

const ACC = [255, 79, 0];
const mix = (base, t, to = ACC) => 'rgb(' + base.map((v, i) => Math.round(v + (to[i] - v) * t)).join(',') + ')';
const topWho = a => { let b = null, n = -1; for (const [u, c] of a.who) if (c > n) { n = c; b = u; } return b; };
const tint = a => GR.showing() && a && a.who.size ? hexRGB(GR.color(topWho(a))) : ACC;   // group view: the colour of whoever walked most of it
const WHITE = [255, 255, 255], CTX = [227, 227, 221];
function prefT(pc) {
  const a = AG.pref.get(pc); if (!a) return 0;
  if (!a.munis.size) return .45;
  return .45 + .55 * Math.sqrt(a.munis.size / Math.max(1, D.prefInfo[pc].m));
}
function muniT(mc) {
  const a = AG.muni.get(mc); if (!a) return 0;
  const P = D.pref[mc.slice(0, 2)], T = (P && P.T[mc]) || 0;   // that prefecture's data may not be here yet
  if (!a.towns) return T ? .45 : 1;
  return .45 + .55 * Math.sqrt(a.towns / Math.max(1, T));
}

/* ---------- view ---------- */
function applyView() {
  const w = W * V.s, h = H * V.s;
  svg.setAttribute('viewBox', `${V.cx - w / 2} ${V.cy - h / 2} ${w} ${h}`);
  sizeDots(); drawGrid(); drawScale();
}
/* dots are zero-length strokes; their size is set in map units here (some mobile browsers ignore
   non-scaling-stroke for them and would draw them huge). [PC px, phone px] */
const DOT_PX = { tDots: [2.4, 1.8], routeRing: [13, 9], routeDots: [8, 5.5], pinRing: [14, 10], pin: [9, 6], meRing: [17, 12], meCore: [11, 7.5], mkr: [10, 7], mk: [6, 4] };
const dotW = id => DOT_PX[id][W < 720 || H < 520 ? 1 : 0] * V.s;
let dotEls;
function sizeDots() {
  dotEls = dotEls || Object.keys(DOT_PX).filter(id => !/^mk/.test(id)).map(id => [id, document.getElementById(id)]);
  for (const [id, n] of dotEls) n.style.strokeWidth = dotW(id);
  const k = (W < 720 || H < 520 ? .85 : 1) * V.s;   // 道のり: round dots ~2.6px every ~5.6px on screen
  for (const [id, w] of [['track', 2.6], ['recLine', 2.6], ['trackHalo', 5], ['recHalo', 5]]) { const n = document.getElementById(id); n.style.strokeWidth = w * k; n.style.strokeDasharray = `${.001 * k} ${5.6 * k}`; }
  const g = document.getElementById('trackGap'); g.style.strokeWidth = 1 * k; g.style.strokeDasharray = `${2 * k} ${5 * k}`;
}
const toWorld = (x, y) => [V.cx + (x - W / 2) * V.s, V.cy + (y - H / 2) * V.s];
const toScreen = (x, y) => [(x - V.cx) / V.s + W / 2, (y - V.cy) / V.s + H / 2];
function pads() {
  return W < 720 ? { t: 168, r: 8, b: 92, l: 8 } : H < 520 ? { t: 112, r: 40, b: 56, l: 40 } : { t: 150, r: 60, b: 90, l: 60 };
}
function fitView(bb) {
  const p = pads();
  const bw = Math.max(bb[2] - bb[0], 1e-3), bh = Math.max(bb[3] - bb[1], 1e-3);
  const s = Math.max(bw / Math.max(60, W - p.l - p.r), bh / Math.max(60, H - p.t - p.b));
  const ax = (p.l + W - p.r) / 2, ay = (p.t + H - p.b) / 2;
  return { cx: (bb[0] + bb[2]) / 2 - (ax - W / 2) * s, cy: (bb[1] + bb[3]) / 2 - (ay - H / 2) * s, s };
}
const SMIN = .0004, SMAX = 8;
let anim = null;
const ease = t => t < .5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
function flyTo(T, dur = 900) {
  cancelAnimationFrame(anim && anim.raf);
  const F = { ...V }, t0 = performance.now();
  const ls0 = Math.log(F.s), ls1 = Math.log(T.s);
  // zoom out a little in the middle when travelling far (feels like a camera)
  const dist = Math.hypot(T.cx - F.cx, T.cy - F.cy) / Math.max(W * Math.max(F.s, T.s), 1e-9);
  const bump = Math.min(1.2, dist * .6);
  $('#gLabel').style.opacity = 0;
  return new Promise(res => {
    const step = now => {
      const t = Math.min(1, Math.max(0, now - t0) / dur), e = ease(t);
      V.cx = F.cx + (T.cx - F.cx) * e; V.cy = F.cy + (T.cy - F.cy) * e;
      V.s = Math.exp(ls0 + (ls1 - ls0) * e + bump * Math.sin(Math.PI * t));
      applyView();
      if (t < 1) anim = { raf: requestAnimationFrame(step) };
      else { anim = null; settle(); res(); }
    };
    anim = { raf: requestAnimationFrame(step) };
  });
}
function stopAnim() { if (anim) { cancelAnimationFrame(anim.raf); anim = null; } }
let settleT;
function settle() { clearTimeout(settleT); settleT = setTimeout(() => { drawLabels(); $('#gLabel').style.opacity = 1; }, 90); }

/* graticule + tick labels */
const STEPS = [10, 5, 2, 1, .5, .2, .1, .05, .02, .01, .005, .002, .001];
function drawGrid() {
  const o = S.pc === '47';
  const gx = o ? OKI.dx : 0, gy = o ? OKI.dy : 0;
  const [l0, a1] = unproj(V.cx - W * V.s / 2, V.cy - H * V.s / 2, o), [l1, a0] = unproj(V.cx + W * V.s / 2, V.cy + H * V.s / 2, o);
  let st = STEPS[0];
  for (const s of STEPS) { if (s * K / V.s >= 110) st = s; else break; }
  const dec = Math.max(0, -Math.floor(Math.log10(st) + 1e-9));
  let d = '', html = '';
  const y0 = V.cy - H * V.s / 2, y1 = V.cy + H * V.s / 2, x0 = V.cx - W * V.s / 2, x1 = V.cx + W * V.s / 2;
  const mob = W < 720;
  for (let g = Math.ceil(l0 / st) * st; g <= l1; g += st) {
    const x = PX(g) + gx; d += `M${x} ${y0}V${y1}`;
    const sx = (x - V.cx) / V.s + W / 2;
    if (!mob) html += `<span style="left:${sx + 4}px;bottom:${6}px">${g.toFixed(dec)}°E</span>`;
  }
  for (let g = Math.ceil(a0 / st) * st; g <= a1; g += st) {
    const y = PY(g) + gy; d += `M${x0} ${y}H${x1}`;
    const sy = (y - V.cy) / V.s + H / 2;
    if (!mob && sy > 150 && sy < H - 70) html += `<span style="right:${6}px;top:${sy - 11}px">${g.toFixed(dec)}°N</span>`;
  }
  $('#grid').setAttribute('d', d);
  $('#ticks').innerHTML = html;
}
function drawScale() {
  const [, lat] = unproj(V.cx, V.cy, S.pc === '47');
  const mpp = V.s * 0.01 * 111320 * Math.cos(lat * Math.PI / 180);
  const target = mpp * 90;
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  const n = [1, 2, 5, 10].map(k => k * p).reverse().find(v => v <= target * 1.4) || p;
  $('#scale i').style.width = (n / mpp) + 'px';
  $('#scale span').textContent = n >= 1000 ? (n / 1000) + ' km' : n + ' m';
}

/* ---------- layers ---------- */
const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const prefNodes = new Map(), muniNodes = new Map();
let townNodes = [], townData = null;

function renderPrefs() {
  const g = $('#gPref');
  for (const f of D.japanFeats) {
    const p = el('path', { d: f.d, 'data-k': f.c, 'data-kind': 'p' });
    g.appendChild(p); prefNodes.set(f.c, p);
  }
  // Okinawa inset frame
  const o = D.japanFeats.find(f => f.c === '47').bb, m = 22;
  const r = $('#inset');
  r.setAttribute('x', o[0] - m); r.setAttribute('y', o[1] - m);
  r.setAttribute('width', o[2] - o[0] + 2 * m); r.setAttribute('height', o[3] - o[1] + 2 * m);
}
function renderMunis(pc) {
  const g = $('#gMuni');
  if (g.dataset.pc === pc) return;
  g.textContent = ''; muniNodes.clear(); g.dataset.pc = pc;
  for (const f of D.pref[pc].feats) {
    const p = el('path', { d: f.d, 'data-k': f.c, 'data-kind': 'm' });
    g.appendChild(p); muniNodes.set(f.c, p);
  }
}
function clearTowns() {
  $('#gCells').textContent = ''; $('#tBorder').removeAttribute('d'); $('#tDots').removeAttribute('d');
  $('#muniEdge').removeAttribute('d'); $('#clipPath').removeAttribute('d');
  townNodes = []; townData = null;
}
function renderTowns(mc) {
  clearTowns();
  const M = D.muni[mc];
  $('#clipPath').setAttribute('d', M.d); $('#muniEdge').setAttribute('d', M.d);
  const towns = D.towns[mc] || [];
  townData = { mc, towns };
  if (!towns.length) return;
  const seeds = [], own = [];
  towns.forEach((t, i) => t.pts.forEach(p => { seeds.push(p); own.push(i); }));
  const bb = M.bb.slice();
  for (const p of seeds) { bb[0] = Math.min(bb[0], p[0]); bb[1] = Math.min(bb[1], p[1]); bb[2] = Math.max(bb[2], p[0]); bb[3] = Math.max(bb[3], p[1]); }
  const pad = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * .08 + .5;
  const box = [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad];
  const del = d3.Delaunay.from(seeds), vor = del.voronoi(box);
  const ds = towns.map(() => ''), tb = towns.map(() => [Infinity, Infinity, -Infinity, -Infinity]);
  for (let j = 0; j < seeds.length; j++) {
    const poly = vor.cellPolygon(j); if (!poly) continue;
    const i = own[j], b = tb[i];
    ds[i] += 'M' + poly.map(p => f3(p[0]) + ' ' + f3(p[1])).join('L') + 'Z';
    for (const p of poly) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; }
  }
  // borders only between different towns (cells of the same 大字 merge)
  const { halfedges: he, triangles: tr, points: pt } = del, cc = vor.circumcenters;
  const far = (box[2] - box[0] + box[3] - box[1]) * 2;
  let bd = '';
  for (let e = 0; e < he.length; e++) {
    const o = he[e];
    const i = tr[e], j = tr[e % 3 === 2 ? e - 2 : e + 1];
    if (own[i] === own[j]) continue;
    const t1 = (e / 3) | 0;
    const ax = cc[2 * t1], ay = cc[2 * t1 + 1];
    if (o >= 0) {
      if (o < e) continue;
      const t2 = (o / 3) | 0;
      bd += `M${f3(ax)} ${f3(ay)}L${f3(cc[2 * t2])} ${f3(cc[2 * t2 + 1])}`;
    } else {
      // hull edge: ray outward, perpendicular to the edge
      const dx = pt[2 * j] - pt[2 * i], dy = pt[2 * j + 1] - pt[2 * i + 1];
      const k = tr[e % 3 === 0 ? e + 2 : e - 1];
      let nx = dy, ny = -dx;
      if (nx * (pt[2 * k] - pt[2 * i]) + ny * (pt[2 * k + 1] - pt[2 * i + 1]) > 0) { nx = -nx; ny = -ny; }
      const L = Math.hypot(nx, ny) || 1;
      bd += `M${f3(ax)} ${f3(ay)}L${f3(ax + nx / L * far)} ${f3(ay + ny / L * far)}`;
    }
  }
  if (!he.length && towns.length > 1) { // collinear / tiny case: outline every cell
    bd = ds.join('');
  }
  const g = $('#gCells'), frag = document.createDocumentFragment();
  let dots = '';
  towns.forEach((t, i) => {
    t.bb = tb[i];
    const p = el('path', { d: ds[i] || 'M0 0', class: 'cell', 'data-k': t.k, 'data-kind': 't', 'data-i': i });
    frag.appendChild(p); townNodes.push(p);
    dots += `M${f3(t.pts[0][0])} ${f3(t.pts[0][1])}h0`;
  });
  g.appendChild(frag);
  $('#tBorder').setAttribute('d', bd);
  $('#tDots').setAttribute('d', dots);
}

/* ripple: children appear outward from the click point */
function ripple(nodes, feats) {
  const o = origin || { x: W / 2, y: H / 2 };
  const maxd = Math.hypot(W, H);
  nodes.forEach((n, i) => {
    const f = feats[i]; if (!f) return;
    const [sx, sy] = toScreen(f.lp[0], f.lp[1]);
    n.style.transition = 'none'; n.style.opacity = 0;
    n.dataset.delay = Math.min(520, Math.hypot(sx - o.x, sy - o.y) / maxd * 900);
  });
  requestAnimationFrame(() => requestAnimationFrame(() => nodes.forEach(n => {
    n.style.transition = `opacity .5s ${n.dataset.delay}ms, fill .5s`; n.style.opacity = 1;
  })));
}

/* paint fills from records */
function paint() {
  aggregate();
  const lv = S.level;
  for (const [pc, n] of prefNodes) {
    const t = prefT(pc);
    const cur = lv !== 'japan' && pc === S.pc;
    const ctx = lv !== 'japan';
    n.classList.toggle('ctx', ctx && !cur);
    n.classList.toggle('hidden', cur);
    const to = tint(AG.pref.get(pc));
    n.style.fill = ctx ? (t ? mix(CTX, t * .45, to) : 'var(--ctx)') : (t ? mix(WHITE, t, to) : '');
  }
  for (const [mc, n] of muniNodes) {
    const t = muniT(mc);
    const ctx = lv === 'muni' && mc !== S.mc;
    const cur = lv === 'muni' && mc === S.mc;
    n.classList.toggle('ctx', ctx);
    n.classList.toggle('off', cur);
    const to = tint(AG.muni.get(mc));
    n.style.fill = ctx ? (t ? mix(CTX, t * .45, to) : 'var(--ctx)') : (t ? mix(WHITE, t, to) : '');
  }
  const grp = GR.showing();
  if (townData) townData.towns.forEach((t, i) => { townNodes[i].style.fill = grp ? (townFill(t.k) || 'var(--land)') : isV(t.k) ? 'var(--accent)' : 'var(--land)'; townNodes[i].classList.toggle('hl', !!HL && HL.keys.has(t.k)); });
  for (const [pc, n] of prefNodes) n.classList.toggle('hl', !!HL && HL.P.has(pc) && !(lv !== 'japan' && pc === S.pc));
  for (const [mc, n] of muniNodes) n.classList.toggle('hl', !!HL && HL.M.has(mc) && !(lv === 'muni' && mc === S.mc));
  $('#gMuni').style.display = lv === 'japan' ? 'none' : '';
  $('#tDots').classList.toggle('hidden', lv !== 'muni');
  $('#inset').classList.toggle('hidden', lv !== 'japan');
  counters();
}

/* ---------- labels (placed when the view settles) ---------- */
function drawLabels() {
  const g = $('#gLabel'); g.textContent = '';
  let mk = '';
  const fsz = W < 720 ? 10 : 11;
  if (S.level === 'japan') D.japanFeats.forEach(f => { if (IX.byPlace.has('p' + f.c)) mk += `M${f.lp[0]} ${f.lp[1] - fsz * 1.5 * V.s}h0`; });
  else if (S.level === 'pref') D.pref[S.pc].feats.forEach(f => { if (IX.byPlace.has('m' + f.c)) mk += `M${f.lp[0]} ${f.lp[1] - fsz * 1.5 * V.s}h0`; });
  if (mk) { g.appendChild(el('path', { d: mk, class: 'mkr dot', style: 'stroke-width:' + dotW('mkr') })); g.appendChild(el('path', { d: mk, class: 'mk dot', style: 'stroke-width:' + dotW('mk') })); }
  let items = [];
  const fs = W < 720 ? 10 : 11;
  if (S.level === 'japan') items = D.japanFeats.map(f => ({ n: D.prefInfo[f.c].n, lp: f.lp, bb: f.bigbb, v: prefT(f.c) > .6 }));
  else if (S.level === 'pref') items = D.pref[S.pc].feats.map(f => ({ n: f.n, lp: f.lp, bb: f.bigbb, v: muniT(f.c) > .6 }));
  else if (townData) items = townData.towns.map(t => ({ n: t.n, lp: t.pts[0], bb: t.bb, v: visK(t.k), c: GR.showing() && GX.own.has(t.k) ? GR.color(GX.own.get(t.k)) : null, dy: -1 }));
  const placed = [];
  const x0 = -40, y0 = -20, x1 = W + 40, y1 = H + 20;
  items.sort((a, b) => (b.bb[2] - b.bb[0]) * (b.bb[3] - b.bb[1]) - (a.bb[2] - a.bb[0]) * (a.bb[3] - a.bb[1]));
  let count = 0;
  for (const it of items) {
    if (count > 260) break;
    const [sx, sy0] = toScreen(it.lp[0], it.lp[1]);
    const sy = sy0 + (it.dy ? -fs * .95 : 0);
    if (sx < x0 || sx > x1 || sy < y0 || sy > y1) continue;
    const bw = (it.bb[2] - it.bb[0]) / V.s, bh = (it.bb[3] - it.bb[1]) / V.s;
    const tw = it.n.length * fs * 1.02 + 4, th = fs + 4;
    if (bw < tw * .8 || bh < th * 1.3) continue;
    const r = [sx - tw / 2, sy - th / 2, sx + tw / 2, sy + th / 2];
    if (placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) continue;
    placed.push(r); count++;
    const [wx, wy] = toWorld(sx, sy);
    const t = el('text', { x: wx, y: wy, 'font-size': fs * V.s, 'stroke-width': 3 * V.s });
    if (it.v && S.level === 'muni') { t.setAttribute('class', 'v'); if (it.c) { t.style.stroke = it.c; if (isLight(it.c)) t.style.fill = 'var(--ink)'; } }
    t.textContent = it.n;
    g.appendChild(t);
  }
}

/* ---------- counters ---------- */
const tw = {};
function tick(id, val, tot) {
  const node = $(id);
  const from = tw[id] ? tw[id].v : 0;
  tw[id] = { v: val };
  const t0 = performance.now();
  const totS = tot == null ? '' : '/' + tot.toLocaleString('en');
  const step = now => {
    const t = Math.min(1, Math.max(0, now - t0) / 700), e = 1 - Math.pow(1 - t, 3);
    node.innerHTML = Math.round(from + (val - from) * e).toLocaleString('en') + (totS ? '<em>' + totS + '</em>' : '');
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
let TOT = { m: 0, t: 0 };
function logBadge() {
  const n = IX.raw;
  $('#bLog').textContent = 'ノート';
}
function counters() {
  logBadge();
  // count what was walked; show "of how many" only for the place on screen (no 189,956 to feel small next to)
  const sp = W < 720 || H < 520, lv = S.level;
  tick('#cP', AG.pref.size, 47);
  if (lv !== 'japan' && D.prefInfo[S.pc]) {
    const a = AG.pref.get(S.pc);
    $('#lM').textContent = sp ? '市' : D.prefInfo[S.pc].n + 'の市区町村'; tick('#cM', a ? a.munis.size : 0, D.prefInfo[S.pc].m);
  } else { $('#lM').textContent = sp ? '市' : '市区町村'; tick('#cM', [...AG.pref.values()].reduce((s, p) => s + p.munis.size, 0), null); }
  if (lv === 'muni' && D.muni[S.mc]) {
    const a = AG.muni.get(S.mc);
    $('#lT').textContent = sp ? '町' : D.muni[S.mc].n + 'の町'; tick('#cT', a ? a.towns || 0 : 0, (D.towns[S.mc] || []).length);
  } else { $('#lT').textContent = '町'; tick('#cT', AG.towns, null); }
  Sync.paint();
}

/* ---------- navigation ---------- */
async function ensurePref(pc) {
  if (D.pref[pc]) return D.pref[pc];
  progress(true);
  try {
    const topo = await loadData('m' + pc);
    const oki = pc === '47';
    const feats = topoFeatures(topo, 'm').map(f => {
      const g = prep(f.polys, oki);
      const o = { c: f.c, n: topo.N[f.c], ...g };
      D.muni[f.c] = o;
      return o;
    });
    D.pref[pc] = { feats, T: topo.T, K: topo.K || {} };
    return D.pref[pc];
  } finally { progress(false); }
}
async function ensureTowns(mc) {
  if (D.towns[mc]) return D.towns[mc];
  const pc = mc.slice(0, 2), P = await ensurePref(pc);
  if (!P.T[mc]) return (D.towns[mc] = []);
  progress(true);
  try {
    const k = P.K[mc];
    const [file] = await Promise.all([loadData('t' + pc + (k ? '_' + k : '')), loadD3()]);
    const oki = pc === '47';
    for (const c in file) {
      if (D.towns[c]) continue;
      const [lat0, lng0, arr] = file[c];
      D.towns[c] = arr.map(e => {
        const pts = [];
        for (let i = 1; i < e.length; i += 2) pts.push(proj(lng0 + e[i + 1] / 1e4, lat0 + e[i] / 1e4, oki));
        return { n: e[0], k: tKey(c, e[0]), pts, ll: [lng0 + e[2] / 1e4, lat0 + e[1] / 1e4] };
      });
    }
    return D.towns[mc] || (D.towns[mc] = []);
  } finally { progress(false); }
}

let navId = 0;
/* while a place's data is on its way, its outline draws itself (only if the wait is noticeable) */
const Loading = {
  t: 0,
  start(node) {
    if (!node || !node.isConnected || !node.getAttribute('d')) return;
    const p = $('#loadEdge'); p.setAttribute('d', node.getAttribute('d')); p.style.strokeWidth = 1.6 * V.s;
    clearTimeout(this.t); this.t = setTimeout(() => p.classList.add('go'), 140);
  },
  stop() { clearTimeout(this.t); const p = $('#loadEdge'); p.classList.remove('go'); p.removeAttribute('d'); }
};
async function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  const id = ++navId;
  try {
    if (/^\d{5}$/.test(h) && D.prefInfo[h.slice(0, 2)] && !D.towns[h]) Loading.start(muniNodes.get(h) || prefNodes.get(h.slice(0, 2)));
    else if (/^\d{2}$/.test(h) && D.prefInfo[h] && !D.pref[h]) Loading.start(prefNodes.get(h));
    if (/^\d{5}$/.test(h) && D.prefInfo[h.slice(0, 2)]) {
      const pc = h.slice(0, 2);
      await ensurePref(pc);
      if (!D.muni[h]) return go('');
      await ensureTowns(h);
      if (id !== navId) return;
      enter('muni', pc, h);
    } else if (/^\d{2}$/.test(h) && D.prefInfo[h]) {
      await ensurePref(h);
      if (id !== navId) return;
      enter('pref', h, null);
    } else enter('japan', null, null);
  } catch (e) {
    toast('地図を読み込めませんでした。電波のいい所で、もう一度押してください'); console.error(e);
    pendingSel = null;
    const back = S.level === 'muni' ? S.mc : S.level === 'pref' ? S.pc : '';
    if (location.hash.slice(1) !== (back || '')) history.replaceState(null, '', back ? '#' + back : location.pathname + location.search);
  }
  finally { if (id === navId) Loading.stop(); }
}
function go(h) { if (location.hash.slice(1) === h) route(); else location.hash = h; }

function enter(level, pc, mc) {
  const prevLevel = S.level, prevPc = S.pc, prevMc = S.mc;
  S.level = level; S.pc = pc; S.mc = mc;
  document.body.dataset.level = level;
  setHover(null);
  $('#pin').removeAttribute('d'); $('#pinRing').removeAttribute('d');
  if (S.sel && (level !== 'muni' || S.sel.mc !== mc)) select(null);
  let target, nodes = [], feats = [];
  if (level === 'japan') {
    clearTowns();
    target = fitView(JAPAN_BB);
    if (prevLevel === 'japan' && !origin) { nodes = [...prefNodes.values()]; feats = D.japanFeats; }
  } else if (level === 'pref') {
    clearTowns();
    renderMunis(pc);
    target = fitView(D.japanFeats.find(f => f.c === pc).main);
    if (prevLevel === 'japan' || prevPc !== pc) { feats = D.pref[pc].feats; nodes = feats.map(f => muniNodes.get(f.c)); }
  } else {
    renderMunis(pc);
    renderTowns(mc);
    target = fitView(D.muni[mc].main);
    if (prevMc !== mc) { nodes = townNodes; feats = townData.towns.map(t => ({ lp: t.pts[0] })); }
  }
  paint();
  if (nodes.length) ripple(nodes, feats);
  origin = null;
  updateHeader();
  if ($('#drawer').classList.contains('open')) renderDrawer();
  if ($('#sheet').classList.contains('open') && !S.sel) closePanel('sheet');
  flyTo(target).then(() => {
    if (pendingSel) { const k = pendingSel; pendingSel = null; selectByKey(k); }
    else if (pendingFly) { const T = pendingFly; pendingFly = null; flyTo(T, 700); }
  });
}

function updateHeader() {
  // the top row only shows (v2.14.0): where you are and how much you walked; 設定 is its one button.
  // Back to the whole of Japan is ⌂, next to ◎ (PC: next to ノート). The prefecture is a small word before a city's name.
  let name = '日本', kind = '47 都道府県', pre = '';
  if (S.level === 'pref') { name = D.prefInfo[S.pc].n; kind = `${D.pref[S.pc].feats.length} 市区町村`; }
  if (S.level === 'muni') {
    pre = D.prefInfo[S.pc].n;
    name = D.muni[S.mc].n;
    kind = `${(D.towns[S.mc] || []).length} 町`;
  }
  $('#namePre').textContent = pre;
  const n = $('#name');
  n.innerHTML = '';
  Array.from(name).forEach((ch, i) => { const s = document.createElement('span'); s.className = 'ch'; s.style.animationDelay = (i * 35) + 'ms'; s.textContent = ch; n.appendChild(s); });
  $('#kind').textContent = kind;
  $('#memoHere').hidden = S.level === 'japan';
  $('#bUp').style.display = S.level === 'japan' ? 'none' : '';
  $('#bHome').style.display = S.level === 'japan' ? 'none' : '';   // ⌂: shown wherever there is a way back to Japan
  document.title = (S.level === 'japan' ? '' : name + ' — ') + 'SANPO LOG';
  refreshMemoBtn(); intro();
}
function intro() {
  const empty = !Store.notes.size && !Store.places.size && !GR.showing();
  let started = false; try { started = !!localStorage.getItem('sanpo-started'); } catch (e) {}
  const first = empty && !started;   // the very first time: one button only
  document.body.classList.toggle('first', first);
  const p = $('#intro'), show = S.level === 'japan' && empty;
  p.hidden = !show;
  if (show) p.innerHTML = '<b>歩いた町が、ぬられていく。</b><br>' + (first ? 'まずは、いまいる町から。' : W < 720 ? '右下の ＋ で、いまいる町にひとこと。' : '地図を押して町までおりると、ひとこと残せます。');
}
function started() { try { localStorage.setItem('sanpo-started', '1'); } catch (e) {} intro(); }
async function firstTown() {
  if (locBusy) return;
  const b = $('#firstGo'); b.disabled = true; b.textContent = 'いまいる町を、さがしています…';
  locBusy = true;
  try {
    const r = await locate();
    started();
    jumpTo(r.key);
    setTimeout(() => { if (!isV(r.key)) Store.setVisited(r.key, true); burst(r.key); toast(`これが、あなたの1町目。${r.key[0] === 't' ? r.name : placeName(r.key)}`, 4200); }, 1300);
  } catch (e) { geoErr(e, firstTown); }
  finally { locBusy = false; b.disabled = false; b.textContent = 'いまいる町を、ぬる'; }
}
$('#firstGo').onclick = firstTown;
$('#firstMap').onclick = () => { started(); toast('地図を押して、歩いた町までおりてください', 3200); };
function refreshMemoBtn() {
  if (S.level === 'japan') return;
  const k = S.level === 'pref' ? 'p' + S.pc : 'm' + S.mc;
  const n = (IX.byPlace.get(k) || []).length;
  const b = $('#memoHere');
  b.classList.toggle('on', isV(k));
  b.textContent = n ? `メモ ${n}` : isV(k) ? '● 行った' : '＋ メモ';
}
function up() {
  if ($('#routeDlg').classList.contains('open')) return closeRoute();
  if (Replay.on) return Replay.stop();
  if (IG.on()) return closePanel('ig');
  if ($('#join').classList.contains('open')) return closePanel('join');
  if ($('#geo').classList.contains('open')) return closePanel('geo');
  if ($('#modal').classList.contains('open')) return closePanel('modal');
  if (Pane.open() && Pane.stack.length && !editing) return Pane.back();
  if ($('#sheet').classList.contains('open')) { Pane.clear(); return closePanel('sheet'); }
  if ($('#wsheet').classList.contains('open')) { Pane.clear(); return closePanel('wsheet'); }
  if ($('#drawer').classList.contains('open')) { Pane.clear(); return closePanel('drawer'); }
  if (S.level === 'muni') go(S.pc); else if (S.level === 'pref') go('');
}

/* ---------- highlight (walk / tag) + walk route ---------- */
let HL = null;
function setHighlight(h) {
  HL = h ? { ...h, keys: new Set(h.keys), P: new Set(h.keys.map(k => k.slice(1, 3))), M: new Set(h.keys.filter(k => k[0] !== 'p').map(k => k.slice(1, 6))) } : null;
  const bar = $('#hlbar');
  bar.classList.toggle('on', !!HL);
  if (HL) bar.querySelector('span').textContent = `${HL.label} · ${HL.keys.size}`;
  drawRoute(); paint();
}
$('#hlbar button').onclick = () => { setHighlight(null); };
function routePoints(ns) {
  return ns.map(n => {
    const oki = n.k.slice(1, 3) === '47';
    if (n.loc) return proj(n.loc[1], n.loc[0], oki);
    if (n.k[0] !== 't') return null;   // a city/prefecture memo without GPS has no point on the course
    const pl = Store.place(n.k), ll = (pl && pl.ll) || (placeInfo(n.k) || {}).ll;
    return ll ? proj(ll[0], ll[1], oki) : null;
  }).filter(Boolean);
}
/* ▶ たどる — the course grows memo by memo while the clock runs (each leg gets the same beat) */
const toMin = a => /^\d{1,2}:\d{2}$/.test(a || '') ? +a.split(':')[0] * 60 + +a.split(':')[1] : null;
const fmtMin = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(Math.round(m) % 60).padStart(2, '0');
const Replay = {
  on: false, raf: 0, d: null,
  items(d) {
    const ns = (IX.byDate.get(d) || []).slice().sort((a, b) => (a.at || '99:99') < (b.at || '99:99') ? -1 : (a.at || '99:99') > (b.at || '99:99') ? 1 : 0);
    const out = []; ns.forEach(n => { const p = routePoints([n])[0]; if (p) out.push({ n, p }); });
    return out;
  },
  start(d) {
    if (W < 720) sheetTo('wsheet', true);
    const its = this.items(d), w = Store.walks.get(d) || {};
    if (w.trk) return this.startTrack(d, w, its);
    if (its.length < 2) return toast('たどるには、場所の分かるメモが2つ以上いります');
    this.stop(true);
    this.on = true; this.d = d;
    document.body.classList.add('replaying');
    const box = $('#replay'); box.classList.add('on');
    const segs = its.length - 1, leg = Math.max(900, Math.min(4000, 18000 / segs)), rest = segs > 8 ? 220 : 420;
    const mins = its.map(it => toMin(it.n.at));
    let shown = -1; const t0 = performance.now();
    const show = i => {
      if (i === shown) return; shown = i;
      const it = its[i];
      box.querySelector('.txt').innerHTML = '<small></small><span></span>';
      box.querySelector('.txt small').textContent = `${i + 1} / ${its.length} · ${placeName(it.n.k)}`;
      box.querySelector('.txt span').textContent = it.n.t || it.n.x || '';
      burst(it.n.k, it.p);
      document.querySelectorAll('#wBody .entry.now').forEach(e => e.classList.remove('now'));
      const e = document.querySelector(`#wBody .entry[data-id="${CSS.escape(it.n.id)}"]`);
      if (e) { e.classList.add('now'); e.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    };
    const step = now => {
      if (!this.on) return;
      const el_ = Math.max(0, now - t0), per = leg + rest;   // a frame's time can be a hair before t0
      const i = Math.min(segs, Math.floor(el_ / per)), inLeg = Math.max(0, el_ - i * per - rest);
      const f = i >= segs ? 1 : Math.min(1, inLeg / leg), e = ease(f);
      // course so far: every finished leg + part of this one
      const pts = its.slice(0, i + 1).map(it => it.p);
      if (i < segs) { const a = its[i].p, b = its[i + 1].p; pts.push([a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e]); }
      $('#replayPath').setAttribute('d', 'M' + pts.map(q => f3(q[0]) + ' ' + f3(q[1])).join('L'));
      show(i < segs && f >= 1 ? i + 1 : i);
      // clock: runs between the two memo times (or holds when a time is missing)
      const m0 = mins[i], m1 = i < segs ? mins[i + 1] : null;
      box.querySelector('.clk').textContent = m0 == null ? (its[i].n.at || '--:--') : m1 == null || m1 < m0 ? fmtMin(m0) : fmtMin(m0 + (m1 - m0) * e);
      if (i >= segs) { this.raf = 0; setTimeout(() => { if (this.on && this.d === d) this.stop(); }, 1600); return; }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  },
  // with a real route: the dotted line grows at walking pace, the clock runs from start to finish,
  // and each memo lights up as the line passes it
  startTrack(d, w, its) {
    this.stop(true);
    const segs = trackPts(d).filter(g => g.length > 1); if (!segs.length) return;
    const flat = [], cum = []; let L = 0;
    segs.forEach((g, si) => g.forEach((p, i) => { if (i) L += Math.hypot(p[0] - g[i - 1][0], p[1] - g[i - 1][1]); flat.push([p[0], p[1], si]); cum.push(L); }));
    if (!L) return;
    const at = its.map(it => { let bi = 0, bd = Infinity; flat.forEach((q, i) => { const dd = (q[0] - it.p[0]) ** 2 + (q[1] - it.p[1]) ** 2; if (dd < bd) { bd = dd; bi = i; } }); return cum[bi] / L; });
    const order = its.map((it, i) => i).sort((a, b) => at[a] - at[b]);
    const dur = Math.max(6000, Math.min(18000, (w.km || 2) * 3500));
    const m0 = toMin(w.t0), m1 = toMin(w.t1);
    this.on = true; this.d = d;
    document.body.classList.add('replaying');
    const box = $('#replay'); box.classList.add('on');
    box.querySelector('.txt').innerHTML = '<small></small><span></span>';
    let shown = 0; const t0 = performance.now();
    const step = now => {
      if (!this.on) return;
      const f = Math.min(1, Math.max(0, now - t0) / dur), want = f * L;
      let k = 0; while (k < cum.length - 1 && cum[k + 1] <= want) k++;
      let dpath = '', cur = -1;
      for (let i = 0; i <= k; i++) { const q = flat[i]; dpath += (q[2] !== cur ? 'M' : 'L') + f3(q[0]) + ' ' + f3(q[1]); cur = q[2]; }
      if (k < flat.length - 1 && flat[k + 1][2] === flat[k][2]) { const a = flat[k], b = flat[k + 1], u = (want - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]); dpath += 'L' + f3(a[0] + (b[0] - a[0]) * u) + ' ' + f3(a[1] + (b[1] - a[1]) * u); }
      $('#replayPath').setAttribute('d', dpath);
      box.querySelector('.clk').textContent = m0 != null && m1 != null && m1 >= m0 ? fmtMin(m0 + (m1 - m0) * f) : fmtKm((w.km || 0) * f);
      while (shown < order.length && at[order[shown]] <= f + 1e-6) {
        const it = its[order[shown++]];
        burst(it.n.k, it.p);
        box.querySelector('.txt span').textContent = it.n.t || it.n.x || '';
        document.querySelectorAll('#wBody .entry.now').forEach(e => e.classList.remove('now'));
        const e = document.querySelector(`#wBody .entry[data-id="${CSS.escape(it.n.id)}"]`);
        if (e) { e.classList.add('now'); e.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      }
      box.querySelector('.txt small').textContent = `${fmtKm((w.km || 0) * f)}${its.length ? ` · メモ ${shown} / ${its.length}` : ''}`;
      if (f >= 1) { this.raf = 0; setTimeout(() => { if (this.on && this.d === d) this.stop(); }, 1800); return; }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  },
  stop() {
    if (!this.on) return;
    this.on = false; cancelAnimationFrame(this.raf);
    document.body.classList.remove('replaying');
    $('#replay').classList.remove('on');
    $('#replayPath').removeAttribute('d');
    document.querySelectorAll('#wBody .entry.now').forEach(e => e.classList.remove('now'));
  }
};
$('#replay button').onclick = () => Replay.stop();
function drawRoute() {
  const pts = HL && HL.route ? routePoints(HL.route) : [];
  const d = pts.length ? 'M' + pts.map(p => f3(p[0]) + ' ' + f3(p[1])).join('L') : '';
  const dots = pts.map(p => `M${f3(p[0])} ${f3(p[1])}h0`).join('');
  ['#route'].forEach(s => d ? $(s).setAttribute('d', d) : $(s).removeAttribute('d'));
  ['#routeRing', '#routeDots'].forEach(s => dots ? $(s).setAttribute('d', dots) : $(s).removeAttribute('d'));
  drawTrack();
}
function focusKeys(keys, fitRoute) {
  if (!keys.length) return;
  const P = uniq(keys.map(k => k.slice(1, 3)));
  let h = '';
  if (P.length === 1) {
    const M = uniq(keys.map(k => k[0] === 'p' ? 'P' : k.slice(1, 6)));
    h = M.length === 1 && M[0] !== 'P' ? M[0] : P[0];
  }
  origin = null;
  // tighten onto the route when the walk stays inside one city
  if (fitRoute && HL && HL.route && (h.length === 5 || HL.trk)) {
    const pts = HL.trk ? trackPts(HL.d).flat() : routePoints(HL.route);
    if (pts.length > 1) {
      const bb = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
      const m = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * .35 + .3;
      const T = fitView([bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m]);
      if (W >= 720) T.cx += 230 * T.s; else T.cy += liftPx('wsheet') * T.s;
      pendingFly = T;
    }
  }
  if (location.hash.slice(1) === h) { if (pendingFly) { const T = pendingFly; pendingFly = null; flyTo(T, 800); } }
  else go(h);
}

/* ---------- pointer: hover, click, pan, pinch, wheel ---------- */
let hoverEl = null;
function setHover(n) {
  if (n === hoverEl) return;
  hoverEl = n;
  const h = $('#hover');
  if (!n) { h.removeAttribute('d'); $('#hName').textContent = ''; return; }
  h.setAttribute('d', n.getAttribute('d'));
  const k = n.dataset.k, kind = n.dataset.kind;
  if (kind === 't') h.setAttribute('clip-path', 'url(#clipMuni)'); else h.removeAttribute('clip-path');   // a town cell is cut by its city's shape, like its fill
  let name = '';
  if (kind === 'p') name = D.prefInfo[k].n;
  else if (kind === 'm') name = D.muni[k].n;
  else if (kind === 't' && townData) name = townData.towns[+n.dataset.i].n;
  const nn = (IX.byPlace.get(kind === 'p' ? 'p' + k : kind === 'm' ? 'm' + k : k) || []).length;
  $('#hName').textContent = name + (nn ? `  ·  メモ ${nn}` : '');
}
function hoverAt(e) {
  $('#xh').style.transform = `translateY(${e.clientY}px)`; $('#yh').style.transform = `translateX(${e.clientX}px)`;
  document.body.classList.add('ptr');
  const [wx, wy] = toWorld(e.clientX, e.clientY);
  const oki = S.pc === '47' || (S.level === 'japan' && insetHit(wx, wy));
  $('#hCoord').textContent = fmtLL(unproj(wx, wy, oki));
  const t = e.target.closest ? e.target.closest('[data-k]') : null;
  setHover(t && !t.classList.contains('off') && !t.classList.contains('hidden') ? t : null);
}
function insetHit(x, y) {
  const r = $('#inset');
  const rx = +r.getAttribute('x'), ry = +r.getAttribute('y');
  return x >= rx && y >= ry && x <= rx + +r.getAttribute('width') && y <= ry + +r.getAttribute('height');
}
const ptrs = new Map();
let drag = null, pinch = null;
svg.addEventListener('pointerdown', e => {
  if (e.button > 0) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { svg.setPointerCapture(e.pointerId); } catch (_) {}
  if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, cx: V.cx, cy: V.cy, target: e.target, moved: false };
  else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: V.s, w: toWorld(mx, my) };
    if (drag) drag.moved = true;
  }
});
svg.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) { if (e.pointerType === 'mouse') hoverAt(e); return; }
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    V.s = Math.min(SMAX, Math.max(SMIN, pinch.s * pinch.d / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))));
    V.cx = pinch.w[0] - (mx - W / 2) * V.s; V.cy = pinch.w[1] - (my - H / 2) * V.s;
    stopAnim(); applyView(); $('#gLabel').style.opacity = 0; return;
  }
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; stopAnim(); $('#gLabel').style.opacity = 0; svg.style.cursor = 'grabbing'; }
    if (drag.moved) { V.cx = drag.cx - dx * V.s; V.cy = drag.cy - dy * V.s; applyView(); }
  }
  if (e.pointerType === 'mouse') hoverAt(e);
});
function endPtr(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (ptrs.size === 1 && pinch) {
    pinch = null;
    const [a] = [...ptrs.values()];
    drag = { x: a.x, y: a.y, cx: V.cx, cy: V.cy, target: null, moved: true };
    return;
  }
  if (ptrs.size === 0) {
    svg.style.cursor = '';
    if (drag && !drag.moved && e.type === 'pointerup') clickOn(drag.target, e);
    else if (drag && drag.moved || pinch) settle();
    drag = null; pinch = null;
  }
}
svg.addEventListener('pointerup', endPtr);
svg.addEventListener('pointercancel', endPtr);
svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !ptrs.size) { setHover(null); document.body.classList.remove('ptr'); } });
svg.addEventListener('wheel', e => {
  e.preventDefault();
  stopAnim();
  const f = Math.exp(e.deltaY * (e.ctrlKey ? .012 : .0018) * (e.deltaMode === 1 ? 16 : 1));
  const w = toWorld(e.clientX, e.clientY);
  V.s = Math.min(SMAX, Math.max(SMIN, V.s * f));
  V.cx = w[0] - (e.clientX - W / 2) * V.s; V.cy = w[1] - (e.clientY - H / 2) * V.s;
  applyView(); $('#gLabel').style.opacity = 0; settle();
}, { passive: false });

function clickOn(t, e) {
  hideHint();
  const n = t && t.closest ? t.closest('[data-k]') : null;
  if (!n || n.classList.contains('off') || n.classList.contains('hidden')) return;
  const k = n.dataset.k, kind = n.dataset.kind;
  origin = { x: e.clientX, y: e.clientY };
  if (kind === 'p') go(k);
  else if (kind === 'm') go(k);
  else if (kind === 't') { origin = null; selectTown(+n.dataset.i, false); }
}
function hideHint() { $('#hint').style.opacity = 0; }
setTimeout(hideHint, 9000);
