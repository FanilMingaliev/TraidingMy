import { BookOpen } from 'lucide-react';
import { SETUPS } from '@core/config.js';
import { formatDuration } from '../lib/format.js';
import { Section } from './ui.jsx';

/** Как устроен сигнал и насколько ему можно верить — с цифрами проверки на истории. */
export default function About({ health }) {
  const cfg = SETUPS.flush;
  const rows = cfg.validation || [];

  return (
    <Section icon={BookOpen} title="Как это работает и насколько этому верить">
      <div className="grid gap-3 text-[12.5px] leading-relaxed text-slate-300">
        <p>
          <b className="text-white">Сигнал на вход</b> — сетап «{cfg.name}»: покупка, когда цена за час упала на{' '}
          {cfg.tiers[0].depth} и более часовых размаха (ATR). Стоп — {cfg.stopAtrMultiplier} часовых ATR ниже входа,
          цели — {cfg.targets.map(([r, share]) => r + 'R (' + share + '%)').join(' и ')}, держать не дольше{' '}
          {formatDuration(cfg.maxHoldMinutes)}. Стоп широкий намеренно: с узким стопом цену выбивает до отскока.
          Объём позиции при этом меньше, так что риск в деньгах остаётся тем, что задан в настройках.
        </p>
        <p>
          <b className="text-white">Фильтр формы.</b> Отскоки после проливов работают периодами: в падающем рынке
          проливы продолжаются, и сетап теряет. Поэтому приложение само проигрывает его на последних{' '}
          {cfg.health.windowDays} днях и выдаёт вход, только если за это время он в плюсе.
          {health && (
            <>
              {' '}
              Сейчас: сделок — {health.trades}, в плюс — {health.winRate}%, в среднем {health.avgR > 0 ? '+' : ''}
              {health.avgR}R.
            </>
          )}
        </p>
        <p>
          <b className="text-white">Сопровождение.</b> Открытая сделка закрывается по стопу, по целям или по времени.
          Досрочный выход «по развороту индикаторов» на истории результат не улучшал, поэтому его нет.
        </p>

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-white/8">
            <table className="w-full min-w-[420px] text-left text-[12px]">
              <thead className="text-[10.5px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Проверка на истории</th>
                  <th className="px-3 py-2 text-right font-semibold">Сделок</th>
                  <th className="px-3 py-2 text-right font-semibold">В плюс</th>
                  <th className="px-3 py-2 text-right font-semibold">Средняя</th>
                  <th className="px-3 py-2 text-right font-semibold">Итог</th>
                </tr>
              </thead>
              <tbody className="num">
                {rows.map((row) => (
                  <tr key={row.label} className="border-t border-white/6">
                    <td className="px-3 py-2 font-sans text-slate-300">{row.label}</td>
                    <td className="px-3 py-2 text-right">{row.trades}</td>
                    <td className="px-3 py-2 text-right">{row.winRate}%</td>
                    <td
                      className="px-3 py-2 text-right font-bold"
                      style={{ color: row.avgR >= 0 ? 'var(--color-mint-500)' : 'var(--color-rose-signal)' }}
                    >
                      {(row.avgR > 0 ? '+' : '') + row.avgR.toFixed(2)}R
                    </td>
                    <td
                      className="px-3 py-2 text-right font-bold"
                      style={{ color: row.totalR >= 0 ? 'var(--color-mint-500)' : 'var(--color-rose-signal)' }}
                    >
                      {(row.totalR > 0 ? '+' : '') + row.totalR}R
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-slate-400">
          R — результат в единицах риска: +1R означает прибыль, равную заложенному убытку по стопу. Комиссия 0,1 %
          за круг учтена. {cfg.validationNote} Прошлый результат не гарантирует будущий — начните с минимального
          объёма и сверяйтесь с собственной историей сделок на вкладке «Мои сделки».
        </p>
      </div>
    </Section>
  );
}
