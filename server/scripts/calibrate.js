/**
 * Калибровка параметров стратегии на истории.
 *
 * Сигналы считаются один раз, затем поверх них перебираются пороги входа,
 * фильтры и правила сопровождения сделки. Веса факторов проверяются отдельно
 * методом отключения: каждый фактор по очереди обнуляется, и видно, что он
 * добавляет к результату, а что отнимает.
 *
 *   npm run calibrate -- --days 7 --symbols BTCUSDT,ETHUSDT,SOLUSDT
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSignals, simulateSignals, summarize } from '../src/backtest.js';
import { loadKlines } from '../src/history.js';
import { COINS, WEIGHTS } from '../../core/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const symbols = args.symbols ? String(args.symbols).split(',') : COINS.map((c) => c.symbol).slice(0, 6);
const days = Number(args.days || 7);
const settings = { deposit: 1000, riskPercent: 1, leverage: 5 };

const to = Date.now();
const from = to - days * 86400000;
const pad = (v, w, right = true) => (right ? String(v).padStart(w) : String(v).padEnd(w));

console.log('Калибровка: ' + symbols.length + ' монет, ' + days + ' дн');
console.log('Шаг 1 — расчёт сигналов на каждом баре (это самая долгая часть)\n');

const benchmarkCandles = await loadKlines('BTCUSDT', '5m', from - 300 * 3600000 - 300000, to);

const collected = [];
for (const symbol of symbols) {
  const started = Date.now();
  const data = await collectSignals({
    symbol,
    from,
    to,
    settings,
    benchmarkCandles: symbol === 'BTCUSDT' ? null : benchmarkCandles
  });
  collected.push(data);
  console.log(
    '  ' + pad(symbol.replace('USDT', ''), 6, false) + pad(data.signals.length, 6) + ' баров за ' +
      ((Date.now() - started) / 1000).toFixed(1) + ' с'
  );
}

/**
 * Прогон одной конфигурации по всем монетам.
 * @param {object} config параметры входа и сопровождения
 * @param {[number, number]} [window] окно времени [от, до] — для проверки вне выборки
 */
function evaluateConfig(config, window = null) {
  const trades = [];
  for (const data of collected) {
    const signals = window
      ? data.signals.filter((sig) => sig.time >= window[0] && sig.time < window[1])
      : data.signals;
    trades.push(...simulateSignals({ ...config, symbol: data.symbol, candles: data.candles, signals }));
  }
  return { ...summarize(trades), config };
}

console.log('\nШаг 2 — перебор параметров входа и сопровождения\n');

const grid = [];
for (const minScore of [28, 35, 45, 55]) {
  for (const minConfidence of [0, 40, 50, 60]) {
    for (const moveToBreakeven of [true, false]) {
      for (const maxHoldBars of [24, 48]) {
        grid.push({ minScore, minConfidence, moveToBreakeven, maxHoldBars });
      }
    }
  }
}

const results = grid.map(evaluateConfig).filter((r) => r.trades >= 20);
results.sort((a, b) => b.totalR - a.totalR);

const header =
  pad('порог', 7) + pad('увер.', 7) + pad('б/у', 6) + pad('баров', 7) +
  pad('сделок', 8) + pad('винрейт', 9) + pad('итог', 10) + pad('средняя', 9) + pad('PF', 7);
console.log(header);
console.log('─'.repeat(header.length));
for (const r of results.slice(0, 12)) {
  console.log(
    pad(r.config.minScore, 7) + pad(r.config.minConfidence, 7) +
      pad(r.config.moveToBreakeven ? 'да' : 'нет', 6) + pad(r.config.maxHoldBars, 7) +
      pad(r.trades, 8) + pad(r.winRate + '%', 9) + pad(r.totalR + 'R', 10) +
      pad(r.avgR + 'R', 9) + pad(r.profitFactor, 7)
  );
}

const best = results[0];
const baseline = evaluateConfig({ minScore: 28, minConfidence: 0, moveToBreakeven: true, maxHoldBars: 48 });

console.log('\nТекущая настройка: ' + baseline.totalR + 'R (' + baseline.trades + ' сделок, средняя ' + baseline.avgR + 'R)');
if (best) {
  console.log('Лучшая найденная:  ' + best.totalR + 'R (' + best.trades + ' сделок, средняя ' + best.avgR + 'R)');
  console.log('Параметры: ' + JSON.stringify(best.config));
}

// Проверка вне выборки: параметры подбираются на первых 60% периода,
// а результат считается на оставшихся 40%, которых подбор не видел.
// Без этого шага любая калибровка — просто подгонка под прошлое.
const splitTime = from + (to - from) * 0.6;
const trainWindow = [from, splitTime];
const testWindow = [splitTime, to];

const trainResults = grid
  .map((config) => ({ config, metrics: evaluateConfig(config, trainWindow) }))
  .filter((r) => r.metrics.trades >= 15)
  .sort((a, b) => b.metrics.totalR - a.metrics.totalR);

console.log('\nШаг 2.5 — проверка вне выборки');
console.log('  обучение: ' + new Date(from).toISOString().slice(0, 16) + ' — ' + new Date(splitTime).toISOString().slice(0, 16));
console.log('  проверка: ' + new Date(splitTime).toISOString().slice(0, 16) + ' — ' + new Date(to).toISOString().slice(0, 16) + '\n');

if (trainResults.length) {
  const chosen = trainResults[0].config;
  const onTrain = trainResults[0].metrics;
  const onTest = evaluateConfig(chosen, testWindow);
  const baselineTest = evaluateConfig(
    { minScore: 28, minConfidence: 0, moveToBreakeven: true, maxHoldBars: 48 },
    testWindow
  );
  console.log('  выбрано на обучении: ' + JSON.stringify(chosen));
  console.log(
    '  на обучении: ' + pad(onTrain.totalR + 'R', 9) + ' (' + onTrain.trades + ' сделок, средняя ' + onTrain.avgR + 'R)'
  );
  console.log(
    '  ВНЕ ВЫБОРКИ: ' + pad(onTest.totalR + 'R', 9) + ' (' + onTest.trades + ' сделок, средняя ' + onTest.avgR + 'R, PF ' + onTest.profitFactor + ')'
  );
  console.log(
    '  текущие настройки на том же отрезке: ' + baselineTest.totalR + 'R (' + baselineTest.trades + ' сделок, средняя ' + baselineTest.avgR + 'R)'
  );
  console.log(
    onTest.totalR > 0 && onTest.totalR > baselineTest.totalR
      ? '  → параметры подтвердились на данных, которых подбор не видел'
      : '  → вне выборки преимущество не подтвердилось: это была подгонка'
  );
}

// Шаг 2.6 — устойчивость по времени.
// Период делится на четыре последовательных отрезка, и конфигурация считается
// пригодной, только если она в плюсе на большинстве из них. Одиночный удачный
// отрезок ничего не доказывает: рынок меняет режим.
const FOLDS = 4;
const foldWindows = [];
for (let f = 0; f < FOLDS; f++) {
  foldWindows.push([from + ((to - from) * f) / FOLDS, from + ((to - from) * (f + 1)) / FOLDS]);
}

const stability = grid.map((config) => {
  const folds = foldWindows.map((w) => evaluateConfig(config, w));
  const positive = folds.filter((m) => m.totalR > 0).length;
  const totalTrades = folds.reduce((acc, m) => acc + m.trades, 0);
  const totalR = folds.reduce((acc, m) => acc + m.totalR, 0);
  const worst = Math.min(...folds.map((m) => m.totalR));
  return { config, folds, positive, totalTrades, totalR: Number(totalR.toFixed(2)), worst: Number(worst.toFixed(2)) };
});

const stable = stability
  .filter((r) => r.totalTrades >= 40)
  .sort((a, b) => b.positive - a.positive || b.worst - a.worst);

console.log('');
console.log('Шаг 2.6 — устойчивость по четырём отрезкам периода');
console.log('');
console.log(
  pad('порог', 7) + pad('увер.', 7) + pad('б/у', 6) + pad('баров', 7) +
    pad('сделок', 8) + pad('плюсовых', 10) + pad('итог', 10) + pad('худший', 9) +
    '   по отрезкам'
);
console.log('─'.repeat(96));
for (const r of stable.slice(0, 10)) {
  console.log(
    pad(r.config.minScore, 7) + pad(r.config.minConfidence, 7) +
      pad(r.config.moveToBreakeven ? 'да' : 'нет', 6) + pad(r.config.maxHoldBars, 7) +
      pad(r.totalTrades, 8) + pad(r.positive + ' из ' + FOLDS, 10) +
      pad(r.totalR + 'R', 10) + pad(r.worst + 'R', 9) +
      '   ' + r.folds.map((m) => (m.totalR >= 0 ? '+' : '') + m.totalR).join(' / ')
  );
}

const robust = stable.filter((r) => r.positive >= 3);
console.log('');
console.log(
  robust.length
    ? 'Устойчивых конфигураций (в плюсе минимум на 3 отрезках из 4): ' + robust.length
    : 'НИ ОДНА конфигурация не держится в плюсе на 3 отрезках из 4 — доказанного преимущества у стратегии нет.'
);

// Шаг 3 — вклад отдельных факторов.
// Сигналы пересчитывать не нужно: смотрим, как результат зависит от знака фактора
// в сделках, которые реально открылись при лучшей конфигурации.
console.log('\nШаг 3 — какие факторы помогали, а какие мешали\n');

const bestTrades = [];
for (const data of collected) {
  bestTrades.push(
    ...simulateSignals({ ...(best?.config || {}), symbol: data.symbol, candles: data.candles, signals: data.signals })
  );
}

const factorRows = [];
for (const key of Object.keys(WEIGHTS)) {
  const aligned = bestTrades.filter((t) => {
    const score = t.factors?.[key];
    if (score == null || Math.abs(score) < 0.1) return false;
    return t.direction === 'LONG' ? score > 0 : score < 0;
  });
  const against = bestTrades.filter((t) => {
    const score = t.factors?.[key];
    if (score == null || Math.abs(score) < 0.1) return false;
    return t.direction === 'LONG' ? score < 0 : score > 0;
  });
  if (aligned.length < 5 && against.length < 5) continue;
  const avg = (list) => (list.length ? list.reduce((a, t) => a + t.resultR, 0) / list.length : null);
  factorRows.push({
    key,
    weight: WEIGHTS[key],
    alignedCount: aligned.length,
    alignedAvgR: avg(aligned),
    againstCount: against.length,
    againstAvgR: avg(against)
  });
}

factorRows.sort((a, b) => (b.alignedAvgR ?? -9) - (a.alignedAvgR ?? -9));
console.log(
  pad('фактор', 16, false) + pad('вес', 6) + pad('за сигнал', 12) + pad('средняя', 10) +
    pad('против', 9) + pad('средняя', 10) + pad('разница', 10)
);
console.log('─'.repeat(73));
for (const row of factorRows) {
  const diff =
    row.alignedAvgR != null && row.againstAvgR != null
      ? (row.alignedAvgR - row.againstAvgR).toFixed(3)
      : '—';
  console.log(
    pad(row.key, 16, false) + pad(row.weight, 6) + pad(row.alignedCount, 12) +
      pad(row.alignedAvgR == null ? '—' : row.alignedAvgR.toFixed(3) + 'R', 10) +
      pad(row.againstCount, 9) +
      pad(row.againstAvgR == null ? '—' : row.againstAvgR.toFixed(3) + 'R', 10) +
      pad(diff, 10)
  );
}
console.log(
  '\nРазница > 0 означает, что сделки по направлению фактора шли лучше, чем против него,\n' +
    'то есть вес фактора оправдан. Отрицательная разница — кандидат на снижение веса.'
);

const outFile = path.resolve(here, '../../data/calibration-report.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(
  outFile,
  JSON.stringify(
    { period: { from: new Date(from).toISOString(), to: new Date(to).toISOString() }, symbols, baseline, best, results: results.slice(0, 20), factorRows },
    null,
    2
  )
);
console.log('\nОтчёт сохранён: ' + outFile);
