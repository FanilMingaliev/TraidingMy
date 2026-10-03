/**
 * Технические индикаторы. Все функции принимают массивы чисел (от старых к новым)
 * и возвращают массив той же длины, где недоступные значения = null.
 */

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );
  const defined = macdLine.filter((v) => v != null);
  const signalDefined = ema(defined, signalPeriod);
  const offset = macdLine.length - defined.length;
  const signalLine = new Array(values.length).fill(null);
  signalDefined.forEach((v, i) => {
    signalLine[i + offset] = v;
  });
  const histogram = values.map((_, i) =>
    macdLine[i] != null && signalLine[i] != null ? macdLine[i] - signalLine[i] : null
  );
  return { macdLine, signalLine, histogram };
}

export function stdev(values, period) {
  const out = new Array(values.length).fill(null);
  const means = sma(values, period);
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const m = means[i];
    const variance = slice.reduce((acc, v) => acc + Math.pow(v - m, 2), 0) / period;
    out[i] = Math.sqrt(variance);
  }
  return out;
}

export function bollinger(values, period = 20, mult = 2) {
  const middle = sma(values, period);
  const sd = stdev(values, period);
  const upper = values.map((_, i) => (middle[i] != null ? middle[i] + mult * sd[i] : null));
  const lower = values.map((_, i) => (middle[i] != null ? middle[i] - mult * sd[i] : null));
  return { upper, middle, lower, stdev: sd };
}

export function trueRange(candles) {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
}

export function atr(candles, period = 14) {
  const tr = trueRange(candles);
  const out = new Array(candles.length).fill(null);
  if (candles.length < period) return out;
  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < tr.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** ADX — сила тренда (без направления). */
export function adx(candles, period = 14) {
  const len = candles.length;
  const out = new Array(len).fill(null);
  if (len < period * 2) return out;
  const plusDM = [0];
  const minusDM = [0];
  for (let i = 1; i < len; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const tr = trueRange(candles);
  const smooth = (arr) => {
    const res = new Array(len).fill(null);
    let sum = arr.slice(1, period + 1).reduce((a, b) => a + b, 0);
    res[period] = sum;
    for (let i = period + 1; i < len; i++) {
      sum = sum - sum / period + arr[i];
      res[i] = sum;
    }
    return res;
  };
  const trS = smooth(tr);
  const pS = smooth(plusDM);
  const mS = smooth(minusDM);
  const dx = new Array(len).fill(null);
  for (let i = period; i < len; i++) {
    if (!trS[i]) continue;
    const pdi = (100 * pS[i]) / trS[i];
    const mdi = (100 * mS[i]) / trS[i];
    const sum = pdi + mdi;
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sum;
  }
  // ADX по Уайлдеру: первое значение — среднее первых period значений DX,
  // дальше сглаживание (предыдущий * (period-1) + текущий) / period.
  const firstIndex = period * 2 - 1;
  if (firstIndex >= len) return out;
  const seed = dx.slice(period, firstIndex + 1).filter((v) => v != null);
  if (seed.length < period) return out;
  let value = seed.reduce((a, b) => a + b, 0) / period;
  out[firstIndex] = value;
  for (let i = firstIndex + 1; i < len; i++) {
    if (dx[i] == null) continue;
    value = (value * (period - 1) + dx[i]) / period;
    out[i] = value;
  }
  return out;
}

/** Stochastic RSI (0..100). */
export function stochRsi(values, rsiPeriod = 14, stochPeriod = 14) {
  const r = rsi(values, rsiPeriod);
  const out = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const window = r.slice(Math.max(0, i - stochPeriod + 1), i + 1).filter((v) => v != null);
    if (window.length < stochPeriod) continue;
    const min = Math.min.apply(null, window);
    const max = Math.max.apply(null, window);
    out[i] = max === min ? 50 : ((r[i] - min) / (max - min)) * 100;
  }
  return out;
}

/** VWAP по последним N свечам (аппроксимация сессионного VWAP). */
export function vwap(candles, period = 96) {
  const out = new Array(candles.length).fill(null);
  for (let i = 0; i < candles.length; i++) {
    const from = Math.max(0, i - period + 1);
    let pv = 0;
    let vol = 0;
    for (let j = from; j <= i; j++) {
      const typical = (candles[j].high + candles[j].low + candles[j].close) / 3;
      pv += typical * candles[j].volume;
      vol += candles[j].volume;
    }
    out[i] = vol > 0 ? pv / vol : candles[i].close;
  }
  return out;
}

/**
 * Ближайшие уровни поддержки и сопротивления по свинг-точкам.
 * lookback — сколько свечей анализируем, strength — размер окна для экстремума.
 */
export function findLevels(candles, lookback = 120, strength = 3) {
  const slice = candles.slice(-lookback);
  const highs = [];
  const lows = [];
  for (let i = strength; i < slice.length - strength; i++) {
    const window = slice.slice(i - strength, i + strength + 1);
    const isHigh = window.every((c) => c.high <= slice[i].high);
    const isLow = window.every((c) => c.low >= slice[i].low);
    if (isHigh) highs.push(slice[i].high);
    if (isLow) lows.push(slice[i].low);
  }
  const price = slice[slice.length - 1].close;
  const resistance = highs.filter((h) => h > price).sort((a, b) => a - b);
  const support = lows.filter((l) => l < price).sort((a, b) => b - a);
  return {
    resistance: resistance.slice(0, 3),
    support: support.slice(0, 3),
    swingHigh: Math.max.apply(null, slice.map((c) => c.high)),
    swingLow: Math.min.apply(null, slice.map((c) => c.low))
  };
}

export const last = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);

export const prevValue = (arr, back = 1) =>
  arr && arr.length > back ? arr[arr.length - 1 - back] : null;
