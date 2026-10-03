/**
 * Сетапы — конкретные рыночные ситуации с проверенным на истории результатом.
 * В отличие от общего счёта индикаторов, каждый сетап проверяется отдельно
 * (npm run validate) и выдаёт сигнал на вход только при выполнении своего условия.
 */
import { atr, last } from './indicators.js';
import { SETUPS } from './config.js';

const MS_5M = 300000;
const MS_1H = 3600000;

/** Оставляет только закрытые свечи: последняя может ещё формироваться. */
function closedOnly(candles, periodMs, now) {
  const tail = candles[candles.length - 1];
  return tail && now < tail.time + periodMs ? candles.slice(0, -1) : candles;
}

/**
 * Глубина пролива: падение за последний час в единицах часового ATR.
 * Нормировка на ATR делает величину сравнимой между монетами и режимами рынка —
 * −2% для биткоина и для мем-коина означают совершенно разное.
 *
 * @param {object[]} candles5  свечи 5м (последняя может быть незакрытой)
 * @param {object[]} candles1h свечи 1ч
 * @param {number} now
 */
export function flushMeasure(candles5, candles1h, now = Date.now()) {
  const c5 = closedOnly(candles5, MS_5M, now);
  if (c5.length < 13) return null;
  const tail = c5[c5.length - 1];
  // Часовые бары считаем закрытыми относительно момента закрытия последней пятиминутки
  const c1h = closedOnly(candles1h, MS_1H, tail.time + MS_5M);
  if (c1h.length < 30) return null;

  const atr1h = last(atr(c1h, 14));
  if (!atr1h) return null;
  const hourAgo = c5[c5.length - 13].close;
  const changePercent = (tail.close / hourAgo - 1) * 100;
  const atrPercent = (atr1h / tail.close) * 100;

  return {
    changePercent: Number(changePercent.toFixed(2)),
    atrPercent: Number(atrPercent.toFixed(2)),
    atr1h,
    // > 0 — цена упала; 3 означает «за час прошли три часовых ATR вниз»
    depth: Number((-changePercent / atrPercent).toFixed(2)),
    barTime: tail.time
  };
}

/**
 * Сетап «Отскок после пролива»: лонг после аномально резкого падения за час.
 * @returns {{ active: boolean, depth: number, threshold: number, progress: number, tier?: object, ... } | null}
 */
export function detectFlush(candles5, candles1h, now = Date.now()) {
  const m = flushMeasure(candles5, candles1h, now);
  if (!m) return null;
  const cfg = SETUPS.flush;
  const tier = [...cfg.tiers].reverse().find((t) => m.depth >= t.depth) || null;
  return {
    key: 'flush',
    name: cfg.name,
    direction: 'LONG',
    active: Boolean(tier),
    tier,
    depth: m.depth,
    threshold: cfg.tiers[0].depth,
    // насколько монета близка к срабатыванию, 0…1
    progress: Number(Math.max(0, Math.min(1, m.depth / cfg.tiers[0].depth)).toFixed(2)),
    changePercent: m.changePercent,
    atrPercent: m.atrPercent,
    stopDistance: m.atr1h * cfg.stopAtrMultiplier,
    targets: cfg.targets,
    maxHoldMinutes: cfg.maxHoldMinutes
  };
}
