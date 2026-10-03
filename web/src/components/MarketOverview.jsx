import { Gauge, Layers, Radio, Waves } from 'lucide-react';

function Cell({ icon: Icon, label, value, color, hint }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/7 bg-black/25 px-3 py-2.5" title={hint}>
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-slate-500">
        <Icon size={11} /> <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 truncate text-[13px] font-bold" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

const FEAR_GREED = {
  'Extreme Fear': 'крайний страх',
  Fear: 'страх',
  Neutral: 'нейтрально',
  Greed: 'жадность',
  'Extreme Greed': 'крайняя жадность'
};

/** Полоса состояния рынка: одной строкой видно, какой сейчас день. */
export default function MarketOverview({ market, results }) {
  if (!market) return null;
  const { regime, fearGreed, provider } = market;

  const up = results.filter((r) => (r.setup?.changePercent ?? 0) > 0.05).length;
  const down = results.filter((r) => (r.setup?.changePercent ?? 0) < -0.05).length;
  const total = results.length || 1;
  const breadthText = up / total >= 0.7 ? 'почти все растут' : down / total >= 0.7 ? 'почти все падают' : 'вразнобой';
  const breadthColor =
    up / total >= 0.7 ? 'var(--color-mint-500)' : down / total >= 0.7 ? 'var(--color-rose-signal)' : '#cbd5e1';
  const fg = fearGreed?.value;
  const fgColor =
    fg == null ? undefined : fg < 30 ? 'var(--color-rose-signal)' : fg > 70 ? 'var(--color-mint-500)' : 'var(--color-amber-signal)';

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Cell
        icon={Layers}
        label="Рынок"
        value={regime ? regime.label.replace('/', ' · ') : '—'}
        hint="Преобладающее состояние: есть ли часовой тренд и какая волатильность"
      />
      <Cell
        icon={Waves}
        label="За час"
        value={breadthText + ' (' + up + '↑ ' + down + '↓)'}
        color={breadthColor}
        hint="Сколько монет выросло и упало за последний час"
      />
      <Cell
        icon={Gauge}
        label="Страх и жадность"
        value={fg == null ? '—' : fg + ' · ' + (FEAR_GREED[fearGreed.classification] || fearGreed.classification)}
        color={fgColor}
        hint="Индекс настроений alternative.me: 0 — паника, 100 — эйфория"
      />
      <Cell icon={Radio} label="Источник" value={provider ? provider[0].toUpperCase() + provider.slice(1) : '—'} />
    </div>
  );
}
