/**
 * Слой ИИ-анализа: отдаёт Claude сжатую сводку по монетам (техника + новости)
 * и получает структурированный вердикт — что покупать, что продавать, чего ждать.
 */
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.AI_MODEL || 'claude-opus-5';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['marketOverview', 'regime', 'riskWarning', 'bestOpportunities', 'coins'],
  properties: {
    marketOverview: {
      type: 'string',
      description: 'Обзор рынка на русском, 2-4 предложения: общий фон, риск-настроение, что важно сегодня.'
    },
    regime: {
      type: 'string',
      enum: ['risk-on', 'risk-off', 'mixed', 'low-volatility'],
      description: 'Текущий режим рынка.'
    },
    riskWarning: {
      type: 'string',
      description: 'Главный риск ближайших часов для скальпера (одно предложение).'
    },
    bestOpportunities: {
      type: 'array',
      items: { type: 'string' },
      description: 'Не более трёх тикеров с лучшим соотношением риск/прибыль прямо сейчас.'
    },
    coins: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['symbol', 'action', 'conviction', 'horizonMinutes', 'rationale', 'keyRisks', 'newsImpact'],
        properties: {
          symbol: { type: 'string' },
          action: { type: 'string', enum: ['BUY', 'SELL', 'WAIT'] },
          conviction: { type: 'integer', description: 'Уверенность от 0 до 100.' },
          horizonMinutes: { type: 'integer', description: 'Горизонт сделки в минутах, от 5 до 480.' },
          rationale: {
            type: 'string',
            description: 'Почему такое решение — на русском, 1-3 предложения, конкретно по данным.'
          },
          keyRisks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Не более трёх пунктов: что может сломать идею — коротко, на русском.'
          },
          newsImpact: {
            type: 'string',
            description: 'Как новостной фон влияет на монету. Если новостей нет — так и написать.'
          }
        }
      }
    }
  }
};

const SYSTEM_PROMPT = `Ты — опытный аналитик по внутридневной торговле криптовалютами (скальпинг, горизонт сделки 15–240 минут).
Тебе дают готовые расчёты: технические индикаторы на 5м/15м/1ч, уровни, оценку риска и новостной фон.

Правила:
- Работай ТОЛЬКО с переданными числами, ничего не выдумывай и не добавляй свои цены.
- Оценивай критически: если сигналы противоречат друг другу или волатильность низкая — честно ставь WAIT.
- BUY = открывать лонг, SELL = открывать шорт, WAIT = сделки нет.
- Учитывай, что при высоком риске и слабом ADX (боковик) скальпинг убыточен из-за комиссий.
- Новости весомее техники, только если они свежие и значимые (регулятор, взлом, ETF, макро).
- Данные фьючерсов читай так: положительная ставка финансирования выше 0.03% за 8 часов означает
  перегруженные лонги и риск каскада ликвидаций вниз; отрицательная ставка — перекос в шортах и
  топливо для отскока. Рост открытого интереса вместе с ценой подтверждает движение новыми деньгами,
  рост цены на падающем OI — это лишь закрытие шортов, такое движение быстро выдыхается.
  Перекос розницы (longShortRatio заметно выше 2.5) чаще работает против толпы.
- btcContext: при корреляции выше 0.7 сделка против направления биткоина почти всегда хуже, чем
  выглядит по самой монете. Положительная альфа при растущем BTC — признак лидера движения.
- conviction — насколько ты уверен; ниже 50 для спорных ситуаций.
- Пиши по-русски, коротко и по делу, без воды и без общих фраз вроде «следите за рынком».
- Не более 3 монет с action BUY/SELL, если фон не даёт явного преимущества всем.`;

/** Сжимаем анализ до компактного вида, чтобы не гонять лишние токены. */
function compact(analysis) {
  return {
    symbol: analysis.symbol,
    name: analysis.name,
    price: analysis.price,
    change24hPercent: analysis.ticker?.changePercent24h ?? null,
    techSignal: analysis.signal.direction,
    techScore: analysis.signal.techScore,
    confidence: analysis.signal.confidence,
    indicators: analysis.indicators,
    levels: analysis.levels,
    plan: {
      direction: analysis.plan.direction,
      entry: analysis.plan.entry,
      stopLoss: analysis.plan.stopLoss,
      stopPercent: analysis.plan.stopPercent,
      targets: analysis.plan.targets.map((t) => t.price),
      riskReward: analysis.plan.riskReward
    },
    risk: { score: analysis.risk.score, level: analysis.risk.level },
    derivatives: analysis.derivatives
      ? {
          fundingPercent8h: analysis.derivatives.fundingPercent,
          fundingTrend: analysis.derivatives.fundingTrend,
          openInterestChange1hPercent: analysis.derivatives.oiChange1h,
          longShortRatio: analysis.derivatives.longShortRatio,
          takerBuySellRatio: analysis.derivatives.takerBuySellRatio
        }
      : null,
    btcContext: analysis.correlation,
    keyFactors: analysis.reasons.map((r) => r.detail),
    news: {
      sentiment: analysis.news.sentiment,
      count: analysis.news.count,
      headlines: analysis.news.headlines.map((h) => h.title)
    }
  };
}

/**
 * Схема ответа для разбора одной монеты.
 * Ответ намеренно короткий: вердикт, одна фраза почему и до трёх причин —
 * трейдер смотрит на карточку несколько секунд, длинный текст ему мешает.
 */
const COIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'conviction', 'headline', 'why', 'nextStep'],
  properties: {
    action: { type: 'string', enum: ['BUY', 'SELL', 'WAIT'] },
    conviction: { type: 'integer', description: 'Уверенность от 0 до 100.' },
    headline: {
      type: 'string',
      description:
        'Итог одной фразой: входить или нет и главная причина. Максимум 90 символов, без перечислений.'
    },
    why: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Две-три причины, каждая максимум 55 символов. Только факты с числами, без вводных слов.'
    },
    nextStep: {
      type: 'string',
      description:
        'Одна строка максимум 80 символов: где вход и стоп, если сделка есть, либо чего ждать, если сделки нет.'
    }
  }
};

/**
 * Разбор одной монеты по кнопке. Стоит примерно в десять раз дешевле полного
 * сканирования, потому что в модель уходит только эта монета.
 */
export async function requestCoinReview({ analysis, market, news }) {
  if (!isAiConfigured()) {
    return { available: false, error: 'ANTHROPIC_API_KEY не задан — ИИ-разбор недоступен.' };
  }

  const client = new Anthropic();
  const payload = {
    timestamp: new Date().toISOString(),
    market: {
      fearGreed: market?.fearGreed || null,
      newsSentiment: news?.marketSentiment ?? null,
      topHeadlines: (news?.items || []).slice(0, 5).map((n) => ({ title: n.title, sentiment: n.sentiment }))
    },
    coin: compact(analysis),
    regime: analysis.regime
  };

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: [
        SYSTEM_PROMPT,
        'Разбирается одна монета. Отвечай МАКСИМАЛЬНО КРАТКО: трейдер смотрит на экран несколько секунд.',
        'headline — одна фраза до 90 символов. why — две-три причины, каждая до 55 символов, только с числами.',
        'nextStep — одна строка до 80 символов. Никаких вводных слов, повторов и рассуждений.',
        'Если regime.tradeable равно false, вход запрещён фильтром рынка — в nextStep укажи, чего ждать.'
      ].join(' '),
      output_config: { effort: 'low', format: { type: 'json_schema', schema: COIN_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: 'Разбери монету и дай вердикт.\n\nДанные (JSON):\n' + JSON.stringify(payload)
        }
      ]
    });

    if (response.stop_reason === 'refusal') {
      return { available: false, error: 'Модель отклонила запрос' };
    }

    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    let review;
    try {
      review = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Не удалось разобрать ответ модели');
      review = JSON.parse(match[0]);
    }

    return {
      available: true,
      model: MODEL,
      review,
      usage: {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens
      }
    };
  } catch (err) {
    return { available: false, error: 'Ошибка обращения к ИИ: ' + err.message };
  }
}

export function isAiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Запрашивает у Claude итоговый вердикт по всем монетам.
 * Возвращает { available, verdict, model, error }.
 */
export async function requestAiAnalysis({ analyses, market, news }) {
  if (!isAiConfigured()) {
    return {
      available: false,
      error: 'ANTHROPIC_API_KEY не задан — ИИ-анализ отключён, показаны только технические сигналы.'
    };
  }

  const client = new Anthropic();
  const payload = {
    timestamp: new Date().toISOString(),
    market: {
      fearGreed: market.fearGreed,
      newsSentiment: news.marketSentiment,
      topHeadlines: news.items
        .slice(0, 10)
        .map((n) => ({ title: n.title, sentiment: n.sentiment, source: n.source }))
    },
    coins: analyses.map(compact)
  };

  const userContent =
    'Проанализируй срез рынка и дай вердикт по каждой монете.\n\n' +
    'Данные (JSON):\n' +
    JSON.stringify(payload);

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SCHEMA }
      },
      messages: [{ role: 'user', content: userContent }]
    });

    if (response.stop_reason === 'refusal') {
      return { available: false, error: 'Модель отклонила запрос: ' + (response.stop_details?.explanation || '') };
    }

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    let verdict;
    try {
      verdict = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Не удалось разобрать ответ модели');
      verdict = JSON.parse(match[0]);
    }

    return {
      available: true,
      model: MODEL,
      verdict,
      usage: {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens
      }
    };
  } catch (err) {
    return { available: false, error: 'Ошибка обращения к ИИ: ' + err.message };
  }
}

/**
 * Объединяет технический сигнал и мнение ИИ в итоговое решение.
 * Совпадение усиливает уверенность, конфликт переводит идею в ожидание.
 */
export function mergeVerdict(analysis, aiCoin) {
  const tech = analysis.signal.direction; // LONG | SHORT | WAIT

  // Если состояние рынка признано непригодным, мнение ИИ этого не отменяет
  if (analysis.signal.blockedByRegime) {
    return {
      ...analysis,
      ai: aiCoin
        ? {
            action: aiCoin.action,
            conviction: aiCoin.conviction,
            horizonMinutes: aiCoin.horizonMinutes,
            rationale: aiCoin.rationale,
            keyRisks: aiCoin.keyRisks,
            newsImpact: aiCoin.newsImpact
          }
        : undefined,
      final: {
        action: 'ЖДАТЬ',
        direction: 'WAIT',
        confidence: 0,
        source: 'Фильтр рынка',
        note: 'Сделка отклонена: ' + analysis.signal.blockedByRegime
      }
    };
  }
  if (!aiCoin) {
    return {
      ...analysis,
      final: {
        action: analysis.signal.action,
        direction: tech,
        confidence: analysis.signal.confidence,
        source: 'Техника',
        note: 'ИИ-вердикт недоступен, решение построено только на индикаторах и новостях.'
      }
    };
  }

  const aiDirection = aiCoin.action === 'BUY' ? 'LONG' : aiCoin.action === 'SELL' ? 'SHORT' : 'WAIT';
  let direction = tech;
  let confidence = analysis.signal.confidence;
  let source = 'Техника + ИИ';
  let note = '';

  if (aiDirection === tech && tech !== 'WAIT') {
    confidence = Math.round(Math.min(100, (confidence * 0.55 + aiCoin.conviction * 0.45) * 1.1));
    note = 'ИИ подтверждает технический сигнал.';
  } else if (tech === 'WAIT' && aiDirection !== 'WAIT') {
    if (aiCoin.conviction >= 65) {
      direction = aiDirection;
      confidence = Math.round(aiCoin.conviction * 0.75);
      source = 'ИИ';
      note = 'Техника нейтральна, но ИИ видит перевес — вход только с уменьшенным объёмом.';
    } else {
      note = 'ИИ склоняется к сделке, но уверенности мало — ждём подтверждения.';
    }
  } else if (aiDirection === 'WAIT' && tech !== 'WAIT') {
    confidence = Math.round(confidence * 0.6);
    if (confidence < 45) {
      direction = 'WAIT';
      note = 'ИИ не поддержал технический сигнал — идея отложена.';
    } else {
      note = 'ИИ осторожен: сигнал есть, но входить стоит уменьшенным объёмом.';
    }
  } else if (aiDirection !== tech && tech !== 'WAIT' && aiDirection !== 'WAIT') {
    direction = 'WAIT';
    confidence = Math.round(confidence * 0.4);
    note = 'Прямой конфликт: техника и ИИ смотрят в разные стороны — от сделки лучше отказаться.';
  } else {
    note = 'И техника, и ИИ не видят перевеса — сделки нет.';
  }

  return {
    ...analysis,
    ai: {
      action: aiCoin.action,
      conviction: aiCoin.conviction,
      horizonMinutes: aiCoin.horizonMinutes,
      rationale: aiCoin.rationale,
      keyRisks: aiCoin.keyRisks,
      newsImpact: aiCoin.newsImpact
    },
    final: {
      action: direction === 'LONG' ? 'ПОКУПАТЬ' : direction === 'SHORT' ? 'ПРОДАВАТЬ' : 'ЖДАТЬ',
      direction,
      confidence: Math.max(0, Math.min(100, confidence)),
      source,
      note
    }
  };
}
