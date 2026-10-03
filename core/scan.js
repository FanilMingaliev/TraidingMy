/**
 * Сканирование рынка: общий сценарий для сервера и для автономного режима
 * (браузер или приложение ходят на биржи напрямую, без своего бэкенда).
 */
import { analyzeCoin, opportunityScore } from './analysis.js';
import { getKlines, getFearGreed, providerStatus } from './market.js';
import { computeBreadth } from './regime.js';
import { COINS } from './config.js';

/**
 * Считает технику по каждой монете.
 * @param {object} input
 * @param {string[]} [input.symbols]
 * @param {object} input.settings        депозит, риск, плечо
 * @param {object} [input.newsByCoin]    новостной фон по монетам (есть только на сервере)
 */
export async function scanMarket({ symbols = COINS.map((c) => c.symbol), settings, newsByCoin = {}, demoSymbol = null }) {
  const started = Date.now();
  const fearGreedPromise = getFearGreed();

  // Синхронность рынка считаем до анализа монет: свечи потом берутся из кэша,
  // поэтому лишних обращений к бирже это не создаёт
  const klines = await Promise.allSettled(symbols.map((symbol) => getKlines(symbol, '5m', 200)));
  const hourChanges = klines
    .filter((r) => r.status === 'fulfilled' && r.value.candles.length > 13)
    .map((r) => {
      const candles = r.value.candles;
      const before = candles[candles.length - 13].close;
      return before ? ((candles[candles.length - 1].close - before) / before) * 100 : null;
    })
    .filter((v) => v != null);
  const breadth = computeBreadth(hourChanges);

  const settled = await Promise.allSettled(
    symbols.map((symbol) =>
      analyzeCoin(symbol, settings, newsByCoin?.[symbol], breadth, { demoSetup: symbol === demoSymbol })
    )
  );

  const analyses = [];
  const errors = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') analyses.push(r.value);
    else errors.push({ symbol: symbols[i], error: r.reason?.message || String(r.reason) });
  });

  return {
    analyses,
    errors,
    breadth,
    fearGreed: await fearGreedPromise,
    provider: providerStatus().preferred,
    elapsedMs: Date.now() - started
  };
}

/**
 * Итоговое решение по монете.
 *
 * Сигнал на вход даёт только сетап (и только при положительной форме — см.
 * applySetupHealth). Общий счёт индикаторов на истории убыточен, поэтому по
 * умолчанию он справочный; включить его как сигнал можно флагом legacy.
 */
export function technicalFinal(analysis, { legacy = false } = {}) {
  const setup = analysis.setup;
  if (setup?.active) {
    return {
      ...analysis,
      final: {
        action: 'ВХОДИТЬ В ЛОНГ',
        direction: 'LONG',
        confidence: setup.tier.winRate,
        source: (setup.demo ? 'ДЕМО · ' : '') + setup.name,
        setup: setup.key,
        demo: setup.demo,
        note: setup.demo
          ? 'Это пример: настоящего пролива сейчас нет. Так будет выглядеть сигнал, когда он появится.'
          : 'Падение ' + setup.changePercent + '% за час — это ' + setup.depth +
            ' часовых ATR. В последние недели после таких проливов цена чаще отскакивала.'
      }
    };
  }
  if (legacy && analysis.signal.direction !== 'WAIT') {
    return {
      ...analysis,
      final: {
        action: analysis.signal.direction === 'LONG' ? 'ВХОДИТЬ В ЛОНГ' : 'ВХОДИТЬ В ШОРТ',
        direction: analysis.signal.direction,
        confidence: analysis.signal.confidence,
        source: 'Тренд по индикаторам',
        experimental: true,
        note: 'Экспериментальный сигнал: на истории он преимущества не показал.'
      }
    };
  }
  return {
    ...analysis,
    plan: { ...analysis.plan, hypothetical: true },
    final: {
      action: 'ЖДАТЬ',
      direction: 'WAIT',
      confidence: 0,
      source: 'Нет сетапа',
      note: analysis.signal.blockedByRegime || null
    }
  };
}

/** Сортировка: сначала сделки, внутри — по уверенности и привлекательности. */
export function rankResults(results) {
  return results
    .map((a) => ({ ...a, opportunity: Math.round(opportunityScore(a)) }))
    .sort((a, b) => {
      const rank = (x) => (x.final.direction === 'WAIT' ? 0 : 1);
      if (rank(b) !== rank(a)) return rank(b) - rank(a);
      return b.final.confidence - a.final.confidence || b.opportunity - a.opportunity;
    });
}

/** Преобладающее состояние рынка по набору монет. */
export function marketRegime(results) {
  const counts = new Map();
  for (const r of results) {
    if (!r.regime) continue;
    counts.set(r.regime.label, (counts.get(r.regime.label) || 0) + 1);
  }
  if (!counts.size) return null;
  const [label, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return {
    label,
    share: Math.round((count / results.length) * 100),
    tradeable: results.filter((r) => r.regime?.tradeable).length,
    total: results.length
  };
}

/**
 * Учитывает форму сетапа: если за последние недели он убыточен (или данных
 * о форме нет), вход не выдаётся — сигнал помечается как пропущенный.
 * Экспериментальные тренд-сигналы форма не затрагивает.
 */
export function applySetupHealth(result, health) {
  if (result.final?.setup !== 'flush' || result.final.demo) return result;
  if (health?.verdict === 'good') return result;
  const why = !health
    ? 'Форма сетапа ещё не посчитана.'
    : health.verdict === 'bad'
      ? 'За последние ' + health.days + ' дн. сетап в минусе (' + health.avgR + 'R в среднем на ' + health.trades + ' сделках).'
      : 'За последние ' + health.days + ' дн. слишком мало сделок (' + health.trades + '), чтобы судить о форме.';
  return {
    ...result,
    plan: { ...result.plan, hypothetical: true },
    final: {
      action: 'ПРОПУСТИТЬ',
      direction: 'WAIT',
      confidence: 0,
      source: result.final.source,
      skipped: true,
      note: why + ' В таком рынке проливы чаще продолжаются, чем отскакивают.'
    }
  };
}
