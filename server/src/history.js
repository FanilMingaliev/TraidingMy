/**
 * Загрузка исторических данных для бэктеста: свечи и метрики рынка фьючерсов.
 *
 * Ограничение источника: пятиминутная история открытого интереса и
 * позиционирования у Binance хранится всего около полутора суток, поэтому для
 * окон длиннее нескольких дней берётся часовая гранулярность и раскладывается
 * по пятиминутным барам методом «последнее известное значение».
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(here, '../../data/cache');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheKey(parts) {
  return parts.join('_').replace(/[^a-zA-Z0-9_-]/g, '') + '.json';
}

function readCache(key, maxAgeMs) {
  ensureCacheDir();
  const file = path.join(CACHE_DIR, key);
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (Date.now() - stat.mtimeMs > maxAgeMs) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  ensureCacheDir();
  fs.writeFileSync(path.join(CACHE_DIR, key), JSON.stringify(value));
  return value;
}

async function fetchJson(url, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'ScalpRadar/1.0' }
    });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      return fetchJson(url, attempt + 1);
    }
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url.slice(0, 90));
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const INTERVAL_MS = { '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000 };

/** Свечи за произвольный период (Binance, постранично). */
export async function loadKlines(symbol, interval, startMs, endMs) {
  const key = cacheKey(['kl', symbol, interval, String(startMs), String(endMs)]);
  const cached = readCache(key, 60 * 60 * 1000);
  if (cached) return cached;

  const step = INTERVAL_MS[interval];
  const out = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const url =
      'https://api.binance.com/api/v3/klines?symbol=' +
      symbol +
      '&interval=' +
      interval +
      '&startTime=' +
      cursor +
      '&limit=1000';
    const batch = await fetchJson(url);
    if (!Array.isArray(batch) || !batch.length) break;
    for (const row of batch) {
      const time = Number(row[0]);
      if (time > endMs) break;
      out.push({
        time,
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5])
      });
    }
    const lastTime = Number(batch[batch.length - 1][0]);
    if (lastTime <= cursor) break;
    cursor = lastTime + step;
    if (batch.length < 1000) break;
  }

  return writeCache(key, out);
}

async function loadFuturesSeries(endpoint, symbol, period, startMs, endMs, mapper) {
  const out = [];
  let cursor = startMs;
  const step = INTERVAL_MS[period];

  while (cursor < endMs) {
    const url =
      'https://fapi.binance.com/futures/data/' +
      endpoint +
      '?symbol=' +
      symbol +
      '&period=' +
      period +
      '&startTime=' +
      cursor +
      '&endTime=' +
      endMs +
      '&limit=500';
    const batch = await fetchJson(url);
    if (!Array.isArray(batch) || !batch.length) break;
    for (const row of batch) out.push(mapper(row));
    const lastTime = Number(batch[batch.length - 1].timestamp);
    if (lastTime <= cursor) break;
    cursor = lastTime + step;
    if (batch.length < 500) break;
  }

  // Источник может отдать данные не с начала запрошенного окна — это нормально
  return out.sort((a, b) => a.time - b.time);
}

/**
 * История метрик фьючерсного рынка.
 * @returns {{ period: string, oi: [], ls: [], taker: [], funding: [] }}
 */
export async function loadDerivativeHistory(symbol, startMs, endMs) {
  const days = (endMs - startMs) / 86400000;
  const period = days <= 4 ? '15m' : '1h';
  const key = cacheKey(['dv', symbol, period, String(startMs), String(endMs)]);
  const cached = readCache(key, 60 * 60 * 1000);
  if (cached) return cached;

  const [oi, ls, taker, funding] = await Promise.all([
    loadFuturesSeries('openInterestHist', symbol, period, startMs, endMs, (r) => ({
      time: Number(r.timestamp),
      value: Number(r.sumOpenInterestValue)
    })).catch(() => []),
    loadFuturesSeries('globalLongShortAccountRatio', symbol, period, startMs, endMs, (r) => ({
      time: Number(r.timestamp),
      value: Number(r.longShortRatio)
    })).catch(() => []),
    loadFuturesSeries('takerlongshortRatio', symbol, period, startMs, endMs, (r) => ({
      time: Number(r.timestamp),
      value: Number(r.buySellRatio)
    })).catch(() => []),
    fetchJson(
      'https://fapi.binance.com/fapi/v1/fundingRate?symbol=' +
        symbol +
        '&startTime=' +
        startMs +
        '&endTime=' +
        endMs +
        '&limit=1000'
    )
      .then((rows) =>
        (Array.isArray(rows) ? rows : []).map((r) => ({
          time: Number(r.fundingTime),
          value: Number(r.fundingRate)
        }))
      )
      .catch(() => [])
  ]);

  return writeCache(key, { period, oi, ls, taker, funding });
}

/** Последнее значение ряда на момент времени (или null). */
function valueAt(series, time, fromIndex = 0) {
  let found = null;
  for (let i = fromIndex; i < series.length; i++) {
    if (series[i].time > time) break;
    found = series[i];
  }
  return found;
}

/** Значение ряда, отстоящее от текущего на N шагов назад. */
function valueBefore(series, time, backMs) {
  return valueAt(series, time - backMs);
}

/**
 * Собирает сводку по фьючерсам на момент времени в том же формате,
 * который отдаёт живой модуль derivatives.js.
 */
export function makeDerivativesLookup(history) {
  if (!history) return () => ({ available: false });
  const { oi, ls, taker, funding, period } = history;
  const periodMs = INTERVAL_MS[period] || 3600000;

  return (time) => {
    const oiNow = valueAt(oi, time);
    const oiHourAgo = valueBefore(oi, time, 3600000);
    const oi15mAgo = periodMs <= 900000 ? valueBefore(oi, time, 900000) : null;
    const lsNow = valueAt(ls, time);
    const takerNow = valueAt(taker, time);
    const fundingNow = valueAt(funding, time);
    const fundingPrev = fundingNow ? valueBefore(funding, fundingNow.time, 1) : null;

    if (!oiNow && !fundingNow) return { available: false };

    const fundingPercent = fundingNow ? fundingNow.value * 100 : null;
    const prevPercent = fundingPrev ? fundingPrev.value * 100 : null;

    return {
      available: true,
      source: 'история binance',
      fundingRate: fundingNow ? fundingNow.value : null,
      fundingPercent: fundingPercent == null ? null : Number(fundingPercent.toFixed(4)),
      fundingAnnualPercent: fundingPercent == null ? null : Number((fundingPercent * 3 * 365).toFixed(1)),
      fundingTrend:
        prevPercent == null || fundingPercent == null
          ? 'unknown'
          : fundingPercent - prevPercent > 0.002
            ? 'rising'
            : prevPercent - fundingPercent > 0.002
              ? 'falling'
              : 'flat',
      nextFundingInMinutes: null,
      openInterestValue: oiNow ? oiNow.value : null,
      oiChange15m:
        oi15mAgo && oiNow && oi15mAgo.value
          ? Number((((oiNow.value - oi15mAgo.value) / oi15mAgo.value) * 100).toFixed(2))
          : null,
      oiChange1h:
        oiHourAgo && oiNow && oiHourAgo.value
          ? Number((((oiNow.value - oiHourAgo.value) / oiHourAgo.value) * 100).toFixed(2))
          : null,
      longShortRatio: lsNow ? lsNow.value : null,
      longShortChange: null,
      takerBuySellRatio: takerNow ? takerNow.value : null
    };
  };
}

export { INTERVAL_MS };
