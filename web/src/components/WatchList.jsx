import { ChevronRight } from 'lucide-react';
import { formatPercent, formatPrice } from '../lib/format.js';
import Sparkline from './Sparkline.jsx';

/**
 * Список наблюдения: монеты без сигнала. Полоса показывает, насколько монета
 * близка к срабатыванию сетапа — так видно, где сигнал может появиться следующим.
 */
export default function WatchList({ items, onOpen }) {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => (b.setup?.progress || 0) - (a.setup?.progress || 0));

  return (
    <div className="glass overflow-hidden rounded-3xl">
      <div className="hidden grid-cols-[1.3fr_1fr_0.8fr_1.4fr_auto] items-center gap-3 border-b border-white/8 px-4 py-2.5 text-[10.5px] uppercase tracking-wider text-slate-500 sm:grid">
        <span>Монета</span>
        <span>Цена · 24ч</span>
        <span>За час</span>
        <span>До сигнала</span>
        <span className="w-4" />
      </div>
      {sorted.map((item) => {
        const progress = item.setup?.progress || 0;
        const change1h = item.setup?.changePercent;
        const change24 = item.ticker?.changePercent24h;
        const hot = progress >= 0.66;
        return (
          <button
            key={item.symbol}
            onClick={() => onOpen(item)}
            className="grid w-full grid-cols-[1.1fr_1fr_auto] items-center gap-3 border-b border-white/5 px-4 py-3 text-left transition last:border-0 hover:bg-white/4 sm:grid-cols-[1.3fr_1fr_0.8fr_1.4fr_auto]"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-[10.5px] font-extrabold text-slate-200">
                {item.base}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">{item.name}</span>
                <span className="block truncate text-[11px] text-slate-500 sm:hidden">
                  за час {formatPercent(change1h)}
                </span>
              </span>
            </span>

            <span className="min-w-0">
              <span className="num block truncate text-[13px] font-bold">${formatPrice(item.price, item.precision)}</span>
              <span
                className="num block text-[11px]"
                style={{ color: change24 >= 0 ? 'var(--color-mint-500)' : 'var(--color-rose-signal)' }}
              >
                {formatPercent(change24)}
              </span>
            </span>

            <span className="hidden items-center gap-2 sm:flex">
              <span className="w-14">
                <Sparkline
                  data={item.sparkline?.slice(-24)}
                  height={26}
                  color={change1h >= 0 ? '#00e5a0' : '#ff4d6d'}
                />
              </span>
              <span
                className="num text-[12px] font-semibold"
                style={{ color: change1h >= 0 ? 'var(--color-mint-500)' : 'var(--color-rose-signal)' }}
              >
                {formatPercent(change1h)}
              </span>
            </span>

            <span className="col-span-3 -mt-1 flex items-center gap-2 sm:col-span-1 sm:mt-0">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                <span
                  className="block h-full rounded-full transition-all duration-700"
                  style={{
                    width: Math.round(progress * 100) + '%',
                    background: hot ? 'var(--color-amber-signal)' : 'rgba(148,163,184,0.55)'
                  }}
                />
              </span>
              <span className={`num w-9 text-right text-[11px] ${hot ? 'font-bold text-[var(--color-amber-signal)]' : 'text-slate-500'}`}>
                {Math.round(progress * 100)}%
              </span>
            </span>

            <ChevronRight size={15} className="hidden text-slate-600 sm:block" />
          </button>
        );
      })}
    </div>
  );
}
