// Перебор разворотных правил на последних 180 днях (DEV). Старшие 180 дней не трогаем.
import { loadUniverse } from './features.js';
import { runRule, stats, line, windows } from './strat.js';

const uni = await loadUniverse(360);
const W = windows(180, 180);

const h1atr = (f, d, i) => (f.h1atrPct / 100) * d.candles[i].close;

console.log('ЛОНГ после пролива: падение за час ≥ k × часовой ATR');
for (const k of [1.5, 2, 2.5, 3]) {
  for (const sMult of [0.75, 1, 1.5]) {
    for (const [tName, targets] of [['1R', [[1, 100]]], ['1.5R', [[1.5, 100]]], ['1R/2R', [[1, 50], [2, 50]]]]) {
      for (const hold of [12, 24, 48]) {
        const rule = (f, i, d) =>
          f.h1atrPct && f.r1h != null && f.r1h / f.h1atrPct <= -k
            ? { direction: 'LONG', stop: h1atr(f, d, i) * sMult, targets, hold }
            : null;
        const s = stats(runRule(uni, rule, W.DEV), W.DEV);
        if (s.n >= 60) console.log(line('k=' + k + ' стоп ' + sMult + 'ATR1ч цель ' + tName + ' ' + hold * 5 + 'мин', s));
      }
    }
  }
}
