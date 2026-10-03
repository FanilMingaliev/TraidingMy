/**
 * Данные рынка бессрочных фьючерсов: ставка финансирования, открытый интерес,
 * позиционирование трейдеров и агрессия тейкеров.
 *
 * Именно эти метрики двигают цену на горизонте скальпинга: перегретое
 * финансирование и перекошенный OI показывают, где скопилось «топливо»
 * для сквиза, чего классические индикаторы по свечам не видят.
 */
import { CACHE_TTL } from './config.js';

const cache = new Map();
const TTL = CACHE_TTL.derivatives || 60 * 1000;

async function fetchJson(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const pct = (from, to) => (from ? ((to - from) / from) * 100 : 0);

/**
 * Тикеры всех бессрочных контрактов Bybit одним запросом.
 * При сканировании десяти монет это экономит девять сетевых обращений.
 */
let tickersCache = null;
let tickersInFlight = null;

function bybitTickers() {
  if (tickersCache && Date.now() - tickersCache.at < TTL) return Promise.resolve(tickersCache.map);
  if (tickersInFlight) return tickersInFlight;
  tickersInFlight = fetchJson('https://api.bybit.com/v5/market/tickers?category=linear')
    .then((res) => {
      const list = res?.result?.list;
      if (!Array.isArray(list) || !list.length) throw new Error('bybit: пустой список тикеров');
      const map = new Map(list.map((t) => [t.symbol, t]));
      tickersCache = { at: Date.now(), map };
      return map;
    })
    .finally(() => {
      tickersInFlight = null;
    });
  return tickersInFlight;
}

/** Финансирование и открытый интерес с Bybit. */
async function bybitCore(symbol) {
  const [tickers, oiRes, fundingRes] = await Promise.all([
    bybitTickers(),
    fetchJson(
      'https://api.bybit.com/v5/market/open-interest?category=linear&symbol=' +
        symbol +
        '&intervalTime=5min&limit=13'
    ),
    // История ставок нужна только для тренда — без неё анализ обходится
    fetchJson(
      'https://api.bybit.com/v5/market/funding/history?category=linear&symbol=' + symbol + '&limit=4'
    ).catch(() => null)
  ]);

  const ticker = tickers.get(symbol);
  if (!ticker) throw new Error('bybit: нет тикера фьючерса');

  // Bybit отдаёт историю от новых к старым
  const oiList = (oiRes?.result?.list || []).map((r) => Number(r.openInterest));
  const fundingList = (fundingRes?.result?.list || []).map((r) => Number(r.fundingRate));

  return {
    source: 'bybit',
    fundingRate: Number(ticker.fundingRate),
    fundingHistory: fundingList,
    nextFundingTime: Number(ticker.nextFundingTime) || null,
    openInterestValue: Number(ticker.openInterestValue),
    oiChange15m: oiList.length > 3 ? pct(oiList[3], oiList[0]) : null,
    oiChange1h: oiList.length > 12 ? pct(oiList[12], oiList[0]) : null
  };
}

/** Резервный источник — Binance Futures. */
async function binanceCore(symbol) {
  const [premium, oiHist] = await Promise.all([
    fetchJson('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=' + symbol),
    fetchJson(
      'https://fapi.binance.com/futures/data/openInterestHist?symbol=' + symbol + '&period=5m&limit=13'
    )
  ]);

  // Binance отдаёт историю от старых к новым
  const oiList = (Array.isArray(oiHist) ? oiHist : []).map((r) => Number(r.sumOpenInterestValue));
  const latest = oiList.length ? oiList[oiList.length - 1] : null;

  return {
    source: 'binance',
    fundingRate: Number(premium.lastFundingRate),
    fundingHistory: [],
    nextFundingTime: Number(premium.nextFundingTime) || null,
    openInterestValue: latest,
    oiChange15m: oiList.length > 3 ? pct(oiList[oiList.length - 4], latest) : null,
    oiChange1h: oiList.length > 12 ? pct(oiList[0], latest) : null
  };
}

/** Позиционирование розницы и агрессия тейкеров (только Binance). */
async function binancePositioning(symbol) {
  const [lsRes, takerRes] = await Promise.all([
    fetchJson(
      'https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=' +
        symbol +
        '&period=5m&limit=12'
    ).catch(() => null),
    fetchJson(
      'https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=' + symbol + '&period=5m&limit=3'
    ).catch(() => null)
  ]);

  const ls = Array.isArray(lsRes) ? lsRes.map((r) => Number(r.longShortRatio)) : [];
  const taker = Array.isArray(takerRes) ? takerRes.map((r) => Number(r.buySellRatio)) : [];

  return {
    longShortRatio: ls.length ? ls[ls.length - 1] : null,
    longShortChange: ls.length > 6 ? ls[ls.length - 1] - ls[0] : null,
    takerBuySellRatio: taker.length ? taker[taker.length - 1] : null
  };
}

/**
 * Сводка по деривативам одной монеты.
 * Если источники недоступны — возвращает { available: false }, движок анализа
 * в этом случае просто не учитывает соответствующие факторы.
 */
export async function getDerivatives(symbol) {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  let core = null;
  const errors = [];
  try {
    core = await bybitCore(symbol);
  } catch (err) {
    errors.push('bybit: ' + err.message);
    try {
      core = await binanceCore(symbol);
    } catch (err2) {
      errors.push('binance: ' + err2.message);
    }
  }

  if (!core) {
    const value = { available: false, error: errors.join('; ') };
    cache.set(symbol, { at: Date.now(), value });
    return value;
  }

  const positioning = await binancePositioning(symbol).catch(() => ({
    longShortRatio: null,
    longShortChange: null,
    takerBuySellRatio: null
  }));

  // Ставка приводится к процентам за период финансирования (обычно 8 часов)
  const fundingPercent = core.fundingRate * 100;
  const prevFunding = core.fundingHistory.length > 1 ? core.fundingHistory[1] * 100 : null;
  const fundingTrend =
    prevFunding == null
      ? 'unknown'
      : fundingPercent - prevFunding > 0.002
        ? 'rising'
        : prevFunding - fundingPercent > 0.002
          ? 'falling'
          : 'flat';

  const value = {
    available: true,
    source: core.source,
    fundingRate: core.fundingRate,
    fundingPercent: Number(fundingPercent.toFixed(4)),
    fundingAnnualPercent: Number((fundingPercent * 3 * 365).toFixed(1)),
    fundingTrend,
    nextFundingInMinutes: core.nextFundingTime
      ? Math.max(0, Math.round((core.nextFundingTime - Date.now()) / 60000))
      : null,
    openInterestValue: core.openInterestValue,
    oiChange15m: core.oiChange15m == null ? null : Number(core.oiChange15m.toFixed(2)),
    oiChange1h: core.oiChange1h == null ? null : Number(core.oiChange1h.toFixed(2)),
    longShortRatio: positioning.longShortRatio,
    longShortChange:
      positioning.longShortChange == null ? null : Number(positioning.longShortChange.toFixed(2)),
    takerBuySellRatio: positioning.takerBuySellRatio
  };

  cache.set(symbol, { at: Date.now(), value });
  return value;
}
