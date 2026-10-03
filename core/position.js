/**
 * Сопровождение открытой сделки: держать, фиксировать часть или закрывать.
 *
 * Правила выхода по сигналу (checkSignalExit) общие для живого советника и
 * бэктеста — история проверяет ровно тот код, который подсказывает вживую.
 */
import { DEFAULTS } from './config.js';

const MS_MINUTE = 60000;

/**
 * Выход по состоянию сигнала, без учёта цены.
 * @param {object} input
 * @param {'LONG'|'SHORT'} input.direction направление открытой сделки
 * @param {number} input.score         текущий общий счёт сигнала, −100…100
 * @param {object} [input.regime]      состояние рынка из computeRegime
 * @param {number} input.heldMinutes   сколько минут сделка открыта
 * @param {object} [input.rules]       переопределение DEFAULTS.exit
 * @returns {{ code: string, reason: string } | null}
 */
export function checkSignalExit({ direction, score, regime = null, heldMinutes, rules = DEFAULTS.exit }) {
  const sign = direction === 'LONG' ? 1 : -1;
  const aligned = score * sign; // > 0 — сигнал всё ещё за сделку

  if (rules.reverseScore != null && aligned <= -rules.reverseScore) {
    return {
      code: 'reverse',
      reason: 'Сигнал развернулся против сделки (счёт ' + (score > 0 ? '+' : '') + Math.round(score) + ')'
    };
  }
  if (
    rules.fadeScore != null &&
    heldMinutes >= (rules.fadeAfterMinutes || 0) &&
    aligned < rules.fadeScore
  ) {
    return {
      code: 'fade',
      reason: 'Перевес исчез: счёт ' + (score > 0 ? '+' : '') + Math.round(score) + ' больше не поддерживает сделку'
    };
  }
  if (rules.exitOnCascade && regime?.cascade) {
    return { code: 'cascade', reason: 'Идёт каскад ликвидаций — цена движется рывками' };
  }
  return null;
}

/** Результат сделки в R по зафиксированным частям и остатку по текущей цене. */
function resultInR(position, price) {
  const sign = position.direction === 'LONG' ? 1 : -1;
  const risk = Math.abs(position.entry - position.initialStop);
  if (!risk) return { realizedR: 0, openR: 0, totalR: 0 };
  const realizedR = (position.fills || []).reduce(
    (acc, f) => acc + (((f.price - position.entry) * sign) / risk) * f.share,
    0
  );
  const openR = (((price - position.entry) * sign) / risk) * position.remaining;
  return { realizedR, openR, totalR: realizedR + openR };
}

/**
 * Совет по открытой сделке.
 *
 * @param {object} position
 * @param {'LONG'|'SHORT'} position.direction
 * @param {number} position.entry        цена входа
 * @param {number} position.stopLoss     текущий стоп
 * @param {number} position.initialStop  стоп в момент входа (база для R)
 * @param {object[]} position.targets    [{ label, price, closeShare, done }]
 * @param {number} position.remaining    оставшаяся доля позиции, 0…1
 * @param {object[]} [position.fills]    частичные фиксации [{ price, share }]
 * @param {number} position.openedAt     время входа, мс
 * @param {number} [position.quantity]   объём в монетах (для расчёта в деньгах)
 *
 * @param {object} analysis  свежий результат evaluate() по этой монете
 * @param {number} [now]
 */
export function advisePosition(position, analysis, now = Date.now()) {
  const isLong = position.direction === 'LONG';
  const sign = isLong ? 1 : -1;
  const price = analysis.price;
  const rules = DEFAULTS.exit;
  const heldMinutes = Math.max(0, (now - position.openedAt) / MS_MINUTE);
  // У сетапа свой срок жизни сделки — он проверялся на истории именно с ним
  const maxHoldMinutes = position.maxHoldMinutes ?? rules.maxHoldMinutes;
  const minutesLeft = Math.round(maxHoldMinutes - heldMinutes);
  const risk = Math.abs(position.entry - position.initialStop);

  // Бары после входа: по ним видно, задевала ли цена стоп или цель, пока экран был закрыт.
  // Бар, в котором был вход, пропускаем — его экстремумы могли случиться до входа.
  const since = (analysis.candles || []).filter((c) => c.time > position.openedAt);
  const extremeHigh = Math.max(price, ...since.map((c) => c.high));
  const extremeLow = Math.min(price, ...since.map((c) => c.low));

  const r = resultInR(position, price);
  const pnlPercent = ((price - position.entry) / position.entry) * 100 * sign;
  const feeShare = DEFAULTS.feePercentRoundTrip / 100;
  const pnlMoney = position.quantity
    ? (position.fills || []).reduce(
        (acc, f) => acc + (f.price - position.entry) * sign * position.quantity * f.share,
        0
      ) +
      (price - position.entry) * sign * position.quantity * position.remaining -
      position.quantity * position.entry * feeShare
    : null;

  const show = (value) => Number(value).toFixed(position.precision ?? analysis.precision ?? 2);
  const nextTarget = position.targets.find((t) => !t.done) || null;
  const base = {
    price,
    heldMinutes: Math.round(heldMinutes),
    minutesLeft,
    pnlPercent: Number(pnlPercent.toFixed(2)),
    pnlR: Number(r.totalR.toFixed(2)),
    pnlMoney: pnlMoney == null ? null : Number(pnlMoney.toFixed(2)),
    nextTarget,
    stopDistancePercent: Number((((price - position.stopLoss) / price) * 100 * sign).toFixed(2)),
    score: analysis.signal.score
  };

  // 1. Стоп — без обсуждений
  const stopHit = isLong ? extremeLow <= position.stopLoss : extremeHigh >= position.stopLoss;
  if (stopHit) {
    return {
      ...base,
      action: 'CLOSE',
      code: 'stop',
      tone: 'danger',
      label: 'ЗАКРЫТЬ',
      title: 'Цена дошла до стоп-лосса',
      reasons: [
        'Стоп ' + show(position.stopLoss) + ' задет. Идея не сработала — закрывайте остаток, не пересиживайте.'
      ],
      exitPrice: position.stopLoss
    };
  }

  // 2. Достигнутые цели — фиксируем часть по плану
  const reached = position.targets.filter(
    (t) => !t.done && (isLong ? extremeHigh >= t.price : extremeLow <= t.price)
  );
  if (reached.length) {
    const target = reached[0];
    const isLast = position.targets.filter((t) => !t.done).length === 1;
    return {
      ...base,
      action: isLast ? 'CLOSE' : 'TAKE',
      code: 'target',
      tone: 'profit',
      label: isLast ? 'ЗАКРЫТЬ В ПЛЮС' : 'ЗАФИКСИРОВАТЬ ' + target.closeShare + '%',
      title: 'Цель ' + target.label + ' достигнута',
      reasons: [
        isLast
          ? 'Последняя цель ' + show(target.price) + ' взята — закрывайте остаток позиции.'
          : 'Цена дошла до ' + show(target.price) + '. Закройте ' + target.closeShare +
            '% позиции, остальное держите до следующей цели.'
      ],
      target,
      exitPrice: target.price
    };
  }

  // 3. Сигнал больше не за сделку. Для сделок по сетапу не применяется:
  // их план проверен на истории без досрочных выходов.
  const signalExit = position.setup ? null : checkSignalExit({
    direction: position.direction,
    score: analysis.signal.score,
    regime: analysis.regime,
    heldMinutes,
    rules
  });
  if (signalExit) {
    return {
      ...base,
      action: 'CLOSE',
      code: signalExit.code,
      tone: r.totalR >= 0 ? 'profit' : 'danger',
      label: 'ЗАКРЫТЬ',
      title: signalExit.code === 'cascade' ? 'Рынок стал опасным' : 'Сигнал изменился',
      reasons: [
        signalExit.reason + '.',
        r.totalR >= 0
          ? 'Сделка в плюсе на ' + r.totalR.toFixed(2) + 'R — заберите результат.'
          : 'Лучше принять ' + r.totalR.toFixed(2) + 'R сейчас, чем ждать полного стопа.'
      ],
      exitPrice: price
    };
  }

  // 4. Время вышло
  if (heldMinutes >= maxHoldMinutes) {
    return {
      ...base,
      action: 'CLOSE',
      code: 'time',
      tone: r.totalR >= 0 ? 'profit' : 'warn',
      label: 'ЗАКРЫТЬ',
      title: 'Вышло время сделки',
      reasons: [
        'Сделка открыта ' + Math.round(heldMinutes) + ' мин при плане до ' + maxHoldMinutes +
          ' мин. Идея не отработала за отведённое время — закрывайте по рынку.'
      ],
      exitPrice: price
    };
  }

  // 5. Держим. Собираем, на что смотреть
  const reasons = [];
  const warnings = [];
  const aligned = analysis.signal.score * sign;
  if (!position.setup) {
    reasons.push(
      aligned >= DEFAULTS.minScoreToTrade
        ? 'Сигнал по-прежнему сильный (счёт ' + (analysis.signal.score > 0 ? '+' : '') + analysis.signal.score + ')'
        : aligned > 0
          ? 'Сигнал ослаб, но остаётся на стороне сделки (счёт ' +
            (analysis.signal.score > 0 ? '+' : '') + analysis.signal.score + ')'
          : 'Сигнал нейтральный (счёт ' + analysis.signal.score + ') — следите за стопом'
    );
  }
  if (nextTarget) {
    const toTarget = (Math.abs(nextTarget.price - price) / price) * 100;
    reasons.push(
      'До ' + nextTarget.label + ' осталось ' + toTarget.toFixed(2) + '%, до стопа ' +
        Math.abs(base.stopDistancePercent).toFixed(2) + '%'
    );
  }
  reasons.push('Ничего не делайте: ждём цель, стоп или окончание времени.');
  if (minutesLeft <= 20) warnings.push('До выхода по времени ' + minutesLeft + ' мин');
  if (!position.setup && analysis.regime && !analysis.regime.tradeable) {
    warnings.push('Рынок перестал быть пригодным для входа: ' + analysis.regime.blockReason);
  }
  if (risk && Math.abs(price - position.stopLoss) < risk * 0.25) {
    warnings.push('Цена рядом со стопом');
  }

  return {
    ...base,
    action: 'HOLD',
    code: 'hold',
    tone: warnings.length ? 'warn' : 'neutral',
    label: 'ДЕРЖАТЬ',
    title: r.totalR >= 0 ? 'Сделка идёт по плану' : 'Сделка в минусе, стоп не задет',
    reasons,
    warnings
  };
}

/** Создаёт запись о сделке из плана сигнала. */
export function openPositionFromPlan(analysis, { entry = null, now = Date.now() } = {}) {
  const plan = analysis.plan;
  const isLong = plan.direction === 'LONG';
  const fill = entry ?? analysis.price;
  // Уровни сдвигаем на разницу между плановой и фактической ценой входа,
  // чтобы риск в R остался тем же
  const shift = fill - plan.entry;
  const digits = analysis.precision;
  const fix = (v) => Number((v + shift).toFixed(digits));
  return {
    id: analysis.symbol + '-' + now,
    symbol: analysis.symbol,
    base: analysis.base,
    name: analysis.name,
    precision: digits,
    direction: isLong ? 'LONG' : 'SHORT',
    entry: Number(fill.toFixed(digits)),
    stopLoss: fix(plan.stopLoss),
    initialStop: fix(plan.stopLoss),
    targets: plan.targets.map((t) => ({
      label: t.label,
      price: fix(t.price),
      rMultiple: t.rMultiple,
      closeShare: t.closeShare,
      done: false
    })),
    remaining: 1,
    fills: [],
    quantity: plan.position.quantity,
    notional: plan.position.notional,
    leverage: plan.position.leverage,
    riskAmount: plan.position.riskAmount,
    setup: plan.setup || null,
    maxHoldMinutes: plan.maxHoldMinutes,
    openedAt: now,
    scoreAtEntry: analysis.signal.score,
    confidenceAtEntry: analysis.final?.confidence ?? analysis.signal.confidence
  };
}

/** Частичная фиксация по цели: возвращает обновлённую сделку. */
export function applyPartial(position, targetLabel, price) {
  const target = position.targets.find((t) => t.label === targetLabel && !t.done);
  if (!target) return position;
  const share = Math.min(position.remaining, target.closeShare / 100);
  return {
    ...position,
    targets: position.targets.map((t) => (t.label === targetLabel ? { ...t, done: true } : t)),
    fills: [...position.fills, { label: targetLabel, price, share, at: Date.now() }],
    remaining: Number((position.remaining - share).toFixed(4))
  };
}

/** Полное закрытие: возвращает запись для истории с итогом в R и деньгах. */
export function closePosition(position, price, reason, now = Date.now()) {
  const sign = position.direction === 'LONG' ? 1 : -1;
  const fills = [...position.fills, { label: 'выход', price, share: position.remaining, at: now }];
  const risk = Math.abs(position.entry - position.initialStop);
  const grossR = risk
    ? fills.reduce((acc, f) => acc + (((f.price - position.entry) * sign) / risk) * f.share, 0)
    : 0;
  const feeR = risk ? ((DEFAULTS.feePercentRoundTrip / 100) * position.entry) / risk : 0;
  const money = position.quantity
    ? fills.reduce((acc, f) => acc + (f.price - position.entry) * sign * position.quantity * f.share, 0) -
      position.quantity * position.entry * (DEFAULTS.feePercentRoundTrip / 100)
    : null;
  return {
    ...position,
    fills,
    remaining: 0,
    closedAt: now,
    exitPrice: price,
    exitReason: reason,
    resultR: Number((grossR - feeR).toFixed(2)),
    resultMoney: money == null ? null : Number(money.toFixed(2)),
    resultPercent: Number((((price - position.entry) / position.entry) * 100 * sign).toFixed(2))
  };
}
