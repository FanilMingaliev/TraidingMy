// Расширение сетки в сторону найденной зависимости + шорт после разгона. Только DEV.
import { loadUniverse } from './features.js';
import { runRule, stats, line, windows } from './strat.js';

const uni = await loadUniverse(360);
const W = windows(180, 180);
const h1atr = (f, d, i) => (f.h1atrPct / 100) * d.candles[i].close;

const show = (name, rule) => {
  const s = stats(runRule(uni, rule, W.DEV), W.DEV);
  if (s.n >= 40) console.log(line(name, s));
};

console.log('ЛОНГ после пролива за час');
for (const k of [3, 3.5, 4]) {
  for (const sMult of [1.5, 2, 3]) {
    for (const [tName, targets] of [['1R', [[1, 100]]], ['1.5R', [[1.5, 100]]], ['0.7R/1.5R', [[0.7, 50], [1.5, 50]]]]) {
      for (const hold of [24, 48, 96]) {
        show('k=' + k + ' стоп ' + sMult + ' цель ' + tName + ' ' + hold * 5 + 'мин', (f, i, d) =>
          f.h1atrPct && f.r1h != null && f.r1h / f.h1atrPct <= -k
            ? { direction: 'LONG', stop: h1atr(f, d, i) * sMult, targets, hold }
            : null
        );
      }
    }
  }
}

console.log('\nШОРТ после разгона за час (зеркально)');
for (const k of [2.5, 3, 3.5, 4]) {
  for (const sMult of [1.5, 2, 3]) {
    for (const hold of [24, 48]) {
      show('час k=' + k + ' стоп ' + sMult + ' цель 1.5R ' + hold * 5 + 'мин', (f, i, d) =>
        f.h1atrPct && f.r1h != null && f.r1h / f.h1atrPct >= k
          ? { direction: 'SHORT', stop: h1atr(f, d, i) * sMult, targets: [[1.5, 100]], hold }
          : null
      );
    }
  }
}

console.log('\nШОРТ после разгона за 4 часа');
for (const k of [4, 5, 6, 8]) {
  for (const sMult of [1.5, 2, 3]) {
    for (const hold of [24, 48]) {
      show('4ч k=' + k + ' стоп ' + sMult + ' цель 1.5R ' + hold * 5 + 'мин', (f, i, d) =>
        f.h1atrPct && f.r4h != null && f.r4h / f.h1atrPct >= k
          ? { direction: 'SHORT', stop: h1atr(f, d, i) * sMult, targets: [[1.5, 100]], hold }
          : null
      );
    }
  }
}

console.log('\nЛОНГ после пролива за 4 часа');
for (const k of [4, 5, 6, 8]) {
  for (const sMult of [1.5, 2, 3]) {
    for (const hold of [24, 48]) {
      show('4ч k=' + k + ' стоп ' + sMult + ' цель 1.5R ' + hold * 5 + 'мин', (f, i, d) =>
        f.h1atrPct && f.r4h != null && f.r4h / f.h1atrPct <= -k
          ? { direction: 'LONG', stop: h1atr(f, d, i) * sMult, targets: [[1.5, 100]], hold }
          : null
      );
    }
  }
}
