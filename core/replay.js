/**
 * Проигрывание сетапа по истории свечей. Один и тот же код:
 *  - проверяет сетап на длинной истории (npm run validate);
 *  - считает «форму» сетапа за последние недели прямо в приложении, чтобы было
 *    видно, работает ли он в текущем рынке.
 */
import { atr } from './indicators.js';
import { simulateTrade } from './simulate.js';
import { SETUPS, DEFAULTS } from './config.js';

const MS_5M = 300000;
const MS_1H = 3600000;

/** Часовые бары из пятиминуток + для каждого 5м-бара индекс последнего ЗАКРЫТОГО часового. */
function aggregateHours(candles) {
  const bars = [];
  const closedIndex = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const bucket = Math.floor(c.time / MS_1H) * MS_1H;
    const tail = bars[bars.length - 1];
    if (!tail || tail.time !== bucket) {
      bars.push({ time: bucket, open: c.open, high: c.high, low: c.low, close: c.close });
    } else {
      tail.high = Math.max(tail.high, c.high);
      tail.low = Math.min(tail.low, c.low);
      tail.close = c.close;
    }
    closedIndex[i] = c.time + MS_5M >= bucket + MS_1H ? bars.length - 1 : bars.length - 2;
  }
  return { bars, closedIndex };
}

/**
 * Глубина пролива на закрытии каждого 5м-бара (в часовых ATR) и сам часовой ATR.
 * Считается только по прошлому: то же, что detectFlush видит вживую.
 */
export function flushSeries(candles) {
  const { bars, closedIndex } = aggregateHours(candles);
  const atr1h = atr(bars, 14);
  const depth = new Array(candles.length).fill(null);
  const atrAt = new Array(candles.length).fill(null);
  for (let i = 12; i < candles.length; i++) {
    const h = closedIndex[i];
    // как и вживую, нужно минимум 30 закрытых часовых баров
    if (h < 29 || atr1h[h] == null) continue;
    const close = candles[i].close;
    const change = close / candles[i - 12].close - 1;
    depth[i] = -change / (atr1h[h] / close);
    atrAt[i] = atr1h[h];
  }
  return { depth, atr1h: atrAt };
}

/**
 * Все сделки сетапа «Отскок после пролива» на отрезке истории.
 * Вход — по открытию следующего бара; одна сделка на монету одновременно.
 */
export function replayFlush(candles, { symbol = '', from = 0, to = Infinity, minDepth = null, cfg = SETUPS.flush, fee = DEFAULTS.feePercentRoundTrip } = {}) {
  const threshold = minDepth ?? cfg.tiers[0].depth;
  const { depth, atr1h } = flushSeries(candles);
  const trades = [];
  let busyUntil = -1;
  for (let i = 0; i < candles.length - 2; i++) {
    const time = candles[i].time;
    if (time < from || time >= to || i <= busyUntil) continue;
    if (depth[i] == null || depth[i] < threshold) continue;
    const entry = candles[i + 1].open;
    const stop = atr1h[i] * cfg.stopAtrMultiplier;
    const trade = simulateTrade({
      trade: {
        symbol,
        direction: 'LONG',
        entryTime: candles[i + 1].time,
        entry,
        stopLoss: entry - stop,
        depth: depth[i],
        targets: cfg.targets.map(([r, share], k) => ({ label: 'TP' + (k + 1), closeShare: share, price: entry + stop * r }))
      },
      candles,
      startIndex: i + 1,
      maxHoldBars: Math.round(cfg.maxHoldMinutes / 5),
      feePercent: fee,
      moveToBreakeven: false
    });
    if (trade) {
      trades.push(trade);
      busyUntil = i + trade.barsHeld;
    }
  }
  return trades;
}

export function summarizeTrades(trades) {
  const n = trades.length;
  if (!n) return { trades: 0, winRate: 0, avgR: 0, totalR: 0 };
  const totalR = trades.reduce((acc, t) => acc + t.resultR, 0);
  return {
    trades: n,
    winRate: Math.round((trades.filter((t) => t.resultR > 0).length / n) * 100),
    avgR: Number((totalR / n).toFixed(2)),
    totalR: Number(totalR.toFixed(1))
  };
}

/**
 * Фильтр формы: сделка разрешена, если сетап за последние windowDays дней
 * (по уже закрытым сделкам) в среднем не убыточен. Отскоки после проливов
 * работают сериями: в падающем рынке проливы продолжаются, и сетап надо выключать.
 *
 * @param {object[]} trades все «бумажные» сделки сетапа, по всем монетам
 * @returns {object[]} те из них, что прошли фильтр
 */
export function applyHealthGate(trades, { windowDays, minTrades } = SETUPS.flush.health) {
  const sorted = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  const windowMs = windowDays * 86400000;
  return sorted.filter((trade) => {
    const recent = sorted.filter((t) => t.exitTime <= trade.entryTime && t.exitTime > trade.entryTime - windowMs);
    if (recent.length < minTrades) return false;
    return recent.reduce((acc, t) => acc + t.resultR, 0) > 0;
  });
}

/** Текущая форма сетапа по набору сделок за последние недели. */
export function healthOf(trades, now = Date.now(), { windowDays, minTrades } = SETUPS.flush.health) {
  const recent = trades.filter((t) => t.exitTime <= now && t.exitTime > now - windowDays * 86400000);
  const stats = summarizeTrades(recent);
  return {
    ...stats,
    days: windowDays,
    verdict: stats.trades < minTrades ? 'unknown' : stats.totalR > 0 ? 'good' : 'bad'
  };
}
