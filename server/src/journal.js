/**
 * Журнал живых сигналов и их исходов.
 *
 * Бэктест умеет проверять только то, что есть в истории: новостной фон
 * восстановить невозможно, а история открытого интереса живёт считанные дни.
 * Журнал закрывает этот пробел — он записывает каждый выданный сигнал целиком,
 * включая новости и вердикт ИИ, а через некоторое время дописывает, чем сделка
 * закончилась бы по собственным же уровням.
 *
 * Хранилище (облако Supabase или локальные файлы) выбирается в journal-store.js.
 */
import { getKlines } from '../../core/market.js';
import { simulateTrade } from '../../core/simulate.js';
import { DEFAULTS } from '../../core/config.js';
import { store, journalBackend } from './journal-store.js';

export { journalBackend };

/** Сигнал считается «созревшим» через два часа — столько живёт скальпинг-идея. */
const MATURITY_MS = (DEFAULTS.maxHoldMinutes || 120) * 60000;
/** Повторные записи по той же монете в этом окне не создаются. */
const DEDUPE_MS = 30 * 60000;

/**
 * Записывает выданные сигналы. Ждущие идеи (ЖДАТЬ) не пишем — проверять нечего.
 * @returns {Promise<number>} сколько записей добавлено
 */
export async function recordSignals(results, meta = {}) {
  const existing = await store.getSignals();
  const now = Date.now();
  const recent = new Map();
  for (const entry of existing) {
    const key = entry.symbol + ':' + entry.direction;
    const at = new Date(entry.time).getTime();
    if (now - at < DEDUPE_MS) recent.set(key, at);
  }

  let added = 0;
  for (const item of results) {
    const direction = item.final?.direction || item.signal.direction;
    if (direction === 'WAIT') continue;
    const key = item.symbol + ':' + direction;
    if (recent.has(key)) continue;

    await store.appendSignal({
      id: item.symbol + '-' + now + '-' + Math.random().toString(36).slice(2, 7),
      time: new Date(now).toISOString(),
      symbol: item.symbol,
      direction,
      action: item.final?.action || item.signal.action,
      score: item.signal.score,
      techScore: item.signal.techScore,
      confidence: item.final?.confidence ?? item.signal.confidence,
      source: item.final?.source || 'Техника',
      riskScore: item.risk.score,
      entry: item.plan.entry,
      stopLoss: item.plan.stopLoss,
      targets: item.plan.targets.map((t) => ({
        label: t.label,
        price: t.price,
        rMultiple: t.rMultiple,
        closeShare: t.closeShare
      })),
      factors: Object.fromEntries(item.factors.map((f) => [f.key, f.score])),
      regime: item.regime || null,
      newsSentiment: item.news?.sentiment ?? null,
      newsCount: item.news?.count ?? 0,
      aiAction: item.ai?.action || null,
      aiConviction: item.ai?.conviction ?? null,
      marketSentiment: meta.newsSentiment ?? null,
      fearGreed: meta.fearGreed?.value ?? null
    });
    recent.set(key, now);
    added++;
  }
  return added;
}

/**
 * Досчитывает исходы созревших сигналов по реальным свечам.
 * Правила сопровождения те же, что подтвердились на истории:
 * без переноса стопа в безубыток, удержание не дольше maxHoldMinutes.
 */
export async function resolveOutcomes() {
  const [signals, outcomeList] = await Promise.all([store.getSignals(), store.getOutcomes()]);
  const resolved = new Set(outcomeList.map((o) => o.id));
  const now = Date.now();
  const pending = signals.filter(
    (s) => !resolved.has(s.id) && now - new Date(s.time).getTime() >= MATURITY_MS
  );
  if (!pending.length) return { resolved: 0, pending: 0 };

  const bySymbol = new Map();
  for (const signal of pending) {
    if (!bySymbol.has(signal.symbol)) bySymbol.set(signal.symbol, []);
    bySymbol.get(signal.symbol).push(signal);
  }

  let count = 0;
  for (const [symbol, items] of bySymbol) {
    let candles;
    try {
      ({ candles } = await getKlines(symbol, '5m', 288));
    } catch {
      continue;
    }

    for (const signal of items) {
      const signalTime = new Date(signal.time).getTime();
      const startIndex = candles.findIndex((c) => c.time >= signalTime);
      if (startIndex < 0) {
        // Свечей за этот период уже нет — закрываем запись как непроверяемую
        await store.appendOutcome({
          id: signal.id,
          symbol,
          status: 'нет данных',
          resolvedAt: new Date().toISOString()
        });
        count++;
        continue;
      }

      const trade = simulateTrade({
        trade: {
          symbol,
          direction: signal.direction,
          entryTime: signalTime,
          entry: signal.entry,
          stopLoss: signal.stopLoss,
          targets: signal.targets
        },
        candles,
        startIndex,
        maxHoldBars: Math.round(MATURITY_MS / 300000),
        feePercent: DEFAULTS.feePercentRoundTrip,
        moveToBreakeven: false
      });

      if (!trade) continue;
      await store.appendOutcome({
        id: signal.id,
        symbol,
        direction: signal.direction,
        confidence: signal.confidence,
        source: signal.source,
        aiAction: signal.aiAction,
        status: 'посчитан',
        exitReason: trade.exitReason,
        hits: trade.hits,
        barsHeld: trade.barsHeld,
        resultR: trade.resultR,
        resolvedAt: new Date().toISOString()
      });
      count++;
    }
  }

  return { resolved: count, pending: pending.length - count };
}

const summarize = (list) => {
  if (!list.length) return { trades: 0, winRate: 0, totalR: 0, avgR: 0 };
  const wins = list.filter((o) => o.resultR > 0).length;
  const totalR = list.reduce((acc, o) => acc + o.resultR, 0);
  return {
    trades: list.length,
    winRate: Number(((wins / list.length) * 100).toFixed(1)),
    totalR: Number(totalR.toFixed(2)),
    avgR: Number((totalR / list.length).toFixed(3))
  };
};

/** Сводная статистика по исходам живых сигналов. */
export async function journalStats() {
  const [signals, allOutcomes] = await Promise.all([store.getSignals(), store.getOutcomes()]);
  const outcomes = allOutcomes.filter((o) => o.status === 'посчитан');
  const byId = new Map(signals.map((s) => [s.id, s]));

  const enriched = outcomes.map((o) => ({ ...byId.get(o.id), ...o }));
  const bucket = (min, max) => enriched.filter((o) => o.confidence >= min && o.confidence <= max);

  const bySymbol = {};
  for (const item of enriched) {
    bySymbol[item.symbol] = bySymbol[item.symbol] || [];
    bySymbol[item.symbol].push(item);
  }

  return {
    backend: journalBackend,
    recorded: signals.length,
    resolved: enriched.length,
    pending: signals.length - allOutcomes.length,
    total: summarize(enriched),
    byDirection: {
      LONG: summarize(enriched.filter((o) => o.direction === 'LONG')),
      SHORT: summarize(enriched.filter((o) => o.direction === 'SHORT'))
    },
    byConfidence: {
      '0-44': summarize(bucket(0, 44)),
      '45-59': summarize(bucket(45, 59)),
      '60+': summarize(bucket(60, 200))
    },
    byAi: {
      'подтверждён ИИ': summarize(
        enriched.filter((o) => (o.direction === 'LONG' && o.aiAction === 'BUY') || (o.direction === 'SHORT' && o.aiAction === 'SELL'))
      ),
      'без ИИ или расхождение': summarize(
        enriched.filter((o) => !((o.direction === 'LONG' && o.aiAction === 'BUY') || (o.direction === 'SHORT' && o.aiAction === 'SELL')))
      )
    },
    bySymbol: Object.fromEntries(Object.entries(bySymbol).map(([symbol, list]) => [symbol, summarize(list)])),
    recent: enriched
      .sort((a, b) => new Date(b.resolvedAt) - new Date(a.resolvedAt))
      .slice(0, 20)
      .map((o) => ({
        symbol: o.symbol,
        direction: o.direction,
        confidence: o.confidence,
        time: o.time,
        resultR: o.resultR,
        exitReason: o.exitReason
      }))
  };
}
