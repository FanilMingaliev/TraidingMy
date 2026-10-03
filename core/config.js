/**
 * Конфигурация сканера: список монет, веса сигналов, параметры риска.
 */

/**
 * 10 монет первого уровня.
 * aliases — ключевые слова для привязки новостей к монете.
 */
export const COINS = [
  { symbol: 'BTCUSDT',  base: 'BTC',  name: 'Bitcoin',   aliases: ['bitcoin', 'btc', 'биткоин'] },
  { symbol: 'ETHUSDT',  base: 'ETH',  name: 'Ethereum',  aliases: ['ethereum', 'eth', 'ether', 'эфир'] },
  { symbol: 'SOLUSDT',  base: 'SOL',  name: 'Solana',    aliases: ['solana', 'sol'] },
  { symbol: 'BNBUSDT',  base: 'BNB',  name: 'BNB',       aliases: ['bnb', 'binance coin'] },
  { symbol: 'XRPUSDT',  base: 'XRP',  name: 'XRP',       aliases: ['xrp', 'ripple'] },
  { symbol: 'DOGEUSDT', base: 'DOGE', name: 'Dogecoin',  aliases: ['dogecoin', 'doge'] },
  { symbol: 'ADAUSDT',  base: 'ADA',  name: 'Cardano',   aliases: ['cardano', 'ada'] },
  { symbol: 'AVAXUSDT', base: 'AVAX', name: 'Avalanche', aliases: ['avalanche', 'avax'] },
  { symbol: 'LINKUSDT', base: 'LINK', name: 'Chainlink', aliases: ['chainlink', 'link'] },
  { symbol: 'SUIUSDT',  base: 'SUI',  name: 'Sui',       aliases: ['sui network', 'sui'] }
];

export const COIN_MAP = new Map(COINS.map((c) => [c.symbol, c]));

/** Таймфреймы: рабочий, подтверждающий и трендовый. */
export const TIMEFRAMES = { entry: '5m', confirm: '15m', trend: '1h' };

/** Параметры торговой модели по умолчанию. */
export const DEFAULTS = {
  deposit: 1000,          // депозит, USDT
  riskPercent: 1,         // риск на сделку, % от депозита
  leverage: 5,            // плечо (для расчёта маржи)
  atrStopMultiplier: 1.4, // множитель ATR для стоп-лосса
  minStopPercent: 0.25,   // минимальная дистанция стопа, % (защита от шума/спреда)
  maxStopPercent: 2.0,    // максимальная дистанция стопа, % (скальпинг не держит широкие стопы)
  takeProfitR: [1, 1.8, 3], // цели в R (кратно риску)
  // Порог 45 выбран по бэктесту: на четырёх отрезках подряд он обходил прежние 28
  // за счёт того, что отсекает частые слабые сигналы, съедающие депозит комиссиями.
  minScoreToTrade: 45,
  // Скальпинг-сделку не стоит держать дольше двух часов: по истории удержание
  // сверх 24 пятиминутных баров ухудшало результат на всех проверенных отрезках.
  maxHoldMinutes: 120,
  feePercentRoundTrip: 0.1, // комиссия вход+выход, % (для расчёта чистой прибыли)
  // Правила досрочного выхода из открытой сделки (см. position.js).
  // null — правило выключено.
  exit: {
    maxHoldMinutes: 120,
    reverseScore: null,     // закрыть, если счёт против сделки достиг этого значения
    fadeScore: null,        // закрыть, если счёт в сторону сделки упал ниже этого значения…
    fadeAfterMinutes: 0,    // …но не раньше, чем через столько минут после входа
    exitOnCascade: false    // закрыть при каскаде ликвидаций
  },
  // Фильтр состояния рынка. По истории сделки в боковике теряли деньги на всех
  // проверенных отрезках (60 сделок, средняя −0.40R, ни одного плюсового отрезка),
  // а сжатая волатильность давала тот же знак. Поэтому в таких состояниях
  // инструмент молчит вместо того, чтобы выдавать сигнал.
  regimeFilter: {
    enabled: true,
    requireTrend: true,   // нужен выраженный часовой тренд (ADX >= 25)
    blockSqueeze: true,   // не торгуем при сжатой волатильности
    blockCascade: true    // не входим в момент каскада ликвидаций
  }
};

/**
 * Сетапы — конкретные рыночные ситуации, проверенные на истории отдельно (npm run validate).
 *
 * «Отскок после пролива»: лонг, когда цена за час упала на три и более часовых ATR.
 * Узкие стопы на таких движениях систематически теряют — цену выбивает до отскока,
 * поэтому стоп широкий (2 часовых ATR), а размер позиции уменьшается пропорционально.
 * Зеркальный шорт после резкого роста на истории убыточен и не используется.
 *
 * Важно: устойчивого преимущества у сетапа нет. На двух годах истории он зарабатывал
 * только в отдельные периоды (последние полгода), а в падающем рынке терял. Поэтому
 * вход выдаётся только при положительной «форме» за последние недели — это сокращает
 * потери в плохие периоды, но прибыльной стратегию само по себе не делает.
 */
export const SETUPS = {
  flush: {
    name: 'Отскок после пролива',
    stopAtrMultiplier: 2,        // стоп = 2 × ATR(1ч)
    targets: [[1, 50], [1.5, 50]], // [цель в R, доля позиции %]
    maxHoldMinutes: 240,
    // Фильтр формы: сигнал выдаётся, только если сетап за последние недели в плюсе
    health: { windowDays: 30, minTrades: 10 },
    // Порог срабатывания: глубина пролива в часовых ATR. Более глубокие проливы
    // на двух годах истории лучшего результата не показали, поэтому ступень одна.
    tiers: [{ depth: 3, label: 'пролив', winRate: 55, avgR: 0.03 }],
    // Результаты npm run validate: 10 монет, 720 дней до 02.10.2026, комиссия 0.1% за круг
    validation: [
      { label: 'Последние 6 месяцев, все сигналы', trades: 194, winRate: 66, avgR: 0.24, totalR: 46.6 },
      { label: 'Предыдущие 18 месяцев, все сигналы', trades: 673, winRate: 42, avgR: -0.18, totalR: -119 },
      { label: '2 года, все сигналы', trades: 867, winRate: 48, avgR: -0.08, totalR: -72.4 },
      { label: '2 года, с фильтром формы', trades: 281, winRate: 55, avgR: 0.03, totalR: 9.5 },
      { label: 'Прежний алгоритм (счёт индикаторов), 8 недель', trades: 1068, winRate: 42, avgR: -0.11, totalR: -118.8 }
    ],
    validationNote:
      'Вывод из проверки: устойчивого преимущества нет. Сетап зарабатывал в последние полгода и терял ' +
      'в предыдущие полтора года; фильтр формы сводит двухлетний итог примерно к нулю, но плюсом его не делает.'
  }
};

/** Веса технических факторов в итоговом score (-100..100). */
export const WEIGHTS = {
  trend1h: 22,      // направление старшего тренда (EMA50/EMA200 на 1ч)
  emaStack: 16,     // выстроенность EMA9/21/50 на 5м
  ema15m: 10,       // подтверждение на 15м
  macd: 12,         // MACD гистограмма и пересечение
  rsi: 12,          // RSI: импульс и зоны перекупленности/перепроданности
  stochRsi: 6,      // Stoch RSI развороты
  bollinger: 8,     // положение цены в канале / сжатие
  volume: 8,        // всплеск объёма в направлении движения
  vwap: 8,          // цена относительно VWAP
  momentum: 8,      // скорость движения за последние свечи
  levels: 6,        // близость к поддержке/сопротивлению
  funding: 9,       // ставка финансирования: перекос толпы и топливо для сквиза
  openInterest: 12, // приток/отток денег во фьючерсы относительно движения цены
  positioning: 6,   // позиционирование розницы и агрессия тейкеров
  btcContext: 14    // связь с биткоином: корреляция, бета, относительная сила
};

export const NEWS_FEEDS = [
  { url: 'https://cointelegraph.com/rss', source: 'Cointelegraph' },
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml', source: 'CoinDesk' },
  { url: 'https://decrypt.co/feed', source: 'Decrypt' },
  { url: 'https://cryptoslate.com/feed/', source: 'CryptoSlate' },
  { url: 'https://ambcrypto.com/feed/', source: 'AMBCrypto' },
  { url: 'https://bitcoinmagazine.com/feed', source: 'Bitcoin Magazine' }
];

export const CACHE_TTL = {
  klines: 20 * 1000,       // свечи
  ticker: 15 * 1000,       // 24ч статистика
  news: 5 * 60 * 1000,     // новости
  derivatives: 60 * 1000,  // финансирование и открытый интерес
  fearGreed: 30 * 60 * 1000
};
