import { ExternalLink, Newspaper, Zap } from 'lucide-react';
import { timeAgo } from '../lib/format.js';

function toneOf(sentiment) {
  if (sentiment > 0.15) return { color: 'var(--color-mint-500)', label: 'позитив' };
  if (sentiment < -0.15) return { color: 'var(--color-rose-signal)', label: 'негатив' };
  return { color: '#64748b', label: 'нейтрально' };
}

export default function NewsPanel({ items = [], compact = false }) {
  if (!items.length) {
    return (
      <div className="glass rounded-3xl p-5 text-center text-[13px] text-slate-500">
        Новости появятся после запуска анализа.
      </div>
    );
  }

  return (
    <div className="glass flex flex-col overflow-hidden rounded-3xl">
      <div className="flex items-center justify-between gap-2 border-b border-white/8 px-4 py-3">
        <h3 className="flex items-center gap-2 text-[13px] font-bold tracking-tight">
          <Newspaper size={14} className="text-[var(--color-violet-signal)]" />
          Новостной фон
        </h3>
        <span className="text-[11px] text-slate-500">{items.length} материалов</span>
      </div>

      <div className={`grid gap-1 overflow-y-auto p-2 ${compact ? 'max-h-[420px]' : 'max-h-[70vh]'}`}>
        {items.map((news) => {
          const tone = toneOf(news.sentiment);
          return (
            <a
              key={news.link || news.title}
              href={news.link}
              target="_blank"
              rel="noreferrer"
              className="group flex items-start gap-2.5 rounded-2xl px-2.5 py-2.5 transition hover:bg-white/5"
            >
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: tone.color }}
                title={tone.label}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] leading-snug text-slate-200 group-hover:text-white">
                  {news.title}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-slate-500">
                  <span>{news.source}</span>
                  <span>·</span>
                  <span>{timeAgo(news.publishedAt)}</span>
                  {news.highImpact && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-[rgba(255,179,71,0.12)] px-1 py-0.5 font-semibold text-[var(--color-amber-signal)]">
                      <Zap size={9} /> важное
                    </span>
                  )}
                  {news.coins?.slice(0, 3).map((symbol) => (
                    <span key={symbol} className="rounded bg-white/6 px-1 py-0.5 font-semibold text-slate-300">
                      {symbol.replace('USDT', '')}
                    </span>
                  ))}
                </span>
              </span>
              <ExternalLink size={12} className="mt-1 shrink-0 text-slate-600 group-hover:text-slate-300" />
            </a>
          );
        })}
      </div>
    </div>
  );
}
