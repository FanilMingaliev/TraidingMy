import { useEffect } from 'react';
import { X } from 'lucide-react';

/** Выезжающая снизу панель (на широком экране — окно по центру). */
export function Sheet({ title, subtitle, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`glass animate-rise relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl ${
          wide ? 'max-w-3xl' : 'max-w-md'
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3.5">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold">{title}</div>
            {subtitle && <div className="truncate text-[12px] text-slate-400">{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

/** Подпись и значение столбиком. */
export function Stat({ label, value, sub, color, className = '' }) {
  return (
    <div className={'min-w-0 ' + className}>
      <div className="truncate text-[10.5px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="num truncate text-[14px] font-bold" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="num truncate text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

export function Row({ label, value, color }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5 last:border-0">
      <span className="text-[12px] text-slate-400">{label}</span>
      <span className="num text-right text-[12.5px] font-bold" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

export function Section({ icon: Icon, title, children, aside }) {
  return (
    <section className="min-w-0 rounded-2xl border border-white/8 bg-black/25 p-4">
      <h4 className="mb-3 flex items-center justify-between gap-2 text-[12px] font-bold uppercase tracking-wider text-slate-400">
        <span className="flex items-center gap-2">
          {Icon && <Icon size={13} />} {title}
        </span>
        {aside}
      </h4>
      {children}
    </section>
  );
}

/** Числовое поле с подписью. */
export function NumberField({ label, value, onChange, suffix, step = 'any', min, hint }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-medium text-slate-400">{label}</span>
      <span className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 focus-within:border-[rgba(0,229,160,0.5)]">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="num w-full min-w-0 bg-transparent py-2.5 text-[15px] font-bold text-white outline-none"
        />
        {suffix && <span className="shrink-0 text-[12px] text-slate-500">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-[11px] leading-snug text-slate-500">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-4 py-2 text-left"
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-slate-100">{label}</span>
        {hint && <span className="mt-0.5 block text-[11.5px] leading-snug text-slate-500">{hint}</span>}
      </span>
      <span
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
          checked ? 'bg-[var(--color-mint-500)]' : 'bg-white/12'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}
        />
      </span>
    </button>
  );
}

export const primaryButton =
  'flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[var(--color-mint-500)] to-[var(--color-mint-400)] px-4 py-3 text-[13.5px] font-extrabold text-[#04140f] transition hover:brightness-110 active:scale-[0.99] disabled:opacity-45';
export const ghostButton =
  'flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[13px] font-semibold text-slate-200 transition hover:bg-white/10 active:scale-[0.99] disabled:opacity-45';
