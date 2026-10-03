// Что отличает удачные проливы от неудачных: разбивка сделок базового правила по признакам режима,
// отдельно по двум половинам года. Нужен признак, который разделяет В ОБЕИХ половинах.
import { loadUniverse } from './features.js';
import { runRule, windows } from './strat.js';

const DAYS = Number(process.argv[2] || 360);
const uni = await loadUniverse(DAYS);
const W = windows(DAYS / 2, DAYS / 2);
const btc = uni.find((d) => d.symbol === 'BTCUSDT');
const btcIndex = new Map(btc.candles.map((c, i) => [c.time, i]));

const ret = (candles, i, bars) => (i - bars >= 0 ? (candles[i].close / candles[i - bars].close - 1) * 100 : null);

const h1atr = (f, d, i) => (f.h1atrPct / 100) * d.candles[i].close;
const rule = (f, i, d) => {
  if (!(f.h1atrPct && f.r1h != null && f.r1h / f.h1atrPct <= -3)) return null;
  const bi = btcIndex.get(d.candles[i].time);
  const ctx = {
    depth: -f.r1h / f.h1atrPct,
    r24h: f.r24h,
    r7d: ret(d.candles, i, 2016),
    r30d: ret(d.candles, i, 8640),
    btc24h: bi != null ? ret(btc.candles, bi, 288) : null,
    btc7d: bi != null ? ret(btc.candles, bi, 2016) : null,
    btc30d: bi != null ? ret(btc.candles, bi, 8640) : null,
    btcR1h: f.btcR1h,
    h1trend: f.h1trend,
    btcH1trend: f.btcH1trend,
    h1adx: f.h1adx,
    h1rsi: f.h1rsi,
    pos24: f.pos24,
    vol3: f.vol3,
    atrPct: f.h1atrPct,
    hour: f.hour
  };
  return { direction: 'LONG', stop: h1atr(f, d, i) * 2, targets: [[1, 50], [1.5, 50]], hold: 48, ctx };
};

// runRule не сохраняет ctx — повторяем правило, чтобы достать контекст сделки
function tradesWithCtx(window) {
  const out = [];
  for (const d of uni) {
    const byTime = new Map(d.candles.map((c, i) => [c.time, i]));
    for (const t of runRule([d], rule, window)) {
      const i = byTime.get(t.entryTime) - 1;
      out.push({ ...t, ctx: rule(d.features[i], i, d).ctx });
    }
  }
  return out;
}

const halves = { 'ранняя': tradesWithCtx(W.HOLD), 'поздняя': tradesWithCtx(W.DEV) };
const avg = (l) => (l.length ? l.reduce((a, t) => a + t.resultR, 0) / l.length : 0);
for (const [n, l] of Object.entries(halves)) console.log(n + ' половина: ' + l.length + ' сделок, средняя ' + avg(l).toFixed(3) + 'R');

const keys = Object.keys(halves['ранняя'][0].ctx);
console.log('\nСредняя R по третям признака (низ / середина / верх), в скобках — число сделок');
for (const k of keys) {
  const cells = [];
  let consistent = null;
  for (const [n, l] of Object.entries(halves)) {
    const v = l.filter((t) => t.ctx[k] != null).sort((a, b) => a.ctx[k] - b.ctx[k]);
    const third = Math.floor(v.length / 3);
    const parts = [v.slice(0, third), v.slice(third, 2 * third), v.slice(2 * third)];
    const edges = [v[third]?.ctx[k], v[2 * third]?.ctx[k]];
    cells.push(n + ': ' + parts.map((p) => (avg(p) >= 0 ? '+' : '') + avg(p).toFixed(2)).join(' / ') + '  границы ' + edges.map((e) => e?.toFixed(2)).join(', '));
    const slope = Math.sign(avg(parts[2]) - avg(parts[0]));
    consistent = consistent == null ? slope : consistent === slope ? slope : 0;
  }
  console.log(k.padEnd(11) + cells.join('   |   ') + (consistent ? '   ← наклон совпадает' : ''));
}
