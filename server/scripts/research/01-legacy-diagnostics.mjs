import { loadAll, report, basePick, runAll, PERIODS, summarize, fmt } from './research.js';

const all = await loadAll();
const day = (t) => new Date(t).toISOString().slice(0, 10);
console.log('A', PERIODS.A.map(day).join('…'), '| B', PERIODS.B.map(day).join('…'), '| C', PERIODS.C.map(day).join('…'));

const inv = (d) => (d === 'LONG' ? 'SHORT' : d === 'SHORT' ? 'LONG' : null);
report(all, 'база (45, режим)', { pick: basePick(45) });
report(all, 'база без режима', { pick: basePick(45, false) });
report(all, 'порог 28', { pick: basePick(28) });
report(all, 'порог 60', { pick: basePick(60) });
report(all, 'только лонг', { pick: (s) => (basePick(45)(s) === 'LONG' ? 'LONG' : null) });
report(all, 'только шорт', { pick: (s) => (basePick(45)(s) === 'SHORT' ? 'SHORT' : null) });
report(all, 'ИНВЕРСИЯ базы', { pick: (s) => inv(basePick(45)(s)) });
report(all, 'инверсия без режима', { pick: (s) => inv(basePick(45, false)(s)) });
report(all, 'база без комиссии', { pick: basePick(45), fee: 0 });

const tr = runAll(all, { pick: basePick(45) }, PERIODS.A);
const group = (name, keyFn) => {
  const g = {};
  for (const t of tr) {
    const k = keyFn(t);
    (g[k] = g[k] || []).push(t);
  }
  console.log('\n' + name);
  for (const k of Object.keys(g).sort()) console.log('  ' + String(k).padEnd(30) + fmt(summarize(g[k])));
};
group('направление × тренд 1ч', (t) => t.direction + ' / ' + t.sig.regime.trendDirection);
group('волатильность', (t) => t.sig.regime.volatilityState);
group('|счёт|', (t) => {
  const a = Math.abs(t.sig.score);
  return a < 50 ? '45-49' : a < 55 ? '50-54' : a < 62 ? '55-61' : '62+';
});
group('растянутость от EMA21, ATR', (t) => {
  const x = ((t.sig.price - t.sig.ind.ema21) / t.sig.ind.atr) * (t.direction === 'LONG' ? 1 : -1);
  return x < 1 ? '<1' : x < 2 ? '1-2' : x < 3 ? '2-3' : '3+';
});
group('RSI в сторону сделки', (t) => {
  const r = t.direction === 'LONG' ? t.sig.ind.rsi5m : 100 - t.sig.ind.rsi5m;
  return r < 55 ? '<55' : r < 65 ? '55-65' : r < 72 ? '65-72' : '72+';
});
group('выход', (t) => t.exitReason);
group('монета', (t) => t.symbol);
