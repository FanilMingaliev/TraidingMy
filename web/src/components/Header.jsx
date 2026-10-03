import { Activity, RefreshCw } from 'lucide-react';

/** Шапка: название, свежесть данных и кнопка обновления с обратным отсчётом. */
export default function Header({ loading, secondsAgo, nextIn, refreshSec, onRefresh, stale, tabs, tab, onTab }) {
  const progress = refreshSec ? Math.max(0, Math.min(1, 1 - nextIn / refreshSec)) : 0;
  const size = 38;
  const radius = 16;
  const circumference = 2 * Math.PI * radius;

  return (
    <header className="sticky top-0 z-30 -mx-3 border-b border-white/6 bg-[rgba(5,7,12,0.86)] px-3 pt-[env(safe-area-inset-top)] backdrop-blur-lg sm:-mx-5 sm:px-5">
      <div className="flex items-center justify-between gap-3 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-[rgba(0,229,160,0.35)] bg-[rgba(0,229,160,0.09)]">
            <div className="animate-radar absolute inset-0 bg-[conic-gradient(from_0deg,transparent_0deg,rgba(0,229,160,0.55)_35deg,transparent_70deg)]" />
            <Activity size={16} strokeWidth={2.6} className="relative text-[var(--color-mint-400)]" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[16px] font-extrabold leading-tight tracking-tight">
              Scalp<span className="text-[var(--color-mint-500)]">Radar</span>
            </h1>
            <p className="truncate text-[11px] text-slate-400">
              {loading && secondsAgo == null
                ? 'загружаю рынок…'
                : secondsAgo == null
                  ? 'нет данных'
                  : stale
                    ? 'данные устарели — обновите'
                    : 'обновлено ' + (secondsAgo < 5 ? 'только что' : secondsAgo + ' с назад')}
            </p>
          </div>
        </div>

        {/* Вкладки на широком экране живут в шапке, на телефоне — внизу */}
        <nav className="hidden gap-1 rounded-2xl border border-white/8 bg-black/30 p-1 lg:flex">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold transition ${
                tab === t.id ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <t.icon size={15} /> {t.label}
              {t.badge > 0 && (
                <span
                  className="num rounded-full px-1.5 text-[10.5px] font-bold text-[#04140f]"
                  style={{ background: t.badgeColor || 'var(--color-mint-500)' }}
                >
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        <button
          onClick={onRefresh}
          disabled={loading}
          aria-label="Обновить"
          className="relative grid shrink-0 place-items-center rounded-full text-slate-200 transition hover:text-white disabled:opacity-70"
          style={{ width: size, height: size }}
        >
          <svg width={size} height={size} className="absolute inset-0 -rotate-90">
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="3" />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={stale ? 'var(--color-amber-signal)' : 'var(--color-mint-500)'}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
    </header>
  );
}
