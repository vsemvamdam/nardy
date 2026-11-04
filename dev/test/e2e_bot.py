import asyncio, json, time
from playwright.async_api import async_playwright

SCR = '/tmp/claude-0/-home-claude/12c71f9d-c91c-52b8-8269-c5abc2d30b5e/scratchpad/'
BASE = 'http://localhost:8080/'
ok = True
def check(cond, msg):
    global ok
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond: ok = False

async def main():
    logs = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True)
        ctx = await browser.new_context(viewport={'width': 390, 'height': 800}, device_scale_factor=2, is_mobile=True, has_touch=True)
        await ctx.route('**/fonts.g*/**', lambda r: r.abort())
        p = await ctx.new_page()
        p.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
        p.on('pageerror', lambda e: logs.append(f'PAGEERROR {e}'))
        await p.goto(BASE)
        await p.click('#btnBot')
        await p.wait_for_selector('#sheetBot:not([hidden])')
        await p.screenshot(path=SCR + 'b1_levels.png')
        n = await p.locator('#botList .lvl').count()
        check(n == 4, f'в списке 4 уровня ({n})')

        # Гроссмейстер — проверяем фоновый поток
        await p.click('#botList .lvl >> nth=3')
        await p.wait_for_function('() => NardyApp.mode === "bot" && NardyApp.S && NardyApp.S.phase !== undefined', timeout=5000)
        check(await p.evaluate('() => NardyApp.oppName') == 'Гроссмейстер', 'соперник — Гроссмейстер')
        await p.wait_for_timeout(2600)

        t0 = time.time(); my_turns = 0; bot_turns_seen = 0; last_turn = None; shot = False
        while time.time() - t0 < 240:
            S = json.loads(await p.evaluate('() => JSON.stringify(NardyApp.S)'))
            if S['phase'] == 'over': break
            if S['turn'] != last_turn:
                if S['turn'] == 1: bot_turns_seen += 1
                last_turn = S['turn']
            if S['turn'] == 0 and not await p.evaluate('() => NardyApp.busy || NardyApp.rolling'):
                if S['phase'] == 'roll':
                    if await p.locator('.roll-btn').count():
                        await p.click('.roll-btn'); my_turns += 1
                        await p.wait_for_timeout(900)
                    else:
                        await p.wait_for_timeout(150)
                    continue
                # ход кликами: шашка -> куда
                info = await p.evaluate('''() => { const S = NardyApp.S; if (S.phase !== 'move' || S.turn !== 0) return null;
                    const ms = Engine.legalMoves(S); const m = ms[Math.floor(Math.random()*ms.length)];
                    return { fromAbs: Engine.absOf(0, m.from), toAbs: m.to >= 24 ? null : Engine.absOf(0, m.to), v: S.v }; }''')
                if info:
                    await p.click(f'#lyHit rect[data-a="{info["fromAbs"]}"]', force=True)
                    await p.wait_for_timeout(40)
                    if info['toAbs'] is None: await p.click('#lyHit rect[data-off] >> nth=0', force=True)
                    else: await p.click(f'#lyHit rect[data-a="{info["toAbs"]}"]', force=True)
                    await p.wait_for_function(f'() => NardyApp.S.v > {info["v"]} && !NardyApp.busy', timeout=6000)
                    if not shot and my_turns >= 6:
                        await p.wait_for_timeout(100); await p.screenshot(path=SCR + 'b2_mid.png'); shot = True
                continue
            # во время хода бота пробуем кликнуть — ничего не должно произойти
            if S['turn'] == 1 and S['phase'] == 'move':
                v = S['v']
                await p.click('#lyHit rect[data-a="0"]', force=True)
                sel = await p.evaluate('() => NardyApp.sel')
                if sel is not None: check(False, 'во время хода бота выбор шашки невозможен')
            await p.wait_for_timeout(120)
        check(await p.evaluate('() => !!NardyBot.w && !NardyBot.failed'), 'бот считает в фоновом потоке')
        S = json.loads(await p.evaluate('() => JSON.stringify(NardyApp.S)'))
        check(S['phase'] == 'over', f'партия доиграна до конца за {time.time()-t0:.0f} с: победил {"вы" if S["winner"]==0 else "бот"}, {S["points"]} очк., ходов бота {bot_turns_seen}, ваших {my_turns}')
        await p.wait_for_selector('#sheetOver:not([hidden])', timeout=4000)
        await p.wait_for_timeout(1200)
        await p.screenshot(path=SCR + 'b3_over.png')

        # новая партия, затем эмоция и ответ бота
        await p.click('#btnAgain')
        await p.wait_for_function('() => NardyApp.S.game === 2', timeout=5000)
        await p.wait_for_timeout(2600)
        await p.evaluate('() => { Math.random = (() => { const r = Math.random; return () => 0.1; })(); }')
        await p.click('#btnEmote'); await p.click('#tray .emo >> nth=0')
        await p.wait_for_timeout(1500)
        flies = await p.locator('#fx .fly').count()
        check(flies >= 1, f'бот ответил эмоцией ({flies} в полёте)')

        # сохранение: перезагрузка -> «Продолжить партию»
        await p.reload(); await p.click('#btnBot')
        resume = await p.locator('#botList .lvl.resume').count()
        check(resume == 1, 'после перезагрузки есть «Продолжить партию»')
        await p.click('#botList .lvl.resume'); await p.wait_for_timeout(500)
        check(await p.evaluate('() => NardyApp.S.game') == 2 and await p.evaluate('() => NardyApp.S.score[0] + NardyApp.S.score[1]') >= 1, 'партия и счёт восстановились')

        # Новичок — быстрая партия
        await p.click('#btnMenu'); await p.click('text=Сложность')
        await p.click('#botList .lvl >> nth=0'); await p.wait_for_timeout(2700)
        check(await p.evaluate('() => NardyApp.oppName') == 'Новичок' and await p.evaluate('() => NardyApp.S.game') == 1, 'смена уровня из меню начинает новый матч')

        # время хода Гроссмейстера на дубле в середине партии
        ms = await p.evaluate('''async () => {
            const E = Engine; let S = E.act(null, {type:'newgame', rolloff:[[5,3]]}).state;
            const r6 = () => 1 + Math.floor(Math.random() * 6);
            for (let k = 0; k < 24; k++) { S = E.act(S, {type:'roll', p:S.turn, dice:[r6(), r6()]}).state;
              for (const m of Bot.choose(S, 3)) S = E.act(S, Object.assign({type:'move', p:S.turn}, m)).state; if (S.phase==='over') break; }
            if (S.phase === 'over') return -1;
            S = E.act(S, {type:'roll', p:S.turn, dice:[3,3]}).state;
            const t0 = performance.now(); await NardyBot.choose(S, 4); return Math.round(performance.now() - t0); }''')
        check(ms < 3000, f'ход Гроссмейстера на дубле 3-3 в миттельшпиле: {ms} мс')

        dark = await browser.new_context(viewport={'width': 390, 'height': 800}, device_scale_factor=2, color_scheme='dark', is_mobile=True)
        d = await dark.new_page(); await d.route('**/fonts.g*/**', lambda r: r.abort())
        await d.goto(BASE); await d.click('#btnBot'); await d.wait_for_timeout(300); await d.screenshot(path=SCR + 'b4_levels_dark.png')
        await d.click('#botList .lvl >> nth=2'); await d.wait_for_timeout(5200); await d.screenshot(path=SCR + 'b5_game_dark.png')
        await browser.close()
    errs = [l for l in logs if 'PAGEERROR' in l or ('error' in l.lower() and 'fonts' not in l and 'ERR_FAILED' not in l)]
    print('\n'.join(errs[:20]) if errs else 'no console errors')
    print('RESULT', 'PASS' if ok else 'FAIL')

asyncio.run(main())
