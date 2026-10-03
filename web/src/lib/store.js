/** Состояние, которое переживает перезапуск: настройки, открытые сделки, история. */
import { useEffect, useState } from 'react';

export const DEFAULT_SETTINGS = {
  deposit: 1000,
  riskPercent: 1,
  leverage: 5,
  symbols: null,          // null — все монеты из списка движка
  refreshSec: 60,
  notify: true,
  sound: true,
  legacySignals: false,   // экспериментальные тренд-сигналы по общему счёту
  demo: false,            // пример сигнала на первой монете — чтобы посмотреть, как всё выглядит
  mode: 'local',          // local — данные бирж напрямую; server — через свой бэкенд (новости, ИИ)
  useAi: false
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    const saved = read(key, null);
    if (saved == null) return initial;
    // Новые поля настроек появляются с обновлениями — дополняем сохранённое значениями по умолчанию
    return initial && typeof initial === 'object' && !Array.isArray(initial) ? { ...initial, ...saved } : saved;
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* хранилище недоступно или переполнено — работаем без сохранения */
    }
  }, [key, value]);
  return [value, setValue];
}

export const KEYS = {
  settings: 'scalp.settings.v2',
  positions: 'scalp.positions.v1',
  history: 'scalp.history.v1'
};
