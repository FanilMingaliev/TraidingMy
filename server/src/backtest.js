/**
 * Бэктест сигналов на исторических данных.
 *
 * Принципы, без которых результат был бы враньём:
 *  - сигнал считается тем же кодом (evaluate), что работает вживую;
 *  - старшие таймфреймы агрегируются из пятиминуток, поэтому последняя свеча
 *    незакрыта ровно так же, как в реальном времени, и будущее не подглядывается;
 *  - вход исполняется по цене открытия СЛЕДУЮЩЕЙ свечи после сигнала;
 *  - если в одном баре задеты и стоп, и тейк — засчитывается стоп (консервативно);
 *  - комиссия берётся с каждой частичной фиксации.
 */
import { evaluate } from '../../core/analysis.js';
import { loadKlines, loadDerivativeHistory, makeDerivativesLookup } from './history.js';
import { DEFAULTS } from '../../core/config.js';
import { simulateTrade } from '../../core/simulate.js';
import { checkSignalExit } from '../../core/position.js';

export { simulateTrade };

const MS_5M = 300000;
const WARMUP_BARS = 200; // рабочий таймфрейм
const WARMUP_MS_1H = 300 * 3600000; // EMA200 на часовом графике
const DEFAULT_HOLD_BARS = Math.round(DEFAULTS.maxHoldMinutes / 5);

/** Накопитель старшего таймфрейма: последний бар всегда «текущий», как вживую. */
function makeAggregator(periodMs) {
  const bars = [];
  return {
    push(c) {
      const bucket = Math.floor(c.time / periodMs) * periodMs;
      const lastBar = bars[bars.length - 1];
      if (!lastBar || lastBar.time !== bucket) {
        bars.push({
          time: bucket,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume
        });
        if (bars.length > 400) bars.shift();
      } else {
        lastBar.high = Math.max(lastBar.high, c.high);
        lastBar.low = Math.min(lastBar.low, c.low);
        lastBar.close = c.close;
        lastBar.volume += c.volume;
      }
    },
    view(n) {
      return bars.slice(-n);
    },
    size() {
      return bars.length;
    }
  };
}

function summarize(trades) {
  if (!trades.length) {
    return {
      trades: 0,
      winRate: 0,
      totalR: 0,
      avgR: 0,
      profitFactor: 0,
      maxDrawdownR: 0,
      avgBarsHeld: 0,
      wins: 0,
      losses: 0
    };
  }

  const wins = trades.filter((t) => t.resultR > 0);
  const losses = trades.filter((t) => t.resultR <= 0);
  const grossWin = wins.reduce((acc, t) => acc + t.resultR, 0);
  const grossLoss = Math.abs(losses.reduce((acc, t) => acc + t.resultR, 0));
  const totalR = trades.reduce((acc, t) => acc + t.resultR, 0);

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const t of [...trades].sort((a, b) => a.entryTime - b.entryTime)) {
    equity += t.resultR;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: Number(((wins.length / trades.length) * 100).toFixed(1)),
    totalR: Number(totalR.toFixed(2)),
    avgR: Number((totalR / trades.length).toFixed(3)),
    profitFactor: grossLoss ? Number((grossWin / grossLoss).toFixed(2)) : grossWin ? 99 : 0,
    maxDrawdownR: Number(maxDrawdown.toFixed(2)),
    avgBarsHeld: Number((trades.reduce((acc, t) => acc + t.barsHeld, 0) / trades.length).toFixed(1))
  };
}

/**
 * Считает сигнал на каждом баре периода. Самая тяжёлая часть, поэтому
 * результат переиспользуется при переборе параметров: сами сигналы от
 * порогов входа и правил сопровождения не зависят.
 */
export async function collectSignals({
  symbol,
  from,
  to,
  settings,
  weightOverrides = null,
  useDerivatives = true,
  benchmarkCandles = null,
  breadthAt = null
}) {
  const warmupFrom = from - Math.max(WARMUP_MS_1H, WARMUP_BARS * MS_5M) - MS_5M;
  const candles = await loadKlines(symbol, '5m', warmupFrom, to);
  if (candles.length < 400) throw new Error(symbol + ': недостаточно истории');

  const derivativeHistory = useDerivatives
    ? await loadDerivativeHistory(symbol, warmupFrom, to).catch(() => null)
    : null;
  const derivativesAt = makeDerivativesLookup(derivativeHistory);

  const benchmarkIndex = new Map();
  if (benchmarkCandles) benchmarkCandles.forEach((c, i) => benchmarkIndex.set(c.time, i));

  const agg15 = makeAggregator(900000);
  const agg1h = makeAggregator(3600000);
  const signals = [];

  for (let i = 0; i < candles.length; i++) {
    agg15.push(candles[i]);
    agg1h.push(candles[i]);

    const bar = candles[i];
    if (bar.time < from) continue;
    if (i < WARMUP_BARS || agg1h.size() < 220) continue;
    if (i + 2 >= candles.length) break;

    const btcSlice = benchmarkCandles
      ? (() => {
          const idx = benchmarkIndex.get(bar.time);
          return idx != null && idx >= WARMUP_BARS
            ? benchmarkCandles.slice(idx - WARMUP_BARS + 1, idx + 1)
            : null;
        })()
      : null;

    const result = evaluate({
      symbol,
      candles5: candles.slice(i - WARMUP_BARS + 1, i + 1),
      candles15: agg15.view(150),
      candles1h: agg1h.view(300),
      benchmarkCandles: btcSlice,
      derivatives: derivativeHistory ? derivativesAt(bar.time) : { available: false },
      newsInfo: null,
      settings,
      now: bar.time + MS_5M,
      weightOverrides,
      minScore: 0, // направление определяем при переборе порогов
      breadth: breadthAt ? breadthAt(bar.time) : null
    });

    signals.push({
      index: i,
      time: bar.time,
      score: result.signal.score,
      confidence: result.signal.confidence,
      riskScore: result.risk.score,
      stopDistance: Math.abs(result.plan.entry - result.plan.stopLoss),
      rMultiples: result.plan.targets.map((t) => t.rMultiple),
      closeShares: result.plan.targets.map((t) => t.closeShare),
      regime: result.regime,
      factors: Object.fromEntries(result.factors.map((f) => [f.key, f.score]))
    });
  }

  return { symbol, candles, signals };
}

/** Прогоняет сделки по заранее посчитанным сигналам с заданными параметрами. */
export function simulateSignals({
  symbol,
  candles,
  signals,
  minScore = DEFAULTS.minScoreToTrade,
  minConfidence = 0,
  maxHoldBars = DEFAULT_HOLD_BARS,
  moveToBreakeven = false,
  targetRs = null,
  maxRiskScore = 100,
  useRegimeFilter = true,
  exitRules = DEFAULTS.exit
}) {
  const trades = [];
  let openUntilIndex = -1;
  const byIndex = new Map(signals.map((sig) => [sig.index, sig]));

  for (const signal of signals) {
    if (signal.index <= openUntilIndex) continue;
    const direction = signal.score >= minScore ? 'LONG' : signal.score <= -minScore ? 'SHORT' : 'WAIT';
    if (direction === 'WAIT') continue;
    if (signal.confidence < minConfidence) continue;
    if (signal.riskScore > maxRiskScore) continue;
    if (useRegimeFilter && signal.regime && signal.regime.tradeable === false) continue;

    const fillBar = candles[signal.index + 1];
    if (!fillBar) break;

    const isLong = direction === 'LONG';
    const entry = fillBar.open;
    const stopDistance = signal.stopDistance;
    if (!stopDistance) continue;
    const stopLoss = isLong ? entry - stopDistance : entry + stopDistance;
    const targets = signal.rMultiples.map((r, idx) => {
      const rMultiple = targetRs ? targetRs[idx] : r;
      return {
        label: 'TP' + (idx + 1),
        closeShare: signal.closeShares[idx],
        price: isLong ? entry + stopDistance * rMultiple : entry - stopDistance * rMultiple
      };
    });

    const trade = simulateTrade({
      trade: {
        symbol,
        direction,
        entryTime: fillBar.time,
        entry,
        stopLoss,
        targets,
        confidence: signal.confidence,
        score: signal.score,
        riskScore: signal.riskScore,
        factors: signal.factors,
        regime: signal.regime
      },
      candles,
      startIndex: signal.index + 1,
      maxHoldBars,
      feePercent: DEFAULTS.feePercentRoundTrip,
      moveToBreakeven,
      // Тот же советник, что сопровождает сделку вживую
      exitSignal: exitRules
        ? (index, barsHeld) => {
            const now = byIndex.get(index);
            if (!now) return null;
            return checkSignalExit({
              direction,
              score: now.score,
              regime: now.regime,
              heldMinutes: barsHeld * 5,
              rules: exitRules
            });
          }
        : null
    });

    if (trade) {
      trades.push(trade);
      openUntilIndex = signal.index + trade.barsHeld;
    }
  }

  return trades;
}

/** Прогон по одной монете: расчёт сигналов плюс симуляция сделок. */
export async function backtestSymbol(options) {
  const collected = await collectSignals(options);
  const trades = simulateSignals({ ...options, ...collected });
  return {
    symbol: options.symbol,
    trades,
    evaluated: collected.signals.length,
    signals: trades.length
  };
}

/** Полный прогон по набору монет. */
export async function runBacktest({
  symbols,
  days = 14,
  settings = { deposit: 1000, riskPercent: 1, leverage: 5 },
  minConfidence = 0,
  maxHoldBars = DEFAULT_HOLD_BARS,
  weightOverrides = null,
  useDerivatives = true,
  onSymbolDone = null,
  minScore = undefined,
  moveToBreakeven = false,
  targetRs = null
}) {
  const to = Date.now();
  const from = to - days * 86400000;

  const warmupFrom = from - Math.max(WARMUP_MS_1H, WARMUP_BARS * MS_5M) - MS_5M;
  const benchmarkCandles = await loadKlines('BTCUSDT', '5m', warmupFrom, to);

  const perSymbol = {};
  const allTrades = [];

  for (const symbol of symbols) {
    const res = await backtestSymbol({
      symbol,
      from,
      to,
      settings,
      minConfidence,
      maxHoldBars,
      weightOverrides,
      useDerivatives,
      minScore,
      moveToBreakeven,
      targetRs,
      benchmarkCandles: symbol === 'BTCUSDT' ? null : benchmarkCandles
    });
    perSymbol[symbol] = { ...summarize(res.trades), evaluated: res.evaluated, signals: res.signals };
    allTrades.push(...res.trades);
    if (onSymbolDone) onSymbolDone(symbol, perSymbol[symbol]);
  }

  const longs = allTrades.filter((t) => t.direction === 'LONG');
  const shorts = allTrades.filter((t) => t.direction === 'SHORT');

  return {
    params: { symbols, days, minConfidence, maxHoldBars, useDerivatives, minScore, moveToBreakeven, targetRs, settings },
    period: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    total: summarize(allTrades),
    byDirection: { LONG: summarize(longs), SHORT: summarize(shorts) },
    perSymbol,
    trades: allTrades
  };
}

export { summarize };
