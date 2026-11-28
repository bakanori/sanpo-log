"""SANPO LOG — the checks that run before every publish (GitHub Actions: .github/workflows/pages.yml).

If any check fails, the site is not published and the last good version stays online.
Run locally:  python3 tools/build_site.py && python3 tests/smoke_test.py   (needs: pip install playwright; python -m playwright install chromium)
Set CHROME=/path/to/chrome to use an installed Chrome instead of Playwright's own.
"""
import asyncio, os, subprocess, sys, time
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.environ.get('SITE', os.path.join(ROOT, '_site'))
PORT = int(os.environ.get('PORT', '8799'))
FAILS, PASSES = [], []

def said(e):   # a page error, with where it happened (the first lines of its stack)
    st = [l.strip() for l in (getattr(e, 'stack', '') or '').splitlines()[1:4]]
    return str(e) + (' @ ' + ' | '.join(st) if st else '')

def check(name, ok, got=None):
    (PASSES if ok else FAILS).append(name)
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else f'   got: {got!r}'))

INIT = """try { localStorage.setItem('sanpo-started', '1'); } catch (e) {}
window.hexRgb = h => { const v = parseInt(h.slice(1), 16); return `rgb(${v >> 16}, ${v >> 8 & 255}, ${v & 255})`; };
window.__opened = []; window.open = u => { window.__opened.push(u); return null; };
window.__clip = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => window.__clip, writeText: async () => {} } });"""
NO_FIREBASE = 'var firebaseConfig = null;'   # the checks never talk to the real cloud

async def page(b, phone, base):
    ctx = await b.new_context(viewport={'width': 393, 'height': 852} if phone else {'width': 1366, 'height': 860}, is_mobile=phone, has_touch=phone, accept_downloads=True)
    await ctx.route('**/firebase-config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body=NO_FIREBASE))
    await ctx.add_init_script(INIT)
    m = await ctx.new_page(); errs = []
    m.on('pageerror', lambda e: errs.append(said(e)))
    return ctx, m, errs

async def swipe_left(m, cdp, sel, dx=-120):   # a finger sliding a row to the left
    x, y = await m.evaluate(f"() => {{ const e = document.querySelector({sel!r}); e.scrollIntoView({{ block: 'center' }}); const b = e.getBoundingClientRect(); return [b.right - 40, b.top + Math.min(b.height / 2, 40)]; }}")
    await m.wait_for_timeout(250)
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    for i in range(1, 9):
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x + dx * i / 8, 'y': y}]}); await m.wait_for_timeout(20)
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); await m.wait_for_timeout(400)

async def app(b, phone, base):
    tag = 'phone' if phone else 'pc'
    ctx, m, errs = await page(b, phone, base)
    await m.goto(base + '/index.html'); await m.wait_for_timeout(2500)
    v = await m.evaluate('VERSION')
    check(f'{tag}: opens (v{v})', bool(v) and await m.evaluate("() => document.querySelectorAll('#gPref path').length") >= 47)
    await m.goto(base + '/index.html#14204'); await m.wait_for_timeout(3500)
    n = await m.evaluate("() => document.querySelectorAll('#gCells path').length")
    check(f'{tag}: a city opens down to its towns', n > 100, n)
    # write a memo in a town
    await m.evaluate("() => jumpTo(D.towns['14204'].find(t => t.n === '小町二丁目').k)"); await m.wait_for_timeout(1500)
    await m.evaluate("() => { if ($('#sForm').classList.contains('collapsed')) $('#fOpen').click(); }"); await m.wait_for_timeout(300)
    await m.fill('#fText', 'テストの散歩 #テスト'); await m.click('#fSave'); await m.wait_for_timeout(900)
    r = await m.evaluate("() => { const x = [...Store.notes.values()].find(n => n.t.startsWith('テストの散歩')); return x && [placeName(x.k), x.tags, document.querySelectorAll('#sEntries .entry').length]; }")
    check(f'{tag}: a memo is kept in its town, with its tag', bool(r) and r[0] == '小町二丁目' and 'テスト' in r[1] and r[2] >= 1, r)
    # なおす
    await m.evaluate("() => document.querySelector('#sEntries .entry .ed').click()"); await m.wait_for_timeout(300)
    r = await m.evaluate("() => [...document.querySelectorAll('.edit .ftools .tl')].map(b => b.textContent.split('：')[0].replace(/ \\d+/, ''))")
    check(f'{tag}: なおす has the same chips as writing (写真 · 日付 · 場所)', r == ['写真 ▾', '日付', '場所'], r)
    await m.fill('.edit .eT', 'テストの散歩（なおした）'); await m.evaluate("() => document.querySelector('.edit .eS').click()"); await m.wait_for_timeout(500)
    check(f'{tag}: なおす changes the memo', await m.evaluate("() => [...Store.notes.values()].some(n => n.t === 'テストの散歩（なおした）')"))
    # けす: gone at once, もどす within 5 seconds
    await m.evaluate("() => document.querySelector('#sEntries .entry .ed').click()"); await m.wait_for_timeout(300)
    await m.evaluate("() => document.querySelector('.edit .eDel').click()"); await m.wait_for_timeout(600)
    gone = await m.evaluate("() => ![...Store.notes.values()].some(n => n.t === 'テストの散歩（なおした）') && $('#toast').textContent.includes('もどす')")
    await m.click('#toast .tact'); await m.wait_for_timeout(600)
    check(f'{tag}: けす is at once, and もどす brings it back', gone and await m.evaluate("() => [...Store.notes.values()].some(n => n.t === 'テストの散歩（なおした）')"))
    # けす from the list itself (v2.13.0): phone — slide the memo to the left; PC — point at it
    sel = '#sEntries .swd > .entry'
    if phone:
        await swipe_left(m, await ctx.new_cdp_session(m), sel)
        opened = await m.evaluate("() => { const b = document.querySelector('#sEntries .swd'); return b.classList.contains('open') && b.firstChild.getBoundingClientRect().right <= b.querySelector('.swdel').getBoundingClientRect().left + 1; }")
        await m.evaluate("() => document.querySelector('#sEntries .swd.open .swdel').click()")
    else:
        await m.hover(sel); await m.wait_for_timeout(300)
        opened = await m.evaluate("() => getComputedStyle(document.querySelector('#sEntries .swd .acts .kesu')).opacity === '1'")
        await m.click('#sEntries .swd .acts .kesu')
    await m.wait_for_timeout(700)
    gone = await m.evaluate("() => ![...Store.notes.values()].some(n => n.t === 'テストの散歩（なおした）') && $('#toast').textContent.includes('もどす')")
    await m.click('#toast .tact'); await m.wait_for_timeout(600)
    check(f'{tag}: けす right from the list ({"slide to the left" if phone else "point at it"}), もどす', opened and gone and await m.evaluate("() => [...Store.notes.values()].some(n => n.t === 'テストの散歩（なおした）')"), [opened, gone])
    # an Instagram link pasted into the memo becomes a photo mark
    await m.evaluate("() => { if ($('#sForm').classList.contains('collapsed')) $('#fOpen').click(); const e = new Event('paste', { bubbles: true, cancelable: true }); e.clipboardData = { getData: () => 'https://www.instagram.com/p/TEST12345/' }; $('#fText').dispatchEvent(e); }"); await m.wait_for_timeout(400)
    check(f'{tag}: a pasted Instagram link becomes a photo', await m.evaluate("() => parseLinks($('#fLinks').value).length === 1 && $('#fPick').textContent.includes('1')"))
    # a shop: the address finds the town
    r = await m.evaluate("async () => { const p = parseShop('喫茶テスト\\n日本、〒248-0006 神奈川県鎌倉市小町２丁目１０−１１\\nhttps://maps.app.goo.gl/test'); const k = await addrKey(p.a); return [p.n, p.u, k && placeName(k.key)]; }")
    check(f'{tag}: a copied shop finds its town', r == ['喫茶テスト', 'https://maps.app.goo.gl/test', '小町二丁目'], r)
    # ノート: its tabs; a place from it opens in the same panel with ‹ ノート, and ‹ brings ノート back as it was; × closes
    await m.evaluate("() => closePanel('sheet')"); await m.wait_for_timeout(400)
    await m.click('#bLog'); await m.wait_for_timeout(600)
    await m.click('#t_list'); await m.wait_for_timeout(300)
    await m.fill('#dFilter', '小町'); await m.wait_for_timeout(300)
    await m.evaluate("() => [...document.querySelectorAll('#dBody .li')].find(b => b.textContent.includes('小町二丁目')).click()"); await m.wait_for_timeout(1800)
    r = await m.evaluate("() => [['drawer', 'sheet', 'wsheet'].filter(id => $('#' + id).classList.contains('open')).join(), $('#sheet .back').hidden ? '' : $('#sheet .back').textContent.trim()]")
    check(f'{tag}: a place from ノート opens in the one panel, with ‹ ノート', r == ['sheet', '‹ ノート'], r)
    await m.click('#sheet .back'); await m.wait_for_timeout(600)
    check(f'{tag}: ‹ brings ノート back as it was', await m.evaluate("() => $('#drawer').classList.contains('open') && !$('#sheet').classList.contains('open') && dTab === 'list' && $('#dFilter').value === '小町'"))
    if not phone:
        check('pc: ノート is on the right, where the pages open', await m.evaluate("() => { const r = $('#drawer').getBoundingClientRect(); return Math.round(r.right) === innerWidth && r.left > innerWidth / 2; }"))
    await m.click('#drawer [data-close=drawer]'); await m.wait_for_timeout(500)
    check(f'{tag}: ノート closes with ×', await m.evaluate("() => !$('#drawer').classList.contains('open') && $('#bLog').textContent === 'ノート'"))
    if phone:
        r = await m.evaluate("""() => ['#bLog', '#fab', '#recBtn'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.bottom)]; })""")
        check('phone: one row at the bottom — ノート · ＋ ここでメモ · さんぽ', r[0][1] < r[1][0] and r[1][1] < r[2][0] and r[2][1] <= 393 and abs(r[0][2] - r[1][2]) <= 1 and abs(r[1][2] - r[2][2]) <= 1, r)
    # backup: words in 設定, the card when photos wait
    await m.evaluate("() => $('#bData').onclick()"); await m.wait_for_timeout(600)
    w = await m.evaluate("() => [$('#mBackup h4').textContent, $('#mDown').textContent]")
    check(f'{tag}: 設定 says バックアップ', w[0] == 'バックアップ', w)
    await m.evaluate("() => closePanel('modal')"); await m.wait_for_timeout(300)
    await m.evaluate("""async () => { const px = 'data:image/jpeg;base64,/9j/4AAQ'; for (const id of ['ttesta1', 'ttestb2']) await Thumbs.put(id, px, false, px);
      Store.putNote({ id: 'old1', k: D.towns['14204'][3].k, d: '2025-01-01', t: '昔', im: ['ttesta1', 'ttestb2'] }); $('#bkPill').hidden = true; await backupPill(); }"""); await m.wait_for_timeout(400)
    check(f'{tag}: the backup card appears when photos wait', await m.evaluate("() => !$('#bkPill').hidden && $('#bkTxt').textContent.includes('2枚')"))
    await m.click('#bkLater'); await m.wait_for_timeout(300)
    check(f'{tag}: あとで puts it away for a week', await m.evaluate("async () => { await backupPill(); return $('#bkPill').hidden; }"))
    # おかえり is the day's own page (no separate window), and says バックアップ when photos wait
    await m.evaluate("() => okaeri()"); await m.wait_for_timeout(900)
    t = await m.evaluate("() => ($('#wBody .welcome') || {}).innerText || ''")
    check(f'{tag}: おかえり opens the day page, and says バックアップ', await m.evaluate("() => $('#wsheet').classList.contains('open') && !$('#routeDlg').classList.contains('open') && !!$('#wBody .addday')") and 'おかえりなさい' in t and 'バックアップする' in t and 'ファイル' not in t, t[-120:])
    await m.evaluate("() => closePanel('wsheet')"); await m.wait_for_timeout(300)
    # the record format
    r = await m.evaluate("() => { const v = Store.dump().v; const n = Store.absorb({ app: 'sanpo-log', v: 2, notes: { old2: { id: 'old2', k: 'p13', d: '2024-05-05', t: '第2版', u: 1 } } }); return [v, n, !!Store.notes.get('old2')]; }")
    check(f'{tag}: records are 第3版 and old ones still open', r == [3, 1, True], r)
    # phone: the sheet comes up to 8/10 of the screen
    if phone:
        await m.evaluate("() => jumpTo(D.towns['14204'][3].k)"); await m.wait_for_timeout(1500)
        h = await m.evaluate("() => Math.round($('#sheet').getBoundingClientRect().top / innerHeight * 100)")
        check('phone: the sheet opens to 8/10', 15 <= h <= 25, h)
    # 寄ったところ (v2.15.0): from a day's page one question; a copied map link becomes that day's memo, back on the day's page
    await m.evaluate("""() => { window.open = u => { (window.__opened = window.__opened || []).push(u); return null; };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => '喫茶ひなた\\n日本、〒248-0006 神奈川県鎌倉市小町２丁目１０−１１\\nhttps://maps.app.goo.gl/AbCdEf123?g_st=ic', writeText: async () => {} } });
      ['sheet', 'drawer'].forEach(id => $('#' + id).classList.contains('open') && closePanel(id, true)); openWalk(today()); }""")
    await m.wait_for_timeout(700)
    await m.evaluate("() => [...document.querySelectorAll('#wBody .addday button')].find(b => b.textContent === '＋ 寄ったところ').click()"); await m.wait_for_timeout(500)
    r = await m.evaluate("() => [$('#rtTitle').textContent, !document.querySelector('#routeDlg .okday'), document.querySelector('#routeDlg .shopf .lab').textContent, document.querySelector('#routeDlg .shpaste').textContent]")
    await m.evaluate("() => document.querySelector('#routeDlg .shpaste').click()"); await m.wait_for_timeout(1800)
    r2 = await m.evaluate("() => [$('#routeDlg').classList.contains('open'), $('#wsheet').classList.contains('open'), [...Store.notes.values()].some(n => n.t === '喫茶ひなた' && n.d === today() && placeName(n.k) === '小町二丁目' && n.s), $('#toast').textContent.includes('もう1つ'), !!document.querySelector('#wBody .shop')]")
    check(f'{tag}: 寄ったところ: one question from the day page; the copied place becomes the day\'s memo, back on the page', r == ['寄ったところを、足す', True, '寄ったところ', 'コピーした場所を、付ける'] and r2 == [False, True, True, True, True], [r, r2])
    await m.evaluate("() => closePanel('wsheet', true)"); await m.wait_for_timeout(300)
    # ⌂ (v2.14.0): back to the Japan map from the map's own buttons; the top row only shows, 設定 is its one framed button
    await m.evaluate("() => ['ig', 'modal', 'sheet', 'wsheet', 'drawer'].forEach(id => $('#' + id).classList.contains('open') && closePanel(id, true))")
    await m.goto(base + '/index.html#14204'); await m.wait_for_timeout(2500)
    r = await m.evaluate("""phone => { const h = $('#bHome').getBoundingClientRect(), l = $('#bLoc').getBoundingClientRect(), g = $('#bLog').getBoundingClientRect();
      return [$('#namePre').textContent, getComputedStyle($('#crumb')).display, h.width > 0, phone ? Math.round(h.right) <= Math.round(l.left) && Math.abs(h.bottom - l.bottom) < 2 : Math.round(h.right) <= Math.round(g.left) && $('#bHome').textContent.trim() === '日本',
        phone ? getComputedStyle($('#bData2')).borderTopWidth : '1px']; }""", phone)
    await m.click('#bHome'); await m.wait_for_timeout(1800)
    back = await m.evaluate("() => S.level === 'japan' && location.hash === '' && getComputedStyle($('#bHome')).display !== 'none'")
    # on the Japan map ⌂ stays (v2.14.1): moved or zoomed, it brings the whole of Japan back into view
    v0 = await m.evaluate("() => [V.cx, V.cy, V.s].map(x => Math.round(x * 1000))")
    await m.evaluate("() => flyTo({ cx: V.cx + 300, cy: V.cy - 200, s: V.s / 3 }, 10)"); await m.wait_for_timeout(500)
    await m.click('#bHome'); await m.wait_for_timeout(1600)
    v1 = await m.evaluate("() => [V.cx, V.cy, V.s].map(x => Math.round(x * 1000))")
    check(f'{tag}: ⌂ ({"next to ◎" if phone else "next to ノート"}) goes back to the Japan map, and is there from the start; the top row only shows', r == ['神奈川県', 'none', True, True, '1px'] and back and v1 == v0, [r, back, v0, v1])
    check(f'{tag}: no errors on the page', not errs, errs)
    await ctx.close()

async def offline(b, base):
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, is_mobile=True, has_touch=True)
    await ctx.add_init_script(INIT)
    m = await ctx.new_page(); errs = []; phase = ['online']
    m.on('pageerror', lambda e: errs.append(phase[0] + ': ' + said(e)))
    await m.goto(base + '/index.html#14204'); await m.wait_for_timeout(3000)
    await m.evaluate("async () => { await navigator.serviceWorker.ready; }")
    await m.reload(); await m.wait_for_timeout(2500)
    await ctx.set_offline(True); phase[0] = 'offline'
    await m.evaluate('window.__before = 1')
    await m.reload(); await m.wait_for_timeout(3500)   # a real fresh open, with no signal
    check('offline: the page really opened again', await m.evaluate('window.__before !== 1'))
    n = await m.evaluate("() => document.querySelectorAll('#gCells path').length")
    check('offline: opens again without a signal', n > 100, n)
    phase[0] = 'offline jump'
    await m.evaluate("() => jumpTo('m13106')"); await m.wait_for_timeout(2500)
    check('offline: an area never opened says so and stays put', await m.evaluate("() => location.hash === '#14204' && S.level === 'muni'"))
    check('offline: no errors on the page', not errs, errs)
    await ctx.close()

FSMOCK = open(os.path.join(ROOT, 'tests', 'fsmock.js'), encoding='utf-8').read()   # an in-memory stand-in for Firebase (no real cloud)

async def together(b, base):   # a group: わたしも行った on someone's memo
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, is_mobile=True, has_touch=True)
    await ctx.route('**/firebase-config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='var firebaseConfig = { apiKey: "test", projectId: "demo" };'))
    await ctx.add_init_script(INIT + "\nwindow.__MOCKUSER = { uid: 'u1', displayName: 'たろう' }; try { localStorage.setItem('sanpo-fb', '1'); } catch (e) {}\n" + FSMOCK)
    m = await ctx.new_page(); errs = []; m.on('pageerror', lambda e: errs.append(said(e)))
    await m.goto(base + '/index.html#14204'); await m.wait_for_timeout(3000)
    await m.evaluate("async () => { await GR.create('散歩部'); }"); await m.wait_for_timeout(2000)
    await m.evaluate("""() => { const M = window.__FBMOCK, gid = GR.gid, g = JSON.parse(JSON.stringify(M.__store.get('groups/' + gid)));
      g.members.u2 = { name: 'はなこ', c: 1, joined: Date.now() }; M.__write('groups/' + gid, g);
      const id = (Date.now() - 3 * 864e5).toString(36) + 'hhhh';
      M.__write(`groups/${gid}/notes/u2_${id}`, { id, k: D.towns['14204'][22].k, d: '2026-11-10', t: 'はなこのメモ', tags: ['散歩部'], u: Date.now(), by: 'u2' }); }""")
    await m.wait_for_timeout(1200)
    await m.evaluate("selectTown(22, false)"); await m.wait_for_timeout(1000)
    btn = '#sEntries .entry.other .also .pgo'
    check('group: a member\'s memo has わたしも行った', await m.evaluate(f"() => [...document.querySelectorAll('{btn}')].map(b => b.textContent).join() === 'わたしも行った'"))
    await m.click(btn); await m.wait_for_timeout(400)
    await m.click('#rtActs button:first-child'); await m.wait_for_timeout(1600)
    r = await m.evaluate("""() => { const n = [...Store.notes.values()].find(x => x.w && x.w.u === 'u2'), doc = n && window.__FBMOCK.__store.get('groups/' + GR.gid + '/notes/u1_' + n.id);
      return [!!n && n.d === '2026-11-10' && n.w.y === 1, !!doc && !!doc.w, townNodes[22].style.fill === hexRgb(deep(GR.color('u2'))), $('#sStat').textContent.includes('あなた')]; }""")
    check('group: いっしょ is kept as my memo, and shared', r[0] and r[1], r)
    check('group: the town keeps the first one\'s colour, deeper for two', r[2] and r[3], r)
    await m.click(btn); await m.wait_for_timeout(400)
    await m.evaluate("() => [...document.querySelectorAll('#rtActs button')].find(b => b.textContent === '取り消す').click()"); await m.wait_for_timeout(1200)
    check('group: 取り消す takes it back', await m.evaluate("() => ![...Store.notes.values()].some(x => x.w) && townNodes[22].style.fill === hexRgb(GR.color('u2'))"))
    await m.click(btn); await m.wait_for_timeout(400)
    await m.evaluate("() => [...document.querySelectorAll('#rtActs button')].find(b => b.textContent === '別の日に行った').click()"); await m.wait_for_timeout(300)
    await m.evaluate("() => { document.querySelector('#rtBody input[type=date]').value = '2025-05-01'; [...document.querySelectorAll('#rtActs button')].find(b => b.textContent === 'のこす').click(); }"); await m.wait_for_timeout(1500)
    check('group: another, earlier day makes the town mine', await m.evaluate("() => townNodes[22].style.fill === hexRgb(deep(GR.color('u1'))) && $('#sStat').textContent.indexOf('あなた') < $('#sStat').textContent.indexOf('はなこ')"))
    # a day shared with the group: its towns passed are coloured, and it can be read from ノート → みんな (never the line)
    await m.evaluate("""() => { const M = window.__FBMOCK, ts = D.towns['14204'];
      M.__write(`groups/${GR.gid}/walks/u2_2026-11-23`, { d: '2026-11-23', title: 'ニトリ、サイゼリア', sum: '昼飲み', tags: ['散歩部'], tw: [ts[30].k, ts[31].k], u: Date.now(), by: 'u2' }); }""")
    await m.wait_for_timeout(1200)
    await m.evaluate("() => { closePanel('sheet'); openDrawer('group'); }"); await m.wait_for_timeout(700)
    ok = await m.evaluate("() => townNodes[30].style.fill === hexRgb(GR.color('u2')) && [...document.querySelectorAll('#dBody .log.dayrow')].some(b => b.textContent.includes('ニトリ、サイゼリア'))")
    await m.evaluate("() => document.querySelector('#dBody .log.dayrow').click()"); await m.wait_for_timeout(1200)
    check('group: a shared day shows its towns, and opens to read (no line)', ok and await m.evaluate("() => $('#wTitle').textContent === 'ニトリ、サイゼリア' && !$('#track').getAttribute('d') && $('#wBody').innerText.includes('通った町 2')"))
    # a second group: the switch, and 共有 when writing goes only where chosen
    await m.evaluate("() => closePanel('wsheet')"); await m.wait_for_timeout(300)
    await m.evaluate("async () => { await GR.create('家族'); }"); await m.wait_for_timeout(1500)
    check('group: two groups at once, each in the switch', await m.evaluate("() => [...document.querySelectorAll('#grp .gseg button')].map(b => b.textContent).join('/') === '自分/散歩部/家族'"))
    await m.evaluate("() => { localStorage.removeItem('sanpo-share'); selectTown(5, false); }"); await m.wait_for_timeout(900)
    await m.evaluate("() => { if ($('#sForm').classList.contains('collapsed')) $('#fOpen').click(); [...document.querySelectorAll('#fShare .shc')].find(b => b.textContent === '家族').click(); }"); await m.wait_for_timeout(200)
    await m.fill('#fText', '家族だけ'); await m.click('#fSave'); await m.wait_for_timeout(2500)
    r = await m.evaluate("""() => { const n = [...Store.notes.values()].find(x => x.t === '家族だけ'), M = window.__FBMOCK.__store, [a, b] = GR.gids();
      return [M.has('groups/' + a + '/notes/u1_' + n.id), M.has('groups/' + b + '/notes/u1_' + n.id)]; }""")
    check('group: 共有 sends a memo only to the group chosen', r == [False, True], r)
    # けす from みんな: only my own memo slides; it goes from the group too (and says so)
    await m.evaluate("() => { GR.view = GR.gids()[1]; GR.saveView(); groupIndex(); paintGroup(); changed(); closePanel('sheet'); openDrawer('group'); }"); await m.wait_for_timeout(800)
    rows = await m.evaluate("() => [...document.querySelectorAll('#dBody .log')].map(b => [b.querySelector('.t').textContent, b.parentNode.classList.contains('swd')])")
    await swipe_left(m, await ctx.new_cdp_session(m), '#dBody .swd > .log')
    await m.evaluate("() => document.querySelector('#dBody .swd.open .swdel').click()"); await m.wait_for_timeout(2500)
    r = await m.evaluate("() => { const M = window.__FBMOCK.__store, b = GR.gids()[1]; return [$('#toast').textContent, [...Store.notes.values()].some(x => x.t === '家族だけ'), [...M.keys()].some(k => k.startsWith('groups/' + b + '/notes/u1_'))]; }")
    await m.evaluate("() => { GR.view = GR.gids()[0]; GR.saveView(); groupIndex(); paintGroup(); changed(); renderDrawer(); }"); await m.wait_for_timeout(800)
    theirs = await m.evaluate("() => [...document.querySelectorAll('#dBody .log')].filter(b => b.textContent.includes('はなこのメモ')).map(b => b.parentNode.classList.contains('swd'))")
    check('group: けす from みんな — only on my own memos, and gone from the group too', rows == [['家族だけ', True]] and '家族からも' in r[0] and not r[1] and not r[2] and theirs and not any(theirs), [rows, r, theirs])
    check('group: no errors on the page', not errs, errs)
    await ctx.close()

def parts():   # v2.12.0~: the page is index.html + its parts (css/, js/), each named by its content (?v=)
    import re, hashlib
    html = open(os.path.join(SITE, 'index.html'), encoding='utf-8').read()
    got = re.findall(r'(?:href|src)="((?:css|js)/[\w-]+\.(?:css|js))\?v=([0-9a-f]+)"', html)
    def same(f, v):
        p = os.path.join(SITE, f)
        return os.path.exists(p) and len(v) >= 8 and hashlib.sha256(open(p, 'rb').read()).hexdigest().startswith(v)
    bad = [f for f, v in got if not same(f, v)]
    check('files: every part of the page is there, and its ?v= matches what is in it', len(got) >= 9 and not bad, bad or got)

async def main():
    parts()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            kw = {'args': ['--no-sandbox']}
            if os.environ.get('CHROME'): kw['executable_path'] = os.environ['CHROME']
            b = await p.chromium.launch(**kw)
            base = f'http://127.0.0.1:{PORT}'
            for phone in (True, False):
                await app(b, phone, base)
            await together(b, base)
            await offline(b, f'http://localhost:{PORT}')   # the offline copy needs a secure address (localhost counts)
            await b.close()
    finally:
        srv.terminate()
    print(f'\n{len(PASSES)} passed, {len(FAILS)} failed')
    if FAILS: sys.exit(1)

asyncio.run(main())
