/**
 * Новостной фон: сбор RSS-лент, оценка тональности и привязка новостей к монетам.
 */
import { XMLParser } from 'fast-xml-parser';
import { COINS, NEWS_FEEDS, CACHE_TTL } from '../../core/config.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text'
});

/** Словарь тональности: вес от -1 до 1. */
const LEXICON = {
  positive: {
    3: ['etf approved', 'approval', 'all-time high', 'record high', 'breakout', 'surges', 'soars'],
    2: ['rally', 'surge', 'bullish', 'gains', 'jumps', 'adoption', 'partnership', 'institutional',
        'inflows', 'upgrade', 'buyback', 'accumulation', 'whale buys', 'listing', 'integration'],
    1: ['rises', 'climbs', 'growth', 'positive', 'support', 'optimism', 'recovery', 'rebound',
        'launch', 'milestone', 'expands', 'funding', 'invests']
  },
  negative: {
    3: ['hack', 'hacked', 'exploit', 'collapse', 'bankruptcy', 'crash', 'plunges', 'ban'],
    2: ['lawsuit', 'sec charges', 'investigation', 'fraud', 'scam', 'liquidations', 'outflows',
        'dump', 'bearish', 'selloff', 'sell-off', 'plummets', 'tumbles', 'delisting', 'halt'],
    1: ['falls', 'drops', 'declines', 'warning', 'concerns', 'fears', 'pressure', 'correction',
        'resistance', 'delay', 'rejects', 'slides', 'risk']
  }
};

/** Слова-маркеры высокой значимости — новость способна двигать рынок. */
const HIGH_IMPACT = [
  'sec', 'etf', 'fed', 'federal reserve', 'cpi', 'inflation', 'rate cut', 'rate hike',
  'hack', 'halving', 'blackrock', 'regulation', 'lawsuit', 'liquidation', 'binance', 'coinbase',
  'tariff', 'fomc'
];

function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object') return textOf(node['#text']);
  return '';
}

function stripHtml(str) {
  return String(str)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchFeed(feed, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        accept: 'application/rss+xml, application/xml, text/xml, */*',
        'user-agent': 'Mozilla/5.0 (compatible; ScalpRadar/1.0)'
      }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const xml = await res.text();
    const doc = parser.parse(xml);
    const rawItems = doc?.rss?.channel?.item || doc?.feed?.entry || [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];
    return items.slice(0, 25).map((item) => {
      const link = typeof item.link === 'object' ? item.link['@_href'] : item.link;
      const published =
        item.pubDate || item.published || item.updated || item['dc:date'] || null;
      return {
        title: stripHtml(textOf(item.title)),
        link: textOf(link),
        source: feed.source,
        summary: stripHtml(textOf(item.description) || textOf(item.summary)).slice(0, 320),
        publishedAt: published ? new Date(published).toISOString() : new Date().toISOString()
      };
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Тональность текста: score -1..1 плюс список сработавших слов. */
export function scoreSentiment(text) {
  const lower = ' ' + text.toLowerCase() + ' ';
  let score = 0;
  const matched = [];
  for (const [weight, words] of Object.entries(LEXICON.positive)) {
    for (const w of words) {
      if (lower.includes(' ' + w) || lower.includes(w + ' ')) {
        score += Number(weight);
        matched.push('+' + w);
      }
    }
  }
  for (const [weight, words] of Object.entries(LEXICON.negative)) {
    for (const w of words) {
      if (lower.includes(' ' + w) || lower.includes(w + ' ')) {
        score -= Number(weight);
        matched.push('-' + w);
      }
    }
  }
  const normalized = Math.max(-1, Math.min(1, score / 5));
  const impact = HIGH_IMPACT.filter((w) => lower.includes(w));
  return { score: Number(normalized.toFixed(2)), matched: matched.slice(0, 6), impact };
}

/** Какие монеты упоминает новость. Короткие тикеры ищем только как отдельное слово в верхнем регистре. */
function matchCoins(item) {
  const text = item.title + ' ' + item.summary;
  const lower = text.toLowerCase();
  const found = new Set();
  for (const coin of COINS) {
    for (const alias of coin.aliases) {
      if (alias.length <= 4) {
        const re = new RegExp('(^|[^A-Za-z])' + alias.toUpperCase() + '([^A-Za-z]|$)');
        if (re.test(text)) found.add(coin.symbol);
      } else if (new RegExp('(^|\\W)' + alias.replace(/\s/g, '\\s') + '(\\W|$)', 'i').test(lower)) {
        found.add(coin.symbol);
      }
    }
  }
  return [...found];
}

/** Вес свежести: свежая новость влияет сильнее. */
function freshnessWeight(publishedAt) {
  const hours = (Date.now() - new Date(publishedAt).getTime()) / 3600000;
  if (!Number.isFinite(hours) || hours < 0) return 1;
  if (hours <= 3) return 1;
  if (hours <= 8) return 0.7;
  if (hours <= 24) return 0.45;
  if (hours <= 48) return 0.2;
  return 0.08;
}

let newsCache = null;

/**
 * Собирает новостной фон. Возвращает общий сентимент рынка,
 * сентимент по каждой монете и список новостей.
 */
export async function getNews(force = false) {
  if (!force && newsCache && Date.now() - newsCache.at < CACHE_TTL.news) return newsCache.value;

  const results = await Promise.allSettled(NEWS_FEEDS.map((f) => fetchFeed(f)));
  const failed = [];
  let items = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value);
    else failed.push(NEWS_FEEDS[i].source);
  });

  // дедупликация по заголовку
  const seen = new Set();
  items = items.filter((item) => {
    const key = item.title.toLowerCase().slice(0, 70);
    if (!item.title || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  items = items
    .map((item) => {
      const sentiment = scoreSentiment(item.title + '. ' + item.summary);
      return {
        ...item,
        sentiment: sentiment.score,
        keywords: sentiment.matched,
        highImpact: sentiment.impact.length > 0,
        impactTags: sentiment.impact.slice(0, 3),
        coins: matchCoins(item),
        weight: freshnessWeight(item.publishedAt)
      };
    })
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 80);

  const weighted = (list) => {
    const totalWeight = list.reduce((acc, n) => acc + n.weight, 0);
    if (!totalWeight) return 0;
    const sum = list.reduce((acc, n) => acc + n.sentiment * n.weight, 0);
    return Number((sum / totalWeight).toFixed(3));
  };

  const byCoin = {};
  for (const coin of COINS) {
    const related = items.filter((n) => n.coins.includes(coin.symbol));
    byCoin[coin.symbol] = {
      sentiment: weighted(related),
      count: related.length,
      highImpact: related.some((n) => n.highImpact),
      headlines: related.slice(0, 4).map((n) => ({
        title: n.title,
        source: n.source,
        link: n.link,
        sentiment: n.sentiment,
        publishedAt: n.publishedAt
      }))
    };
  }

  const value = {
    updatedAt: new Date().toISOString(),
    marketSentiment: weighted(items),
    total: items.length,
    failedFeeds: failed,
    byCoin,
    items
  };
  newsCache = { at: Date.now(), value };
  return value;
}
