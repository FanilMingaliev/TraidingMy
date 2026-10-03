/**
 * Запуск бэктеста из командной строки.
 *
 * Примеры:
 *   npm run backtest
 *   npm run backtest -- --days 14 --symbols BTCUSDT,ETHUSDT --min-score 35
 *   npm run backtest -- --no-breakeven --min-confidence 45 --save отчёт.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBacktest } from '../src/backtest.js';
import { COINS } from '../../core/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const symbols = args.symbols ? String(args.symbols).split(',') : COINS.map((c) => c.symbol);
const days = Number(args.days || 7);

const options = {
  symbols,
  days,
  minConfidence: Number(args['min-confidence'] || 0),
  maxHoldBars: Number(args['max-hold'] || 24),
  useDerivatives: !args['no-derivatives'],
  // По умолчанию стоп в безубыток не переносим — на истории это ухудшало результат
  moveToBreakeven: Boolean(args.breakeven),
  minScore: args['min-score'] ? Number(args['min-score']) : undefined,
  targetRs: args.targets ? String(args.targets).split(',').map(Number) : null
};

const pad = (value, width, right = true) =>
  right ? String(value).padStart(width) : String(value).padEnd(width);

console.log(
  'Бэктест: ' + symbols.length + ' монет, ' + days + ' дн, ' +
    'порог ' + (options.minScore ?? 'по умолчанию') +
    ', уверенность ≥ ' + options.minConfidence +
    ', безубыток после TP1: ' + (options.moveToBreakeven ? 'да' : 'нет') +
    ', фильтр режима: включён'
);
console.log('Загрузка истории и прогон…\n');

const started = Date.now();
const report = await runBacktest({
  ...options,
  onSymbolDone: (symbol, stats) =>
    console.log(
      '  ' + pad(symbol.replace('USDT', ''), 6, false) +
        ' сделок ' + pad(stats.trades, 4) +
        ' | винрейт ' + pad(stats.winRate + '%', 7) +
        ' | итог ' + pad(stats.totalR + 'R', 9) +
        ' | средняя ' + pad(stats.avgR + 'R', 8)
    )
});

const line = (label, m) =>
  pad(label, 10, false) +
  pad(m.trades, 7) +
  pad(m.winRate + '%', 9) +
  pad(m.totalR + 'R', 10) +
  pad(m.avgR + 'R', 9) +
  pad(m.profitFactor, 8) +
  pad(m.maxDrawdownR + 'R', 10) +
  pad(m.avgBarsHeld, 8);

console.log('\n' + '─'.repeat(72));
console.log(
  pad('', 10, false) + pad('сделок', 7) + pad('винрейт', 9) + pad('итог', 10) +
    pad('средняя', 9) + pad('PF', 8) + pad('просадка', 10) + pad('баров', 8)
);
console.log('─'.repeat(72));
console.log(line('ВСЕГО', report.total));
console.log(line('лонги', report.byDirection.LONG));
console.log(line('шорты', report.byDirection.SHORT));
console.log('─'.repeat(72));

// Разбивка по причинам выхода
const reasons = {};
for (const trade of report.trades) {
  reasons[trade.exitReason] = reasons[trade.exitReason] || { count: 0, totalR: 0 };
  reasons[trade.exitReason].count++;
  reasons[trade.exitReason].totalR += trade.resultR;
}
console.log('\nПричины выхода:');
for (const [reason, data] of Object.entries(reasons).sort((a, b) => b[1].count - a[1].count)) {
  console.log(
    '  ' + pad(reason, 32, false) + pad(data.count, 5) + ' сделок, итог ' +
      pad(data.totalR.toFixed(2) + 'R', 10)
  );
}

// Насколько уверенность сигнала связана с результатом
const buckets = [
  { label: '0–34', min: 0, max: 34 },
  { label: '35–49', min: 35, max: 49 },
  { label: '50–64', min: 50, max: 64 },
  { label: '65+', min: 65, max: 200 }
];
console.log('\nРезультат по уверенности сигнала:');
for (const bucket of buckets) {
  const subset = report.trades.filter(
    (t) => t.confidence >= bucket.min && t.confidence <= bucket.max
  );
  if (!subset.length) continue;
  const totalR = subset.reduce((acc, t) => acc + t.resultR, 0);
  const wins = subset.filter((t) => t.resultR > 0).length;
  console.log(
    '  ' + pad(bucket.label, 8, false) + pad(subset.length, 5) + ' сделок' +
      ' | винрейт ' + pad(((wins / subset.length) * 100).toFixed(1) + '%', 7) +
      ' | средняя ' + pad((totalR / subset.length).toFixed(3) + 'R', 9)
  );
}

console.log('\nВремя прогона: ' + ((Date.now() - started) / 1000).toFixed(1) + ' с');

const outFile = args.save
  ? path.resolve(process.cwd(), String(args.save))
  : path.resolve(here, '../../data/backtest-report.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log('Отчёт сохранён: ' + outFile);
