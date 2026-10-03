// Предсказательная сила факторов: корреляция значения фактора с будущим движением цены.
import { loadAll, PERIODS } from './research.js';

const all = await loadAll();
const H = [6, 12, 24, 48];

function corr(xs, ys) {
  const n = xs.length;
  if (n < 50) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let c = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    c += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  return vx && vy ? c / Math.sqrt(vx * vy) : 0;
}

// Дополнительные признаки напрямую из свечей
function extra(candles, i) {
  const c = candles[i].close;
  const ret = (n) => (i - n >= 0 ? (c / candles[i - n].close - 1) * 100 : 0);
  let hi = -Infinity, lo = Infinity;
  for (let j = Math.max(0, i - 287); j <= i; j++) { hi = Math.max(hi, candles[j].high); lo = Math.min(lo, candles[j].low); }
  return {
    ret1h: ret(12), ret4h: ret(48), ret24h: ret(288),
    pos24h: hi > lo ? (c - lo) / (hi - lo) - 0.5 : 0
  };
}

const keys = new Set();
const rows = { A: [], B: [], C: [] };
for (const data of all) {
  for (const s of data.signals) {
    const p = Object.keys(PERIODS).find((k) => s.time >= PERIODS[k][0] && s.time < PERIODS[k][1]);
    if (!p) continue;
    const i = s.index;
    if (i + 48 >= data.candles.length) continue;
    const next = data.candles[i + 1].open;
    const f = { ...s.factors, SCORE: s.score / 100, ...extra(data.candles, i) };
    Object.keys(f).forEach((k) => keys.add(k));
    const fwd = H.map((h) => (data.candles[i + h].close / next - 1) * 10000); // б.п.
    rows[p].push({ f, fwd, tradeable: s.regime?.tradeable !== false });
  }
}

for (const hIdx of [1, 2, 3]) {
  console.log('\nГоризонт ' + H[hIdx] * 5 + ' мин — корреляция с будущим движением (A | B | C)');
  for (const k of keys) {
    const out = ['A', 'B', 'C'].map((p) => {
      const sub = rows[p].filter((r) => r.f[k] != null);
      const v = corr(sub.map((r) => r.f[k]), sub.map((r) => r.fwd[hIdx]));
      return v == null ? '   —  ' : (v >= 0 ? '+' : '') + v.toFixed(3);
    });
    const same = out.every((o) => o.startsWith('+')) || out.every((o) => o.startsWith('-'));
    console.log('  ' + k.padEnd(14) + out.join('  ') + (same ? '   ← знак устойчив' : ''));
  }
}

console.log('\nСреднее будущее движение (б.п.) по квантилям общего счёта, горизонт 2ч; комиссия = 10 б.п.');
for (const p of ['A', 'B', 'C']) {
  const sorted = [...rows[p]].sort((a, b) => a.f.SCORE - b.f.SCORE);
  const n = sorted.length;
  const q = (from, to) => {
    const sub = sorted.slice(Math.floor(n * from), Math.floor(n * to));
    return (sub.reduce((a, r) => a + r.fwd[2], 0) / sub.length).toFixed(1).padStart(7);
  };
  console.log('  ' + p + ': нижние 2% ' + q(0, 0.02) + ' | нижние 10% ' + q(0, 0.1) + ' | середина ' + q(0.4, 0.6) + ' | верхние 10% ' + q(0.9, 1) + ' | верхние 2% ' + q(0.98, 1) + '   (всего ' + n + ')');
}
