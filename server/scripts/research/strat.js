/**
 * Симуляция правил по признакам (features.js) на длинной истории.
 * Одна позиция на монету; вход по открытию следующего бара; комиссия 0.1% за круг.
 */
import { simulateTrade } from '../../../core/simulate.js';
import { END, DAY } from './features.js';

export const WARM = 2600;

/**
 * @param {object[]} uni  [{ symbol, candles, features }]
 * @param {(f, i, d) => null | { direction, stop, targets: [[R, доля]], hold }} rule
 *        stop — дистанция стопа в цене
 * @param {[number, number]} window  [от, до] в мс
 */
export function runRule(uni, rule, window, fee = 0.1) {
  const trades = [];
  for (const d of uni) {
    let busyUntil = -1;
    for (let i = WARM; i < d.candles.length - 2; i++) {
      const t = d.candles[i].time;
      if (t < window[0] || t >= window[1]) continue;
      if (i <= busyUntil) continue;
      const sig = rule(d.features[i], i, d);
      if (!sig) continue;
      const entry = d.candles[i + 1].open;
      const isLong = sig.direction === 'LONG';
      const trade = simulateTrade({
        trade: {
          symbol: d.symbol,
          direction: sig.direction,
          entryTime: d.candles[i + 1].time,
          entry,
          stopLoss: isLong ? entry - sig.stop : entry + sig.stop,
          stopPct: (sig.stop / entry) * 100,
          targets: sig.targets.map(([r, share], k) => ({
            label: 'TP' + (k + 1),
            closeShare: share,
            price: isLong ? entry + sig.stop * r : entry - sig.stop * r
          }))
        },
        candles: d.candles,
        startIndex: i + 1,
        maxHoldBars: sig.hold,
        feePercent: fee,
        moveToBreakeven: Boolean(sig.breakeven)
      });
      if (trade) {
        trades.push(trade);
        busyUntil = i + trade.barsHeld;
      }
    }
  }
  return trades;
}

export function stats(trades, window, folds = 6) {
  const n = trades.length;
  if (!n) return { n: 0, win: 0, avgR: 0, totalR: 0, bps: 0, pos: 0, folds: [], perDay: 0, dd: 0 };
  const totalR = trades.reduce((a, t) => a + t.resultR, 0);
  const bps = trades.reduce((a, t) => a + t.resultR * t.stopPct * 100, 0) / n;
  const span = (window[1] - window[0]) / folds;
  const f = Array.from({ length: folds }, () => 0);
  for (const t of trades) f[Math.min(folds - 1, Math.floor((t.entryTime - window[0]) / span))] += t.resultR;
  let eq = 0, peak = 0, dd = 0;
  for (const t of [...trades].sort((a, b) => a.entryTime - b.entryTime)) {
    eq += t.resultR;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  return {
    n,
    win: (trades.filter((t) => t.resultR > 0).length / n) * 100,
    avgR: totalR / n,
    totalR,
    bps,
    pos: f.filter((x) => x > 0).length,
    folds: f,
    perDay: n / ((window[1] - window[0]) / DAY),
    dd
  };
}

export const line = (name, s) =>
  name.padEnd(46) + String(s.n).padStart(5) + ' сд ' + s.perDay.toFixed(1).padStart(5) + '/д ' +
  (s.win.toFixed(0) + '%').padStart(4) + ' ср ' + (s.avgR >= 0 ? '+' : '') + s.avgR.toFixed(3) + 'R ' +
  ('итог ' + s.totalR.toFixed(0) + 'R').padStart(11) + (' ' + s.bps.toFixed(0) + 'бп').padStart(7) +
  ' просадка ' + s.dd.toFixed(0).padStart(3) + 'R  +' + s.pos + '/' + s.folds.length + '  [' +
  s.folds.map((x) => x.toFixed(0)).join(' ') + ']';

export const windows = (devDays, holdDays) => ({
  DEV: [END - devDays * DAY, END],
  HOLD: [END - (devDays + holdDays) * DAY, END - devDays * DAY]
});
