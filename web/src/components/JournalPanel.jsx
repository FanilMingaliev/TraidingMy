import { History, Trash2 } from 'lucide-react';
import { formatMoney, formatPrice } from '../lib/format.js';
import { Stat } from './ui.jsx';

const REASONS = {
  stop: 'стоп-лосс',
  target: 'цели взяты',
  reverse: 'сигнал развернулся',
  fade: 'перевес исчез',
  cascade: 'каскад ликвидаций',
  time: 'вышло время',
  manual: 'вручную',
  hold: 'вручную'
};

/** История закрытых сделок и личная статистика — единственная проверка, которой стоит верить до конца. */
export default function JournalPanel({ history, onClear }) {
  const wins = history.filter((t) => t.resultR > 0).length;
  const totalR = history.reduce((acc, t) => acc + t.resultR, 0);
  const totalMoney = history.reduce((acc, t) => acc + (t.resultMoney || 0), 0);

  return (
    <div className="glass overflow-hidden rounded-3xl">
      <div className="flex items-center justify-between gap-2 border-b border-white/8 px-4 py-3">
        <h3 className="flex items-center gap-2 text-[13px] font-bold tracking-tight">
          <History size={14} className="text-[var(--color-violet-signal)]" /> Мои закрытые сделки
        </h3>
        {history.length > 0 && (
          <button onClick={onClear} className="flex items-center gap-1 text-[11px] text-slate-500 transition hover:text-[var(--color-rose-signal)]">
            <Trash2 size={12} /> очистить
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <p className="p-5 text-center text-[12.5px] leading-relaxed text-slate-500">
          Здесь появятся сделки, которые вы закрыли, и общий итог: сколько из них в плюс и какой результат в R.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3 border-b border-white/8 px-4 py-3">
            <Stat label="Сделок" value={history.length} />
            <Stat label="В плюс" value={Math.round((wins / history.length) * 100) + '%'} />
            <Stat
              label="Итог"
              value={(totalR > 0 ? '+' : '') + totalR.toFixed(2) + 'R'}
              color={totalR >= 0 ? 'var(--color-mint-500)' : 'var(--color-rose-signal)'}
            />
            <Stat
              label="В деньгах"
              value={(totalMoney > 0 ? '+' : '') + formatMoney(totalMoney) + ' $'}
              color={totalMoney >= 0 ? 'var(--color-mint-500)' : 'var(--color-rose-signal)'}
            />
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {history.map((t) => (
              <div key={t.id} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-white/5 px-4 py-2.5 last:border-0">
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-semibold">
                    {t.base} · {t.direction === 'LONG' ? 'лонг' : 'шорт'}
                    <span className="ml-2 font-normal text-slate-500">{REASONS[t.exitReason] || t.exitReason}</span>
                  </div>
                  <div className="num truncate text-[11px] text-slate-500">
                    {formatPrice(t.entry, t.precision)} → {formatPrice(t.exitPrice, t.precision)} ·{' '}
                    {new Date(t.closedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className="num text-[13px] font-bold"
                    style={{ color: t.resultR >= 0 ? 'var(--color-mint-500)' : 'var(--color-rose-signal)' }}
                  >
                    {(t.resultR > 0 ? '+' : '') + t.resultR.toFixed(2)}R
                  </div>
                  {t.resultMoney != null && (
                    <div className="num text-[11px] text-slate-500">
                      {(t.resultMoney > 0 ? '+' : '') + formatMoney(t.resultMoney)} $
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
