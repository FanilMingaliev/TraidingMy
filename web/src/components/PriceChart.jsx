import { useEffect, useRef } from 'react';
import { createChart, LineStyle } from 'lightweight-charts';

/**
 * Свечной график 5м с уровнями сделки.
 * @param {object[]} candles [{ time (мс), open, high, low, close }]
 * @param {object[]} lines   [{ price, color, title }]
 */
export default function PriceChart({ candles = [], lines = [], precision = 2, height = 260 }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !candles.length) return undefined;
    const chart = createChart(ref.current, {
      height,
      layout: { background: { color: 'transparent' }, textColor: '#8b98ad', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      handleScale: { axisPressedMouseMove: false }
    });
    const series = chart.addCandlestickSeries({
      upColor: '#00e5a0',
      downColor: '#ff4d6d',
      wickUpColor: '#00e5a0',
      wickDownColor: '#ff4d6d',
      borderVisible: false,
      priceFormat: { type: 'price', precision, minMove: 1 / 10 ** precision },
      // Уровни сделки должны помещаться на графике, даже если цена до них ещё не дошла
      autoscaleInfoProvider: (original) => {
        const info = original();
        const prices = lines.map((l) => l.price).filter((v) => v != null);
        if (!info || !prices.length) return info;
        return {
          ...info,
          priceRange: {
            minValue: Math.min(info.priceRange.minValue, ...prices),
            maxValue: Math.max(info.priceRange.maxValue, ...prices)
          }
        };
      }
    });
    // Библиотека считает время в UTC — сдвигаем, чтобы ось показывала местное
    const offset = -new Date().getTimezoneOffset() * 60;
    series.setData(
      candles.map((c) => ({ time: c.time / 1000 + offset, open: c.open, high: c.high, low: c.low, close: c.close }))
    );
    for (const line of lines) {
      if (line.price == null) continue;
      series.createPriceLine({
        price: line.price,
        color: line.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: line.title
      });
    }
    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => chart.applyOptions({ width: ref.current?.clientWidth || 300 }));
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [candles, lines, precision, height]);

  if (!candles.length) {
    return <div style={{ height }} className="grid place-items-center rounded-xl bg-white/3 text-[12px] text-slate-500">Нет свечей</div>;
  }
  return <div ref={ref} style={{ height }} className="w-full" />;
}
