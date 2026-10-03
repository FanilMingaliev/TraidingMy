import { useMemo } from 'react';
import { Activity, AlertTriangle, Layers, LineChart, Loader2, Sparkles, Target, TrendingDown } from 'lucide-react';
import { formatCompact, formatDuration, formatMoney, formatPercent, formatPrice, formatQuantity, riskColor } from '../lib/format.js';
import PriceChart from './PriceChart.jsx';
import { Row, Section, Sheet, ghostButton, primaryButton } from './ui.jsx';

/** Подробный разбор монеты: график с уровнями, сетап, план, контекст рынка. */
export default function DetailDrawer({ item, position, inPosition, onClose, onEnter, canAskAi, onAskAi, review, reviewLoading }) {
  const { final, plan, setup, signal, regime, derivatives } = item;
  const hasSignal = final.direction !== 'WAIT';

  // Если по монете открыта сделка — на графике её уровни, иначе уровни плана
  const lines = useMemo(() => {
    if (position) {
      return [
        { price: position.entry, color: '#94a3b8', title: 'вход' },
        { price: position.stopLoss, color: '#ff4d6d', title: 'стоп' },
        ...position.targets.map((t) => ({ price: t.price, color: '#00e5a0', title: t.label }))
      ];
    }
    if (!hasSignal) return [];
    return [
      { price: plan.stopLoss, color: '#ff4d6d', title: 'стоп' },
      ...plan.targets.map((t) => ({ price: t.price, color: '#00e5a0', title: t.label }))
    ];
  }, [position, plan, hasSignal]);

  const maxWeight = Math.max(...item.factors.map((f) => f.weight));

  return (
    <Sheet
      wide
      onClose={onClose}
      title={item.name + ' · $' + formatPrice(item.price, item.precision)}
      subtitle={hasSignal ? final.action + ' · ' + final.source : 'Сигнала на вход нет'}
    >
      <div className="grid gap-3">
        <div className="rounded-2xl border border-white/8 bg-black/25 p-2">
          <PriceChart candles={item.candles || []} lines={lines} precision={item.precision} />
        </div>

        {setup && (
          <Section icon={TrendingDown} title={setup.name}>
            <div className="flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: Math.round(setup.progress * 100) + '%',
                    background: setup.active && !setup.demo ? 'var(--color-mint-500)' : 'var(--color-amber-signal)'
                  }}
                />
              </div>
              <span className="num text-[12.5px] font-bold">
                {Math.max(0, setup.depth).toFixed(2)} / {setup.threshold}
              </span>
            </div>
            <p className="mt-2 text-[12px] leading-snug text-slate-400">
              За час цена изменилась на <b className="text-slate-200">{formatPercent(setup.changePercent)}</b> при обычном
              часовом размахе {setup.atrPercent}%. Сигнал на покупку появляется, когда падение за час достигает{' '}
              {setup.threshold} часовых размахов и сетап при этом «в форме» за последние недели.
              {setup.demo ? ' Сейчас показан демо-сигнал.' : setup.active ? ' Условие выполнено.' : ' Сейчас условие не выполнено.'}
            </p>
          </Section>
        )}

        {hasSignal && (
          <Section icon={Target} title="План сделки">
            <div className="grid gap-x-6 sm:grid-cols-2">
              <div>
                <Row label="Вход" value={formatPrice(plan.entry, item.precision)} />
                <Row label="Стоп-лосс" value={formatPrice(plan.stopLoss, item.precision) + '  (−' + plan.stopPercent + '%)'} color="var(--color-rose-signal)" />
                {plan.targets.map((t) => (
                  <Row
                    key={t.label}
                    label={t.label + ' — закрыть ' + t.closeShare + '%'}
                    value={formatPrice(t.price, item.precision) + '  (+' + t.percent + '%, ' + t.rMultiple + 'R)'}
                    color="var(--color-mint-500)"
                  />
                ))}
                <Row label="Держать не дольше" value={formatDuration(plan.maxHoldMinutes)} />
              </div>
              <div>
                <Row label="Объём" value={formatQuantity(plan.position.quantity) + ' ' + item.base} />
                <Row label="Сумма позиции" value={'$' + formatMoney(plan.position.notional)} />
                <Row label={'Маржа при плече ×' + plan.position.leverage} value={'$' + formatMoney(plan.position.margin)} />
                <Row label="Убыток по стопу с комиссией" value={'−$' + formatMoney(plan.profit.maxLoss)} color="var(--color-rose-signal)" />
                <Row label="Прибыль по плану" value={'+$' + formatMoney(plan.profit.planned)} color="var(--color-mint-500)" />
              </div>
            </div>
            {!position && (
              <button onClick={() => onEnter(item)} disabled={inPosition} className={primaryButton + ' mt-3 w-full'}>
                {inPosition ? 'Сделка уже открыта' : 'Я вошёл в сделку'}
              </button>
            )}
          </Section>
        )}

        {canAskAi && (
          <Section icon={Sparkles} title="Разбор ИИ">
            {review && !review.error ? (
              <div className="grid gap-2">
                <p className="text-[13px] font-semibold leading-snug text-slate-200">{review.review.headline}</p>
                <ul className="grid gap-1">
                  {(review.review.why || []).map((reason) => (
                    <li key={reason} className="text-[12px] leading-snug text-slate-400">
                      · {reason}
                    </li>
                  ))}
                </ul>
                {review.review.nextStep && (
                  <p className="rounded-lg border border-[rgba(139,124,255,0.25)] bg-[rgba(139,124,255,0.08)] px-2.5 py-2 text-[12px] leading-snug text-[var(--color-violet-signal)]">
                    {review.review.nextStep}
                  </p>
                )}
                <p className="text-[10.5px] text-slate-500">
                  {review.model} · мнение модели справочное и на решение о сигнале не влияет
                </p>
              </div>
            ) : (
              <>
                {review?.error && <p className="mb-2 text-[12px] text-[var(--color-rose-signal)]">{review.error}</p>}
                <button onClick={() => onAskAi(item.symbol)} disabled={reviewLoading} className={ghostButton + ' w-full'}>
                  {reviewLoading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  {reviewLoading ? 'Модель думает…' : 'Спросить ИИ по этой монете'}
                </button>
              </>
            )}
          </Section>
        )}

        <Section icon={Layers} title="Состояние рынка">
          <div className="grid gap-x-6 sm:grid-cols-2">
            <div>
              <Row label="Часовой тренд" value={regime ? regime.trendState + ', ' + regime.trendDirection : '—'} />
              <Row label="ADX 1ч" value={regime?.adx1h ?? '—'} />
              <Row label="Волатильность" value={regime ? regime.volatilityState + ' (×' + regime.atrRatio + ')' : '—'} />
              <Row label="Изменение за 24ч" value={formatPercent(item.ticker?.changePercent24h)} />
              <Row label="Оборот за 24ч" value={item.ticker ? '$' + formatCompact(item.ticker.quoteVolume24h) : '—'} />
            </div>
            <div>
              <Row label="RSI 5м / 15м / 1ч" value={[item.indicators.rsi5m, item.indicators.rsi15m, item.indicators.rsi1h].join(' / ')} />
              <Row label="Финансирование" value={derivatives ? derivatives.fundingPercent + '% за 8ч' : '—'} />
              <Row label="Открытый интерес за час" value={derivatives?.oiChange1h != null ? formatPercent(derivatives.oiChange1h) : '—'} />
              <Row label="Лонги : шорты" value={derivatives?.longShortRatio != null ? derivatives.longShortRatio.toFixed(2) : '—'} />
              <Row label="Риск" value={item.risk.level + ' (' + item.risk.score + ')'} color={riskColor(item.risk.score)} />
            </div>
          </div>
          {regime?.cascade && (
            <p className="mt-2 flex items-start gap-2 text-[12px] text-[var(--color-amber-signal)]">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> Идёт каскад ликвидаций: объём выше нормы, открытый интерес тает.
            </p>
          )}
        </Section>

        <Section
          icon={Activity}
          title="Счёт индикаторов"
          aside={
            <span className="num text-[13px] font-bold normal-case tracking-normal" style={{ color: signal.score >= 0 ? 'var(--color-mint-500)' : 'var(--color-rose-signal)' }}>
              {signal.score > 0 ? '+' : ''}
              {signal.score}
            </span>
          }
        >
          <p className="mb-3 text-[11.5px] leading-snug text-slate-500">
            Сводная оценка 15 факторов от −100 до +100. Это справка о текущем перевесе: на годовой истории входы
            по одному лишь счёту были убыточны, поэтому сигналом на вход он не считается.
          </p>
          <div className="grid gap-1.5">
            {item.factors.map((f) => (
              <div key={f.key} title={f.detail} className="grid grid-cols-[130px_1fr_40px] items-center gap-2 text-[11.5px] sm:grid-cols-[170px_1fr_44px]">
                <span className="truncate text-slate-400">{f.label}</span>
                <span className="relative h-1.5 rounded-full bg-white/7">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-white/20" />
                  <span
                    className="absolute inset-y-0 rounded-full"
                    style={{
                      left: f.score >= 0 ? '50%' : 50 - Math.abs(f.score) * 50 * (f.weight / maxWeight) + '%',
                      width: Math.abs(f.score) * 50 * (f.weight / maxWeight) + '%',
                      background: f.score >= 0 ? 'var(--color-mint-500)' : 'var(--color-rose-signal)'
                    }}
                  />
                </span>
                <span className="num text-right text-slate-300">{f.score > 0 ? '+' : ''}{f.score.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section icon={LineChart} title="Уровни">
          <Row label="Сопротивление" value={item.levels.resistance.map((v) => formatPrice(v, item.precision)).join(' · ') || '—'} />
          <Row label="Поддержка" value={item.levels.support.map((v) => formatPrice(v, item.precision)).join(' · ') || '—'} />
          <Row label="VWAP" value={formatPrice(item.indicators.vwap, item.precision)} />
          <Row label="EMA 9 / 21 / 50 (5м)" value={[item.indicators.ema9, item.indicators.ema21, item.indicators.ema50].map((v) => formatPrice(v, item.precision)).join(' / ')} />
        </Section>
      </div>
    </Sheet>
  );
}
