import asyncio, json, sys, time
from playwright.async_api import async_playwright

SCR = '/tmp/claude-0/-home-claude/12c71f9d-c91c-52b8-8269-c5abc2d30b5e/scratchpad/'
BASE = 'http://localhost:8080/?ph=127.0.0.1&pp=9000&ps=0'
ok = True
def check(cond, msg):
    global ok
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond: ok = False

async def page_for(browser, name, logs):
    ctx = await browser.new_context(viewport={'width': 390, 'height': 760}, device_scale_factor=2, is_mobile=True, has_touch=True, permissions=['camera', 'microphone'])
    await ctx.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    await ctx.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    p = await ctx.new_page()
    p.on('console', lambda m: logs.append(f'[{name}] {m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    p.on('pageerror', lambda e: logs.append(f'[{name}] PAGEERROR {e}'))
    return p

async def st(p):
    return await p.evaluate('() => JSON.stringify(NardyApp.S)')

async def wait_for(p, expr, timeout=15000):
    await p.wait_for_function(expr, timeout=timeout)

async def play_turn(pages, use_clicks=False):
    """Активная сторона бросает и делает все ходы. Возвращает число сыгранных ходов."""
    for p in pages:
        turn_mine = await p.evaluate('() => NardyApp.S && NardyApp.S.phase==="roll" && NardyApp.S.turn===NardyApp.me')
        if turn_mine: break
    else:
        return -1
    v0 = await p.evaluate('() => NardyApp.S.v')
    if use_clicks:
        await p.click('.roll-btn')
    else:
        await p.evaluate('() => NardyApp.roll()')
    await wait_for(p, f'() => NardyApp.S.v > {v0} && !NardyApp.rolling')
    n = 0
    while True:
        await p.wait_for_timeout(50)
        info = await p.evaluate('''() => { const S = NardyApp.S; if (S.phase !== 'move' || S.turn !== NardyApp.me) return null;
            const ms = Engine.legalMoves(S); const m = ms[Math.floor(Math.random()*ms.length)];
            return { m, fromAbs: Engine.absOf(S.turn, m.from), toAbs: m.to>=24 ? null : Engine.absOf(S.turn, m.to), v: S.v }; }''')
        if not info: break
        if use_clicks:
            await p.click(f'#lyHit rect[data-a="{info["fromAbs"]}"]', force=True)
            await p.wait_for_timeout(60)
            if info['toAbs'] is None:
                await p.click('#lyHit rect[data-off]', force=True)
            else:
                await p.click(f'#lyHit rect[data-a="{info["toAbs"]}"]', force=True)
        else:
            await p.evaluate('(m) => NardyApp.playPath([m])', info['m'])
        await wait_for(p, f'() => NardyApp.S.v > {info["v"]} && !NardyApp.busy', 8000)
        n += 1
    return n

async def main():
    logs = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=[
            '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
            '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'])
        A = await page_for(browser, 'host', logs)
        B = await page_for(browser, 'guest', logs)

        await A.goto(BASE); await A.fill('#nameInput', 'Герман'); await A.click('#btnCreate')
        await A.wait_for_selector('#sheetInvite:not([hidden])')
        url = (await A.text_content('#inviteLink')).strip()
        check('room=' in url and 'ph=127.0.0.1' in url, 'ссылка-приглашение: ' + url)
        await A.screenshot(path=SCR + '01_invite.png')

        await B.goto(url)
        check(await B.is_visible('#invitedCard'), 'гость видит карточку приглашения')
        await B.screenshot(path=SCR + '02_guest_lobby.png')
        await B.fill('#nameInput', 'Арам'); await B.click('#btnJoin')

        for p, nm in ((A, 'хост'), (B, 'гость')):
            await wait_for(p, '() => NardyApp.S && NardyApp.net && NardyApp.net.open', 20000)
        check(True, 'соединение установлено, партия создана')
        await A.wait_for_timeout(1500)
        check(await st(A) == await st(B), 'состояния совпадают после подключения')
        check(await A.text_content('#nameOpp') == 'Арам' and await B.text_content('#nameOpp') == 'Герман', 'имена обменялись')
        check(await A.is_hidden('#sheetInvite'), 'приглашение закрылось у хоста')

        # видео
        await A.wait_for_timeout(3500)
        for p, nm in ((A, 'хост'), (B, 'гость')):
            vw = await p.evaluate('() => { const v = document.getElementById("vidOpp"); return [v.hidden, v.videoWidth, v.readyState]; }')
            check(not vw[0] and vw[1] > 0, f'{nm} видит видео соперника {vw}')
        await A.screenshot(path=SCR + '03_host_game.png'); await B.screenshot(path=SCR + '04_guest_game.png')

        # один ход кликами
        n = await play_turn([A, B], use_clicks=True)
        await A.wait_for_timeout(700)
        check(n >= 1, f'ход кликами сыгран ({n} шаг.)')
        check(await st(A) == await st(B), 'состояния совпадают после хода')

        # попытка «вернуть» ход: двигать назад движок не даёт, а тот же игрок не может ходить после конца хода
        S = json.loads(await st(A))
        check(S['phase'] == 'roll', 'после хода — очередь бросать у соперника')

        # эмоции
        await A.click('#btnEmote'); await A.wait_for_selector('#tray:not([hidden])')
        await A.screenshot(path=SCR + '05_tray.png')
        await A.click('#tray .emo >> nth=0')
        await B.wait_for_selector('#fx .fly', timeout=3000)
        check(True, 'флаг долетел до соперника')
        await B.wait_for_timeout(350); await B.screenshot(path=SCR + '06_emote_incoming.png')
        await B.click('#btnEmote'); await B.click('#tray .emo >> nth=1')
        await A.wait_for_selector('#fx .fly', timeout=3000)
        check(True, 'футбольная эмоция долетела')

        # переподключение гостя после перезагрузки
        await B.reload()
        await wait_for(B, '() => NardyApp.S && NardyApp.net && NardyApp.net.open', 25000)
        await B.wait_for_timeout(1200)
        check(await st(A) == await st(B), 'после перезагрузки гостя партия продолжилась')

        # много ходов подряд
        t0 = time.time(); turns = 0
        while turns < 40:
            r = await play_turn([A, B])
            if r < 0:
                S = json.loads(await st(A))
                if S['phase'] == 'over': break
                await A.wait_for_timeout(200); continue
            turns += 1
        await A.wait_for_timeout(800)
        sa, sb = await st(A), await st(B)
        check(sa == sb, f'после {turns} ходов состояния совпадают (v={json.loads(sa)["v"]}, {time.time()-t0:.1f}s)')
        await A.screenshot(path=SCR + '07_midgame_host.png')
        await B.screenshot(path=SCR + '08_midgame_guest.png')

        # сдача и новая партия
        await A.evaluate('() => NardyApp.commit({type:"resign", p: NardyApp.me})')
        await B.wait_for_selector('#sheetOver:not([hidden])', timeout=5000)
        await B.screenshot(path=SCR + '09_over_guest.png')
        await B.click('#btnAgain')
        await wait_for(A, '() => NardyApp.S.phase === "roll" && NardyApp.S.game === 2', 6000)
        await A.wait_for_timeout(600)
        check(await st(A) == await st(B), 'новая партия по кнопке гостя создана и совпадает')

        # одно устройство
        C = await page_for(browser, 'local', logs)
        await C.goto(BASE); await C.click('#btnLocal')
        await C.wait_for_timeout(2600)
        await C.click('.roll-btn'); await C.wait_for_timeout(900)
        await C.screenshot(path=SCR + '10_local.png')
        check(await C.evaluate('() => NardyApp.S.phase') in ('move', 'roll'), 'режим на одном экране работает')

        # десктоп
        D = await browser.new_page(viewport={'width': 1280, 'height': 800})
        await D.route('**/fonts.g*/**', lambda r: r.abort())
        await D.goto(BASE); await D.click('#btnLocal'); await D.wait_for_timeout(2600)
        await D.screenshot(path=SCR + '11_desktop.png')

        await browser.close()
    errs = [l for l in logs if 'PAGEERROR' in l or ('error' in l.lower() and 'fonts' not in l and 'ERR_FAILED' not in l)]
    print('\n'.join(errs[:30]) if errs else 'no console errors')
    print('RESULT', 'PASS' if ok else 'FAIL')

asyncio.run(main())
