// Проверка выбранного правила: на старших 180 днях (HOLD) и на других монетах.
import { loadUniverse, loadCandles, buildFeatures } from './features.js';
import { runRule, stats, line, windows } from './strat.js';

const W = windows(180, 180);
const h1atr = (f, d, i) => (f.h1atrPct / 100) * d.candles[i].close;
const flush = (k, sMult = 2, targets = [[1, 50], [1.5, 50]], hold = 48) => (f, i, d) =>
  f.h1atrPct && f.r1h != null && f.r1h / f.h1atrPct <= -k
    ? { direction: 'LONG', stop: h1atr(f, d, i) * sMult, targets, hold }
    : null;

const uni = await loadUniverse(360);

const OTHER = ['TRXUSDT', 'DOTUSDT', 'LTCUSDT', 'BCHUSDT', 'NEARUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'ATOMUSDT', 'UNIUSDT',
  'AAVEUSDT', 'FILUSDT', 'INJUSDT', 'TONUSDT', 'HBARUSDT', 'XLMUSDT', 'ETCUSDT', 'SEIUSDT', 'TIAUSDT', 'WLDUSDT', 'PEPEUSDT', 'ENAUSDT'];
const uni2 = [];
for (const symbol of OTHER) {
  try {
    const candles = await loadCandles(symbol, 360);
    if (candles.length < 90000) { console.error(symbol + ': истории мало (' + candles.length + ')'); continue; }
    uni2.push({ symbol, candles, features: buildFeatures(candles) });
  } catch (err) {
    console.error(symbol + ': ' + err.message);
  }
}
console.log('Вторая группа: ' + uni2.map((d) => d.symbol.replace('USDT', '')).join(' '));

for (const [uName, u] of [['10 монет', uni], ['другие ' + uni2.length, uni2]]) {
  for (const wName of ['DEV', 'HOLD']) {
    console.log('\n=== ' + uName + ' / ' + (wName === 'DEV' ? 'последние 180 дней (на них подбиралось)' : 'предыдущие 180 дней (не использовались)'));
    for (const k of [2.5, 3, 3.5, 4]) {
      console.log(line('пролив k=' + k + ' стоп 2 цели 1R/1.5R 4ч', stats(runRule(u, flush(k), W[wName]), W[wName])));
    }
    console.log(line('k=3, комиссия+проскальзывание 0.2%', stats(runRule(u, flush(3), W[wName], 0.2), W[wName])));
    console.log(line('k=3 стоп 1.5', stats(runRule(u, flush(3, 1.5), W[wName]), W[wName])));
    console.log(line('k=3 стоп 3', stats(runRule(u, flush(3, 3), W[wName]), W[wName])));
    console.log(line('k=3 цель 1.5R целиком', stats(runRule(u, flush(3, 2, [[1.5, 100]]), W[wName]), W[wName])));
    console.log(line('k=3 удержание 2ч', stats(runRule(u, flush(3, 2, [[1, 50], [1.5, 50]], 24), W[wName]), W[wName])));
  }
}

// Разбивка базового правила по монетам на всей истории
const WHOLE = [W.HOLD[0], W.DEV[1]];
console.log('\nПо монетам, k=3, вся история 360 дней');
for (const d of [...uni, ...uni2]) {
  const s = stats(runRule([d], flush(3), WHOLE), WHOLE);
  console.log('  ' + d.symbol.replace('USDT', '').padEnd(6) + String(s.n).padStart(4) + ' сд ' + (s.win.toFixed(0) + '%').padStart(4) + ' ср ' + (s.avgR >= 0 ? '+' : '') + s.avgR.toFixed(2) + 'R итог ' + s.totalR.toFixed(1) + 'R');
}
