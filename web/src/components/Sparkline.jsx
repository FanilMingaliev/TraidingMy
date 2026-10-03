/** Мини-график последних свечей (только цена закрытия). */
export default function Sparkline({ data = [], color = '#00e5a0', height = 44, width = 150, className = '' }) {
  if (!data || data.length < 2) {
    return <div style={{ height }} className={'rounded-lg bg-white/3 ' + className} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((value, i) => [i * step, height - ((value - min) / span) * (height - 6) - 3]);
  const line = points.map(([x, y], i) => (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
  const area = line + ' L' + width + ' ' + height + ' L0 ' + height + ' Z';
  const id = 'spark-' + color.replace(/[^a-z0-9]/gi, '');

  return (
    <svg
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={'block w-full overflow-visible ' + className}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r="2.6" fill={color} />
    </svg>
  );
}
