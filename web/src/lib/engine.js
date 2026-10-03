/**
 * Сканирование рынка для интерфейса.
 *
 * Автономный режим: движок работает прямо в браузере или приложении и сам ходит
 * на публичные API бирж — свой сервер не нужен. Режим сервера добавляет то, чего
 * в браузере сделать нельзя: новостной фон и разбор ИИ (ключ хранится на сервере).
 */
import { scanMarket, technicalFinal, rankResults, marketRegime } from '@core/scan.js';
import { COINS } from '@core/config.js';
import { api } from './api.js';

export { COINS };

export async function runScan(settings, extraSymbols = []) {
  const chosen = settings.symbols?.length ? settings.symbols : COINS.map((c) => c.symbol);
  // Монеты с открытыми сделками сканируем всегда, даже если их убрали из списка
  const symbols = [...new Set([...chosen, ...extraSymbols])];
  const trade = { deposit: settings.deposit, riskPercent: settings.riskPercent, leverage: settings.leverage };

  if (settings.mode === 'server') {
    const res = await api.analyze({ ...trade, symbols, useAi: settings.useAi, legacySignals: settings.legacySignals });
    return { ...res, source: 'server' };
  }

  const scan = await scanMarket({ symbols, settings: trade, demoSymbol: settings.demo ? symbols[0] : null });
  if (!scan.analyses.length) {
    throw new Error(
      'Биржи не отвечают' + (scan.errors[0] ? ': ' + scan.errors[0].error : '') + '. Проверьте интернет.'
    );
  }
  const results = rankResults(scan.analyses.map((a) => technicalFinal(a, { legacy: settings.legacySignals })));
  return {
    source: 'local',
    generatedAt: new Date().toISOString(),
    elapsedMs: scan.elapsedMs,
    results,
    errors: scan.errors,
    market: {
      fearGreed: scan.fearGreed,
      breadth: scan.breadth == null ? null : Number(scan.breadth.toFixed(2)),
      regime: marketRegime(results),
      provider: scan.provider
    },
    news: []
  };
}
