/**
 * Признаки по чистым свечам для исследования на длинной истории (без evaluate —
 * он медленный и зависит от истории фьючерсов, которой дальше месяца нет).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKlines } from '../../src/history.js';
import { ema, rsi, atr, sma, adx } from '../../../core/indicators.js';
import { COINS } from '../../../core/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.resolve(here, '../../../data/research');
fs.mkdirSync(CACHE, { recursive: true });

export const DAY = 86400000;
export const END = Math.floor(Date.now() / DAY) * DAY;

export async function loadCandles(symbol, days) {
  const file = path.join(CACHE, 'kl_' + END + '_' + days + '_' + symbol + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const candles = await loadKlines(symbol, '5m', END - days * DAY, END);
  fs.writeFileSync(file, JSON.stringify(candles));
  return candles;
}

function aggregate(candles, periodMs) {
  const bars = [];
  const mapIndex = new Array(candles.length); // индекс последнего ЗАКРЫТОГО старшего бара для каждого 5м-бара
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const bucket = Math.floor(c.time / periodMs) * periodMs;
    const lastBar = bars[bars.length - 1];
    if (!lastBar || lastBar.time !== bucket) {
      bars.push({ time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    } else {
      lastBar.high = Math.max(lastBar.high, c.high);
      lastBar.low = Math.min(lastBar.low, c.low);
      lastBar.close = c.close;
      lastBar.volume += c.volume;
    }
    // бар 5м закрывает старший бар, если следующий 5м-бар уже в другом ведре
    const closesBucket = c.time + 300000 >= bucket + periodMs;
    mapIndex[i] = closesBucket ? bars.length - 1 : bars.length - 2;
  }
  return { bars, mapIndex };
}

/** Массивы признаков той же длины, что и свечи. Всё считается только по прошлому. */
export function buildFeatures(candles) {
  const n = candles.length;
  const close = candles.map((c) => c.close);
  const vol = candles.map((c) => c.volume);
  const atr14 = atr(candles, 14);
  const e9 = ema(close, 9);
  const e21 = ema(close, 21);
  const e50 = ema(close, 50);
  const e200 = ema(close, 200);
  const rsi14 = rsi(close, 14);
  const volSma = sma(vol, 20);

  const h1 = aggregate(candles, 3600000);
  const h1close = h1.bars.map((b) => b.close);
  const h1ema50 = ema(h1close, 50);
  const h1ema200 = ema(h1close, 200);
  const h1adx = adx(h1.bars, 14);
  const h1rsi = rsi(h1close, 14);
  const h1atr = atr(h1.bars, 14);

  const f = [];
  for (let i = 0; i < n; i++) {
    const c = close[i];
    const a = atr14[i];
    const ret = (k) => (i - k >= 0 ? (c / close[i - k] - 1) * 100 : null);
    const hi = i >= 1 ? h1.mapIndex[i] : -1;
    let hi24 = -Infinity;
    let lo24 = Infinity;
    if (i >= 288) {
      for (let j = i - 287; j <= i; j++) {
        if (candles[j].high > hi24) hi24 = candles[j].high;
        if (candles[j].low < lo24) lo24 = candles[j].low;
      }
    }
    let vol3 = null;
    if (i >= 23 && volSma[i - 3]) vol3 = (vol[i] + vol[i - 1] + vol[i - 2]) / 3 / volSma[i - 3];
    const bar = candles[i];
    const range = bar.high - bar.low;
    f.push({
      atrPct: a ? (a / c) * 100 : null,
      r15: ret(3),
      r1h: ret(12),
      r4h: ret(48),
      r24h: ret(288),
      // движение в единицах собственной волатильности — сравнимо между монетами
      m15: a ? (c - close[Math.max(0, i - 3)]) / a : null,
      m1h: a ? (c - close[Math.max(0, i - 12)]) / a : null,
      z9: a && e9[i] != null ? (c - e9[i]) / a : null,
      z21: a && e21[i] != null ? (c - e21[i]) / a : null,
      z50: a && e50[i] != null ? (c - e50[i]) / a : null,
      z200: a && e200[i] != null ? (c - e200[i]) / a : null,
      rsi: rsi14[i],
      vol3,
      volNow: volSma[i - 1] ? vol[i] / volSma[i - 1] : null,
      wickLow: range ? (Math.min(bar.open, bar.close) - bar.low) / range : 0,
      wickHigh: range ? (bar.high - Math.max(bar.open, bar.close)) / range : 0,
      body: a ? (bar.close - bar.open) / a : 0,
      pos24: hi24 > lo24 ? (c - lo24) / (hi24 - lo24) : null,
      h1trend: hi >= 0 && h1ema50[hi] != null && h1ema200[hi] != null ? ((h1ema50[hi] - h1ema200[hi]) / h1ema200[hi]) * 100 : null,
      h1px50: hi >= 0 && h1ema50[hi] != null ? ((c - h1ema50[hi]) / h1ema50[hi]) * 100 : null,
      h1slope: hi >= 12 && h1ema50[hi] != null && h1ema50[hi - 12] != null ? ((h1ema50[hi] - h1ema50[hi - 12]) / h1ema50[hi - 12]) * 100 : null,
      h1adx: hi >= 0 ? h1adx[hi] : null,
      h1rsi: hi >= 0 ? h1rsi[hi] : null,
      h1atrPct: hi >= 0 && h1atr[hi] ? (h1atr[hi] / c) * 100 : null,
      hour: new Date(bar.time).getUTCHours()
    });
  }
  return f;
}

export async function loadUniverse(days, symbols = COINS.map((c) => c.symbol)) {
  const out = [];
  for (const symbol of symbols) {
    const candles = await loadCandles(symbol, days);
    out.push({ symbol, candles, features: buildFeatures(candles) });
  }
  // Признаки биткоина на тех же барах — контекст рынка
  const btc = out.find((d) => d.symbol === 'BTCUSDT');
  if (btc) {
    const byTime = new Map(btc.candles.map((c, i) => [c.time, i]));
    for (const d of out) {
      d.features.forEach((f, i) => {
        const bi = byTime.get(d.candles[i].time);
        const bf = bi == null ? null : btc.features[bi];
        f.btcM1h = bf ? bf.m1h : null;
        f.btcR1h = bf ? bf.r1h : null;
        f.btcR4h = bf ? bf.r4h : null;
        f.btcH1trend = bf ? bf.h1trend : null;
      });
    }
  }
  return out;
}
