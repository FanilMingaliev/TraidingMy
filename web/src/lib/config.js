/**
 * Адрес бэкенда для приложения.
 *
 * В браузере (разработка) по умолчанию пусто — запросы идут на тот же origin
 * через прокси Vite. В собранном Android-приложении своего сервера на origin нет,
 * поэтому адрес задаётся в настройках и хранится локально на устройстве.
 */
const KEY = 'scalpradar.apiBase';
const TOKEN_KEY = 'scalpradar.apiToken';

export function getApiBase() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved != null) return saved;
  } catch {
    /* localStorage может быть недоступен */
  }
  return import.meta.env.VITE_API_URL || '';
}

export function setApiBase(url) {
  try {
    const normalized = String(url || '').trim().replace(/\/+$/, '');
    localStorage.setItem(KEY, normalized);
    return normalized;
  } catch {
    return url;
  }
}

/** true, если приложение запущено как нативная обёртка Capacitor. */
export function isNativeApp() {
  return typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());
}

export function getApiToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setApiToken(token) {
  try {
    const value = String(token || '').trim();
    localStorage.setItem(TOKEN_KEY, value);
    return value;
  } catch {
    return token;
  }
}
