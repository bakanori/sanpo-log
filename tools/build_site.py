#!/usr/bin/env python3
"""Build the SANPO LOG site into ./_site (run by GitHub Actions; stdlib only).

Downloads the public source data, turns it into small per-prefecture files under _site/data,
and copies the page itself.
  - City/prefecture outlines: smartnews-smri/japan-topography (MLIT 国土数値情報 行政区域, simplified)
  - Town points: geolonia/japanese-addresses (CC BY 4.0)
"""
import json, csv, collections, math, os, sys, shutil, urllib.request, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DL = os.environ.get('SANPO_SRC') or os.path.join(ROOT, '_src')
SITE = os.path.join(ROOT, '_site')
OUT = os.path.join(SITE, 'data')
TOPO = 'https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/topojson/'
CSV_URL = 'https://raw.githubusercontent.com/geolonia/japanese-addresses/master/data/latest.csv'
D3_URL = 'https://cdn.jsdelivr.net/npm/d3-delaunay@6.0.6/dist/d3-delaunay.min.js'

def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for i in range(4):
        try:
            with urllib.request.urlopen(url, timeout=120) as r, open(path + '.tmp', 'wb') as f:
                shutil.copyfileobj(r, f)
            os.replace(path + '.tmp', path)
            return path
        except Exception as e:
            print('retry', url, e, file=sys.stderr); time.sleep(3 * (i + 1))
    raise SystemExit('download failed: ' + url)

def download_sources():
    fetch(TOPO + 's0001/prefectures.json', os.path.join(DL, 'topojson_s0001_prefectures.json'))
    for i in range(1, 48):
        fetch(TOPO + f's0010/N03-21_{i:02d}_210101.json', os.path.join(DL, 'muni', f'm{i:02d}.json'))
    fetch(CSV_URL, os.path.join(DL, 'latest.csv'))

if os.path.exists(SITE):
    shutil.rmtree(SITE)
os.makedirs(OUT, exist_ok=True)
download_sources()

PREFS = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"]
code_of = {n: f"{i+1:02d}" for i, n in enumerate(PREFS)}

def decode_arcs(topo):
    sx, sy = topo['transform']['scale']; tx, ty = topo['transform']['translate']
    out = []
    for arc in topo['arcs']:
        x = y = 0; pts = []
        for dx, dy in arc:
            x += dx; y += dy
            pts.append((x * sx + tx, y * sy + ty))
        out.append(pts)
    return out

def rings_of(geom, arcs):
    def ring(idx):
        pts = []
        for i in idx:
            a = arcs[i] if i >= 0 else arcs[~i][::-1]
            pts.extend(a if not pts else a[1:])
        return pts
    if geom['type'] == 'Polygon':
        return [[ring(r) for r in geom['arcs']]]
    if geom['type'] == 'MultiPolygon':
        return [[ring(r) for r in p] for p in geom['arcs']]
    return []

def pip(pt, polys):
    x, y = pt; inside = False
    for poly in polys:
        for r in poly:
            n = len(r); j = n - 1
            for i in range(n):
                xi, yi = r[i]; xj, yj = r[j]
                if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-300) + xi:
                    inside = not inside
                j = i
    return inside

# ---- towns from CSV
rows = list(csv.reader(open(f'{DL}/latest.csv', encoding='utf-8')))[1:]
groups = collections.OrderedDict()
for r in rows:
    if not r[12] or not r[13]:
        continue
    groups.setdefault((r[4], r[8]), []).append(r)

def town_points(rs):
    base = [r for r in rs if not r[11]]
    pts = [(float(r[12]), float(r[13])) for r in rs]
    if base:
        rep = (float(base[0][12]), float(base[0][13]))
    else:
        la = [p[0] for p in pts]; ln = [p[1] for p in pts]
        c = ((max(la) + min(la)) / 2, (max(ln) + min(ln)) / 2)
        rep = min(pts, key=lambda p: (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2)
    seeds = []
    seen = {(round(rep[0], 4), round(rep[1], 4))}
    for p in pts:
        k = (round(p[0], 4), round(p[1], 4))
        if k not in seen:
            seen.add(k); seeds.append(p)
    # keep at most 5 extra seeds, spread out (farthest-point sampling)
    chosen = []
    pool = seeds[:]
    ref = [rep]
    while pool and len(chosen) < 5:
        far = max(pool, key=lambda p: min((p[0]-q[0])**2 + ((p[1]-q[1])*0.8)**2 for q in ref))
        pool.remove(far); chosen.append(far); ref.append(far)
    return rep, chosen

towns_by_muni = collections.defaultdict(list)  # code -> [(name, rep, seeds)]
for (code, name), rs in groups.items():
    rep, seeds = town_points(rs)
    towns_by_muni[code].append((name, rep, seeds))

# ---- municipalities
pref_meta = []
all_muni_codes = set()
muni_geo = {}
stats = {'munis': 0, 'towns': 0}
for i, pname in enumerate(PREFS):
    pc = f"{i+1:02d}"
    topo = json.load(open(f'{DL}/muni/m{pc}.json'))
    key = list(topo['objects'].keys())[0]
    obj = topo['objects'][key]
    arcs = decode_arcs(topo)
    geoms = []
    names = {}
    for g in obj['geometries']:
        p = g.get('properties') or {}
        c = p.get('N03_007')
        if not c:
            continue  # unassigned land
        n3, n4 = p.get('N03_003') or '', p.get('N03_004') or ''
        name = (n3 + n4) if (n3.endswith('市') and n4.endswith('区')) else (n4 or n3)
        names[c] = name
        geoms.append({'type': g['type'], 'arcs': g['arcs'], 'properties': {'c': c, 'n': name}})
        muni_geo[c] = rings_of(g, arcs)
        all_muni_codes.add(c)
    obj2 = {'type': 'GeometryCollection', 'geometries': geoms}
    out = {'type': 'Topology', 'transform': topo['transform'], 'arcs': topo['arcs'], 'objects': {'m': obj2}}
    pref_meta.append([pc, pname, names])

# reassign towns whose code is unknown
orphans = [c for c in towns_by_muni if c not in all_muni_codes]
print('orphan town codes:', orphans, file=sys.stderr)
for oc in orphans:
    cands = [c for c in all_muni_codes if c[:2] == oc[:2]]
    for t in towns_by_muni.pop(oc):
        lat, lng = t[1]
        hit = next((c for c in cands if pip((lng, lat), muni_geo[c])), None)
        if hit is None:
            # nearest by vertex distance
            best = None
            for c in cands:
                for poly in muni_geo[c]:
                    for (x, y) in poly[0][::5]:
                        d = (x - lng) ** 2 + (y - lat) ** 2
                        if best is None or d < best[0]:
                            best = (d, c)
            hit = best[1]
        towns_by_muni[hit].append(t)

# ---- write per-prefecture files
summary = []
for pc, pname, names in pref_meta:
    topo = json.load(open(f'{DL}/muni/m{pc}.json'))
    key = list(topo['objects'].keys())[0]
    geoms = []
    for g in topo['objects'][key]['geometries']:
        p = g.get('properties') or {}
        c = p.get('N03_007')
        if not c: continue
        geoms.append({'type': g['type'], 'arcs': g['arcs'], 'c': c})
    tcount = {c: len(towns_by_muni.get(c, [])) for c in names}
    tfiles = [{}]
    chunk_of = {}
    size = 0
    for c in names:
        ts = towns_by_muni.get(c, [])
        if not ts: continue
        lat0 = math.floor(min(t[1][0] for t in ts) * 100) / 100
        lng0 = math.floor(min(t[1][1] for t in ts) * 100) / 100
        arr = []
        for name, rep, seeds in ts:
            e = [name, round((rep[0] - lat0) * 1e4), round((rep[1] - lng0) * 1e4)]
            for s in seeds:
                e += [round((s[0] - lat0) * 1e4), round((s[1] - lng0) * 1e4)]
            arr.append(e)
        piece = json.dumps(arr, ensure_ascii=False)
        if size and size + len(piece.encode()) > 140000:
            tfiles.append({}); size = 0
        tfiles[-1][c] = [lat0, lng0, arr]
        size += len(piece.encode())
        chunk_of[c] = len(tfiles) - 1
    for k, tf in enumerate(tfiles):
        json.dump(tf, open(f'{OUT}/t{pc}' + (f'_{k}' if k else '') + '.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    mfile = {'type': 'Topology', 'transform': topo['transform'], 'arcs': topo['arcs'],
             'objects': {'m': {'type': 'GeometryCollection', 'geometries': geoms}},
             'N': names, 'T': tcount, 'K': {c: k for c, k in chunk_of.items() if k}}
    json.dump(mfile, open(f'{OUT}/m{pc}.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    summary.append([pc, pname, len(names), sum(tcount.values())])
    stats['munis'] += len(names); stats['towns'] += sum(tcount.values())

# ---- Japan file
ptopo = json.load(open(f'{DL}/topojson_s0001_prefectures.json'))
geoms = []
for g in ptopo['objects']['prefectures']['geometries']:
    geoms.append({'type': g['type'], 'arcs': g['arcs'], 'c': code_of[g['properties']['N03_001']]})
jfile = {'type': 'Topology', 'transform': ptopo['transform'], 'arcs': ptopo['arcs'],
         'objects': {'p': {'type': 'GeometryCollection', 'geometries': geoms}}, 'P': summary}
json.dump(jfile, open(f'{OUT}/japan.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(stats, file=sys.stderr)


# wrap each data file as a script (so the page also works when opened from disk)
for name in os.listdir(OUT):
    if not name.endswith('.json'):
        continue
    p = os.path.join(OUT, name)
    with open(p, encoding='utf-8') as f:
        s = f.read()
    with open(p[:-5] + '.js', 'w', encoding='utf-8') as f:
        f.write('SANPO.d("%s",%s);\n' % (name[:-5], s))
    os.remove(p)

# the page itself + library
os.makedirs(os.path.join(SITE, 'lib'), exist_ok=True)
fetch(D3_URL, os.path.join(SITE, 'lib', 'd3-delaunay.min.js'))
# app icons (kept as base64 text in tools/icons.json)
import base64
os.makedirs(os.path.join(SITE, 'icons'), exist_ok=True)
for name, b64 in json.load(open(os.path.join(ROOT, 'tools', 'icons.json'))).items():
    if not name.startswith('_'):
        with open(os.path.join(SITE, 'icons', name), 'wb') as f: f.write(base64.b64decode(b64))

for name in ['index.html', 'README.md', 'firebase-config.js', 'manifest.webmanifest', 'sw.js']:
    if os.path.exists(os.path.join(ROOT, name)):
        shutil.copy(os.path.join(ROOT, name), os.path.join(SITE, name))
for name in ['css', 'js']:   # the parts of the page (v2.12.0~)
    if os.path.isdir(os.path.join(ROOT, name)):
        shutil.copytree(os.path.join(ROOT, name), os.path.join(SITE, name))
open(os.path.join(SITE, '.nojekyll'), 'w').close()
print('built', len(os.listdir(OUT)), 'data files', file=sys.stderr)
