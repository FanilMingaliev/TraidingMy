/**
 * Проверка правил досрочного выхода из сделки на истории.
 *
 * Вход везде один и тот же (текущие настройки), меняется только сопровождение:
 * выход при развороте сигнала, при потере перевеса, при каскаде ликвидаций.
 * Каждый вариант считается целиком и по четырём последовательным отрезкам —
 * правило годится, только если оно не хуже базового на большинстве из них.
 *
 *   npm run exits -- --days 14 --symbols BTCUSDT,ETHUSDT,SOLUSDT
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSignals, simulateSignals, summarize } from '../src/backtest.js';
import { loadKlines } from '../src/history.js';
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
const symbols = args.symbols ? String(args.symbols).split(',') : COINS.map((c) => c.symbol).slice(0, 6);
const days = Number(args.days || 14);
// --end-days-ago N сдвигает окно в прошлое: так правило проверяется на периоде, которого подбор не видел
const to = Date.now() - Number(args['end-days-ago'] || 0) * 86400000;
const from = to - days * 86400000;
const settings = { deposit: 1000, riskPercent: 1, leverage: 5 };
const pad = (v, w, right = true) => (right ? String(v).padStart(w) : String(v).padEnd(w));

console.log(
  'Правила выхода: ' + symbols.length + ' монет, ' + new Date(from).toISOString().slice(0, 10) +
    ' — ' + new Date(to).toISOString().slice(0, 10)
);
console.log('Расчёт сигналов на каждом баре…\n');

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

const off = { maxHoldMinutes: DEFAULTS.maxHoldMinutes, reverseScore: null, fadeScore: null, fadeAfterMinutes: 0, exitOnCascade: false };
const variants = [
  { name: 'без досрочного выхода', rules: off },
  { name: 'разворот до −45', rules: { ...off, reverseScore: 45 } },
  { name: 'разворот до −30', rules: { ...off, reverseScore: 30 } },
  { name: 'разворот до −15', rules: { ...off, reverseScore: 15 } },
  { name: 'разворот до 0', rules: { ...off, reverseScore: 0 } },
  { name: 'перевес < 10 после 15 мин', rules: { ...off, fadeScore: 10, fadeAfterMinutes: 15 } },
  { name: 'перевес < 10 после 30 мин', rules: { ...off, fadeScore: 10, fadeAfterMinutes: 30 } },
  { name: 'перевес < 20 после 30 мин', rules: { ...off, fadeScore: 20, fadeAfterMinutes: 30 } },
  { name: 'перевес < 20 после 60 мин', rules: { ...off, fadeScore: 20, fadeAfterMinutes: 60 } },
  { name: 'каскад ликвидаций', rules: { ...off, exitOnCascade: true } },
  { name: 'разворот −15 + каскад', rules: { ...off, reverseScore: 15, exitOnCascade: true } }
];

const FOLDS = 4;
const foldOf = (time) => Math.min(FOLDS - 1, Math.floor(((time - from) / (to - from)) * FOLDS));

function run(rules) {
  const trades = [];
  for (const data of collected) {
    trades.push(...simulateSignals({ symbol: data.symbol, candles: data.candles, signals: data.signals, exitRules: rules }));
  }
  const folds = Array.from({ length: FOLDS }, (_, f) => summarize(trades.filter((t) => foldOf(t.entryTime) === f)));
  const early = trades.filter((t) => !['stop', 'targets', 'time'].includes(t.exitCode));
  return { total: summarize(trades), folds, early: summarize(early), trades };
}

const results = variants.map((v) => ({ ...v, ...run(v.rules) }));
const base = results[0];

console.log('\n' + pad('правило', 28, false) + pad('сделок', 7) + pad('винрейт', 9) + pad('итог', 9) + pad('средняя', 9) +
  pad('просадка', 10) + pad('досрочно', 10) + pad('лучше базы', 12) + '   по отрезкам');
console.log('─'.repeat(128));
for (const r of results) {
  const better = r.folds.filter((f, i) => f.totalR > base.folds[i].totalR).length;
  console.log(
    pad(r.name, 28, false) + pad(r.total.trades, 7) + pad(r.total.winRate + '%', 9) + pad(r.total.totalR + 'R', 9) +
      pad(r.total.avgR + 'R', 9) + pad(r.total.maxDrawdownR + 'R', 10) + pad(r.early.trades, 10) +
      pad(r === base ? '—' : better + ' из ' + FOLDS, 12) +
      '   ' + r.folds.map((f) => (f.totalR >= 0 ? '+' : '') + f.totalR).join(' / ')
  );
}

console.log('\nБаза по направлениям: лонги ' + summarize(base.trades.filter((t) => t.direction === 'LONG')).totalR +
  'R, шорты ' + summarize(base.trades.filter((t) => t.direction === 'SHORT')).totalR + 'R');

const outFile = path.resolve(here, '../../data/exits-report.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(
  outFile,
  JSON.stringify(
    {
      period: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      symbols,
      results: results.map((r) => ({ name: r.name, rules: r.rules, total: r.total, folds: r.folds, early: r.early }))
    },
    null,
    2
  )
);
console.log('Отчёт сохранён: ' + outFile);
