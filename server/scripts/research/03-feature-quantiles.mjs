// Одномерный разбор: будущее движение по квантилям каждого признака, две половины периода.
import { loadUniverse, END, DAY } from './features.js';

const DAYS = Number(process.argv[2] || 180);
const uni = await loadUniverse(DAYS);
const mid = END - (DAYS / 2) * DAY;
const WARM = 2600; // EMA200 на часовом графике

const names = Object.keys(uni[0].features[WARM]).filter((k) => k !== 'hour');
const HZ = [12, 24];

for (const name of names) {
  const rows = [[], []];
  for (const d of uni) {
    for (let i = WARM; i < d.candles.length - 49; i++) {
      const v = d.features[i][name];
      if (v == null || Number.isNaN(v)) continue;
      const next = d.candles[i + 1].open;
      rows[d.candles[i].time < mid ? 0 : 1].push([v, (d.candles[i + 12].close / next - 1) * 1e4, (d.candles[i + 24].close / next - 1) * 1e4]);
    }
  }
  const parts = rows.map((r) => {
    r.sort((a, b) => a[0] - b[0]);
    const n = r.length;
    const all = r.reduce((a, x) => a + x[2], 0) / n;
    const q = (from, to, h) => {
      const sub = r.slice(Math.floor(n * from), Math.floor(n * to));
      return sub.reduce((a, x) => a + x[h], 0) / sub.length - (h === 2 ? all : all / 2);
    };
    return [q(0, 0.01, 2), q(0, 0.05, 2), q(0.05, 0.2, 2), q(0.8, 0.95, 2), q(0.95, 1, 2), q(0.99, 1, 2), q(0, 0.01, 1), q(0.99, 1, 1)];
  });
  const cell = (k) => parts.map((p) => p[k].toFixed(0).padStart(5)).join('/');
  console.log(
    name.padEnd(10) + ' 2ч: ниж1% ' + cell(0) + '  ниж5% ' + cell(1) + '  5-20% ' + cell(2) + '  80-95% ' + cell(3) +
      '  верх5% ' + cell(4) + '  верх1% ' + cell(5) + ' | 1ч: ниж1% ' + cell(6) + '  верх1% ' + cell(7)
  );
}
console.log('\nЗначения — отклонение от среднего движения рынка, б.п.; формат «первая половина/вторая половина». Комиссия за круг 10 б.п.');
void HZ;
