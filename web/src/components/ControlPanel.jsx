import { useState } from 'react';
import { Bell, CheckCircle2, Coins, FlaskConical, Server, Wallet } from 'lucide-react';
import { getApiBase, setApiBase, getApiToken, setApiToken, isNativeApp } from '../lib/config.js';
import { requestNotifyPermission } from '../lib/notify.js';
import { formatMoney } from '../lib/format.js';
import { NumberField, Section, Toggle, ghostButton } from './ui.jsx';

const REFRESH = [
  { value: 30, label: '30 с' },
  { value: 60, label: '1 мин' },
  { value: 120, label: '2 мин' },
  { value: 300, label: '5 мин' }
];

/** Настройки: деньги и риск, монеты, оповещения, режим работы. */
export default function ControlPanel({ settings, onChange, coins, health, onServerChange }) {
  const [serverUrl, setServerUrl] = useState(getApiBase());
  const [token, setToken] = useState(getApiToken());
  const [saved, setSaved] = useState(false);
  const [notifyDenied, setNotifyDenied] = useState(false);

  const set = (patch) => onChange({ ...settings, ...patch });
  const number = (key) => (raw) => {
    const value = Number(raw);
    set({ [key]: raw === '' || !Number.isFinite(value) ? raw : value });
  };

  const selected = settings.symbols?.length ? settings.symbols : coins.map((c) => c.symbol);
  const toggleCoin = (symbol) => {
    const next = selected.includes(symbol) ? selected.filter((s) => s !== symbol) : [...selected, symbol];
    set({ symbols: next.length === coins.length || next.length === 0 ? null : next });
  };

  const toggleNotify = async (on) => {
    if (!on) return set({ notify: false });
    const granted = await requestNotifyPermission();
    setNotifyDenied(!granted);
    set({ notify: granted });
  };

  const saveServer = () => {
    setApiBase(serverUrl);
    setApiToken(token);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
    onServerChange();
  };

  const riskMoney = (Number(settings.deposit) * Number(settings.riskPercent)) / 100;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
      <Section icon={Wallet} title="Деньги и риск">
        <div className="grid grid-cols-3 gap-3">
          <NumberField label="Депозит" value={settings.deposit} onChange={number('deposit')} suffix="$" min={10} />
          <NumberField label="Риск на сделку" value={settings.riskPercent} onChange={number('riskPercent')} suffix="%" step="0.1" min={0.1} />
          <NumberField label="Плечо" value={settings.leverage} onChange={number('leverage')} suffix="×" step="1" min={1} />
        </div>
        <p className="mt-3 text-[12px] leading-snug text-slate-400">
          При срабатывании стопа вы теряете{' '}
          <b className="text-slate-200">{Number.isFinite(riskMoney) ? '$' + formatMoney(riskMoney) : '—'}</b>. Объём
          позиции в каждом сигнале рассчитан так, чтобы убыток по стопу был именно таким, каким бы широким стоп ни был.
        </p>
      </Section>

      <Section icon={Bell} title="Обновление и оповещения">
        <div className="mb-2 text-[11.5px] font-medium text-slate-400">Как часто обновлять рынок</div>
        <div className="mb-3 grid grid-cols-4 gap-1.5 rounded-2xl border border-white/8 bg-black/30 p-1">
          {REFRESH.map((option) => (
            <button
              key={option.value}
              onClick={() => set({ refreshSec: option.value })}
              className={`rounded-xl py-2 text-[12.5px] font-semibold transition ${
                settings.refreshSec === option.value ? 'bg-white/12 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Toggle
          checked={settings.notify}
          onChange={toggleNotify}
          label="Уведомления"
          hint="Сообщать о новом сигнале на вход и о том, что сделку пора фиксировать или закрывать."
        />
        {notifyDenied && (
          <p className="text-[11.5px] text-[var(--color-amber-signal)]">
            Уведомления запрещены в настройках {isNativeApp() ? 'телефона' : 'браузера'} — разрешите их там.
          </p>
        )}
        <Toggle checked={settings.sound} onChange={(v) => set({ sound: v })} label="Звук и вибрация" />
        <p className="mt-1 text-[11.5px] leading-snug text-slate-500">
          Рынок отслеживается, пока приложение открыто на экране. В свёрнутом виде обновления приостанавливаются.
        </p>
      </Section>

      <Section
        icon={Coins}
        title="Монеты"
        aside={
          <button onClick={() => set({ symbols: null })} className="text-[11px] font-semibold normal-case tracking-normal text-[var(--color-mint-400)]">
            выбрать все
          </button>
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {coins.map((coin) => {
            const on = selected.includes(coin.symbol);
            return (
              <button
                key={coin.symbol}
                onClick={() => toggleCoin(coin.symbol)}
                className={`rounded-xl border px-2.5 py-1.5 text-[12px] font-semibold transition ${
                  on
                    ? 'border-[rgba(0,229,160,0.4)] bg-[rgba(0,229,160,0.1)] text-[var(--color-mint-400)]'
                    : 'border-white/10 bg-white/4 text-slate-500'
                }`}
              >
                {coin.base}
              </button>
            );
          })}
        </div>
      </Section>

      <Section icon={FlaskConical} title="Экспериментальное">
        <Toggle
          checked={settings.demo}
          onChange={(v) => set({ demo: v })}
          label="Демо-сигнал"
          hint="Показать пример сигнала на первой монете списка, чтобы попробовать вход и сопровождение. Настоящего сигнала при этом нет."
        />
        <Toggle
          checked={settings.legacySignals}
          onChange={(v) => set({ legacySignals: v })}
          label="Тренд-сигналы по счёту индикаторов"
          hint="Вход, когда общий счёт 15 индикаторов выше 45. На годовой истории такие входы убыточны — включайте только для наблюдения."
        />
      </Section>

      <div className="min-w-0 lg:col-span-2">
        <Section icon={Server} title="Свой сервер (необязательно)">
          <p className="mb-3 text-[12px] leading-snug text-slate-400">
            По умолчанию приложение само берёт данные с бирж — сервер не нужен. Свой сервер добавляет новостной фон и
            разбор монеты искусственным интеллектом.
          </p>
          <Toggle
            checked={settings.mode === 'server'}
            onChange={(v) => set({ mode: v ? 'server' : 'local' })}
            label="Работать через сервер"
            hint={
              settings.mode === 'server'
                ? health
                  ? 'Сервер на связи' + (health.aiConfigured ? ', ИИ подключён (' + health.model + ')' : ', ИИ не настроен')
                  : 'Сервер не отвечает — проверьте адрес'
                : undefined
            }
          />
          {settings.mode === 'server' && (
            <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-medium text-slate-400">Адрес сервера</span>
                <input
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://192.168.1.10:8787"
                  className="num w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-[13px] text-white outline-none focus:border-[rgba(0,229,160,0.5)]"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-medium text-slate-400">Токен доступа</span>
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  type="password"
                  autoComplete="off"
                  className="num w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-[13px] text-white outline-none focus:border-[rgba(0,229,160,0.5)]"
                />
              </label>
              <button onClick={saveServer} className={ghostButton}>
                {saved ? <CheckCircle2 size={15} className="text-[var(--color-mint-500)]" /> : null}
                {saved ? 'Сохранено' : 'Сохранить'}
              </button>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
