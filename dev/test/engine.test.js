const E = require('../src/engine.js');
const assert = require('assert');
let passed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n    ', e.message); process.exitCode = 1; } };

function state(white, black, extra = {}) {
  const pts = new Array(24).fill(0);
  for (const [i, n] of Object.entries(white)) pts[E.absOf(0, +i)] += n;
  for (const [i, n] of Object.entries(black)) pts[E.absOf(1, +i)] -= n;
  const offW = 15 - Object.values(white).reduce((a, b) => a + b, 0);
  const offB = 15 - Object.values(black).reduce((a, b) => a + b, 0);
  return Object.assign({ v: 1, game: 1, score: [0, 0], pts, off: [offW, offB], turn: 0, phase: 'roll', dice: [], rolled: [], headUsed: 0, turnsDone: [5, 5], lastMoves: [] }, extra);
}
const roll = (S, a, b) => E.act(S, { type: 'roll', p: S.turn, dice: [a, b] });
const fmt = (ms) => ms.map((m) => `${m.from}>${m.to}(${m.die})`).sort().join(' ');
function playSeq(S, seq) { // seq: [[from,to,die],...]
  for (const [from, to, die] of seq) {
    const a = { type: 'move', p: S.turn, from, to, die };
    assert.ok(E.validate(S, a), `move ${from}>${to}(${die}) should be legal; legal: ${fmt(E.legalMoves(S))}`);
    S = E.act(S, a).state;
  }
  return S;
}
function newGame() { return E.act(null, { type: 'newgame', rolloff: [[5, 3]] }).state; }

t('начальная позиция: 15 на голове, путь 360', () => {
  const S = newGame();
  assert.strictEqual(S.pts[0], 15); assert.strictEqual(S.pts[12], -15);
  assert.strictEqual(E.pips(S, 0), 360); assert.strictEqual(E.pips(S, 1), 360);
  assert.strictEqual(S.turn, 0);
});

t('6-2 первым ходом: с головы одна шашка, второй кубик — той же шашкой', () => {
  let S = roll(newGame(), 6, 2).state;
  assert.strictEqual(fmt(E.legalMoves(S)), '0>2(2) 0>6(6)');
  S = playSeq(S, [[0, 6, 6]]);
  assert.strictEqual(fmt(E.legalMoves(S)), '6>8(2)');
  S = playSeq(S, [[6, 8, 2]]);
  assert.strictEqual(S.turn, 1); assert.strictEqual(S.phase, 'roll');
});

t('нельзя переиграть: после 0>6 ход 0>2 запрещён', () => {
  let S = roll(newGame(), 6, 2).state;
  S = playSeq(S, [[0, 6, 6]]);
  assert.ok(!E.validate(S, { type: 'move', p: 0, from: 0, to: 2, die: 2 }));
});

t('первый бросок 6-6: снимаются две шашки, остальное не играется', () => {
  let { state: S } = roll(newGame(), 6, 6);
  assert.strictEqual(fmt(E.legalMoves(S)), '0>6(6)');
  S = playSeq(S, [[0, 6, 6]]);
  assert.strictEqual(fmt(E.legalMoves(S)), '0>6(6)'); // 6>12 — голова чёрных
  const r = E.act(S, { type: 'move', p: 0, from: 0, to: 6, die: 6 });
  assert.ok(r.info.restBlocked); assert.strictEqual(r.state.turn, 1);
  assert.strictEqual(r.state.pts[6], 2); assert.strictEqual(r.state.pts[0], 13);
});

t('первый бросок 3-3: две с головы, все четыре хода', () => {
  let { state: S } = roll(newGame(), 3, 3);
  S = playSeq(S, [[0, 3, 3], [3, 6, 3], [6, 9, 3]]);
  assert.strictEqual(fmt(E.legalMoves(S)), '0>3(3)'); // 9>12 занято, вторая с головы разрешена
  S = playSeq(S, [[0, 3, 3]]);
  assert.strictEqual(S.turn, 1);
});

t('первый бросок 4-4: можно две с головы', () => {
  let { state: S } = roll(newGame(), 4, 4);
  S = playSeq(S, [[0, 4, 4], [4, 8, 4]]);
  assert.strictEqual(fmt(E.legalMoves(S)), '0>4(4)');
});

t('первый бросок 5-5: только одна с головы', () => {
  let { state: S } = roll(newGame(), 5, 5);
  S = playSeq(S, [[0, 5, 5], [5, 10, 5]]);
  // 10>15 разрешено, голова уже использована
  assert.strictEqual(fmt(E.legalMoves(S)), '10>15(5)');
});

t('не первый ход 6-6: только одна с головы', () => {
  let S = state({ 0: 13, 6: 1, 8: 1 }, { 0: 13, 5: 1, 9: 1 });
  S = roll(S, 6, 6).state;
  S = playSeq(S, [[0, 6, 6]]);
  assert.ok(!E.legalMoves(S).some((m) => m.from === 0));
});

t('нельзя вставать на пункт с шашкой соперника', () => {
  // белая на 2, чёрная на пути белых 5 (абс 5 = путь чёрных 17)
  let S = state({ 0: 14, 2: 1 }, { 0: 14, 17: 1 });
  S = roll(S, 3, 1).state;
  assert.ok(!E.legalMoves(S).some((m) => m.from === 2 && m.to === 5));
});

t('забор из 6 без шашки соперника впереди запрещён', () => {
  // белые занимают 1..5, ход на 6 сделает 6 подряд; все чёрные позади (на голове)
  let S = state({ 0: 5, 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 }, { 0: 15 });
  S = roll(S, 6, 1).state;
  const ms = E.legalMoves(S);
  assert.ok(!ms.some((m) => m.to === 6), 'на 6 вставать нельзя: ' + fmt(ms));
});

t('забор из 6 разрешён, если шашка соперника впереди', () => {
  // чёрная шашка уже ушла дальше забора: абс 8 → путь чёрных 20
  let S = state({ 0: 5, 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 }, { 0: 14, 20: 1 });
  S = roll(S, 6, 1).state;
  assert.ok(E.legalMoves(S).some((m) => m.to === 6));
});

t('нужно сыграть оба кубика, если возможно', () => {
  // белая на 18 и 23 — дом не весь (есть шашка на 10). Проверяем, что ход, блокирующий второй кубик, запрещён
  // Чёрные стоят на абс 13 и 14 (их путь 1,2). Белая на 10: 10+3=13 занято, 10+4=14 занято, 10+7=17
  let S = state({ 10: 1, 0: 14 }, { 1: 1, 2: 1, 0: 13 }, { turnsDone: [3, 3] });
  S.headUsed = 0;
  S = roll(S, 3, 4).state;
  const ms = E.legalMoves(S);
  // с головы: 0>3, 0>4 и далее; 10>13,10>14 нельзя. Каждый допустимый ход должен оставлять второй кубик
  for (const m of ms) assert.ok(!(m.from === 10), 'шашкой с 10 не сыграть: ' + fmt(ms));
});

t('если играется только один кубик — обязательно больший', () => {
  // Белые: одна шашка на 16 и остальные в доме, голова пуста. Чёрные блокируют так, что только один ход
  // Путь белых: 16. Кубики 5 и 2. 16+2=18 свободно, 16+5=21 свободно, 16+7=23 занято.
  // После 16>18 второй (5): 18+5=23 занято → нельзя; после 16>21 второй (2): 21+2=23 занято → нельзя.
  // Остальные шашки (в 19,20) — 19+2=21, если свободно... закроем: все остальные выведены.
  const white = { 16: 1 }; // 14 выведено — дом не полон, так как 16 вне дома
  const black = { 11: 1, 0: 14 }; // абс 23 = путь чёрных 11
  let S = state(white, black);
  S = roll(S, 5, 2).state;
  assert.strictEqual(fmt(E.legalMoves(S)), '16>21(5)');
});

t('выброс: точный кубик и больший с самого дальнего пункта', () => {
  // все белые в доме: 18:2, 20:3, 23:1, остальные выведены
  let S = state({ 18: 2, 20: 3, 23: 1 }, { 5: 15 });
  S = roll(S, 6, 1).state;
  const ms = E.legalMoves(S);
  assert.ok(ms.some((m) => m.from === 18 && m.to === 24 && m.die === 6), fmt(ms));
  assert.ok(!ms.some((m) => m.from === 20 && m.to === 24 && m.die === 6), 'с 20 шестёркой нельзя, пока есть на 18');
  assert.ok(ms.some((m) => m.from === 23 && m.to === 24 && m.die === 1));
});

t('выброс больше нужного разрешён, когда дальше никого нет', () => {
  let S = state({ 22: 1, 23: 1 }, { 5: 15 });
  S = roll(S, 6, 5).state;
  S = playSeq(S, [[22, 24, 6], [23, 24, 5]]);
  assert.strictEqual(S.phase, 'over'); assert.strictEqual(S.winner, 0);
  assert.strictEqual(S.points, 2); assert.ok(S.mars); assert.deepStrictEqual(S.score, [2, 0]);
});

t('нельзя выводить, пока не все в доме', () => {
  let S = state({ 17: 1, 23: 1 }, { 5: 15 });
  S = roll(S, 1, 2).state;
  assert.ok(!E.legalMoves(S).some((m) => m.to === 24 && m.from === 23 && m.die === 2 ));
});

t('победа без марса — 1 очко', () => {
  let S = state({ 23: 1 }, { 20: 1 });
  S = roll(S, 1, 2).state;
  S = playSeq(S, [[23, 24, 2]]);
  assert.strictEqual(S.points, 1); assert.ok(!S.mars);
});

t('нет хода — ход переходит', () => {
  // белая шашка на 22 (не дома полностью: есть на 5), все пути заняты
  let S = state({ 5: 1, 0: 14 }, { 0: 13, 18: 1, 17: 1 });
  // абс 6 = путь чёрных 18; абс 5 = 17. Белая на 5... упростим: проверим просто через headUsed
  S.headUsed = 1; // голова уже использована — проверка пропуска
  S.phase = 'move'; S.dice = [1, 1, 1, 1]; S.rolled = [1, 1];
  // 5+1=6 занято чёрной → ходов нет
  assert.strictEqual(E.legalMoves(S).length, 0);
  const r = roll(Object.assign({}, S, { phase: 'roll', headUsed: 0, pts: (() => { const p = S.pts.slice(); return p; })() }), 1, 1);
  // с головы 0>1 возможен, поэтому пропуска нет
  assert.ok(!r.info.passed);
});

t('пропуск хода при полной блокировке', () => {
  // единственная белая (кроме выведенных) на 4; клетки 5 и 6 заняты чёрными
  let S = state({ 4: 1 }, { 17: 1, 18: 1, 0: 13 });
  const r = roll(S, 1, 2);
  assert.ok(r.info.passed); assert.strictEqual(r.state.turn, 1); assert.strictEqual(r.state.phase, 'roll');
});

t('чёрные: первый 6-6 тоже две с головы', () => {
  let S = newGame(); S.turn = 1;
  let r = roll(S, 6, 6).state;
  r = playSeq(r, [[0, 6, 6], [0, 6, 6]]);
  assert.strictEqual(r.turn, 0);
});

t('reachable: 6-2 с головы даёт 2, 6 и 8', () => {
  const S = roll(newGame(), 6, 2).state;
  const m = E.reachable(S, 0);
  assert.deepStrictEqual([...m.keys()].sort((a, b) => a - b), [2, 6, 8]);
  assert.strictEqual(m.get(8).length, 2);
});

t('сдача', () => {
  let S = roll(newGame(), 6, 2).state;
  const r = E.act(S, { type: 'resign', p: 0 });
  assert.strictEqual(r.state.winner, 1); assert.deepStrictEqual(r.state.score, [0, 1]);
});

t('случайная партия до конца без ошибок и с сохранением 15 шашек', () => {
  for (let g = 0; g < 200; g++) {
    let S = E.act(null, { type: 'newgame', rolloff: E.rollOff(() => 1 + Math.floor(Math.random() * 6)) }).state;
    let guard = 0;
    while (S.phase !== 'over' && guard++ < 4000) {
      if (S.phase === 'roll') { S = roll(S, 1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)).state; continue; }
      const ms = E.legalMoves(S); assert.ok(ms.length, 'в фазе move должен быть ход');
      const m = ms[Math.floor(Math.random() * ms.length)];
      S = E.act(S, Object.assign({ type: 'move', p: S.turn }, m)).state;
      for (const p of [0, 1]) { let n = S.off[p]; for (let i = 0; i < 24; i++) n += E.cnt(S, p, i); assert.strictEqual(n, 15); }
      for (const v of S.pts) assert.ok(Number.isInteger(v));
    }
    assert.strictEqual(S.phase, 'over', 'партия должна закончиться');
  }
});

console.log(`\n${passed} passed`);
