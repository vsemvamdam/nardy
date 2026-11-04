// Подбор весов оценки самоигрой (уровень 3 против уровня 3 с другими весами)
const E = require('../src/engine.js'), Bot = require('../src/bot.js');
let seed = Number(process.env.SEED || 777);
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const d6 = () => 1 + Math.floor(rnd() * 6);
function play(wW, wB, lW = 3, lB = 3) {
  let S = E.act(null, { type: 'newgame', rolloff: E.rollOff(d6) }).state; const ws = [wW, wB], ls = [lW, lB];
  while (S.phase !== 'over') {
    if (S.phase === 'roll') { S = E.act(S, { type: 'roll', p: S.turn, dice: [d6(), d6()] }).state; continue; }
    const p = S.turn; for (const m of Bot.choose(S, ls[p], rnd, ws[p])) S = E.act(S, { type: 'move', p, from: m.from, to: m.to, die: m.die }).state;
  }
  return S.winner;
}
function score(a, b, n, la = 3, lb = 3) { let w = 0; for (let i = 0; i < n; i++) { if (i % 2) w += play(b, a, lb, la) === 1 ? 1 : 0; else w += play(a, b, la, lb) === 0 ? 1 : 0; } return w / n; }
module.exports = { score, play };
if (require.main === module) {
  let best = Object.assign({}, Bot.W);
  const keys = Object.keys(best); const n = Number(process.env.N || 300), iters = Number(process.env.IT || 16);
  console.log('Мастер vs Новичок', score(best, best, 100, 3, 1));
  for (let it = 0; it < iters; it++) {
    const cand = Object.assign({}, best);
    const k1 = keys[Math.floor(rnd() * keys.length)], k2 = keys[Math.floor(rnd() * keys.length)];
    for (const k of new Set([k1, k2])) cand[k] = Math.max(0, +(cand[k] * (0.5 + rnd() * 1.1) + (rnd() - 0.5) * 0.3).toFixed(2));
    const r = score(cand, best, n);
    console.log(it, r.toFixed(3), JSON.stringify(cand));
    if (r > 0.545) { best = cand; console.log('   -> принято'); }
  }
  console.log('ИТОГ', JSON.stringify(best));
  console.log('итог vs старт', score(best, Bot.W, 400));
}
