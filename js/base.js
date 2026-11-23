/* SANPO LOG — js/base.js
   土台 — small helpers, the map projection, loading the map data (per prefecture), the state of the view.
   The files load in this order (see index.html): base → parts → records → sync → map → memo → screens → start.
   They share one scope: a name made in an earlier file can be used in any later one, but code that runs
   while the page loads may only use names from its own file and the earlier ones. */
'use strict';

/* ============================================================
   SANPO LOG — 歩いた場所を、地図に。
   Pure SVG, no framework. Data is lazy-loaded per prefecture.
   ============================================================ */
const $ = s => document.querySelector(s);
const svg = $('#map');
const NS = 'http://www.w3.org/2000/svg';

/* ---------- projection (Mercator, 1 unit = 0.01°) ---------- */
const K = 100, LNG0 = 137, LAT0 = 36, R2D = 180 / Math.PI;
const merc = la => Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360)) * R2D;
const MY0 = merc(LAT0);
const PX = lng => (lng - LNG0) * K;
const PY = lat => -(merc(lat) - MY0) * K;
const OKI = { dx: PX(135.6) - PX(127.8), dy: PY(31.6) - PY(26.4) };   // Okinawa drawn as an inset south of Kii
const proj = (lng, lat, o) => o ? [PX(lng) + OKI.dx, PY(lat) + OKI.dy] : [PX(lng), PY(lat)];
function unproj(x, y, o) {
  if (o) { x -= OKI.dx; y -= OKI.dy; }
  return [x / K + LNG0, (2 * Math.atan(Math.exp((-y / K + MY0) / R2D)) - Math.PI / 2) * R2D];
}

/* ---------- data loading (script tags → works on file:// too) ---------- */
const SANPO = window.SANPO = { cb: {}, d(name, v) { const f = this.cb[name]; delete this.cb[name]; f && f(v); } };
const loaded = {};
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error(src));
    document.head.appendChild(s);
  });
}
function loadData(name) {
  if (!loaded[name]) loaded[name] = new Promise((res, rej) => {
    SANPO.cb[name] = res;
    loadScript('data/' + name + '.js').catch(e => { delete loaded[name]; rej(e); });
  });
  return loaded[name];
}
let d3p;
const loadD3 = () => d3p || (d3p = window.d3 && window.d3.Delaunay ? Promise.resolve() : loadScript('lib/d3-delaunay.min.js'));

let busy = 0;
function progress(on) {
  busy += on ? 1 : -1;
  const b = $('#bar');
  document.body.classList.toggle('busy', busy > 0);
  if (busy > 0) { b.style.opacity = 1; b.style.width = '30%'; requestAnimationFrame(() => b.style.width = '70%'); }
  else { b.style.width = '100%'; setTimeout(() => { if (!busy) { b.style.opacity = 0; b.style.width = 0; } }, 300); }
}

/* ---------- geometry helpers ---------- */
function topoFeatures(topo, key) {
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map(a => { let x = 0, y = 0; return a.map(p => { x += p[0]; y += p[1]; return [x * sx + tx, y * sy + ty]; }); });
  const ring = idx => {
    const pts = [];
    for (const i of idx) {
      const a = i >= 0 ? arcs[i] : arcs[~i].slice().reverse();
      for (let k = pts.length ? 1 : 0; k < a.length; k++) pts.push(a[k]);
    }
    return pts;
  };
  return topo.objects[key].geometries.map(g => ({
    c: g.c,
    polys: g.type === 'Polygon' ? [g.arcs.map(ring)] : g.type === 'MultiPolygon' ? g.arcs.map(p => p.map(ring)) : []
  }));
}
const f3 = v => Math.round(v * 1000) / 1000;
function prep(polys, oki) {
  let d = '';
  const parts = [];
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of polys) {
    poly.forEach((r, ri) => {
      const pr = r.map(p => proj(p[0], p[1], oki));
      d += 'M' + pr.map(p => f3(p[0]) + ' ' + f3(p[1])).join('L') + 'Z';
      if (ri) return;
      const b = [Infinity, Infinity, -Infinity, -Infinity];
      let a = 0;
      for (let i = 0, j = pr.length - 1; i < pr.length; j = i++) {
        const p = pr[i];
        if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1];
        if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1];
        a += (pr[j][0] - p[0]) * (pr[j][1] + p[1]);
      }
      parts.push({ bb: b, area: Math.abs(a / 2), ring: pr });
      bb[0] = Math.min(bb[0], b[0]); bb[1] = Math.min(bb[1], b[1]); bb[2] = Math.max(bb[2], b[2]); bb[3] = Math.max(bb[3], b[3]);
    });
  }
  if (!parts.length) return { d, bb: [0, 0, 0, 0], main: [0, 0, 0, 0], lp: [0, 0], area: 0 };
  const big = parts.reduce((a, b) => b.area > a.area ? b : a);
  const [x0, y0, x1, y1] = big.bb, m = Math.max(x1 - x0, y1 - y0) * .55;
  const main = big.bb.slice();
  for (const p of parts) {
    const b = p.bb;
    if (b[2] > x0 - m && b[0] < x1 + m && b[3] > y0 - m && b[1] < y1 + m) {
      main[0] = Math.min(main[0], b[0]); main[1] = Math.min(main[1], b[1]); main[2] = Math.max(main[2], b[2]); main[3] = Math.max(main[3], b[3]);
    }
  }
  return { d, bb, main, parts, lp: labelPoint(big.ring, big.bb), area: parts.reduce((s, p) => s + p.area, 0), bigbb: big.bb };
}
function inside(pt, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function labelPoint(r, b) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
    a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
  }
  if (a) { cx /= 3 * a; cy /= 3 * a; } else { cx = (b[0] + b[2]) / 2; cy = (b[1] + b[3]) / 2; }
  if (inside([cx, cy], r)) return [cx, cy];
  // widest horizontal run through a few scanlines
  let best = null;
  for (const t of [.5, .35, .65, .2, .8]) {
    const y = b[1] + (b[3] - b[1]) * t, xs = [];
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + (y - yi) * (xj - xi) / (yj - yi));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) if (!best || xs[k + 1] - xs[k] > best[0]) best = [xs[k + 1] - xs[k], (xs[k] + xs[k + 1]) / 2, y];
  }
  return best ? [best[1], best[2]] : [cx, cy];
}

/* ---------- state ---------- */
const D = { P: [], pref: {}, prefInfo: {}, muni: {}, towns: {} };
const S = { level: 'japan', pc: null, mc: null, sel: null };
const V = { cx: 0, cy: 0, s: 1 };
const SHEET = { small: {} };
function liftPx(id) {   // phone: how far above the middle of the screen a place should sit to be seen above the sheet
  if (W >= 720) return 0;
  id = id || ['sheet', 'wsheet', 'drawer'].find(x => $('#' + x).classList.contains('open')) || 'sheet';
  const b2 = document.getElementById('bData2'), top = Math.max(60, (b2 ? b2.getBoundingClientRect().bottom : 50) + 12);
  const bottom = H * (1 - (SHEET.small[id] ? .45 : .8)) - 8;
  return Math.max(0, H / 2 - (top + Math.max(top + 40, bottom)) / 2);
}
let W = innerWidth, H = innerHeight;
let origin = null;           // screen point of last dive click (ripple source)
let JAPAN_BB;
