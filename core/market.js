/**
 * Загрузка рыночных данных. Три независимых источника с автопереключением:
 * Bybit -> Binance -> OKX. Все они доступны без ключей API.
 */
import { CACHE_TTL } from './config.js';

const cache = new Map();

function getCached(key, ttl) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  return null;
}

function setCached(key, value) {
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchJson(url, timeoutMs = 10000) {
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

const candle = (t, o, h, l, c, v) => ({
  time: Number(t),
  open: Number(o),
  high: Number(h),
  low: Number(l),
  close: Number(c),
  volume: Number(v)
});

const okxInst = (symbol) => symbol.replace(/USDT$/, '-USDT');

const INTERVALS = {
  bybit: { '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240' },
  binance: { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h' },
  okx: { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H' }
};

const PROVIDERS = [
  {
    name: 'bybit',
    async klines(symbol, interval, limit) {
      const url =
        'https://api.bybit.com/v5/market/kline?category=spot&symbol=' +
        symbol +
        '&interval=' +
        INTERVALS.bybit[interval] +
        '&limit=' +
        limit;
      const data = await fetchJson(url);
      const list = data?.result?.list;
      if (!Array.isArray(list) || !list.length) throw new Error('bybit: пустой ответ');
      return list
        .map((r) => candle(r[0], r[1], r[2], r[3], r[4], r[5]))
        .sort((a, b) => a.time - b.time);
    },
    async ticker(symbol) {
      const data = await fetchJson(
        'https://api.bybit.com/v5/market/tickers?category=spot&symbol=' + symbol
      );
      const t = data?.result?.list?.[0];
      if (!t) throw new Error('bybit: нет тикера');
      return {
        price: Number(t.lastPrice),
        changePercent24h: Number(t.price24hPcnt) * 100,
        high24h: Number(t.highPrice24h),
        low24h: Number(t.lowPrice24h),
        quoteVolume24h: Number(t.turnover24h)
      };
    }
  },
  {
    name: 'binance',
    async klines(symbol, interval, limit) {
      const url =
        'https://api.binance.com/api/v3/klines?symbol=' +
        symbol +
        '&interval=' +
        INTERVALS.binance[interval] +
        '&limit=' +
        limit;
      const list = await fetchJson(url);
      if (!Array.isArray(list) || !list.length) throw new Error('binance: пустой ответ');
      return list.map((r) => candle(r[0], r[1], r[2], r[3], r[4], r[5]));
    },
    async ticker(symbol) {
      const t = await fetchJson('https://api.binance.com/api/v3/ticker/24hr?symbol=' + symbol);
      return {
        price: Number(t.lastPrice),
        changePercent24h: Number(t.priceChangePercent),
        high24h: Number(t.highPrice),
        low24h: Number(t.lowPrice),
        quoteVolume24h: Number(t.quoteVolume)
      };
    }
  },
  {
    name: 'okx',
    async klines(symbol, interval, limit) {
      const url =
        'https://www.okx.com/api/v5/market/candles?instId=' +
        okxInst(symbol) +
        '&bar=' +
        INTERVALS.okx[interval] +
        '&limit=' +
        limit;
      const data = await fetchJson(url);
      const list = data?.data;
      if (!Array.isArray(list) || !list.length) throw new Error('okx: пустой ответ');
      return list
        .map((r) => candle(r[0], r[1], r[2], r[3], r[4], r[5]))
        .sort((a, b) => a.time - b.time);
    },
    async ticker(symbol) {
      const data = await fetchJson(
        'https://www.okx.com/api/v5/market/ticker?instId=' + okxInst(symbol)
      );
      const t = data?.data?.[0];
      if (!t) throw new Error('okx: нет тикера');
      const price = Number(t.last);
      const open24h = Number(t.open24h);
      return {
        price,
        changePercent24h: open24h ? ((price - open24h) / open24h) * 100 : 0,
        high24h: Number(t.high24h),
        low24h: Number(t.low24h),
        quoteVolume24h: Number(t.volCcy24h)
      };
    }
  }
];

/** Провайдер, который сработал последним — пробуем его первым. */
let preferredProvider = 'bybit';

async function withFallback(method, symbol, ...args) {
  const ordered = [
    ...PROVIDERS.filter((p) => p.name === preferredProvider),
    ...PROVIDERS.filter((p) => p.name !== preferredProvider)
  ];
  const errors = [];
  for (const provider of ordered) {
    try {
      const value = await provider[method](symbol, ...args);
      preferredProvider = provider.name;
      return { value, provider: provider.name };
    } catch (err) {
      errors.push(provider.name + ': ' + err.message);
    }
  }
  throw new Error('Все источники недоступны (' + errors.join('; ') + ')');
}

/** Одинаковые запросы, уже летящие в сеть, не дублируем — ждём первый. */
const inFlight = new Map();

function once(key, ttl, load) {
  const cached = getCached(key, ttl);
  if (cached) return Promise.resolve(cached);
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = load()
    .then((value) => setCached(key, value))
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export function getKlines(symbol, interval, limit = 200) {
  return once('k:' + symbol + ':' + interval + ':' + limit, CACHE_TTL.klines, async () => {
    const { value, provider } = await withFallback('klines', symbol, interval, limit);
    return { candles: value, provider };
  });
}

export function getTicker(symbol) {
  return once('t:' + symbol, CACHE_TTL.ticker, async () => {
    const { value, provider } = await withFallback('ticker', symbol);
    return { ...value, provider };
  });
}

const HISTORY = {
  /** Bybit отдаёт до 1000 свечей от новых к старым — идём от конца периода назад. */
  async bybit(symbol, interval, startMs, endMs) {
    const out = [];
    let end = endMs;
    while (end > startMs) {
      const data = await fetchJson(
        'https://api.bybit.com/v5/market/kline?category=spot&symbol=' + symbol +
          '&interval=' + INTERVALS.bybit[interval] + '&start=' + startMs + '&end=' + end + '&limit=1000'
      );
      const list = data?.result?.list;
      if (!Array.isArray(list) || !list.length) break;
      for (const r of list) out.push(candle(r[0], r[1], r[2], r[3], r[4], r[5]));
      const oldest = Number(list[list.length - 1][0]);
      if (list.length < 1000 || oldest <= startMs) break;
      end = oldest - 1;
    }
    if (!out.length) throw new Error('bybit: нет истории');
    return out.sort((a, b) => a.time - b.time);
  },
  /** Binance отдаёт от старых к новым — идём от начала периода вперёд. */
  async binance(symbol, interval, startMs, endMs) {
    const out = [];
    let cursor = startMs;
    while (cursor < endMs) {
      const list = await fetchJson(
        'https://api.binance.com/api/v3/klines?symbol=' + symbol + '&interval=' + INTERVALS.binance[interval] +
          '&startTime=' + cursor + '&endTime=' + endMs + '&limit=1000'
      );
      if (!Array.isArray(list) || !list.length) break;
      for (const r of list) out.push(candle(r[0], r[1], r[2], r[3], r[4], r[5]));
      const newest = Number(list[list.length - 1][0]);
      if (list.length < 1000 || newest <= cursor) break;
      cursor = newest + 1;
    }
    if (!out.length) throw new Error('binance: нет истории');
    return out;
  }
};

/**
 * Свечи за произвольный период (больше, чем отдаёт один запрос).
 * Нужны, чтобы посчитать форму сетапа за последние недели.
 */
export async function getKlinesHistory(symbol, interval, startMs, endMs = Date.now()) {
  const order = preferredProvider === 'binance' ? ['binance', 'bybit'] : ['bybit', 'binance'];
  const errors = [];
  for (const name of order) {
    try {
      return await HISTORY[name](symbol, interval, startMs, endMs);
    } catch (err) {
      errors.push(name + ': ' + err.message);
    }
  }
  throw new Error('История недоступна (' + errors.join('; ') + ')');
}

/** Индекс страха и жадности (alternative.me) — общий фон рынка. */
export async function getFearGreed() {
  const cached = getCached('fng', CACHE_TTL.fearGreed);
  if (cached) return cached;
  try {
    const data = await fetchJson('https://api.alternative.me/fng/?limit=1', 8000);
    const item = data?.data?.[0];
    if (!item) return null;
    return setCached('fng', {
      value: Number(item.value),
      classification: item.value_classification
    });
  } catch {
    return null;
  }
}

export function providerStatus() {
  return { preferred: preferredProvider, available: PROVIDERS.map((p) => p.name) };
}
