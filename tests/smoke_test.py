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
    await m.fill('.edit .eT', 'テストの散歩（なおした）'); await m.evaluate("() => document.querySelector('.edit .eS').click()"); await m.wait_for_timeout(500)
    check(f'{tag}: なおす changes the memo', await m.evaluate("() => [...Store.notes.values()].some(n => n.t === 'テストの散歩（なおした）')"))
    # an Instagram link pasted into the memo becomes a photo mark
    await m.evaluate("() => { if ($('#sForm').classList.contains('collapsed')) $('#fOpen').click(); const e = new Event('paste', { bubbles: true, cancelable: true }); e.clipboardData = { getData: () => 'https://www.instagram.com/p/TEST12345/' }; $('#fText').dispatchEvent(e); }"); await m.wait_for_timeout(400)
    check(f'{tag}: a pasted Instagram link becomes a photo', await m.evaluate("() => parseLinks($('#fLinks').value).length === 1 && $('#fPick').textContent.includes('1')"))
    # a shop: the address finds the town
    r = await m.evaluate("async () => { const p = parseShop('喫茶テスト\\n日本、〒248-0006 神奈川県鎌倉市小町２丁目１０−１１\\nhttps://maps.app.goo.gl/test'); const k = await addrKey(p.a); return [p.n, p.u, k && placeName(k.key)]; }")
    check(f'{tag}: a copied shop finds its town', r == ['喫茶テスト', 'https://maps.app.goo.gl/test', '小町二丁目'], r)
    # 記録 (the drawer): its tabs, and × with a real tap
    await m.evaluate("() => closePanel('sheet')"); await m.wait_for_timeout(400)
    await m.evaluate("() => openDrawer('walks')"); await m.wait_for_timeout(600)
    await m.click('#t_list'); await m.wait_for_timeout(300)
    await m.click('#drawer [data-close=drawer]'); await m.wait_for_timeout(500)
    check(f'{tag}: 記録 switches tabs and closes', await m.evaluate("() => dTab === 'list' && !$('#drawer').classList.contains('open')"))
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
    # おかえり (after a walk) also says バックアップ
    await m.evaluate("() => okaeri()"); await m.wait_for_timeout(500)
    t = await m.evaluate("() => $('#routeDlg').innerText")
    check(f'{tag}: おかえり says バックアップ', 'バックアップする' in t and 'ファイル' not in t, t[-120:])
    await m.evaluate("() => closeRoute()"); await m.wait_for_timeout(300)
    # the record format
    r = await m.evaluate("() => { const v = Store.dump().v; const n = Store.absorb({ app: 'sanpo-log', v: 2, notes: { old2: { id: 'old2', k: 'p13', d: '2024-05-05', t: '第2版', u: 1 } } }); return [v, n, !!Store.notes.get('old2')]; }")
    check(f'{tag}: records are 第3版 and old ones still open', r == [3, 1, True], r)
    # phone: the sheet comes up to 8/10 of the screen
    if phone:
        await m.evaluate("() => jumpTo(D.towns['14204'][3].k)"); await m.wait_for_timeout(1500)
        h = await m.evaluate("() => Math.round($('#sheet').getBoundingClientRect().top / innerHeight * 100)")
        check('phone: the sheet opens to 8/10', 15 <= h <= 25, h)
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

async def main():
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
            await offline(b, f'http://localhost:{PORT}')   # the offline copy needs a secure address (localhost counts)
            await b.close()
    finally:
        srv.terminate()
    print(f'\n{len(PASSES)} passed, {len(FAILS)} failed')
    if FAILS: sys.exit(1)

asyncio.run(main())
