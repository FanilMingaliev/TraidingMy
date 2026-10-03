/**
 * Проверка сетапа «Отскок после пролива» на длинной истории.
 *
 * Использует тот же код, что и приложение (core/replay.js): условие входа,
 * стоп, цели, выход по времени и фильтр формы. История — 5-минутные свечи Binance.
 *
 *   npm run validate                 # 720 дней, монеты из core/config.js
 *   npm run validate -- --days 360 --symbols BTCUSDT,ETHUSDT
 */
import { loadCandles, END, DAY } from './research/features.js';
import { replayFlush, summarizeTrades, applyHealthGate } from '../../core/replay.js';
import { COINS, SETUPS } from '../../core/config.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[argv[i].slice(2)] = true;
    else args[argv[i++].slice(2)] = next;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const days = Number(args.days || 720);
const symbols = args.symbols ? String(args.symbols).split(',') : COINS.map((c) => c.symbol);
const cfg = SETUPS.flush;

console.log('Сетап «' + cfg.name + '»: ' + symbols.length + ' монет, ' + days + ' дней до ' + new Date(END).toISOString().slice(0, 10));
console.log(
  'Вход: падение за час ≥ ' + cfg.tiers[0].depth + ' ATR(1ч). Стоп ' + cfg.stopAtrMultiplier + ' ATR(1ч), цели ' +
    cfg.targets.map(([r, s]) => r + 'R/' + s + '%').join(' и ') + ', до ' + cfg.maxHoldMinutes + ' мин. Комиссия 0.1% за круг.\n'
);

const all = [];
for (const symbol of symbols) {
  const candles = await loadCandles(symbol, days);
  all.push(...replayFlush(candles, { symbol }));
}
all.sort((a, b) => a.entryTime - b.entryTime);
const gated = applyHealthGate(all);

const start = END - days * DAY;
const QUARTER = 90 * DAY;
const pad = (v, w) => String(v).padStart(w);
const row = (label, trades) => {
  const s = summarizeTrades(trades);
  return label.padEnd(24) + pad(s.trades, 6) + pad(s.winRate + '%', 7) + pad((s.avgR > 0 ? '+' : '') + s.avgR.toFixed(2) + 'R', 9) + pad((s.totalR > 0 ? '+' : '') + s.totalR + 'R', 10);
};

for (const [title, trades] of [['Все сигналы, без фильтра формы', all], ['С фильтром формы (' + cfg.health.windowDays + ' дн., мин. ' + cfg.health.minTrades + ' сделок)', gated]]) {
  console.log(title);
  console.log(''.padEnd(24) + pad('сделок', 6) + pad('в плюс', 7) + pad('средняя', 9) + pad('итог', 10));
  for (let from = start; from < END; from += QUARTER) {
    const to = Math.min(END, from + QUARTER);
    const label = new Date(from).toISOString().slice(0, 10) + ' … ' + new Date(to).toISOString().slice(5, 10);
    console.log(row(label, trades.filter((t) => t.entryTime >= from && t.entryTime < to)));
  }
  console.log(row('ВСЕГО', trades));
  console.log('');
}

console.log('Ступени силы сигнала (все сигналы / с фильтром формы)');
cfg.tiers.forEach((tier, i) => {
  const upper = cfg.tiers[i + 1]?.depth ?? Infinity;
  const pick = (list) => list.filter((t) => t.depth >= tier.depth && t.depth < upper);
  console.log(row('глубина ' + tier.depth + (upper === Infinity ? '+' : '–' + upper), pick(all)) + '   |' + row('', pick(gated)).slice(24));
});

console.log('\nПо монетам (с фильтром формы)');
for (const symbol of symbols) console.log(row(symbol.replace('USDT', ''), gated.filter((t) => t.symbol === symbol)));
