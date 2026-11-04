const E = require('../src/engine.js');
const Bot = require('../src/bot.js');
const assert = require('assert');

let seed = Number(process.env.SEED || 12345);
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const d6 = () => 1 + Math.floor(rnd() * 6);

function newGame() { return E.act(null, { type: 'newgame', rolloff: E.rollOff(d6) }).state; }

// 1) Согласованность генератора с движком
let checked = 0;
for (let g = 0; g < 60; g++) {
  let S = newGame();
  while (S.phase !== 'over') {
    if (S.phase === 'roll') { S = E.act(S, { type: 'roll', p: S.turn, dice: [d6(), d6()] }).state; continue; }
    const ts = Bot.turns(S);
    const key = (st) => st.pts.join(',') + '|' + st.off.join(',');
    const mine = new Set(ts.map((t) => key(t.st)));
    const ref = new Set(), seen = new Set();
    const rec = (st) => { const ms = st.dice.length && st.off[st.turn] < 15 ? E.legalMoves(Object.assign({}, st, { phase: 'move' })) : [];
      if (!ms.length) { ref.add(key(st)); return; }
      for (const m of ms) { const n = E.applyRaw(st, m); const k = key(n) + n.dice.join('') + n.headUsed; if (!seen.has(k)) { seen.add(k); rec(n); } } };
    rec(S);
    assert.deepStrictEqual([...mine].sort(), [...ref].sort(), 'итоговые позиции генератора = позиции по правилам движка');
    const t = ts[Math.floor(rnd() * ts.length)];
    const p = S.turn;
    for (const m of t.seq) {
      const a = { type: 'move', p, from: m.from, to: m.to, die: m.die };
      assert.ok(E.validate(S, a), 'каждый шаг последовательности разрешён');
      S = E.act(S, a).state;
    }
    assert.ok(S.turn !== p || S.phase === 'over', 'после последовательности ход переходит');
    checked++;
  }
}
console.log('ok   генератор согласован с правилами,', checked, 'ходов проверено');

// 2) Турнир
function play(levelW, levelB) {
  let S = newGame();
  const lv = [levelW, levelB];
  let guard = 0;
  while (S.phase !== 'over' && guard++ < 2000) {
    if (S.phase === 'roll') { S = E.act(S, { type: 'roll', p: S.turn, dice: [d6(), d6()] }).state; continue; }
    const p = S.turn;
    for (const m of Bot.choose(S, lv[p], rnd)) S = E.act(S, { type: 'move', p, from: m.from, to: m.to, die: m.die }).state;
  }
  return { winner: S.winner, points: S.points };
}
function match(a, b, n) {
  let wa = 0, pa = 0, pb = 0; const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const swap = i % 2 === 1; const r = swap ? play(b, a) : play(a, b);
    const aWon = swap ? r.winner === 1 : r.winner === 0;
    if (aWon) { wa++; pa += r.points; } else pb += r.points;
  }
  return { wa, n, pct: Math.round((wa / n) * 100), pa, pb, sec: ((Date.now() - t0) / 1000).toFixed(1) };
}
const N = Number(process.env.N || 100);
const pairs = (process.env.PAIRS || '2:1,3:2,4:3').split(',').map((s) => s.split(':').map(Number));
for (const [a, b] of pairs) {
  const r = match(a, b, a === 4 || b === 4 ? Math.min(N, Number(process.env.N4 || 40)) : N);
  console.log(`${Bot.LEVELS[a - 1].name} vs ${Bot.LEVELS[b - 1].name}: ${r.wa}/${r.n} (${r.pct}%), очки ${r.pa}:${r.pb}, ${r.sec}s`);
}
