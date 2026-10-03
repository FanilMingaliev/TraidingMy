/**
 * Исследовательский стенд: считает сигналы один раз (с кэшем на диске) и даёт
 * проверять варианты входа и фильтров на трёх непересекающихся периодах.
 *
 *   A — поиск:    от −28 до −7 дней
 *   B — проверка: последние 7 дней
 *   C — проверка: от −56 до −28 дней (без истории фьючерсов — её там уже нет)
 *
 * Правило честности: гипотезы выбираются по A, а B и C только подтверждают или опровергают.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSignals, summarize } from '../../src/backtest.js';
import { loadKlines } from '../../src/history.js';
import { simulateTrade } from '../../../core/simulate.js';
import { COINS, DEFAULTS } from '../../../core/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.resolve(here, '../../../data/research');
fs.mkdirSync(CACHE, { recursive: true });

const DAY = 86400000;
const END = Math.floor(Date.now() / DAY) * DAY; // полночь UTC — кэш стабилен в течение дня
export const PERIODS = {
  A: [END - 28 * DAY, END - 7 * DAY],
  B: [END - 7 * DAY, END],
  C: [END - 56 * DAY, END - 28 * DAY]
};
const settings = { deposit: 1000, riskPercent: 1, leverage: 5 };

export async function loadAll(symbols = COINS.map((c) => c.symbol), tag = '') {
  const from = PERIODS.C[0];
  const benchmark = await loadKlines('BTCUSDT', '5m', from - 300 * 3600000 - 300000, END);
  const out = [];
  for (const symbol of symbols) {
    const file = path.join(CACHE, 'sig_' + END + '_' + symbol + tag + '.json');
    if (fs.existsSync(file)) {
      out.push(JSON.parse(fs.readFileSync(file, 'utf8')));
      continue;
    }
    const started = Date.now();
    const data = await collectSignals({
      symbol,
      from,
      to: END,
      settings,
      benchmarkCandles: symbol === 'BTCUSDT' ? null : benchmark
    });
    fs.writeFileSync(file, JSON.stringify(data));
    console.error('  ' + symbol + ' ' + data.signals.length + ' баров, ' + ((Date.now() - started) / 1000).toFixed(0) + ' с');
    out.push(data);
  }
  return out;
}

/**
 * Универсальная симуляция.
 * @param {object} data   { symbol, candles, signals }
 * @param {object} cfg
 *   pick(signal, data) → 'LONG' | 'SHORT' | null   правило входа
 *   entry: 'market' | { limit(signal, direction) → price, validBars }
 *   stop(signal, direction, entry) → дистанция стопа (по умолчанию из плана)
 *   targets: [[R, доля%], …]
 *   maxHoldBars, moveToBreakeven, fee
 */
export function simulate(data, cfg, window) {
  const { candles, signals } = data;
  const trades = [];
  let busyUntil = -1;
  const targetsCfg = cfg.targets || [[1, 50], [1.8, 30], [3, 20]];
  const fee = cfg.fee ?? DEFAULTS.feePercentRoundTrip;

  for (const sig of signals) {
    if (sig.time < window[0] || sig.time >= window[1]) continue;
    if (sig.index <= busyUntil) continue;
    const direction = cfg.pick(sig, data);
    if (!direction) continue;
    const isLong = direction === 'LONG';

    let fillIndex = sig.index + 1;
    let entry;
    if (!cfg.entry || cfg.entry === 'market') {
      if (!candles[fillIndex]) break;
      entry = candles[fillIndex].open;
    } else {
      const limit = cfg.entry.limit(sig, direction);
      if (limit == null) continue;
      let filled = false;
      for (let j = sig.index + 1; j <= sig.index + cfg.entry.validBars && j < candles.length; j++) {
        const bar = candles[j];
        if (isLong ? bar.low <= limit : bar.high >= limit) {
          // Гэп через уровень исполняется по открытию
          entry = isLong ? Math.min(limit, bar.open) : Math.max(limit, bar.open);
          fillIndex = j;
          filled = true;
          break;
        }
      }
      if (!filled) continue;
    }

    const stopDistance = cfg.stop ? cfg.stop(sig, direction, entry) : sig.stopDistance;
    if (!stopDistance) continue;
    const trade = simulateTrade({
      trade: {
        symbol: data.symbol,
        direction,
        entryTime: candles[fillIndex].time,
        entry,
        stopLoss: isLong ? entry - stopDistance : entry + stopDistance,
        targets: targetsCfg.map(([r, share], i) => ({
          label: 'TP' + (i + 1),
          closeShare: share,
          price: isLong ? entry + stopDistance * r : entry - stopDistance * r
        })),
        sig
      },
      candles,
      startIndex: fillIndex,
      maxHoldBars: cfg.maxHoldBars || 24,
      feePercent: fee,
      moveToBreakeven: Boolean(cfg.moveToBreakeven),
      exitSignal: cfg.exitSignal ? (i, held) => cfg.exitSignal(data, i, held, direction) : null
    });
    if (trade) {
      trades.push(trade);
      busyUntil = fillIndex + trade.barsHeld - 1;
    }
  }
  return trades;
}

export function runAll(all, cfg, window) {
  const trades = [];
  for (const data of all) trades.push(...simulate(data, cfg, window));
  return trades;
}

export const fmt = (m) =>
  String(m.trades).padStart(5) + ' сд ' + String(m.winRate + '%').padStart(6) + ' ' +
  String(m.totalR + 'R').padStart(9) + ' ср ' + String(m.avgR + 'R').padStart(8);

export function report(all, name, cfg) {
  const line = ['A', 'B', 'C'].map((p) => p + ':' + fmt(summarize(runAll(all, cfg, PERIODS[p])))).join(' | ');
  console.log(name.padEnd(32) + line);
}

export const basePick = (minScore = 45, regime = true) => (s) => {
  const d = s.score >= minScore ? 'LONG' : s.score <= -minScore ? 'SHORT' : null;
  if (!d) return null;
  if (regime && s.regime && s.regime.tradeable === false) return null;
  return d;
};

export { summarize };
