/**
 * HTTP-сервер ScalpRadar Pro: сканирование монет, новости, ИИ-вердикт.
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

import { COINS, DEFAULTS } from '../../core/config.js';
import { analyzeCoin } from '../../core/analysis.js';
import { scanMarket, technicalFinal, rankResults, marketRegime } from '../../core/scan.js';
import { getNews } from './news.js';
import { getFearGreed, providerStatus } from '../../core/market.js';
import { requestAiAnalysis, requestCoinReview, isAiConfigured } from './ai.js';
import { recordSignals, resolveOutcomes, journalStats, journalBackend } from './journal.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Если задан API_TOKEN, наружу сервер отвечает только с правильным токеном в заголовке.
// Нужно при публикации через туннель: адрес открывает доступ к платным ИИ-запросам.
// /api/health оставляем открытым, чтобы приложение могло проверить доступность сервера.
const API_TOKEN = process.env.API_TOKEN;
if (API_TOKEN) {
  app.use('/api', (req, res, next) => {
    if (req.path === '/health') return next();
    if (req.get('x-api-token') === API_TOKEN) return next();
    return res.status(401).json({ error: 'Неверный или отсутствует токен доступа' });
  });
}

/** Приводим пользовательские настройки к безопасным значениям. */
function normalizeSettings(body = {}) {
  const num = (value, fallback, min, max) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, min), max);
  };
  return {
    deposit: num(body.deposit, DEFAULTS.deposit, 10, 10_000_000),
    riskPercent: num(body.riskPercent, DEFAULTS.riskPercent, 0.1, 10),
    leverage: num(body.leverage, DEFAULTS.leverage, 1, 50)
  };
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    aiConfigured: isAiConfigured(),
    authRequired: Boolean(API_TOKEN),
    model: process.env.AI_MODEL || 'claude-opus-5',
    market: providerStatus(),
    time: new Date().toISOString()
  });
});

app.get('/api/coins', (req, res) => {
  res.json({ coins: COINS, defaults: DEFAULTS });
});

app.get('/api/news', async (req, res) => {
  try {
    const news = await getNews(req.query.force === '1');
    res.json({
      updatedAt: news.updatedAt,
      marketSentiment: news.marketSentiment,
      failedFeeds: news.failedFeeds,
      items: news.items.slice(0, 40)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Основной сценарий: кнопка «Анализ».
 * 1) собираем новостной фон, 2) считаем технику по каждой монете,
 * 3) отдаём всё в ИИ, 4) объединяем вердикты и сортируем по привлекательности.
 */
app.post('/api/analyze', async (req, res) => {
  const started = Date.now();
  try {
    const settings = normalizeSettings(req.body);
    const useAi = req.body?.useAi !== false;
    const requested = Array.isArray(req.body?.symbols) && req.body.symbols.length
      ? req.body.symbols
      : COINS.map((c) => c.symbol);
    const symbols = requested.filter((s) => typeof s === 'string').slice(0, 20);

    const news = await getNews().catch(() => ({ marketSentiment: 0, byCoin: {}, items: [], failedFeeds: ['все'] }));
    const scan = await scanMarket({ symbols, settings, newsByCoin: news.byCoin });
    const { analyses, errors, breadth, fearGreed } = scan;

    if (!analyses.length) {
      return res.status(502).json({
        error: 'Не удалось получить рыночные данные ни по одной монете',
        details: errors
      });
    }

    const market = { fearGreed, newsSentiment: news.marketSentiment };
    const ai = useAi
      ? await requestAiAnalysis({ analyses, market, news })
      : { available: false, error: 'ИИ-анализ отключён в настройках запроса.' };

    const aiBySymbol = new Map(
      (ai.verdict?.coins || []).map((c) => [String(c.symbol).toUpperCase(), c])
    );

    // Решение о входе принимает только проверенный на истории сетап.
    // Мнение ИИ прикладывается как справка и на сигнал не влияет.
    const results = rankResults(
      analyses.map((a) => {
        const aiCoin = aiBySymbol.get(a.symbol);
        return {
          ...technicalFinal(a, { legacy: Boolean(req.body?.legacySignals) }),
          ai: aiCoin
            ? {
                action: aiCoin.action,
                conviction: aiCoin.conviction,
                horizonMinutes: aiCoin.horizonMinutes,
                rationale: aiCoin.rationale,
                keyRisks: aiCoin.keyRisks,
                newsImpact: aiCoin.newsImpact
              }
            : undefined
        };
      })
    );

    // Каждый выданный сигнал попадает в журнал: через два часа сервис сам
    // посчитает, чем он закончился, и накопит статистику на живых данных.
    let journaled = 0;
    try {
      journaled = await recordSignals(results, { newsSentiment: news.marketSentiment, fearGreed });
    } catch (err) {
      console.error('[журнал]', err.message);
    }

    res.json({
      generatedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      journaled,
      settings,
      market: {
        fearGreed,
        newsSentiment: news.marketSentiment,
        newsUpdatedAt: news.updatedAt,
        failedFeeds: news.failedFeeds,
        provider: providerStatus().preferred,
        breadth: breadth == null ? null : Number(breadth.toFixed(2)),
        regime: marketRegime(results)
      },
      ai: {
        available: ai.available,
        model: ai.model || null,
        error: ai.error || null,
        overview: ai.verdict?.marketOverview || null,
        regime: ai.verdict?.regime || null,
        riskWarning: ai.verdict?.riskWarning || null,
        bestOpportunities: ai.verdict?.bestOpportunities || [],
        usage: ai.usage || null
      },
      results,
      news: (news.items || []).slice(0, 25),
      errors
    });
  } catch (err) {
    console.error('[analyze]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Разбор одной монеты по кнопке. Дешевле полного сканирования примерно
 * в десять раз, потому что в модель уходит только запрошенная монета.
 */
app.post('/api/ai-review', async (req, res) => {
  try {
    const symbol = String(req.body?.symbol || '').toUpperCase();
    if (!symbol) return res.status(400).json({ error: 'Не указана монета' });
    if (!isAiConfigured()) {
      return res.json({ available: false, error: 'ANTHROPIC_API_KEY не задан — ИИ-разбор недоступен.' });
    }

    const settings = normalizeSettings(req.body);
    const [news, fearGreed] = await Promise.all([
      getNews().catch(() => ({ marketSentiment: 0, byCoin: {}, items: [] })),
      getFearGreed()
    ]);

    const analysis = await analyzeCoin(symbol, settings, news.byCoin?.[symbol]);
    const result = await requestCoinReview({ analysis, market: { fearGreed }, news });
    res.json({ ...result, symbol, price: analysis.price, signal: analysis.signal, regime: analysis.regime });
  } catch (err) {
    console.error('[ai-review]', err);
    res.status(500).json({ error: err.message });
  }
});

/** Статистика по исходам ранее выданных сигналов. */
app.get('/api/journal', async (req, res) => {
  try {
    res.json(await journalStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// В продакшене отдаём собранный фронтенд из web/dist
const distPath = path.resolve(here, '../../web/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Досчитываем исходы созревших сигналов при старте и раз в десять минут
const runResolver = () =>
  resolveOutcomes()
    .then((r) => {
      if (r.resolved) console.log('[журнал] посчитано исходов: ' + r.resolved);
    })
    .catch((err) => console.error('[журнал]', err.message));

setTimeout(runResolver, 5000);
setInterval(runResolver, 10 * 60 * 1000).unref();

/** Адреса этого ПК в локальной сети — их вписывают в поле «адрес сервера» на телефоне. */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

// 0.0.0.0 — слушаем на всех интерфейсах, чтобы телефон в той же сети мог достучаться
app.listen(PORT, '0.0.0.0', () => {
  console.log('ScalpRadar API слушает http://localhost:' + PORT);
  const lan = lanAddresses();
  if (lan.length) {
    console.log('В локальной сети (для телефона): ' + lan.map((ip) => 'http://' + ip + ':' + PORT).join('  '));
  }
  console.log('ИИ-анализ: ' + (isAiConfigured() ? 'включён (' + (process.env.AI_MODEL || 'claude-opus-5') + ')' : 'выключен — задайте ANTHROPIC_API_KEY'));
  console.log('Журнал: ' + (journalBackend === 'supabase' ? 'облако Supabase' : 'локальные файлы data/journal'));
});
