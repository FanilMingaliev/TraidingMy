import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Briefcase, CircleSlash, HeartPulse, Radar, Settings2, TrendingUp } from 'lucide-react';
import { advisePosition, applyPartial, closePosition } from '@core/position.js';
import { computeFlushHealth } from '@core/health.js';
import { applySetupHealth } from '@core/scan.js';
import { SETUPS } from '@core/config.js';
import Header from './components/Header.jsx';
import MarketOverview from './components/MarketOverview.jsx';
import SignalCard from './components/SignalCard.jsx';
import WatchList from './components/WatchList.jsx';
import PositionCard from './components/PositionCard.jsx';
import DetailDrawer from './components/DetailDrawer.jsx';
import ControlPanel from './components/ControlPanel.jsx';
import JournalPanel from './components/JournalPanel.jsx';
import NewsPanel from './components/NewsPanel.jsx';
import About from './components/About.jsx';
import { EnterSheet, CloseSheet } from './components/TradeSheets.jsx';
import { COINS, runScan } from './lib/engine.js';
import { api } from './lib/api.js';
import { announce, requestNotifyPermission } from './lib/notify.js';
import { isNativeApp } from './lib/config.js';
import { DEFAULT_SETTINGS, KEYS, usePersistentState } from './lib/store.js';
import { TONE, formatPrice } from './lib/format.js';

const HEALTH_KEY = 'scalp.health.v1';
const HEALTH_TTL = 3 * 3600 * 1000;

function loadHealth() {
  try {
    const saved = JSON.parse(localStorage.getItem(HEALTH_KEY));
    return saved && Date.now() - saved.computedAt < HEALTH_TTL ? saved : null;
  } catch {
    return null;
  }
}

/** Строка о том, работает ли сетап в текущем рынке. */
function HealthStrip({ health, loading }) {
  const name = SETUPS.flush.name;
  if (!health) {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-white/8 bg-black/25 px-3.5 py-2.5 text-[12px] text-slate-400">
        <HeartPulse size={14} className={loading ? 'animate-pulse' : ''} />
        {loading ? 'Проверяю, как сетап «' + name + '» работал последние ' + SETUPS.flush.health.windowDays + ' дней…' : 'Форма сетапа не посчитана — нет истории с бирж.'}
      </div>
    );
  }
  const good = health.verdict === 'good';
  const unknown = health.verdict === 'unknown';
  const tone = TONE[good ? 'profit' : unknown ? 'warn' : 'danger'];
  const color = tone.color;
  return (
    <div
      className="flex items-start gap-2.5 rounded-2xl border px-3.5 py-2.5 text-[12px] leading-snug"
      style={{ borderColor: tone.border, background: tone.soft }}
    >
      <HeartPulse size={14} className="mt-0.5 shrink-0" style={{ color }} />
      <span className="text-slate-300">
        <b style={{ color }}>
          {good ? 'Сетап в форме.' : unknown ? 'Мало данных о форме сетапа.' : 'Сетап сейчас не работает.'}
        </b>{' '}
        «{name}» за {health.days} дн.: сделок — {health.trades}, в плюс — {health.winRate}%, в среднем{' '}
        {health.avgR > 0 ? '+' : ''}
        {health.avgR}R.{' '}
        {good
          ? 'Сигналы на вход выдаются.'
          : unknown
            ? 'Сделок слишком мало для вывода — сигналы на вход приостановлены.'
            : 'Проливы в этом рынке продолжаются, а не отскакивают — сигналы на вход приостановлены.'}
      </span>
    </div>
  );
}

function EmptySignals({ closest, loading }) {
  return (
    <div className="glass flex flex-col items-center gap-3 rounded-3xl px-6 py-10 text-center">
      <div className="relative grid h-16 w-16 place-items-center overflow-hidden rounded-full border border-[rgba(0,229,160,0.25)] bg-[rgba(0,229,160,0.07)]">
        <div className="animate-radar absolute inset-0 bg-[conic-gradient(from_0deg,transparent_0deg,rgba(0,229,160,0.4)_40deg,transparent_80deg)]" />
        <Radar size={24} className="relative text-[var(--color-mint-400)]" />
      </div>
      <div className="max-w-md">
        <h2 className="text-[16px] font-bold tracking-tight">{loading ? 'Сканирую рынок…' : 'Сейчас входа нет'}</h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-400">
          {loading
            ? 'Загружаю свечи и считаю сигналы.'
            : 'Сигнал появляется редко — после резкого пролива цены. Не входить без сигнала — тоже решение.'}
          {closest && !loading && (
            <>
              {' '}
              Ближе всех к сигналу сейчас <b className="text-slate-200">{closest.base}</b> —{' '}
              {Math.round(closest.setup.progress * 100)}% пути.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = usePersistentState(KEYS.settings, DEFAULT_SETTINGS);
  const [positions, setPositions] = usePersistentState(KEYS.positions, []);
  const [history, setHistory] = usePersistentState(KEYS.history, []);

  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastScanAt, setLastScanAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState('signals');
  const [detailSymbol, setDetailSymbol] = useState(null);
  const [enterItem, setEnterItem] = useState(null);
  const [closing, setClosing] = useState(null);
  const [health, setHealth] = useState(loadHealth);
  const [healthLoading, setHealthLoading] = useState(false);
  const [serverHealth, setServerHealth] = useState(null);
  const [aiReviews, setAiReviews] = useState({});
  const [aiPending, setAiPending] = useState({});

  // Таймер обновления читает самые свежие значения через ref, чтобы не пересоздаваться
  const live = useRef({});
  live.current = { settings, positions, loading, lastScanAt };

  const scan = useCallback(async () => {
    const { settings: s, positions: p, loading: busy } = live.current;
    if (busy) return;
    setLoading(true);
    try {
      const res = await runScan(s, p.map((x) => x.symbol));
      setRaw(res);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLastScanAt(Date.now());
      setLoading(false);
    }
  }, []);

  // Первый запуск и обновление по таймеру. В свёрнутом виде не обновляем — бережём трафик.
  useEffect(() => {
    scan();
    const id = setInterval(() => {
      setNow(Date.now());
      const { settings: s, loading: busy, lastScanAt: at } = live.current;
      if (document.hidden || busy) return;
      if (Date.now() - at >= s.refreshSec * 1000) scan();
    }, 1000);
    const onVisible = () => {
      if (!document.hidden && Date.now() - live.current.lastScanAt >= live.current.settings.refreshSec * 1000) scan();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [scan]);

  // Смена режима, списка монет или параметров риска — пересчитываем сразу
  const scanKey = [settings.mode, settings.legacySignals, settings.demo, settings.deposit, settings.riskPercent, settings.leverage, (settings.symbols || []).join(',')].join('|');
  const firstKey = useRef(scanKey);
  useEffect(() => {
    if (firstKey.current === scanKey) return undefined;
    firstKey.current = scanKey;
    const id = setTimeout(scan, 600);
    return () => clearTimeout(id);
  }, [scanKey, scan]);

  // Разрешение на уведомления. В приложении спрашиваем сразу при запуске; в браузере
  // запрос без действия пользователя запрещён, поэтому там переключатель честно гаснет,
  // пока разрешение не выдано через настройки.
  useEffect(() => {
    if (!live.current.settings.notify) return;
    if (isNativeApp()) {
      requestNotifyPermission().then((granted) => {
        if (!granted) setSettings((s) => ({ ...s, notify: false }));
      });
    } else if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      setSettings((s) => ({ ...s, notify: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Форма сетапа: считаем при запуске и раз в три часа
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (loadHealth()) return;
      setHealthLoading(true);
      try {
        const symbols = live.current.settings.symbols?.length ? live.current.settings.symbols : COINS.map((c) => c.symbol);
        const result = await computeFlushHealth(symbols);
        if (cancelled || !result.coins) return;
        setHealth(result);
        localStorage.setItem(HEALTH_KEY, JSON.stringify(result));
      } catch {
        /* без формы сигналы остаются приостановленными */
      } finally {
        if (!cancelled) setHealthLoading(false);
      }
    };
    refresh();
    const id = setInterval(refresh, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (settings.mode !== 'server') return setServerHealth(null);
    api.health().then(setServerHealth).catch(() => setServerHealth(null));
    return undefined;
  }, [settings.mode, lastScanAt]);

  // Решение по каждой монете с учётом формы сетапа
  const results = useMemo(
    () => (raw ? raw.results.map((r) => applySetupHealth(r, health)) : []),
    [raw, health]
  );
  const bySymbol = useMemo(() => new Map(results.map((r) => [r.symbol, r])), [results]);
  const entries = results.filter((r) => r.final.direction !== 'WAIT');
  const skipped = results.filter((r) => r.final.skipped);
  const watch = results.filter((r) => r.final.direction === 'WAIT' && !r.final.skipped);
  const closest = [...watch].sort((a, b) => (b.setup?.progress || 0) - (a.setup?.progress || 0))[0];

  const minute = Math.floor(now / 30000);
  const advices = useMemo(() => {
    const map = new Map();
    for (const position of positions) {
      const analysis = bySymbol.get(position.symbol);
      if (analysis) map.set(position.id, advisePosition(position, analysis, Date.now()));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, bySymbol, minute]);
  const needAction = positions.filter((p) => advices.get(p.id) && advices.get(p.id).action !== 'HOLD').length;

  // Оповещения: новый вход и момент, когда сделку пора фиксировать или закрывать
  useEffect(() => {
    for (const item of entries) {
      if (item.final.demo) continue;
      announce(
        'entry:' + item.symbol + ':' + Math.floor(Date.now() / 3600000),
        {
          kind: 'entry',
          title: item.base + ': ' + (item.final.direction === 'LONG' ? 'войти в лонг' : 'войти в шорт'),
          body: item.final.source + ' · вход ' + formatPrice(item.plan.entry, item.precision) + ' · стоп ' + formatPrice(item.plan.stopLoss, item.precision)
        },
        settings
      );
    }
    for (const position of positions) {
      const advice = advices.get(position.id);
      if (!advice || advice.action === 'HOLD') continue;
      announce(
        'pos:' + position.id + ':' + advice.code + ':' + (advice.target?.label || ''),
        { kind: advice.tone === 'danger' ? 'danger' : 'profit', title: position.base + ': ' + advice.label.toLowerCase(), body: advice.title },
        settings
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, advices]);

  const openPosition = (position) => {
    setPositions((list) => [position, ...list]);
    setEnterItem(null);
    setDetailSymbol(null);
    setTab('trades');
  };

  const takePartial = (position, target) =>
    setPositions((list) => list.map((p) => (p.id === position.id ? applyPartial(p, target.label, target.price) : p)));

  const finishClose = (exitPrice) => {
    const { position, advice } = closing;
    const reason = advice && advice.action === 'CLOSE' ? advice.code : 'manual';
    setHistory((list) => [closePosition(position, exitPrice, reason), ...list].slice(0, 300));
    setPositions((list) => list.filter((p) => p.id !== position.id));
    setClosing(null);
  };

  const askAi = useCallback(
    async (symbol) => {
      setAiPending((prev) => ({ ...prev, [symbol]: true }));
      try {
        const res = await api.aiReview({ symbol, deposit: settings.deposit, riskPercent: settings.riskPercent, leverage: settings.leverage });
        setAiReviews((prev) => ({ ...prev, [symbol]: res.available ? res : { error: res.error || 'ИИ недоступен' } }));
      } catch (err) {
        setAiReviews((prev) => ({ ...prev, [symbol]: { error: err.message } }));
      } finally {
        setAiPending((prev) => ({ ...prev, [symbol]: false }));
      }
    },
    [settings]
  );

  const secondsAgo = lastScanAt && raw ? Math.max(0, Math.round((now - lastScanAt) / 1000)) : null;
  const nextIn = Math.max(0, settings.refreshSec - (lastScanAt ? (now - lastScanAt) / 1000 : 0));
  const stale = secondsAgo != null && secondsAgo > settings.refreshSec * 3;
  const detail = detailSymbol ? bySymbol.get(detailSymbol) : null;

  const tabs = [
    { id: 'signals', label: 'Сигналы', icon: TrendingUp, badge: entries.length },
    { id: 'trades', label: 'Мои сделки', icon: Briefcase, badge: needAction || positions.length, badgeColor: needAction ? 'var(--color-amber-signal)' : '#94a3b8' },
    { id: 'settings', label: 'Настройки', icon: Settings2, badge: 0 }
  ];

  return (
    <div className="mx-auto w-full max-w-[1180px] px-3 pb-28 sm:px-5 lg:pb-10">
      <Header
        loading={loading}
        secondsAgo={secondsAgo}
        nextIn={nextIn}
        refreshSec={settings.refreshSec}
        stale={stale}
        onRefresh={scan}
        tabs={tabs}
        tab={tab}
        onTab={setTab}
      />

      <main className="grid grid-cols-[minmax(0,1fr)] gap-3 pt-3">
        {error && (
          <div className="glass flex items-start gap-2.5 rounded-2xl border-[rgba(255,77,109,0.3)] p-3.5 text-[12.5px] text-[var(--color-rose-signal)]">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {tab === 'signals' && (
          <>
            {needAction > 0 && (
              <button
                onClick={() => setTab('trades')}
                className="flex items-center justify-between gap-3 rounded-2xl border border-[rgba(255,179,71,0.45)] bg-[rgba(255,179,71,0.1)] px-4 py-3 text-left text-[13px] font-semibold text-[var(--color-amber-signal)]"
              >
                <span>По {needAction === 1 ? 'одной сделке' : needAction + ' сделкам'} нужно действие</span>
                <span className="text-[12px]">открыть →</span>
              </button>
            )}

            <MarketOverview market={raw?.market} results={results} />
            <HealthStrip health={health} loading={healthLoading} />

            <h2 className="mt-1 text-[12px] font-bold uppercase tracking-wider text-slate-400">Вход сейчас</h2>
            {entries.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {entries.map((item) => (
                  <SignalCard
                    key={item.symbol}
                    item={item}
                    inPosition={positions.some((p) => p.symbol === item.symbol)}
                    onEnter={setEnterItem}
                    onOpen={(x) => setDetailSymbol(x.symbol)}
                  />
                ))}
              </div>
            ) : (
              <EmptySignals closest={closest} loading={loading && !raw} />
            )}

            {skipped.map((item) => (
              <button
                key={item.symbol}
                onClick={() => setDetailSymbol(item.symbol)}
                className="flex items-start gap-2.5 rounded-2xl border border-white/8 bg-black/25 px-3.5 py-3 text-left text-[12px] leading-snug text-slate-400"
              >
                <CircleSlash size={14} className="mt-0.5 shrink-0 text-slate-500" />
                <span>
                  <b className="text-slate-200">{item.base}: пролив есть, вход пропущен.</b> {item.final.note}
                </span>
              </button>
            ))}

            {watch.length > 0 && (
              <>
                <h2 className="mt-2 text-[12px] font-bold uppercase tracking-wider text-slate-400">Наблюдение</h2>
                <WatchList items={watch} onOpen={(x) => setDetailSymbol(x.symbol)} />
              </>
            )}

            {raw?.source === 'server' && raw.news?.length > 0 && <NewsPanel items={raw.news} compact />}
            {raw?.errors?.length > 0 && (
              <p className="text-[11px] text-slate-500">Не загрузились: {raw.errors.map((e) => e.symbol.replace('USDT', '')).join(', ')}</p>
            )}
          </>
        )}

        {tab === 'trades' && (
          <>
            {positions.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {positions.map((position) => (
                  <PositionCard
                    key={position.id}
                    position={position}
                    advice={advices.get(position.id)}
                    onPartial={takePartial}
                    onClose={(p, advice) => setClosing({ position: p, advice })}
                    onOpen={(p) => setDetailSymbol(p.symbol)}
                  />
                ))}
              </div>
            ) : (
              <div className="glass rounded-3xl px-6 py-10 text-center">
                <Briefcase size={26} className="mx-auto text-slate-500" />
                <h2 className="mt-3 text-[16px] font-bold tracking-tight">Открытых сделок нет</h2>
                <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-slate-400">
                  Когда войдёте в сделку по сигналу, нажмите «Я вошёл в сделку» — здесь появится её сопровождение:
                  держать, фиксировать часть или закрывать.
                </p>
              </div>
            )}
            <JournalPanel history={history} onClear={() => window.confirm('Удалить всю историю сделок?') && setHistory([])} />
          </>
        )}

        {tab === 'settings' && (
          <>
            <ControlPanel
              settings={settings}
              onChange={setSettings}
              coins={COINS}
              health={serverHealth}
              onServerChange={scan}
            />
            <About health={health} />
          </>
        )}

        <footer className="mt-2 border-t border-white/6 pt-3 text-[11px] leading-relaxed text-slate-500">
          Данные — публичные API бирж Bybit, Binance, OKX. Приложение не выставляет ордера и не является
          инвестиционной рекомендацией: любой сигнал может не сработать. Рискуйте только суммой, потерю которой
          готовы принять.
        </footer>
      </main>

      {/* Нижние вкладки на телефоне */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-white/8 bg-[rgba(5,7,12,0.94)] pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition ${
              tab === t.id ? 'text-[var(--color-mint-400)]' : 'text-slate-500'
            }`}
          >
            <span className="relative">
              <t.icon size={20} />
              {t.badge > 0 && (
                <span
                  className="num absolute -right-3 -top-1.5 min-w-[16px] rounded-full px-1 text-center text-[10px] font-bold leading-4 text-[#04140f]"
                  style={{ background: t.badgeColor || 'var(--color-mint-500)' }}
                >
                  {t.badge}
                </span>
              )}
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      {detail && (
        <DetailDrawer
          item={detail}
          position={positions.find((p) => p.symbol === detail.symbol)}
          inPosition={positions.some((p) => p.symbol === detail.symbol)}
          onClose={() => setDetailSymbol(null)}
          onEnter={setEnterItem}
          canAskAi={settings.mode === 'server' && Boolean(serverHealth?.aiConfigured)}
          onAskAi={askAi}
          review={aiReviews[detail.symbol]}
          reviewLoading={Boolean(aiPending[detail.symbol])}
        />
      )}
      {enterItem && <EnterSheet item={enterItem} onConfirm={openPosition} onClose={() => setEnterItem(null)} />}
      {closing && (
        <CloseSheet position={closing.position} advice={closing.advice} onConfirm={finishClose} onClose={() => setClosing(null)} />
      )}
    </div>
  );
}
