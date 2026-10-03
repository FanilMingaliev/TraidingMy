import { ArrowDownRight, ArrowUpRight, ChevronRight, Clock, FlaskConical, ShieldAlert } from 'lucide-react';
import { DIRECTION_STYLE, formatDuration, formatMoney, formatPrice, formatQuantity } from '../lib/format.js';
import { Stat, ghostButton, primaryButton } from './ui.jsx';

/** Карточка сигнала на вход: что делать, где стоп и цели, каким объёмом. */
export default function SignalCard({ item, health, inPosition, onEnter, onOpen }) {
  const { final, plan, setup } = item;
  const isLong = final.direction === 'LONG';
  const style = DIRECTION_STYLE[final.direction];
  const Arrow = isLong ? ArrowUpRight : ArrowDownRight;
  const weak = final.experimental || (health && health.verdict === 'bad');

  return (
    <article
      className={`glass animate-rise overflow-hidden rounded-3xl ${weak ? '' : isLong ? 'glow-mint' : 'glow-rose'}`}
    >
      <div className="flex items-center justify-between gap-3 p-4 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border text-[12px] font-extrabold"
            style={{ borderColor: style.accent + '55', background: style.accent + '14', color: style.accent }}
          >
            {item.base}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[12px] text-slate-400">{item.name}</div>
            <div className="num text-[18px] font-bold leading-tight">${formatPrice(item.price, item.precision)}</div>
          </div>
        </div>
        <div className="text-right">
          <div
            className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[13px] font-extrabold"
            style={{ background: style.accent + '1f', color: style.accent }}
          >
            <Arrow size={15} strokeWidth={3} /> {isLong ? 'ВОЙТИ В ЛОНГ' : 'ВОЙТИ В ШОРТ'}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">{final.source}</div>
        </div>
      </div>

      <div className="px-4">
        <p className="text-[12.5px] leading-snug text-slate-300">{final.note}</p>
        {setup?.active && !setup.demo && (
          <p className="mt-1.5 text-[11.5px] leading-snug text-slate-500">
            Это не гарантия: сетап работает периодами. За два года истории такие входы в сумме дали около нуля —
            входите минимальным объёмом и всегда со стопом.
          </p>
        )}
        {final.experimental && (
          <p className="mt-2 flex items-start gap-2 rounded-xl border border-[rgba(255,179,71,0.25)] bg-[rgba(255,179,71,0.07)] px-3 py-2 text-[11.5px] leading-snug text-[var(--color-amber-signal)]">
            <FlaskConical size={13} className="mt-0.5 shrink-0" />
            Экспериментальный сигнал по общему счёту индикаторов. На годовой истории такие входы были убыточны.
          </p>
        )}
        {health && health.verdict === 'bad' && (
          <p className="mt-2 flex items-start gap-2 rounded-xl border border-[rgba(255,77,109,0.3)] bg-[rgba(255,77,109,0.08)] px-3 py-2 text-[11.5px] leading-snug text-[var(--color-rose-signal)]">
            <ShieldAlert size={13} className="mt-0.5 shrink-0" />
            За последние {health.days} дн. этот сетап в минусе ({health.avgR > 0 ? '+' : ''}
            {health.avgR}R в среднем на {health.trades} сделках). В таком рынке отскоки не отрабатывают — разумнее пропустить.
          </p>
        )}
      </div>

      <div className="mx-4 mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-2xl border border-white/7 bg-black/30 p-3 sm:grid-cols-4">
        <Stat label="Вход" value={formatPrice(plan.entry, item.precision)} />
        <Stat
          label="Стоп"
          value={formatPrice(plan.stopLoss, item.precision)}
          sub={'−' + plan.stopPercent + '%'}
          color="var(--color-rose-signal)"
        />
        {plan.targets.slice(0, 2).map((t) => (
          <Stat
            key={t.label}
            label={t.label + ' · ' + t.closeShare + '%'}
            value={formatPrice(t.price, item.precision)}
            sub={'+' + t.percent + '%'}
            color="var(--color-mint-500)"
          />
        ))}
      </div>

      <div className="mx-4 mt-2 grid grid-cols-2 gap-x-3 gap-y-2.5 px-3 py-1 sm:grid-cols-4">
        <Stat label="Объём" value={formatQuantity(plan.position.quantity)} sub={item.base} />
        <Stat label="На сумму" value={'$' + formatMoney(plan.position.notional, 0)} sub={'маржа $' + formatMoney(plan.position.margin, 0)} />
        <Stat label="Риск" value={'$' + formatMoney(plan.profit.maxLoss)} sub="если стоп" color="var(--color-rose-signal)" />
        <Stat label="Цель" value={'$' + formatMoney(plan.profit.planned)} sub="по плану" color="var(--color-mint-500)" />
      </div>

      <div className="mx-4 mt-2 flex items-center gap-1.5 text-[11.5px] text-slate-500">
        <Clock size={12} /> держать не дольше {formatDuration(plan.maxHoldMinutes)}
        {plan.position.cappedByLeverage && <span> · объём ограничен плечом</span>}
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2 p-4 pt-0">
        <button onClick={() => onEnter(item)} disabled={inPosition} className={primaryButton}>
          {inPosition ? 'Сделка уже открыта' : 'Я вошёл в сделку'}
        </button>
        <button onClick={() => onOpen(item)} className={ghostButton}>
          Разбор <ChevronRight size={15} />
        </button>
      </div>
    </article>
  );
}
