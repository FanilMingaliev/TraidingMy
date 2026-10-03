/**
 * Связь монеты с биткоином. Альткоины ходят за BTC, поэтому сигнал против
 * движения биткоина при высокой корреляции почти всегда хуже, чем выглядит
 * в изолированном анализе — а сила относительно BTC, наоборот, подсказывает
 * лидеров и аутсайдеров.
 */

const logReturns = (values) => {
  const out = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0 && values[i] > 0) out.push(Math.log(values[i] / values[i - 1]));
  }
  return out;
};

const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

/**
 * @param {number[]} coinCloses цены закрытия монеты (5м, от старых к новым)
 * @param {number[]} btcCloses  цены закрытия BTC за тот же период
 * @param {number} window сколько последних свечей учитывать
 */
export function correlationStats(coinCloses, btcCloses, window = 96) {
  const size = Math.min(coinCloses.length, btcCloses.length, window + 1);
  if (size < 20) return null;

  const coin = logReturns(coinCloses.slice(-size));
  const btc = logReturns(btcCloses.slice(-size));
  const n = Math.min(coin.length, btc.length);
  if (n < 15) return null;

  const a = coin.slice(-n);
  const b = btc.slice(-n);
  const ma = mean(a);
  const mb = mean(b);

  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  const correlation = varA > 0 && varB > 0 ? cov / Math.sqrt(varA * varB) : 0;
  const beta = varB > 0 ? cov / varB : 0;

  // Движение за последний час (12 пятиминуток) и опережение/отставание от BTC
  const back = Math.min(12, coinCloses.length - 1, btcCloses.length - 1);
  const coinChange1h = ((coinCloses.at(-1) - coinCloses.at(-1 - back)) / coinCloses.at(-1 - back)) * 100;
  const btcChange1h = ((btcCloses.at(-1) - btcCloses.at(-1 - back)) / btcCloses.at(-1 - back)) * 100;
  const expected = beta * btcChange1h;
  const alpha = coinChange1h - expected;

  return {
    correlation: Number(correlation.toFixed(2)),
    beta: Number(beta.toFixed(2)),
    coinChange1h: Number(coinChange1h.toFixed(2)),
    btcChange1h: Number(btcChange1h.toFixed(2)),
    alpha1h: Number(alpha.toFixed(2))
  };
}
