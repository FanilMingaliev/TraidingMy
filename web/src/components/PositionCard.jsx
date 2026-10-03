import { AlertTriangle, Check, Clock, LogOut } from 'lucide-react';
import { TONE, formatDuration, formatMoney, formatPrice } from '../lib/format.js';
import { ghostButton } from './ui.jsx';

/** Шкала сделки: стоп слева, цели справа, маркер — текущая цена. */
function LevelBar({ position, price }) {
  const sign = position.direction === 'LONG' ? 1 : -1;
  const lastTarget = position.targets[position.targets.length - 1].price;
  const span = (lastTarget - position.initialStop) * sign;
  const at = (value) => Math.max(0, Math.min(100, (((value - position.initialStop) * sign) / span) * 100));
  const pricePos = at(price);
  const entryPos = at(position.entry);
  const inProfit = (price - position.entry) * sign >= 0;

  return (
    <div className="relative pb-6 pt-5">
      <div className="relative h-2 rounded-full bg-white/8">
        {/* зона убытка и зона прибыли */}
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-[rgba(255,77,109,0.28)]" style={{ width: entryPos + '%' }} />
        <div
          className="absolute inset-y-0 rounded-r-full bg-[rgba(0,229,160,0.22)]"
          style={{ left: entryPos + '%', right: 0 }}
        />
        <div
          className="absolute inset-y-0"
          style={{
            left: Math.min(entryPos, pricePos) + '%',
            width: Math.abs(pricePos - entryPos) + '%',
            background: inProfit ? 'var(--color-mint-500)' : 'var(--color-rose-signal)'
          }}
        />
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#05070c] bg-white shadow-[0_0_0_3px_rgba(255,255,255,0.18)] transition-all duration-700"
          style={{ left: pricePos + '%' }}
        />
      </div>
      {[
        { label: 'стоп', value: position.stopLoss, pos: at(position.stopLoss), color: 'var(--color-rose-signal)' },
        { label: 'вход', value: position.entry, pos: entryPos, color: '#94a3b8' },
        ...position.targets.map((t) => ({
          label: t.label + (t.done ? ' ✓' : ''),
          value: t.price,
          pos: at(t.price),
          color: 'var(--color-mint-500)'
        }))
      ].map((mark, i, all) => (
        <div
          key={mark.label}
          className="absolute bottom-0 text-[10px] leading-tight"
          style={{
            left: mark.pos + '%',
            transform: i === 0 ? 'none' : i === all.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
            color: mark.color
          }}
        >
          <div className="font-semibold">{mark.label}</div>
        </div>
      ))}
      <div
        className="num absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10.5px] font-bold text-white transition-all duration-700"
        style={{ left: Math.max(8, Math.min(92, pricePos)) + '%' }}
      >
        {formatPrice(price, position.precision)}
      </div>
    </div>
  );
}

/** Открытая сделка с советом: держать, фиксировать или закрывать. */
export default function PositionCard({ position, advice, onPartial, onClose, onOpen }) {
  const isLong = position.direction === 'LONG';
  const tone = TONE[advice?.tone || 'neutral'];
  const pnlColor = !advice ? '#94a3b8' : advice.pnlR >= 0 ? 'var(--color-mint-500)' : 'var(--color-rose-signal)';

  return (
    <article className="glass animate-rise overflow-hidden rounded-3xl" style={{ borderColor: tone.border }}>
      {/* Главное — что делать прямо сейчас */}
      <div className="px-4 py-3.5" style={{ background: tone.soft }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">Что делать</div>
            <div className="text-[19px] font-extrabold leading-tight tracking-tight" style={{ color: tone.color }}>
              {advice ? advice.label : 'НЕТ ДАННЫХ'}
            </div>
          </div>
          <div className="shrink-0 whitespace-nowrap text-right">
            <div className="num text-[20px] font-extrabold leading-tight" style={{ color: pnlColor }}>
              {advice ? (advice.pnlR > 0 ? '+' : '') + advice.pnlR + 'R' : '—'}
            </div>
            <div className="num text-[11.5px]" style={{ color: pnlColor }}>
              {advice
                ? (advice.pnlPercent > 0 ? '+' : '') + advice.pnlPercent + '%' +
                  (advice.pnlMoney != null ? ' · ' + (advice.pnlMoney > 0 ? '+' : '') + formatMoney(advice.pnlMoney) + ' $' : '')
                : ''}
            </div>
          </div>
        </div>
        {advice && (
          <div className="mt-2 grid gap-1">
            <div className="text-[12.5px] font-semibold text-slate-100">{advice.title}</div>
            {advice.reasons.map((reason) => (
              <div key={reason} className="text-[12px] leading-snug text-slate-300">
                {reason}
              </div>
            ))}
            {(advice.warnings || []).map((warning) => (
              <div key={warning} className="flex items-start gap-1.5 text-[12px] leading-snug text-[var(--color-amber-signal)]">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {warning}
              </div>
            ))}
          </div>
        )}
        {!advice && (
          <div className="mt-1 text-[12px] text-slate-400">Цена по монете не загрузилась — обновите данные.</div>
        )}
      </div>

      <div className="px-4 pt-3">
        <button onClick={() => onOpen(position)} className="flex w-full items-center justify-between gap-3 text-left">
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-[10.5px] font-extrabold"
              style={{
                borderColor: (isLong ? '#00e5a0' : '#ff4d6d') + '55',
                background: (isLong ? '#00e5a0' : '#ff4d6d') + '14',
                color: isLong ? 'var(--color-mint-500)' : 'var(--color-rose-signal)'
              }}
            >
              {position.base}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-bold">
                {position.name} · {isLong ? 'лонг' : 'шорт'}
              </span>
              <span className="num block truncate text-[11.5px] text-slate-400">
                вход {formatPrice(position.entry, position.precision)}
                {position.remaining < 1 && ' · осталось ' + Math.round(position.remaining * 100) + '%'}
              </span>
            </span>
          </span>
          <span className="shrink-0 text-right text-[11.5px] text-slate-400">
            <span className="flex items-center justify-end gap-1.5">
              <Clock size={12} /> {advice ? formatDuration(advice.heldMinutes) : '—'}
            </span>
            {advice && advice.minutesLeft > 0 && (
              <span className="block text-slate-500">ещё {formatDuration(advice.minutesLeft)}</span>
            )}
          </span>
        </button>

        {advice && <LevelBar position={position} price={advice.price} />}
      </div>

      <div className="flex flex-wrap gap-2 p-4 pt-2">
        {advice?.action === 'TAKE' && (
          <button
            onClick={() => onPartial(position, advice.target)}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[13px] font-extrabold text-[#04140f] transition hover:brightness-110"
            style={{ background: 'var(--color-mint-500)' }}
          >
            <Check size={16} strokeWidth={3} /> Зафиксировал {advice.target.closeShare}%
          </button>
        )}
        <button
          onClick={() => onClose(position, advice)}
          className={
            advice?.action === 'CLOSE'
              ? 'flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[13px] font-extrabold text-[#05070c] transition hover:brightness-110'
              : ghostButton + ' flex-1'
          }
          style={advice?.action === 'CLOSE' ? { background: tone.color } : undefined}
        >
          <LogOut size={15} /> {advice?.action === 'CLOSE' ? 'Закрыл сделку' : 'Закрыть вручную'}
        </button>
      </div>
    </article>
  );
}
