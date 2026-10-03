/** Клиент API. База берётся из настроек приложения (см. lib/config.js). */
import { getApiBase, getApiToken } from './config.js';

async function request(path, options = {}) {
  const token = getApiToken();
  const res = await fetch(getApiBase() + path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-api-token': token } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса (' + res.status + ')');
  return data;
}

export const api = {
  health: () => request('/api/health'),
  coins: () => request('/api/coins'),
  news: () => request('/api/news'),
  journal: () => request('/api/journal'),
  aiReview: (payload) =>
    request('/api/ai-review', { method: 'POST', body: JSON.stringify(payload) }),
  analyze: (payload) =>
    request('/api/analyze', { method: 'POST', body: JSON.stringify(payload) })
};
