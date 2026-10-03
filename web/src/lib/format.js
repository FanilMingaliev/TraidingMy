/** Форматирование чисел, цен и времени для интерфейса. */

export function formatPrice(value, precision = 2) {
  if (value == null || Number.isNaN(value)) return '—';
  return Number(value).toLocaleString('ru-RU', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  });
}

export function formatMoney(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—';
  return Number(value).toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function formatCompact(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return (value / 1e9).toFixed(2) + ' млрд';
  if (abs >= 1e6) return (value / 1e6).toFixed(1) + ' млн';
  if (abs >= 1e3) return (value / 1e3).toFixed(1) + ' тыс.';
  return value.toFixed(0);
}

export function formatPercent(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—';
  return (value > 0 ? '+' : '') + Number(value).toFixed(digits) + '%';
}

export function formatQuantity(value) {
  if (value == null) return '—';
  if (value >= 1000) return value.toFixed(1);
  if (value >= 1) return value.toFixed(3);
  return value.toFixed(6);
}

export function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 60000;
  if (diff < 1) return 'только что';
  if (diff < 60) return Math.round(diff) + ' мин назад';
  const hours = diff / 60;
  if (hours < 24) return Math.round(hours) + ' ч назад';
  return Math.round(hours / 24) + ' дн назад';
}

/** Цвета и подписи для направления сделки. */
export const DIRECTION_STYLE = {
  LONG: {
    label: 'ПОКУПАТЬ',
    short: 'LONG',
    text: 'text-[var(--color-mint-500)]',
    bg: 'bg-[rgba(0,229,160,0.12)]',
    border: 'border-[rgba(0,229,160,0.35)]',
    accent: 'var(--color-mint-500)'
  },
  SHORT: {
    label: 'ПРОДАВАТЬ',
    short: 'SHORT',
    text: 'text-[var(--color-rose-signal)]',
    bg: 'bg-[rgba(255,77,109,0.12)]',
    border: 'border-[rgba(255,77,109,0.35)]',
    accent: 'var(--color-rose-signal)'
  },
  WAIT: {
    label: 'ЖДАТЬ',
    short: 'WAIT',
    text: 'text-slate-300',
    bg: 'bg-[rgba(148,163,184,0.1)]',
    border: 'border-[rgba(148,163,184,0.25)]',
    accent: '#94a3b8'
  }
};

export function riskColor(score) {
  if (score < 33) return 'var(--color-mint-500)';
  if (score < 58) return 'var(--color-amber-signal)';
  if (score < 78) return '#ff8a5b';
  return 'var(--color-rose-signal)';
}

export function sentimentLabel(value) {
  if (value > 0.35) return { text: 'Позитивный', color: 'var(--color-mint-500)' };
  if (value > 0.1) return { text: 'Умеренно позитивный', color: 'var(--color-mint-600)' };
  if (value < -0.35) return { text: 'Негативный', color: 'var(--color-rose-signal)' };
  if (value < -0.1) return { text: 'Умеренно негативный', color: '#ff8a5b' };
  return { text: 'Нейтральный', color: '#94a3b8' };
}

/** «1 ч 25 мин» из минут. */
export function formatDuration(minutes) {
  if (minutes == null || Number.isNaN(minutes)) return '—';
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return m + ' мин';
  const rest = m % 60;
  return Math.floor(m / 60) + ' ч' + (rest ? ' ' + rest + ' мин' : '');
}

/** Цвета состояний советника по сделке. */
export const TONE = {
  profit: { color: 'var(--color-mint-500)', soft: 'rgba(0,229,160,0.12)', border: 'rgba(0,229,160,0.4)' },
  danger: { color: 'var(--color-rose-signal)', soft: 'rgba(255,77,109,0.12)', border: 'rgba(255,77,109,0.45)' },
  warn: { color: 'var(--color-amber-signal)', soft: 'rgba(255,179,71,0.1)', border: 'rgba(255,179,71,0.4)' },
  neutral: { color: '#cbd5e1', soft: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.22)' }
};
