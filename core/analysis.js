/**
 * Движок анализа: считает технические факторы, объединяет их с новостным фоном,
 * определяет направление сделки, уровни входа/стопа/тейков, размер позиции и риск.
 */
import {
  ema,
  rsi,
  macd,
  bollinger,
  atr,
  adx,
  stochRsi,
  vwap,
  sma,
  findLevels,
  last,
  prevValue
} from './indicators.js';
import { getKlines, getTicker } from './market.js';
import { getDerivatives } from './derivatives.js';
import { correlationStats } from './correlation.js';
import { computeRegime } from './regime.js';
import { detectFlush } from './setups.js';
import { TIMEFRAMES, DEFAULTS, WEIGHTS, COIN_MAP, SETUPS } from './config.js';

/** Эталон рынка: движение альткоинов сравнивается с ним. */
const BENCHMARK = 'BTCUSDT';

/** Длительность свечи в миллисекундах по названию таймфрейма. */
const TIMEFRAME_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000 };

const clamp = (v, min = -1, max = 1) => Math.max(min, Math.min(max, v));
const round = (v, digits) => (v == null ? null : Number(v.toFixed(digits)));

/** Количество знаков после запятой для отображения цены. */
function pricePrecision(price) {
  if (price >= 1000) return 2;
  if (price >= 100) return 3;
  if (price >= 1) return 4;
  if (price >= 0.01) return 5;
  return 7;
}

/** Технические факторы. Каждый возвращает score -1..1 и человекочитаемое пояснение. */
function buildFactors(tf5, tf15, tf1h, context = {}) {
  const factors = [];
  const add = (key, label, score, weight, detail) =>
    factors.push({ key, label, score: Number(clamp(score).toFixed(2)), weight, detail });

  // 1. Старший тренд (1ч)
  const trendUp = tf1h.ema50 != null && tf1h.ema200 != null ? tf1h.ema50 - tf1h.ema200 : 0;
  const trendStrength = tf1h.ema200 ? clamp((trendUp / tf1h.ema200) * 60) : 0;
  const priceVsTrend = tf1h.ema50 ? clamp(((tf1h.price - tf1h.ema50) / tf1h.ema50) * 40) : 0;
  const trendScore = clamp(trendStrength * 0.6 + priceVsTrend * 0.4);
  add(
    'trend1h',
    'Старший тренд 1ч',
    trendScore,
    WEIGHTS.trend1h,
    trendScore > 0.15
      ? 'Цена выше EMA50, тренд 1ч восходящий — приоритет у лонгов'
      : trendScore < -0.15
        ? 'Цена ниже EMA50, тренд 1ч нисходящий — приоритет у шортов'
        : 'Тренд 1ч плоский, чёткого приоритета нет'
  );

  // 2. Порядок скользящих на рабочем ТФ
  let stack = 0;
  if (tf5.ema9 > tf5.ema21) stack += 0.4;
  else stack -= 0.4;
  if (tf5.ema21 > tf5.ema50) stack += 0.35;
  else stack -= 0.35;
  if (tf5.price > tf5.ema9) stack += 0.25;
  else stack -= 0.25;
  add(
    'emaStack',
    'EMA 9/21/50 (5м)',
    stack,
    WEIGHTS.emaStack,
    stack > 0.5
      ? 'Скользящие выстроены вверх — импульс покупателей'
      : stack < -0.5
        ? 'Скользящие выстроены вниз — импульс продавцов'
        : 'Скользящие переплетены — рынок без направления'
  );

  // 3. Подтверждение на 15м
  const conf15 =
    tf15.ema21 != null
      ? clamp(((tf15.price - tf15.ema21) / tf15.ema21) * 90) * 0.6 +
        (tf15.ema9 > tf15.ema21 ? 0.4 : -0.4)
      : 0;
  add(
    'ema15m',
    'Подтверждение 15м',
    conf15,
    WEIGHTS.ema15m,
    conf15 > 0.2
      ? '15м подтверждает рост'
      : conf15 < -0.2
        ? '15м подтверждает снижение'
        : '15м не даёт подтверждения'
  );

  // 4. MACD
  const histNow = tf5.macdHist ?? 0;
  const histPrev = tf5.macdHistPrev ?? 0;
  const histNorm = tf5.atr ? clamp((histNow / tf5.atr) * 3) : 0;
  const growing = Math.abs(histNow) > Math.abs(histPrev);
  const macdScore = clamp(histNorm * (growing ? 1 : 0.6));
  add(
    'macd',
    'MACD (5м)',
    macdScore,
    WEIGHTS.macd,
    histNow > 0
      ? 'Гистограмма MACD выше нуля' + (growing ? ' и растёт — импульс усиливается' : ', но затухает')
      : 'Гистограмма MACD ниже нуля' +
        (growing ? ' и снижается — давление продавцов растёт' : ', но затухает')
  );

  // 5. RSI: импульс + защита от входа на перегреве
  const r = tf5.rsi ?? 50;
  let rsiScore = clamp((r - 50) / 22);
  let rsiDetail = 'RSI ' + r.toFixed(1) + ' — нейтральная зона';
  if (r > 74) {
    rsiScore = clamp(rsiScore * 0.3 - 0.35);
    rsiDetail = 'RSI ' + r.toFixed(1) + ' — перекупленность, риск отката после входа в лонг';
  } else if (r < 26) {
    rsiScore = clamp(rsiScore * 0.3 + 0.35);
    rsiDetail = 'RSI ' + r.toFixed(1) + ' — перепроданность, вероятен отскок';
  } else if (Math.abs(r - 50) > 8) {
    rsiDetail = 'RSI ' + r.toFixed(1) + (r > 50 ? ' — импульс на стороне покупателей' : ' — импульс на стороне продавцов');
  }
  add('rsi', 'RSI 14 (5м)', rsiScore, WEIGHTS.rsi, rsiDetail);

  // 6. Stoch RSI — точки разворота
  const st = tf5.stoch;
  let stochScore = 0;
  let stochDetail = 'Stoch RSI в середине диапазона';
  if (st != null) {
    if (st < 20) {
      stochScore = 0.7;
      stochDetail = 'Stoch RSI ' + st.toFixed(0) + ' — зона перепроданности, разворот вверх вероятен';
    } else if (st > 80) {
      stochScore = -0.7;
      stochDetail = 'Stoch RSI ' + st.toFixed(0) + ' — зона перекупленности, разворот вниз вероятен';
    } else {
      stochScore = clamp((st - 50) / 60);
    }
  }
  add('stochRsi', 'Stoch RSI (5м)', stochScore, WEIGHTS.stochRsi, stochDetail);

  // 7. Полосы Боллинджера: положение и сжатие
  let bbScore = 0;
  let bbDetail = 'Цена в середине канала Боллинджера';
  if (tf5.bbUpper != null && tf5.bbLower != null && tf5.bbUpper !== tf5.bbLower) {
    const pctB = (tf5.price - tf5.bbLower) / (tf5.bbUpper - tf5.bbLower);
    const width = ((tf5.bbUpper - tf5.bbLower) / tf5.bbMiddle) * 100;
    if (pctB > 1) {
      bbScore = -0.4;
      bbDetail = 'Цена пробила верхнюю полосу — растянутость, ждём возврат в канал';
    } else if (pctB < 0) {
      bbScore = 0.4;
      bbDetail = 'Цена под нижней полосой — растянутость вниз, вероятен отскок';
    } else {
      bbScore = clamp((pctB - 0.5) * 1.6);
      bbDetail = 'Позиция в канале: ' + (pctB * 100).toFixed(0) + '%';
    }
    if (width < 1.2) {
      bbScore *= 0.5;
      bbDetail += '. Канал сжат (' + width.toFixed(2) + '%) — готовится импульсное движение';
    }
  }
  add('bollinger', 'Полосы Боллинджера', bbScore, WEIGHTS.bollinger, bbDetail);

  // 8. Объём. Текущая свеча ещё формируется, поэтому её объём приводим
  // к полной свече по доле прошедшего времени — иначе сравнение со средним занижено.
  const volRatio = tf5.volumeAvg ? tf5.volumeProjected / tf5.volumeAvg : 1;
  const bullCandle = tf5.price >= tf5.open;
  const volScore = clamp((volRatio - 1) * 1.1) * (bullCandle ? 1 : -1);
  const progressNote =
    tf5.candleProgress < 0.9 ? ' (свеча пройдена на ' + Math.round(tf5.candleProgress * 100) + '%)' : '';
  add(
    'volume',
    'Объём',
    volScore,
    WEIGHTS.volume,
    (volRatio > 1.5
      ? 'Всплеск объёма ×' + volRatio.toFixed(1) + (bullCandle ? ' на росте' : ' на падении')
      : volRatio < 0.6
        ? 'Объём ниже среднего (×' + volRatio.toFixed(1) + ') — движение слабое'
        : 'Объём в норме (×' + volRatio.toFixed(1) + ')') + progressNote
  );

  // 9. VWAP
  const vwapScore = tf5.vwap ? clamp(((tf5.price - tf5.vwap) / tf5.vwap) * 120) : 0;
  add(
    'vwap',
    'VWAP',
    vwapScore,
    WEIGHTS.vwap,
    vwapScore > 0
      ? 'Цена выше VWAP — контроль у покупателей'
      : 'Цена ниже VWAP — контроль у продавцов'
  );

  // 10. Импульс последних свечей
  const momentumScore = tf5.atr ? clamp((tf5.momentum / tf5.atr) * 0.8) : 0;
  add(
    'momentum',
    'Импульс (6 свечей)',
    momentumScore,
    WEIGHTS.momentum,
    'Движение за 30 минут: ' + (tf5.momentumPercent >= 0 ? '+' : '') + tf5.momentumPercent.toFixed(2) + '%'
  );

  // 11. Близость уровней
  const nearRes = tf5.levels.resistance[0];
  const nearSup = tf5.levels.support[0];
  const distRes = nearRes ? (nearRes - tf5.price) / tf5.atr : 99;
  const distSup = nearSup ? (tf5.price - nearSup) / tf5.atr : 99;
  let levelScore = 0;
  let levelDetail = 'Ближайшие уровни далеко, пространство для движения есть';
  if (distRes < 1 && distRes < distSup) {
    levelScore = -0.6;
    levelDetail = 'Сопротивление рядом (' + distRes.toFixed(1) + ' ATR) — лонг ограничен';
  } else if (distSup < 1 && distSup < distRes) {
    levelScore = 0.6;
    levelDetail = 'Поддержка рядом (' + distSup.toFixed(1) + ' ATR) — есть опора для лонга';
  } else if (distRes > 2.5 && distSup < distRes) {
    levelScore = 0.25;
    levelDetail = 'До сопротивления ' + distRes.toFixed(1) + ' ATR — запас хода вверх';
  }
  add('levels', 'Уровни', levelScore, WEIGHTS.levels, levelDetail);

  const deriv = context.derivatives;

  // 12. Ставка финансирования — где скопился перекос толпы.
  // Логика контртрендовая: за перегретые лонги платят те же лонги, и именно
  // они становятся топливом для каскада ликвидаций.
  if (deriv?.available && Number.isFinite(deriv.fundingPercent)) {
    const fp = deriv.fundingPercent;
    const excess = fp - 0.01; // 0.01% за 8ч — нейтральный уровень рынка
    let fundingScore = clamp(-excess / 0.045);
    if (Math.abs(excess) < 0.008) fundingScore *= 0.4;
    const trendNote =
      deriv.fundingTrend === 'rising'
        ? ', ставка растёт'
        : deriv.fundingTrend === 'falling'
          ? ', ставка снижается'
          : '';
    const fundingDetail =
      fp > 0.03
        ? 'Финансирование ' + fp + '% за 8ч (' + deriv.fundingAnnualPercent + '% годовых)' + trendNote +
          ' — лонги перегружены, растёт риск сквиза вниз'
        : fp < -0.005
          ? 'Отрицательное финансирование ' + fp + '%' + trendNote +
            ' — шорты платят лонгам, это топливо для отскока вверх'
          : 'Финансирование в норме: ' + fp + '% за 8ч' + trendNote;
    add('funding', 'Финансирование', fundingScore, WEIGHTS.funding, fundingDetail);
  }

  // 13. Открытый интерес против цены — четыре классических сценария.
  const oiChange = deriv?.available ? (deriv.oiChange1h ?? deriv.oiChange15m) : null;
  if (oiChange != null) {
    const priceChange = tf5.change1hPercent;
    const strength = clamp(Math.abs(oiChange) / 3, 0, 1);
    let oiScore = 0;
    let oiDetail = 'Открытый интерес стабилен — новых денег во фьючерсы не приходит';
    if (oiChange > 0.2 && priceChange > 0.1) {
      oiScore = 0.75 * strength;
      oiDetail = 'OI +' + oiChange + '% на растущей цене — заходят новые лонги, движение обеспечено деньгами';
    } else if (oiChange > 0.2 && priceChange < -0.1) {
      oiScore = -0.75 * strength;
      oiDetail = 'OI +' + oiChange + '% на падающей цене — набирают шорты, давление продавцов реальное';
    } else if (oiChange < -0.2 && priceChange > 0.1) {
      oiScore = 0.15 * strength;
      oiDetail = 'OI ' + oiChange + '% при росте цены — это закрытие шортов, а не покупки: топливо на исходе';
    } else if (oiChange < -0.2 && priceChange < -0.1) {
      oiScore = -0.15 * strength;
      oiDetail = 'OI ' + oiChange + '% при падении — лонги выходят и ликвидируются, движение может выдохнуться';
    }
    add('openInterest', 'Открытый интерес', oiScore, WEIGHTS.openInterest, oiDetail);
  }

  // 14. Позиционирование розницы и агрессия тейкеров
  if (deriv?.available && (deriv.longShortRatio != null || deriv.takerBuySellRatio != null)) {
    const parts = [];
    const notes = [];
    if (deriv.longShortRatio != null) {
      const ls = deriv.longShortRatio;
      parts.push({ score: clamp(-(ls - 1.8) / 1.5), weight: 0.55 });
      notes.push(
        ls > 2.5
          ? 'Розница в лонгах ' + ls.toFixed(2) + ':1 — толпа перекошена вверх'
          : ls < 1
            ? 'Розница в шортах (' + ls.toFixed(2) + ':1) — перекос вниз'
            : 'Позиционирование розницы обычное (' + ls.toFixed(2) + ':1)'
      );
    }
    if (deriv.takerBuySellRatio != null) {
      const taker = deriv.takerBuySellRatio;
      parts.push({ score: clamp((taker - 1) / 0.5), weight: 0.45 });
      notes.push(
        taker > 1.15
          ? 'тейкеры агрессивно покупают (' + taker.toFixed(2) + ')'
          : taker < 0.85
            ? 'тейкеры агрессивно продают (' + taker.toFixed(2) + ')'
            : 'агрессия тейкеров сбалансирована'
      );
    }
    const totalPartWeight = parts.reduce((acc, p) => acc + p.weight, 0);
    const posScore = parts.reduce((acc, p) => acc + p.score * p.weight, 0) / totalPartWeight;
    add('positioning', 'Позиционирование', posScore, WEIGHTS.positioning, notes.join('; '));
  }

  // 15. Контекст биткоина — альткоин против рынка почти всегда проигрывает
  const corr = context.correlation;
  if (corr && !context.isBenchmark) {
    const btcMove = clamp(corr.btcChange1h / 1.2);
    const trendPart = btcMove * Math.max(0, corr.correlation);
    const alphaPart = clamp(corr.alpha1h / 1) * 0.35;
    const btcScore = clamp(trendPart * 0.75 + alphaPart);
    const strengthWord =
      corr.alpha1h > 0.25 ? 'сильнее рынка' : corr.alpha1h < -0.25 ? 'слабее рынка' : 'вровень с рынком';
    add(
      'btcContext',
      'Контекст BTC',
      btcScore,
      WEIGHTS.btcContext,
      'BTC за час ' + (corr.btcChange1h >= 0 ? '+' : '') + corr.btcChange1h + '%, корреляция ' +
        corr.correlation + ', бета ' + corr.beta + '. Монета идёт ' + strengthWord +
        ' (альфа ' + (corr.alpha1h >= 0 ? '+' : '') + corr.alpha1h + '%)'
    );
  }

  return factors;
}

function snapshot5m(candles, intervalMs, now = Date.now()) {
  const closes = candles.map((c) => c.close);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  const rsiArr = rsi(closes, 14);
  const macdArr = macd(closes);
  const bb = bollinger(closes, 20, 2);
  const atrArr = atr(candles, 14);
  const adxArr = adx(candles, 14);
  const stochArr = stochRsi(closes);
  const vwapArr = vwap(candles, 96);
  // Среднее берём только по закрытым свечам, текущую (неполную) исключаем
  const closedVolumes = candles.slice(0, -1).map((c) => c.volume);
  const volSma = sma(closedVolumes, 20);
  const lastCandle = candles[candles.length - 1];
  const sixAgo = candles[candles.length - 7] || candles[0];
  const hourAgo = candles[candles.length - 13] || candles[0];
  // Какая доля текущей свечи уже прошла (нижняя граница защищает от деления на почти ноль)
  const candleProgress = Math.min(1, Math.max(0.12, (now - lastCandle.time) / intervalMs));

  return {
    price: lastCandle.close,
    open: lastCandle.open,
    volume: lastCandle.volume,
    // В первые секунды свечи проекция неустойчива — тогда берём объём последней закрытой свечи
    volumeProjected:
      candleProgress >= 0.3 || !candles[candles.length - 2]
        ? lastCandle.volume / candleProgress
        : candles[candles.length - 2].volume,
    candleProgress,
    volumeAvg: last(volSma),
    ema9: last(e9),
    ema21: last(e21),
    ema50: last(e50),
    rsi: last(rsiArr),
    macdHist: last(macdArr.histogram),
    macdHistPrev: prevValue(macdArr.histogram),
    bbUpper: last(bb.upper),
    bbMiddle: last(bb.middle),
    bbLower: last(bb.lower),
    atr: last(atrArr),
    adx: last(adxArr),
    stoch: last(stochArr),
    vwap: last(vwapArr),
    momentum: lastCandle.close - sixAgo.close,
    momentumPercent: ((lastCandle.close - sixAgo.close) / sixAgo.close) * 100,
    change1hPercent: ((lastCandle.close - hourAgo.close) / hourAgo.close) * 100,
    levels: findLevels(candles, 120, 3),
    closes: closes.slice(-60)
  };
}

/** Оценка риска сделки: 0 (спокойно) .. 100 (очень рискованно). */
function assessRisk({ tf5, tf15, tf1h, stopPercent, newsInfo, agreement, absScore, derivatives }) {
  const parts = [];
  const volatility = (tf5.atr / tf5.price) * 100; // ATR в % от цены
  let risk = 0;

  const volRisk = clamp(volatility / 1.2, 0, 1) * 24;
  risk += volRisk;
  parts.push({
    label: 'Волатильность (ATR ' + volatility.toFixed(2) + '%)',
    value: Math.round(volRisk),
    max: 24
  });

  const stopRisk = clamp(stopPercent / DEFAULTS.maxStopPercent, 0, 1) * 14;
  risk += stopRisk;
  parts.push({ label: 'Ширина стопа ' + stopPercent.toFixed(2) + '%', value: Math.round(stopRisk), max: 14 });

  const chop = tf5.adx == null ? 11 : clamp((25 - tf5.adx) / 25, 0, 1) * 18;
  risk += chop;
  parts.push({
    label: 'Слабость тренда (ADX ' + (tf5.adx == null ? 'н/д' : tf5.adx.toFixed(0)) + ')',
    value: Math.round(chop),
    max: 18
  });

  const conflictRisk = (1 - agreement) * 16;
  risk += conflictRisk;
  parts.push({ label: 'Разнобой индикаторов', value: Math.round(conflictRisk), max: 16 });

  let newsRisk = 0;
  if (newsInfo) {
    if (newsInfo.highImpact) newsRisk += 6;
    if (newsInfo.count === 0) newsRisk += 2;
    if (Math.abs(newsInfo.sentiment) > 0.5) newsRisk += 4;
  } else {
    newsRisk = 4;
  }
  risk += newsRisk;
  parts.push({ label: 'Новостной риск', value: Math.round(newsRisk), max: 12 });

  // Перегрев рынка фьючерсов: экстремальное финансирование и резкий сдвиг OI
  // означают скопление плеча, а значит и повышенный шанс каскадных ликвидаций
  let derivRisk = 0;
  const derivNotes = [];
  if (derivatives?.available) {
    if (Math.abs(derivatives.fundingPercent) > 0.03) {
      derivRisk += 6;
      derivNotes.push('перегретое финансирование');
    }
    if (Math.abs(derivatives.oiChange1h ?? 0) > 3) {
      derivRisk += 4;
      derivNotes.push('резкий сдвиг OI');
    }
    if (derivatives.nextFundingInMinutes != null && derivatives.nextFundingInMinutes < 15) {
      derivRisk += 2;
      derivNotes.push('скоро выплата финансирования');
    }
  } else {
    derivRisk = 4;
    derivNotes.push('нет данных по фьючерсам');
  }
  risk += derivRisk;
  parts.push({
    label: 'Рынок фьючерсов' + (derivNotes.length ? ': ' + derivNotes.join(', ') : ' спокоен'),
    value: Math.round(derivRisk),
    max: 12
  });

  const weakSignal = clamp((45 - absScore) / 45, 0, 1) * 4;
  risk += weakSignal;
  parts.push({ label: 'Слабость сигнала', value: Math.round(weakSignal), max: 4 });

  const score = Math.round(clamp(risk, 0, 100));
  const level = score < 33 ? 'Низкий' : score < 58 ? 'Средний' : score < 78 ? 'Высокий' : 'Экстремальный';
  return { score, level, parts, volatilityPercent: Number(volatility.toFixed(2)) };
}

/**
 * Расчёт входа, стопа, тейков и размера позиции.
 * @param {object} [input.setup] сетап со своими стопом и целями — тогда уровни берутся из него
 */
function buildTradePlan({ direction, tf5, settings, setup = null }) {
  const price = tf5.price;
  const atrValue = tf5.atr || price * 0.003;
  const isLong = direction === 'LONG';

  let stopDistance;
  if (setup) {
    stopDistance = setup.stopDistance;
  } else {
    // Стоп: ATR-множитель, но не ближе последнего свинга (с буфером 15% ATR)
    stopDistance = atrValue * DEFAULTS.atrStopMultiplier;
    const swingStop = isLong
      ? tf5.levels.support[0] ?? tf5.levels.swingLow
      : tf5.levels.resistance[0] ?? tf5.levels.swingHigh;
    if (swingStop) {
      const swingDistance = Math.abs(price - swingStop) + atrValue * 0.15;
      if (swingDistance > stopDistance && swingDistance < atrValue * 2.6) stopDistance = swingDistance;
    }
    const minDist = price * (DEFAULTS.minStopPercent / 100);
    const maxDist = price * (DEFAULTS.maxStopPercent / 100);
    stopDistance = Math.min(Math.max(stopDistance, minDist), maxDist);
  }
  const targetPlan = setup
    ? setup.targets
    : DEFAULTS.takeProfitR.map((r, i) => [r, [50, 30, 20][i]]);

  const entry = price;
  const stopLoss = isLong ? entry - stopDistance : entry + stopDistance;
  const stopPercent = (stopDistance / entry) * 100;

  // Оптимальная зона входа: откат к EMA9/VWAP в сторону против движения
  const pullback = [tf5.ema9, tf5.vwap].filter((v) => v != null);
  const pullbackLevel = pullback.length
    ? pullback.reduce((a, b) => a + b, 0) / pullback.length
    : entry;
  const entryZone = isLong
    ? [Math.min(entry, pullbackLevel), entry * 1.0008]
    : [entry * 0.9992, Math.max(entry, pullbackLevel)];

  const targets = targetPlan.map(([r, closeShare], i) => {
    let tp = isLong ? entry + stopDistance * r : entry - stopDistance * r;
    // Первую цель подрезаем под ближайший уровень, если он ближе.
    // Для сетапов уровни не трогаем: они проверялись на истории ровно такими.
    if (i === 0 && !setup) {
      const level = isLong ? tf5.levels.resistance[0] : tf5.levels.support[0];
      if (level) {
        const levelR = Math.abs(level - entry) / stopDistance;
        if (levelR > 0.55 && levelR < r) tp = isLong ? level - atrValue * 0.1 : level + atrValue * 0.1;
      }
    }
    return {
      label: 'TP' + (i + 1),
      price: tp,
      rMultiple: Number((Math.abs(tp - entry) / stopDistance).toFixed(2)),
      percent: Number((((tp - entry) / entry) * 100 * (isLong ? 1 : -1)).toFixed(2)),
      closeShare
    };
  });

  const riskAmount = (settings.deposit * settings.riskPercent) / 100;
  const quantity = riskAmount / stopDistance;
  let notional = quantity * entry;
  const maxNotional = settings.deposit * settings.leverage;
  let cappedByLeverage = false;
  if (notional > maxNotional) {
    notional = maxNotional;
    cappedByLeverage = true;
  }
  const finalQuantity = notional / entry;
  const actualRisk = finalQuantity * stopDistance;
  const margin = notional / settings.leverage;
  const fees = notional * (DEFAULTS.feePercentRoundTrip / 100);

  const profits = targets.map((t) => ({
    label: t.label,
    gross: finalQuantity * Math.abs(t.price - entry),
    net: finalQuantity * Math.abs(t.price - entry) - fees
  }));

  // Ожидаемая прибыль при частичном закрытии по плану
  const weightedProfit = targets.reduce(
    (acc, t, i) => acc + finalQuantity * Math.abs(t.price - entry) * (t.closeShare / 100),
    0
  );

  const rrToTp2 = targets[Math.min(1, targets.length - 1)].rMultiple;
  // Средневзвешенное R с учётом плана частичных фиксаций
  const expectedR = Number(
    targets.reduce((acc, t) => acc + t.rMultiple * (t.closeShare / 100), 0).toFixed(2)
  );

  return {
    direction,
    entry,
    entryZone,
    stopLoss,
    stopDistance,
    stopPercent: Number(stopPercent.toFixed(2)),
    targets,
    riskReward: rrToTp2,
    expectedR,
    position: {
      quantity: finalQuantity,
      notional,
      margin,
      leverage: settings.leverage,
      riskAmount: actualRisk,
      plannedRiskAmount: riskAmount,
      cappedByLeverage,
      fees
    },
    profit: {
      byTarget: profits,
      planned: weightedProfit - fees,
      maxLoss: actualRisk + fees
    }
  };
}

/**
 * Чистый расчёт сигнала по уже собранным данным.
 * Используется и живым сканером, и бэктестом — так история проверяет
 * ровно тот же код, который принимает решения в реальном времени.
 *
 * @param {object} input
 * @param {string} input.symbol
 * @param {object[]} input.candles5   свечи рабочего таймфрейма (последняя — текущая)
 * @param {object[]} input.candles15  свечи подтверждающего таймфрейма
 * @param {object[]} input.candles1h  свечи трендового таймфрейма
 * @param {object[]} [input.benchmarkCandles] свечи BTC того же таймфрейма
 * @param {object} [input.derivatives] сводка по фьючерсам
 * @param {object} [input.newsInfo]    новостной фон по монете
 * @param {object} input.settings      депозит, риск, плечо
 * @param {object} [input.ticker]      24ч статистика
 * @param {number} [input.now]         момент расчёта (для бэктеста — время закрытия свечи)
 * @param {object[]} [input.weights]   переопределение весов факторов (для калибровки)
 */
export function evaluate({
  symbol,
  candles5,
  candles15,
  candles1h,
  benchmarkCandles = null,
  derivatives = null,
  newsInfo = null,
  settings,
  ticker = null,
  now = Date.now(),
  weightOverrides = null,
  minScore = DEFAULTS.minScoreToTrade,
  breadth = null,
  includeCandles = false,
  demoSetup = false
}) {
  const coin = COIN_MAP.get(symbol) || { symbol, base: symbol.replace('USDT', ''), name: symbol };
  const isBenchmark = symbol === BENCHMARK;
  const k5 = { candles: candles5, provider: 'история' };
  const k15 = { candles: candles15 };
  const k1h = { candles: candles1h };
  const benchmark = benchmarkCandles ? { candles: benchmarkCandles } : null;

  const tf5 = snapshot5m(k5.candles, TIMEFRAME_MS[TIMEFRAMES.entry], now);
  const closes15 = k15.candles.map((c) => c.close);
  const closes1h = k1h.candles.map((c) => c.close);
  const tf15 = {
    price: last(closes15),
    ema9: last(ema(closes15, 9)),
    ema21: last(ema(closes15, 21)),
    rsi: last(rsi(closes15, 14))
  };
  const tf1h = {
    price: last(closes1h),
    ema50: last(ema(closes1h, 50)),
    ema200: last(ema(closes1h, 200)),
    rsi: last(rsi(closes1h, 14))
  };

  const correlation = benchmark
    ? correlationStats(
        k5.candles.map((c) => c.close),
        benchmark.candles.map((c) => c.close)
      )
    : null;

  const regime = computeRegime({ candles5, candles1h, derivatives, breadth });

  let factors = buildFactors(tf5, tf15, tf1h, { derivatives, correlation, isBenchmark });
  if (weightOverrides) {
    factors = factors.map((f) => ({ ...f, weight: weightOverrides[f.key] ?? f.weight }));
  }
  const totalWeight = factors.reduce((acc, f) => acc + f.weight, 0);
  const techScore = factors.reduce((acc, f) => acc + f.score * f.weight, 0) / totalWeight * 100;

  const news = newsInfo || { sentiment: 0, count: 0, highImpact: false, headlines: [] };
  const newsScore = news.sentiment * 100;
  const totalScore = clamp(techScore * 0.8 + newsScore * 0.2, -100, 100);

  // Согласованность факторов: доля веса, совпадающая по знаку с итогом
  const dominant = Math.sign(totalScore) || 1;
  const agreeWeight = factors
    .filter((f) => Math.sign(f.score) === dominant && Math.abs(f.score) > 0.1)
    .reduce((acc, f) => acc + f.weight, 0);
  const agreement = Number((agreeWeight / totalWeight).toFixed(2));

  const absScore = Math.abs(totalScore);
  let direction = 'WAIT';
  if (totalScore >= minScore) direction = 'LONG';
  else if (totalScore <= -minScore) direction = 'SHORT';

  // Состояние рынка важнее силы сигнала: в боковике и при сжатой волатильности
  // те же самые сигналы на истории теряли деньги на каждом отрезке
  const blockedByRegime = direction !== 'WAIT' && regime && !regime.tradeable ? regime.blockReason : null;
  if (blockedByRegime) direction = 'WAIT';

  // Сетап с проверенным результатом важнее общего счёта: если он сработал,
  // план строится по его собственным стопу и целям.
  let setup = detectFlush(candles5, candles1h, now);
  // Демо-режим: показываем, как выглядит сигнал, не дожидаясь настоящего пролива
  if (demoSetup && setup && !setup.active) {
    setup = { ...setup, active: true, demo: true, tier: SETUPS.flush.tiers[0] };
  }
  const activeSetup = setup?.active ? setup : null;

  // Для сигнала «ЖДАТЬ» план всё равно считаем — как сценарий на случай подтверждения,
  // в сторону текущего перевеса факторов.
  const planDirection = activeSetup
    ? activeSetup.direction
    : direction === 'WAIT'
      ? (totalScore < 0 ? 'SHORT' : 'LONG')
      : direction;
  const plan = buildTradePlan({ direction: planDirection, tf5, settings, setup: activeSetup });
  const risk = assessRisk({
    tf5,
    tf15,
    tf1h,
    stopPercent: plan.stopPercent,
    newsInfo: news,
    agreement,
    absScore,
    derivatives
  });

  // Уверенность: сила сигнала + согласованность + сила тренда - риск
  const trendQuality = tf5.adx == null ? 0.4 : clamp(tf5.adx / 40, 0, 1);
  let confidence =
    absScore * 0.5 + agreement * 100 * 0.25 + trendQuality * 100 * 0.15 - risk.score * 0.18;
  if (direction === 'WAIT') confidence *= 0.55;
  confidence = Math.round(clamp(confidence, 0, 100));

  const precision = pricePrecision(tf5.price);
  const topFactors = [...factors]
    .filter((f) => Math.abs(f.score) > 0.12)
    .sort((a, b) => Math.abs(b.score * b.weight) - Math.abs(a.score * a.weight))
    .slice(0, 5);

  return {
    symbol,
    base: coin.base,
    name: coin.name,
    price: tf5.price,
    precision,
    provider: k5.provider || 'история',
    ticker: ticker
      ? {
          changePercent24h: Number(ticker.changePercent24h.toFixed(2)),
          high24h: ticker.high24h,
          low24h: ticker.low24h,
          quoteVolume24h: ticker.quoteVolume24h
        }
      : null,
    signal: {
      direction,
      action: direction === 'LONG' ? 'ПОКУПАТЬ' : direction === 'SHORT' ? 'ПРОДАВАТЬ' : 'ЖДАТЬ',
      score: Math.round(totalScore),
      blockedByRegime,
      techScore: Math.round(techScore),
      newsScore: Math.round(newsScore),
      confidence,
      agreement
    },
    indicators: {
      rsi5m: round(tf5.rsi, 1),
      rsi15m: round(tf15.rsi, 1),
      rsi1h: round(tf1h.rsi, 1),
      adx: round(tf5.adx, 1),
      atr: round(tf5.atr, precision),
      atrPercent: risk.volatilityPercent,
      ema9: round(tf5.ema9, precision),
      ema21: round(tf5.ema21, precision),
      ema50: round(tf5.ema50, precision),
      vwap: round(tf5.vwap, precision),
      macdHist: tf5.macdHist,
      stochRsi: round(tf5.stoch, 1),
      volumeRatio: tf5.volumeAvg ? Number((tf5.volumeProjected / tf5.volumeAvg).toFixed(2)) : null,
      candleProgress: Number(tf5.candleProgress.toFixed(2)),
      trend1h: tf1h.ema50 > tf1h.ema200 ? 'Восходящий' : 'Нисходящий'
    },
    levels: {
      support: tf5.levels.support.map((v) => round(v, precision)),
      resistance: tf5.levels.resistance.map((v) => round(v, precision)),
      swingHigh: round(tf5.levels.swingHigh, precision),
      swingLow: round(tf5.levels.swingLow, precision)
    },
    setup: setup
      ? {
          key: setup.key,
          name: setup.name,
          direction: setup.direction,
          active: setup.active,
          demo: Boolean(setup.demo),
          tier: setup.tier,
          depth: setup.depth,
          threshold: setup.threshold,
          progress: setup.progress,
          changePercent: setup.changePercent,
          atrPercent: setup.atrPercent
        }
      : null,
    plan: {
      direction: planDirection,
      setup: activeSetup ? activeSetup.key : null,
      maxHoldMinutes: activeSetup ? activeSetup.maxHoldMinutes : DEFAULTS.maxHoldMinutes,
      hypothetical: !activeSetup && direction === 'WAIT',
      entry: round(plan.entry, precision),
      entryZone: plan.entryZone.map((v) => round(v, precision)),
      stopLoss: round(plan.stopLoss, precision),
      stopPercent: plan.stopPercent,
      targets: plan.targets.map((t) => ({ ...t, price: round(t.price, precision) })),
      riskReward: plan.riskReward,
      expectedR: plan.expectedR,
      position: {
        quantity: Number(plan.position.quantity.toFixed(6)),
        notional: round(plan.position.notional, 2),
        margin: round(plan.position.margin, 2),
        leverage: plan.position.leverage,
        riskAmount: round(plan.position.riskAmount, 2),
        cappedByLeverage: plan.position.cappedByLeverage,
        fees: round(plan.position.fees, 2)
      },
      profit: {
        byTarget: plan.profit.byTarget.map((p) => ({
          label: p.label,
          gross: round(p.gross, 2),
          net: round(p.net, 2)
        })),
        planned: round(plan.profit.planned, 2),
        maxLoss: round(plan.profit.maxLoss, 2)
      }
    },
    risk,
    regime,
    derivatives: derivatives?.available
      ? {
          fundingPercent: derivatives.fundingPercent,
          fundingAnnualPercent: derivatives.fundingAnnualPercent,
          fundingTrend: derivatives.fundingTrend,
          nextFundingInMinutes: derivatives.nextFundingInMinutes,
          openInterestValue: derivatives.openInterestValue,
          oiChange15m: derivatives.oiChange15m,
          oiChange1h: derivatives.oiChange1h,
          longShortRatio: derivatives.longShortRatio,
          takerBuySellRatio: derivatives.takerBuySellRatio,
          source: derivatives.source
        }
      : null,
    correlation,
    factors,
    reasons: topFactors.map((f) => ({
      label: f.label,
      detail: f.detail,
      direction: f.score > 0 ? 'up' : 'down'
    })),
    news: {
      sentiment: news.sentiment,
      count: news.count,
      highImpact: news.highImpact,
      headlines: news.headlines
    },
    sparkline: tf5.closes,
    // Последние 10 часов рабочего таймфрейма: для графика и для сопровождения сделки
    // (по ним видно, задевала ли цена стоп или цель)
    candles: includeCandles
      ? candles5.slice(-120).map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }))
      : undefined,
    updatedAt: new Date(now).toISOString()
  };
}

/** Живой анализ: загружает данные и передаёт их в evaluate. */
export async function analyzeCoin(symbol, settings, newsInfo, breadth = null, options = {}) {
  const isBenchmark = symbol === BENCHMARK;
  const [k5, k15, k1h, ticker, derivatives, benchmark] = await Promise.all([
    getKlines(symbol, TIMEFRAMES.entry, 200),
    getKlines(symbol, TIMEFRAMES.confirm, 150),
    getKlines(symbol, TIMEFRAMES.trend, 300),
    getTicker(symbol).catch(() => null),
    getDerivatives(symbol).catch(() => ({ available: false, error: 'источник недоступен' })),
    isBenchmark ? Promise.resolve(null) : getKlines(BENCHMARK, TIMEFRAMES.entry, 200).catch(() => null)
  ]);

  const result = evaluate({
    symbol,
    candles5: k5.candles,
    candles15: k15.candles,
    candles1h: k1h.candles,
    benchmarkCandles: benchmark?.candles || null,
    derivatives,
    newsInfo,
    settings,
    ticker,
    breadth,
    includeCandles: true,
    demoSetup: Boolean(options.demoSetup)
  });
  result.provider = k5.provider;
  return result;
}

/** Итоговый рейтинг возможности — по нему сортируем карточки. */
export function opportunityScore(analysis) {
  if (analysis.setup?.active) return 100 + analysis.setup.depth * 10;
  if (analysis.signal.direction === 'WAIT') return analysis.signal.confidence * 0.4 + (analysis.setup?.progress || 0) * 30;
  const rrBonus = clamp(analysis.plan.riskReward / 3, 0, 1) * 15;
  const riskPenalty = analysis.risk.score * 0.25;
  return analysis.signal.confidence + rrBonus - riskPenalty;
}

export { DEFAULTS };
