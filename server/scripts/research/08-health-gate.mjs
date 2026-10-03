// Фильтр формы на двух годах. Первый год (дни 720–360) до этого не использовался вообще.
import { loadCandles, END, DAY } from './features.js';
import { replayFlush, summarizeTrades, applyHealthGate } from '../../../core/replay.js';
import { COINS } from '../../../core/config.js';

const symbols = COINS.map((c) => c.symbol);
const all = [];
for (const symbol of symbols) {
  const candles = await loadCandles(symbol, 720);
  all.push(...replayFlush(candles, { symbol }));
}
all.sort((a, b) => a.entryTime - b.entryTime);

const Y1 = [END - 720 * DAY + 62 * DAY, END - 360 * DAY]; // первые 60 дней — разгон фильтра
const Y2 = [END - 360 * DAY, END];
const inWin = (w) => (t) => t.entryTime >= w[0] && t.entryTime < w[1];
const show = (name, trades) => {
  const row = [Y1, Y2].map((w) => {
    const sub = trades.filter(inWin(w));
    const s = summarizeTrades(sub);
    // по кварталам
    const q = [0, 1, 2, 3].map((k) => {
      const a = w[0] + ((w[1] - w[0]) * k) / 4, b = w[0] + ((w[1] - w[0]) * (k + 1)) / 4;
      return sub.filter((t) => t.entryTime >= a && t.entryTime < b).reduce((acc, t) => acc + t.resultR, 0).toFixed(0);
    });
    return String(s.trades).padStart(4) + ' сд ' + String(s.winRate + '%').padStart(4) + ' ср ' + (s.avgR >= 0 ? '+' : '') + s.avgR.toFixed(2) + 'R итог ' + String(s.totalR).padStart(6) + 'R [' + q.join(' ') + ']';
  });
  console.log(name.padEnd(30) + 'год 1 (новый): ' + row[0] + '  |  год 2: ' + row[1]);
};

show('без фильтра', all);
for (const windowDays of [14, 30, 60]) {
  for (const minTrades of [5, 10, 20]) {
    show('форма ' + windowDays + ' дн, мин ' + minTrades, applyHealthGate(all, { windowDays, minTrades }));
  }
}
