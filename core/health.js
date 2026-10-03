/**
 * Форма сетапа в текущем рынке: проигрываем его на последних неделях истории
 * по всем монетам и смотрим, в плюсе ли он. Считается прямо в приложении.
 */
import { getKlinesHistory } from './market.js';
import { replayFlush, healthOf } from './replay.js';
import { SETUPS } from './config.js';

const DAY = 86400000;

/**
 * @param {string[]} symbols
 * @param {number} [now]
 * @returns {Promise<{ verdict: 'good' | 'bad' | 'unknown', trades, winRate, avgR, totalR, days, computedAt, coins }>}
 */
export async function computeFlushHealth(symbols, now = Date.now()) {
  const { windowDays } = SETUPS.flush.health;
  // два дня запаса — на разгон часового ATR
  const from = now - (windowDays + 2) * DAY;
  const trades = [];
  let coins = 0;

  // По три монеты одновременно: быстрее, чем по одной, и без риска упереться в лимиты биржи
  const queue = [...symbols];
  const worker = async () => {
    while (queue.length) {
      const symbol = queue.shift();
      try {
        const candles = await getKlinesHistory(symbol, '5m', from, now);
        trades.push(...replayFlush(candles, { symbol, from: now - windowDays * DAY }));
        coins++;
      } catch {
        /* монета без истории просто не участвует */
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  return { ...healthOf(trades, now), computedAt: now, coins };
}
