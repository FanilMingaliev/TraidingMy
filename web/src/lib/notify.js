/**
 * Оповещения о сигналах: системное уведомление, звук и вибрация.
 * В Android-приложении используются локальные уведомления Capacitor,
 * в браузере — Notification API.
 */
import { isNativeApp } from './config.js';

let nativePlugin = null;
async function native() {
  if (!isNativeApp()) return null;
  if (!nativePlugin) {
    const mod = await import('@capacitor/local-notifications');
    nativePlugin = mod.LocalNotifications;
  }
  return nativePlugin;
}

/** Запрашивает разрешение. Возвращает true, если уведомления разрешены. */
export async function requestNotifyPermission() {
  try {
    const plugin = await native();
    if (plugin) {
      const res = await plugin.requestPermissions();
      return res.display === 'granted';
    }
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

let audioContext = null;
function beep(kind) {
  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    const tones = kind === 'danger' ? [520, 390] : kind === 'profit' ? [660, 880] : [740, 740];
    tones.forEach((freq, i) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      const start = audioContext.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(start);
      osc.stop(start + 0.17);
    });
  } catch {
    /* звук недоступен до первого касания экрана — не критично */
  }
}

// Каждое событие сообщаем один раз, даже если оно держится несколько обновлений подряд
const fired = new Set();
let counter = 1;

/**
 * @param {string} key   уникальный ключ события
 * @param {object} event { title, body, kind: 'entry' | 'profit' | 'danger' }
 * @param {object} settings настройки приложения (notify, sound)
 */
export async function announce(key, event, settings) {
  if (fired.has(key)) return false;
  fired.add(key);
  if (settings.sound) {
    beep(event.kind);
    try {
      navigator.vibrate?.(event.kind === 'danger' ? [200, 80, 200] : 180);
    } catch {
      /* вибрации нет */
    }
  }
  if (!settings.notify) return true;
  try {
    const plugin = await native();
    if (plugin) {
      await plugin.schedule({
        notifications: [{ id: counter++ + (Date.now() % 100000) * 100, title: event.title, body: event.body }]
      });
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const registration = await navigator.serviceWorker?.getRegistration?.();
      if (registration?.showNotification) await registration.showNotification(event.title, { body: event.body, tag: key });
      else new Notification(event.title, { body: event.body, tag: key });
    }
  } catch {
    /* уведомление не показалось — сигнал всё равно виден на экране */
  }
  return true;
}
