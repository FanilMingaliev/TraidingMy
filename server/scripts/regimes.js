/**
 * Разбор результатов по состояниям рынка.
 *
 * Каждый бар истории размечается признаками режима (тренд/боковик,
 * сжатие/норма/всплеск волатильности, синхронность рынка), затем сделки
 * группируются по этим состояниям. Состояние считается пригодным для торговли,
 * только если оно в плюсе на большинстве отрезков периода, а не в среднем.
 *
 *   npm run regimes -- --days 7
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSignals, simulateSignals, summarize } from '../src/backtest.js';
import { loadKlines } from '../src/history.js';
import { computeBreadth } from '../../core/regime.js';
import { COINS, DEFAULTS } from '../../core/config.js';

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
const symbols = args.symbols ? String(args.symbols).split(',') : COINS.map((c) => c.symbol);
const days = Number(args.days || 7);
const settings = { deposit: 1000, riskPercent: 1, leverage: 5 };
const config = {
  minScore: Number(args['min-score'] || DEFAULTS.minScoreToTrade),
  minConfidence: Number(args['min-confidence'] || 0),
  moveToBreakeven: false,
  maxHoldBars: Math.round((DEFAULTS.maxHoldMinutes || 120) / 5)
};

const to = Date.now();
const from = to - days * 86400000;
const pad = (v, w, right = true) => (right ? String(v).padStart(w) : String(v).padEnd(w));

console.log('Разбор по состояниям рынка: ' + symbols.length + ' монет, ' + days + ' дн');
console.log('Правила входа: ' + JSON.stringify(config));
console.log('');

// Шаг 1. Свечи всех монет — из них строится синхронность рынка
const warmupFrom = from - 300 * 3600000 - 300000;
const candlesBySymbol = new Map();
for (const symbol of symbols) {
  candlesBySymbol.set(symbol, await loadKlines(symbol, '5m', warmupFrom, to));
}
const benchmarkCandles = candlesBySymbol.get('BTCUSDT');

// Синхронность: доля растущих за час минус доля падающих, по всем монетам сразу
const breadthMap = new Map();
{
  const indexBySymbol = new Map();
  for (const [symbol, candles] of candlesBySymbol) {
    const map = new Map();
    candles.forEach((c, i) => map.set(c.time, i));
    indexBySymbol.set(symbol, map);
  }
  const times = benchmarkCandles.map((c) => c.time);
  for (const time of times) {
    const changes = [];
    for (const [symbol, candles] of candlesBySymbol) {
      const idx = indexBySymbol.get(symbol).get(time);
      if (idx == null || idx < 12) continue;
      const now = candles[idx].close;
      const before = candles[idx - 12].close;
      if (before) changes.push(((now - before) / before) * 100);
    }
    const value = computeBreadth(changes);
    if (value != null) breadthMap.set(time, value);
  }
}
console.log('Синхронность рынка посчитана на ' + breadthMap.size + ' моментах времени');
console.log('');

// Шаг 2. Сигналы с разметкой режима
const breadthAt = (time) => breadthMap.get(time) ?? null;
const allTrades = [];
for (const symbol of symbols) {
  const started = Date.now();
  const data = await collectSignals({
    symbol,
    from,
    to,
    settings,
    benchmarkCandles: symbol === 'BTCUSDT' ? null : benchmarkCandles,
    breadthAt
  });
  const trades = simulateSignals({ ...config, symbol, candles: data.candles, signals: data.signals });
  allTrades.push(...trades);
  console.log(
    '  ' + pad(symbol.replace('USDT', ''), 6, false) + pad(trades.length, 5) + ' сделок за ' +
      ((Date.now() - started) / 1000).toFixed(1) + ' с'
  );
}

console.log('');
console.log('Всего сделок: ' + allTrades.length);

// Шаг 3. Группировка по состояниям с проверкой на четырёх отрезках
const FOLDS = 4;
const foldOf = (time) => Math.min(FOLDS - 1, Math.floor(((time - from) / (to - from)) * FOLDS));

function report(title, keyFn) {
  const groups = new Map();
  for (const trade of allTrades) {
    const key = keyFn(trade);
    if (key == null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trade);
  }

  console.log('');
  console.log(title);
  console.log(
    pad('состояние', 22, false) + pad('сделок', 8) + pad('винрейт', 9) + pad('итог', 10) +
      pad('средняя', 9) + pad('плюс.отр.', 11) + '  по отрезкам'
  );
  console.log('─'.repeat(96));

  const rows = [];
  for (const [key, trades] of groups) {
    const stats = summarize(trades);
    const folds = [];
    for (let f = 0; f < FOLDS; f++) {
      const subset = trades.filter((t) => foldOf(t.entryTime) === f);
      folds.push(subset.length ? Number(subset.reduce((a, t) => a + t.resultR, 0).toFixed(1)) : null);
    }
    const positive = folds.filter((v) => v != null && v > 0).length;
    const withData = folds.filter((v) => v != null).length;
    rows.push({ key, stats, folds, positive, withData });
  }

  rows.sort((a, b) => b.stats.avgR - a.stats.avgR);
  for (const row of rows) {
    if (row.stats.trades < 8) continue;
    console.log(
      pad(row.key, 22, false) + pad(row.stats.trades, 8) + pad(row.stats.winRate + '%', 9) +
        pad(row.stats.totalR + 'R', 10) + pad(row.stats.avgR + 'R', 9) +
        pad(row.positive + ' из ' + row.withData, 11) + '  ' +
        row.folds.map((v) => (v == null ? '—' : (v > 0 ? '+' : '') + v)).join(' / ')
    );
  }
  return rows;
}

const byLabel = report('Тренд и волатильность:', (t) => t.regime?.label || null);
const byAlignment = report('Синхронность рынка:', (t) => t.regime?.alignmentState || null);
const byDirectionTrend = report(
  'Направление сделки против часового тренда:',
  (t) => {
    if (!t.regime || t.regime.trendDirection === 'плоский') return 'тренд плоский';
    const along =
      (t.direction === 'LONG' && t.regime.trendDirection === 'вверх') ||
      (t.direction === 'SHORT' && t.regime.trendDirection === 'вниз');
    return along ? 'по тренду' : 'против тренда';
  }
);

// Шаг 4. Какие состояния держатся в плюсе на большинстве отрезков
const candidates = byLabel.filter((r) => r.stats.trades >= 12 && r.positive >= Math.ceil(r.withData * 0.75));
console.log('');
if (candidates.length) {
  console.log('Состояния, устойчиво прибыльные (в плюсе минимум на 3/4 отрезков с данными):');
  for (const row of candidates) {
    console.log(
      '  ' + row.key + ' — ' + row.stats.trades + ' сделок, средняя ' + row.stats.avgR + 'R, итог ' + row.stats.totalR + 'R'
    );
  }
} else {
  console.log('Устойчиво прибыльных состояний не найдено — торговый фильтр по режиму пока не обоснован.');
}

const outFile = path.resolve(here, '../../data/regime-report.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(
  outFile,
  JSON.stringify(
    {
      period: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      symbols,
      config,
      byLabel,
      byAlignment,
      byDirectionTrend,
      candidates: candidates.map((c) => c.key)
    },
    null,
    2
  )
);
console.log('');
console.log('Отчёт сохранён: ' + outFile);
