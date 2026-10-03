/**
 * Определение состояния рынка.
 *
 * Идея простая: одни и те же сигналы ведут себя по-разному в спокойном тренде,
 * в вялом боковике и в панике. Здесь состояние описывается четырьмя
 * измеримыми признаками, а не оценкой «на глаз».
 */
import { adx, atr, ema, last } from './indicators.js';
import { DEFAULTS } from './config.js';

/**
 * @param {object} input
 * @param {object[]} input.candles5   свечи рабочего таймфрейма
 * @param {object[]} input.candles1h  свечи трендового таймфрейма
 * @param {object} [input.derivatives] сводка по фьючерсам (для каскада ликвидаций)
 * @param {number} [input.breadth]    синхронность рынка: доля растущих минус доля падающих, −1…1
 */
export function computeRegime({ candles5, candles1h, derivatives = null, breadth = null }) {
  const closes1h = candles1h.map((c) => c.close);
  const price = last(candles5).close;

  // 1. Сила тренда: ADX на часовом графике.
  // Направление меряем по наклону EMA50 за последние 12 часов и положению цены
  // относительно неё. Прежний вариант (наклон EMA200 за сутки) оказался настолько
  // медленным, что за две недели ни разу не показал «вниз».
  const adx1h = last(adx(candles1h, 14));
  const ema50Series = ema(closes1h, 50);
  const ema50Now = last(ema50Series);
  const ema50Back = ema50Series.length > 62 ? ema50Series[ema50Series.length - 13] : null;
  const slopePercent =
    ema50Now && ema50Back ? ((ema50Now - ema50Back) / ema50Back) * 100 : null;
  const priceVsEma50 = ema50Now ? ((price - ema50Now) / ema50Now) * 100 : null;

  const trendState = adx1h != null && adx1h >= 25 ? 'тренд' : 'боковик';
  let trendDirection = 'плоский';
  if (slopePercent != null) {
    const up = slopePercent > 0.2 || (slopePercent > 0 && (priceVsEma50 ?? 0) > 0.3);
    const down = slopePercent < -0.2 || (slopePercent < 0 && (priceVsEma50 ?? 0) < -0.3);
    if (up && !down) trendDirection = 'вверх';
    else if (down && !up) trendDirection = 'вниз';
  }

  // 2. Волатильность: текущий ATR против собственной нормы за последние сутки-двое
  const atrSeries = atr(candles5, 14).filter((v) => v != null);
  const atrNow = atrSeries.length ? atrSeries[atrSeries.length - 1] : null;
  const window = atrSeries.slice(-Math.min(atrSeries.length, 288));
  const sorted = [...window].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const atrRatio = atrNow && median ? atrNow / median : null;
  const atrPercent = atrNow ? (atrNow / price) * 100 : null;

  const volatilityState =
    atrRatio == null ? 'норма' : atrRatio < 0.7 ? 'сжатие' : atrRatio <= 1.6 ? 'норма' : 'всплеск';

  // 3. Синхронность рынка
  const alignmentState =
    breadth == null ? 'неизвестно' : Math.abs(breadth) >= 0.6 ? 'синхронный' : 'разнобой';

  // 4. Каскад ликвидаций: объём выше нормы при быстро тающем открытом интересе
  const volumes = candles5.slice(-21, -1).map((c) => c.volume);
  const volAvg = volumes.length ? volumes.reduce((a, b) => a + b, 0) / volumes.length : null;
  const volRatio = volAvg ? last(candles5).volume / volAvg : null;
  const oiDrop = derivatives?.available ? (derivatives.oiChange1h ?? 0) : 0;
  const cascade = Boolean(volRatio && volRatio > 2.5 && oiDrop < -1.5);

  // Пригодность состояния для торговли — вывод из бэктеста, а не мнение
  const filter = DEFAULTS.regimeFilter || {};
  let blockReason = null;
  if (filter.enabled) {
    if (filter.requireTrend && trendState === 'боковик') {
      blockReason = 'боковик: часового тренда нет (ADX ' + (adx1h == null ? 'н/д' : adx1h.toFixed(0)) +
        '), в таком рынке сигналы систематически убыточны';
    } else if (filter.blockSqueeze && volatilityState === 'сжатие') {
      blockReason = 'волатильность сжата (' + (atrRatio ? atrRatio.toFixed(2) : '—') +
        ' от нормы) — движения не хватает, чтобы окупить комиссию';
    } else if (filter.blockCascade && cascade) {
      blockReason = 'идёт каскад ликвидаций — цена движется рывками, стоп срабатывает случайно';
    }
  }

  return {
    label: trendState + '/' + volatilityState,
    tradeable: !blockReason,
    blockReason,
    trendState,
    trendDirection,
    volatilityState,
    alignmentState,
    cascade,
    adx1h: adx1h == null ? null : Number(adx1h.toFixed(1)),
    slopePercent: slopePercent == null ? null : Number(slopePercent.toFixed(2)),
    priceVsEma50: priceVsEma50 == null ? null : Number(priceVsEma50.toFixed(2)),
    atrPercent: atrPercent == null ? null : Number(atrPercent.toFixed(2)),
    atrRatio: atrRatio == null ? null : Number(atrRatio.toFixed(2)),
    breadth: breadth == null ? null : Number(breadth.toFixed(2))
  };
}

/**
 * Синхронность рынка по набору монет: доля растущих за час минус доля падающих.
 * @param {number[]} changes изменения цены за час в процентах
 */
export function computeBreadth(changes) {
  const valid = changes.filter((c) => Number.isFinite(c));
  if (!valid.length) return null;
  const up = valid.filter((c) => c > 0.05).length;
  const down = valid.filter((c) => c < -0.05).length;
  return (up - down) / valid.length;
}

/** Человекочитаемое пояснение состояния. */
export function describeRegime(regime) {
  if (!regime) return '';
  const parts = [];
  parts.push(
    regime.trendState === 'тренд'
      ? 'Часовой тренд выражен (ADX ' + regime.adx1h + '), направление ' + regime.trendDirection
      : 'Часового тренда нет (ADX ' + regime.adx1h + ') — рынок в боковике'
  );
  if (regime.volatilityState === 'всплеск') {
    parts.push('волатильность выше нормы в ' + regime.atrRatio + ' раза');
  } else if (regime.volatilityState === 'сжатие') {
    parts.push('волатильность сжата (' + regime.atrRatio + ' от нормы)');
  }
  if (regime.alignmentState === 'синхронный') {
    parts.push('рынок движется синхронно');
  } else if (regime.alignmentState === 'разнобой') {
    parts.push('монеты идут вразнобой');
  }
  if (regime.cascade) parts.push('идёт каскад ликвидаций');
  return parts.join(', ');
}
