/* ===== Бот для длинных нард =====
   Уровни: 1 Новичок — случайный ход; 2 Любитель — гонка с ошибками;
   3 Мастер — полная оценка позиции; 4 Гроссмейстер — просчёт ответа соперника. */
const Bot = (() => {
  const E = (typeof Engine !== 'undefined') ? Engine : require('./engine.js');
  const LEVELS = [
    { id: 1, name: 'Новичок', note: 'Ходит наугад. Для разминки.' },
    { id: 2, name: 'Любитель', note: 'Понимает игру, но часто ошибается.' },
    { id: 3, name: 'Мастер', note: 'Строит блоки, не даёт уйти с головы.' },
    { id: 4, name: 'Гроссмейстер', note: 'Просчитывает ваш ответ на каждый ход.' },
  ];
  const CFG = { K: 6 };
  const uniq = (a) => [...new Set(a)];
  const keyOf = (st) => st.pts.join(',') + '|' + st.off[0] + ',' + st.off[1];

  // Все различные итоговые позиции после полного хода (с учётом обязательных правил)
  function turns(S) {
    const p = S.turn, out = new Map(), seen = new Set();
    let best = 0;
    const rec = (st, seq) => {
      let any = false;
      if (st.dice.length && st.off[p] < 15) {
        for (const d of uniq(st.dice)) for (const m of E.singleMoves(st, d)) {
          any = true;
          const n = E.applyRaw(st, m);
          const k = keyOf(n) + '|' + n.dice.join('') + '|' + n.headUsed;
          if (seen.has(k)) continue;
          seen.add(k);
          rec(n, seq.concat([m]));
        }
      }
      if (!any) {
        const L = seq.length;
        if (L < best) return;
        if (L > best) { best = L; out.clear(); }
        const k = keyOf(st);
        if (!out.has(k)) out.set(k, { seq, st });
      }
    };
    rec(S, []);
    if (!best) return [];
    if (best === 1) { // один ход: берём разрешённые ходы прямо из правил (там же правило большего кубика)
      const m1 = new Map();
      for (const m of E.legalMoves(Object.assign({}, S, { phase: 'move' }))) { const st = E.applyRaw(S, m), k = keyOf(st); if (!m1.has(k)) m1.set(k, { seq: [m], st }); }
      return [...m1.values()];
    }
    return [...out.values()];
  }

  // ---- оценка позиции: side(p) - side(q), чем больше, тем лучше для p ----
  const W = { head: 2.2, stack: 2.32, homeStack: 0.5, spread: 1.5, block: 1.1, blockPow: 2.54, blockHome: 0.6 };
  function side(pts, off, p, w) {
    const q = 1 - p, sg = p === 0 ? 1 : -1;
    const own = new Array(24);
    let pip = 0;
    for (let i = 0; i < 24; i++) { const v = pts[E.absOf(p, i)] * sg; own[i] = v > 0 ? v : 0; pip += own[i] * (24 - i); }
    let s = -pip;
    s -= w.head * Math.max(0, own[0] - 1);
    let spread = 0;
    for (let i = 1; i < 24; i++) {
      if (own[i] > 3) s -= w.stack * (own[i] - 3) * (i < 18 ? 1 : w.homeStack);
      if (own[i] && i < 18) spread++;
    }
    s += w.spread * spread;
    // блоки в координатах пути соперника: шашки соперника позади блока должны через него пройти
    const qs = q === 0 ? 1 : -1, opp = new Array(24);
    for (let j = 0; j < 24; j++) { const v = pts[E.absOf(q, j)] * qs; opp[j] = v > 0 ? v : 0; }
    let behind = 0, j = 0;
    const behindAt = new Array(25); behindAt[0] = 0;
    for (let k = 0; k < 24; k++) behindAt[k + 1] = behindAt[k] + opp[k];
    while (j < 24) {
      const a = pts[E.absOf(q, j)] * sg;
      if (a > 0) {
        let e = j;
        while (e + 1 < 24 && pts[E.absOf(q, e + 1)] * sg > 0) e++;
        const L = e - j + 1;
        behind = behindAt[j];
        if (L >= 2 && behind) s += w.block * Math.pow(L, w.blockPow) * (behind / 15) * (j < 18 ? 1 : w.blockHome);
        j = e + 1;
      } else j++;
    }
    return s;
  }
  function evaluate(st, p, w = W) {
    if (st.off[p] === 15) return 1e6;
    return side(st.pts, st.off, p, w) - side(st.pts, st.off, 1 - p, w);
  }

  const ROLLS = [];
  for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) ROLLS.push({ dice: [a, b], w: a === b ? 1 / 36 : 2 / 36 });

  function oppState(S, st) {
    const p = S.turn, q = 1 - p, td = S.turnsDone.slice(); td[p]++;
    return { pts: st.pts, off: st.off, turn: q, phase: 'move', dice: [], rolled: [], headUsed: 0, turnsDone: td };
  }
  function replyValue(S, st, w) { // ожидаемая оценка для p после лучшего ответа соперника
    const p = S.turn; if (st.off[p] === 15) return 1e6;
    const base = oppState(S, st); let sum = 0;
    for (const r of ROLLS) {
      const O = Object.assign({}, base, { rolled: r.dice, dice: r.dice[0] === r.dice[1] ? [r.dice[0], r.dice[0], r.dice[0], r.dice[0]] : r.dice.slice() });
      const ts = turns(O);
      let worst = ts.length ? Infinity : evaluate(st, p, w);
      for (const t of ts) { const v = evaluate(t.st, p, w); if (v < worst) worst = v; }
      sum += r.w * worst;
    }
    return sum;
  }

  function choose(S, level, rand = Math.random, w = W) {
    const ts = turns(S);
    if (!ts.length) return [];
    if (ts.length === 1) return ts[0].seq;
    const p = S.turn;
    if (level <= 1) return ts[Math.floor(rand() * ts.length)].seq;
    if (level === 2) { // понимает позицию, но часто ошибается
      if (rand() < 0.2) return ts[Math.floor(rand() * ts.length)].seq;
      let best = null, bv = -Infinity;
      for (const t of ts) { const v = evaluate(t.st, p, w) + (rand() + rand() + rand() - 1.5) * 14; if (v > bv) { bv = v; best = t; } }
      return best.seq;
    }
    const scored = ts.map((t) => ({ t, v: evaluate(t.st, p, w) })).sort((a, b) => b.v - a.v);
    if (level === 3) return scored[0].t.seq;
    const K = Math.min(scored.length, CFG.K);
    let best = scored[0], bv = -Infinity;
    for (let i = 0; i < K; i++) { const v = replyValue(S, scored[i].t.st, w); if (v > bv) { bv = v; best = scored[i]; } }
    return best.t.seq;
  }

  return { LEVELS, W, CFG, turns, evaluate, choose };
})();
if (typeof module !== 'undefined') module.exports = Bot;
