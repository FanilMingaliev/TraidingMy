/**
 * Проигрывание сделки по барам. Общий код для бэктеста и журнала живых сигналов.
 *
 * Консервативные допущения: если бар задел и стоп, и цель — первым считается стоп;
 * комиссия берётся с каждой частичной фиксации.
 */

/**
 * @param {object} input
 * @param {object} input.trade        { direction, entry, stopLoss, targets: [{ label, price, closeShare }] }
 * @param {object[]} input.candles    свечи рабочего таймфрейма
 * @param {number} input.startIndex   бар, на открытии которого исполнен вход
 * @param {number} input.maxHoldBars  выход по времени
 * @param {number} input.feePercent   комиссия за круг, %
 * @param {boolean} [input.moveToBreakeven] перенос стопа на вход после TP1
 * @param {(index: number, barsHeld: number) => ({ code: string, reason: string } | null)} [input.exitSignal]
 *   досрочный выход по сигналу. Вызывается на закрытии бара, исполняется по
 *   открытию следующего — будущее не подглядывается.
 */
export function simulateTrade({
  trade,
  candles,
  startIndex,
  maxHoldBars,
  feePercent,
  moveToBreakeven = true,
  exitSignal = null
}) {
  const isLong = trade.direction === 'LONG';
  const risk = Math.abs(trade.entry - trade.stopLoss);
  if (!risk) return null;

  let stop = trade.stopLoss;
  let remaining = 1; // доля позиции
  let realizedR = 0;
  let feesR = 0;
  const hits = [];
  const halfFee = feePercent / 100 / 2;
  feesR += halfFee * (trade.entry / risk);

  const targets = trade.targets.map((t) => ({ ...t, done: false }));
  const end = Math.min(candles.length, startIndex + maxHoldBars);

  const finish = (price, bar, index, exitReason, exitCode) => {
    realizedR += ((isLong ? price - trade.entry : trade.entry - price) / risk) * remaining;
    feesR += halfFee * (price / risk) * remaining;
    return {
      ...trade,
      exitTime: bar.time,
      exitReason,
      exitCode,
      barsHeld: index - startIndex + 1,
      hits,
      resultR: Number((realizedR - feesR).toFixed(3))
    };
  };

  for (let i = startIndex; i < end; i++) {
    const bar = candles[i];
    const stopHit = isLong ? bar.low <= stop : bar.high >= stop;

    // Консервативно: если бар задел и стоп, и цель — считаем, что первым сработал стоп
    if (stopHit) {
      return finish(stop, bar, i, hits.length ? 'стоп после частичной фиксации' : 'стоп-лосс', 'stop');
    }

    for (const target of targets) {
      if (target.done) continue;
      const reached = isLong ? bar.high >= target.price : bar.low <= target.price;
      if (!reached) continue;
      target.done = true;
      const share = target.closeShare / 100;
      realizedR += ((isLong ? target.price - trade.entry : trade.entry - target.price) / risk) * share;
      feesR += halfFee * (target.price / risk) * share;
      remaining -= share;
      hits.push(target.label);
      // Перенос стопа в безубыток после первой цели — проверяемая гипотеза, а не догма
      if (moveToBreakeven && target.label === 'TP1') stop = trade.entry;
    }

    if (remaining <= 0.001) {
      remaining = 0;
      return finish(bar.close, bar, i, 'все цели достигнуты', 'targets');
    }

    if (exitSignal && i + 1 < end) {
      const exit = exitSignal(i, i - startIndex + 1);
      if (exit) {
        const next = candles[i + 1];
        return finish(next.open, next, i + 1, 'выход по сигналу: ' + exit.code, exit.code);
      }
    }
  }

  // Вышли по времени
  const lastIndex = end - 1;
  const lastBar = candles[lastIndex];
  if (!lastBar) return null;
  return finish(lastBar.close, lastBar, lastIndex, 'выход по времени', 'time');
}
