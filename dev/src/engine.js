/* ===== Движок длинных нард =====
   Игрок 0 — белые, 1 — чёрные. pts[a] — абсолютный пункт a (= путь белых):
   >0 белые шашки, <0 чёрные. У каждого игрока свой путь 0..23: 0 — голова, 18..23 — дом.
   Путь чёрных i ↔ абсолютный (i+12)%24. Преобразование симметрично. */
const Engine = (() => {
  const HOME = 18;
  const absOf = (p, i) => (p === 0 ? i : (i + 12) % 24);
  const sgn = (p) => (p === 0 ? 1 : -1);
  const cnt = (S, p, i) => { const v = S.pts[absOf(p, i)]; return p === 0 ? (v > 0 ? v : 0) : (v < 0 ? -v : 0); };
  const oppAt = (S, p, i) => { const v = S.pts[absOf(p, i)]; return p === 0 ? v < 0 : v > 0; };

  function initialPts() { const pts = new Array(24).fill(0); pts[0] = 15; pts[12] = -15; return pts; }

  function maxHead(S) {
    const r = S.rolled;
    return S.turnsDone[S.turn] === 0 && r && r.length === 2 && r[0] === r[1] && (r[0] === 3 || r[0] === 4 || r[0] === 6) ? 2 : 1;
  }
  function allHome(S, p) { let n = S.off[p]; for (let i = HOME; i < 24; i++) n += cnt(S, p, i); return n === 15; }

  // Забор из 6+ шашек подряд (по пути соперника), впереди которого нет ни одной шашки соперника
  function badBlock(pts, p, destAbs) {
    const q = 1 - p;
    const own = (a) => (p === 0 ? pts[a] > 0 : pts[a] < 0);
    const qi = absOf(q, destAbs);
    let lo = qi, hi = qi;
    while (lo > 0 && own(absOf(q, lo - 1))) lo--;
    while (hi < 23 && own(absOf(q, hi + 1))) hi++;
    if (hi - lo + 1 < 6) return false;
    for (let k = hi + 1; k < 24; k++) { const v = pts[absOf(q, k)]; if (q === 0 ? v > 0 : v < 0) return false; }
    return true;
  }

  function singleMoves(S, d) {
    const p = S.turn, res = [];
    const home = allHome(S, p), mh = maxHead(S), s = sgn(p);
    for (let i = 0; i < 24; i++) {
      if (!cnt(S, p, i)) continue;
      if (i === 0 && S.headUsed >= mh) continue;
      const t = i + d;
      if (t < 24) {
        if (oppAt(S, p, t)) continue;
        const pts = S.pts.slice();
        pts[absOf(p, i)] -= s; pts[absOf(p, t)] += s;
        if (badBlock(pts, p, absOf(p, t))) continue;
        res.push({ from: i, to: t, die: d });
      } else {
        if (!home) continue;
        if (t > 24) { let higher = false; for (let k = HOME; k < i; k++) if (cnt(S, p, k)) { higher = true; break; } if (higher) continue; }
        res.push({ from: i, to: 24, die: d });
      }
    }
    return res;
  }

  // Ход без завершения хода игрока (для перебора и подсказок)
  function applyRaw(S, m) {
    const p = S.turn, s = sgn(p);
    const N = Object.assign({}, S, { pts: S.pts.slice(), off: S.off.slice(), dice: S.dice.slice() });
    N.pts[absOf(p, m.from)] -= s;
    if (m.to >= 24) N.off[p]++; else N.pts[absOf(p, m.to)] += s;
    N.dice.splice(N.dice.indexOf(m.die), 1);
    if (m.from === 0) N.headUsed++;
    return N;
  }

  const uniq = (a) => [...new Set(a)];
  function maxDepth(S, memo) {
    if (!S.dice.length || S.off[S.turn] === 15) return 0;
    const key = S.pts.join(',') + '|' + S.off[S.turn] + '|' + S.dice.join('') + '|' + S.headUsed;
    if (memo.has(key)) return memo.get(key);
    let best = 0;
    outer: for (const d of uniq(S.dice)) {
      for (const m of singleMoves(S, d)) {
        const r = 1 + maxDepth(applyRaw(S, m), memo);
        if (r > best) { best = r; if (best === S.dice.length) break outer; }
      }
    }
    memo.set(key, best);
    return best;
  }

  // Все разрешённые одиночные ходы с учётом обязательности максимума кубиков и большего кубика
  function legalMoves(S) {
    if (S.phase !== 'move' || !S.dice.length) return [];
    const memo = new Map();
    let cands = [], best = 0;
    for (const d of uniq(S.dice)) {
      for (const m of singleMoves(S, d)) {
        const depth = 1 + maxDepth(applyRaw(S, m), memo);
        cands.push({ m, depth });
        if (depth > best) best = depth;
      }
    }
    if (!best) return [];
    let moves = cands.filter((c) => c.depth === best).map((c) => c.m);
    if (best === 1 && S.dice.length === 2 && S.dice[0] !== S.dice[1]) {
      const hi = Math.max(S.dice[0], S.dice[1]);
      if (moves.some((m) => m.die === hi)) moves = moves.filter((m) => m.die === hi);
    }
    return moves;
  }

  function pips(S, p) { let n = 0; for (let i = 0; i < 24; i++) n += cnt(S, p, i) * (24 - i); return n; }

  function endTurn(N) {
    N.turnsDone = N.turnsDone.slice(); N.turnsDone[N.turn]++;
    N.turn = 1 - N.turn; N.phase = 'roll'; N.dice = []; N.headUsed = 0;
  }

  function finishIfWon(N, p) {
    if (N.off[p] !== 15) return false;
    const q = 1 - p;
    N.phase = 'over'; N.winner = p; N.points = N.off[q] === 0 ? 2 : 1; N.mars = N.off[q] === 0;
    N.score = N.score.slice(); N.score[p] += N.points; N.dice = [];
    return true;
  }

  function newGameState(prev, rolloff) {
    const last = rolloff[rolloff.length - 1];
    return {
      v: prev ? prev.v : 0,
      game: prev ? (prev.game || 0) + 1 : 1,
      score: prev ? prev.score.slice() : [0, 0],
      pts: initialPts(), off: [0, 0],
      turn: last[0] > last[1] ? 0 : 1,
      phase: 'roll', dice: [], rolled: [], headUsed: 0, turnsDone: [0, 0],
      rolloff, lastRoll: null, lastMoves: [], winner: null, points: 0, mars: false, resigned: null,
    };
  }

  function validate(S, a) {
    if (!a || typeof a !== 'object') return false;
    if (a.type === 'newgame') return (!S || S.phase === 'over') && Array.isArray(a.rolloff) && a.rolloff.length > 0;
    if (!S) return false;
    if (a.type === 'roll') return S.phase === 'roll' && a.p === S.turn && Array.isArray(a.dice) && a.dice.length === 2 && a.dice.every((x) => Number.isInteger(x) && x >= 1 && x <= 6);
    if (a.type === 'move') return S.phase === 'move' && a.p === S.turn && legalMoves(S).some((m) => m.from === a.from && m.to === a.to && m.die === a.die);
    if (a.type === 'resign') return S.phase !== 'over' && (a.p === 0 || a.p === 1);
    return false;
  }

  // Применить действие. Возвращает {state, info}. Предполагается, что validate(S,a) === true.
  function act(S, a) {
    const info = {};
    let N;
    if (a.type === 'newgame') {
      N = newGameState(S, a.rolloff);
    } else if (a.type === 'roll') {
      N = Object.assign({}, S);
      N.rolled = a.dice.slice();
      N.dice = a.dice[0] === a.dice[1] ? [a.dice[0], a.dice[0], a.dice[0], a.dice[0]] : a.dice.slice();
      N.phase = 'move'; N.headUsed = 0; N.lastRoll = { p: S.turn, dice: a.dice.slice() }; N.lastMoves = [];
      if (!legalMoves(N).length) { info.passed = true; endTurn(N); }
    } else if (a.type === 'move') {
      const p = S.turn;
      N = applyRaw(S, a);
      N.lastMoves = (S.lastMoves || []).concat([{ p, from: a.from, to: a.to }]);
      if (finishIfWon(N, p)) info.over = true;
      else if (!N.dice.length) endTurn(N);
      else if (!legalMoves(N).length) { info.restBlocked = N.dice.slice(); endTurn(N); }
    } else if (a.type === 'resign') {
      N = Object.assign({}, S);
      const w = 1 - a.p;
      N.phase = 'over'; N.winner = w; N.points = 1; N.mars = false; N.resigned = a.p; N.dice = [];
      N.score = S.score.slice(); N.score[w] += 1; info.over = true;
    }
    N.v = (S ? S.v : 0) + 1;
    return { state: N, info };
  }

  // Куда можно дойти выбранной шашкой одним или несколькими кубиками подряд
  function reachable(S, fromIdx) {
    const out = new Map();
    const rec = (st, cur, path) => {
      for (const m of legalMoves(st)) {
        if (m.from !== cur) continue;
        const np = path.concat([m]);
        const ex = out.get(m.to);
        if (!ex || np.length < ex.length || (np.length === ex.length && np[0].die < ex[0].die)) out.set(m.to, np);
        if (m.to < 24 && st.dice.length > 1) rec(applyRaw(st, m), m.to, np);
      }
    };
    rec(S, fromIdx, []);
    return out;
  }

  function rollOff(rand) {
    const seq = [];
    for (let k = 0; k < 20; k++) { const r = [rand(), rand()]; seq.push(r); if (r[0] !== r[1]) break; }
    if (seq[seq.length - 1][0] === seq[seq.length - 1][1]) seq.push([6, 1]);
    return seq;
  }

  return { HOME, absOf, cnt, legalMoves, reachable, applyRaw, act, validate, pips, allHome, rollOff, initialPts, singleMoves, badBlock };
})();
if (typeof module !== 'undefined') module.exports = Engine;
