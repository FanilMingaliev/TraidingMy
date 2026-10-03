import { useMemo, useState } from 'react';
import { openPositionFromPlan } from '@core/position.js';
import { formatMoney, formatPrice } from '../lib/format.js';
import { NumberField, Row, Sheet, primaryButton } from './ui.jsx';

/** Подтверждение входа: фактическая цена и объём могут отличаться от плана. */
export function EnterSheet({ item, onConfirm, onClose }) {
  const [price, setPrice] = useState(String(item.price));
  const [quantity, setQuantity] = useState(String(item.plan.position.quantity));

  const preview = useMemo(() => {
    const entry = Number(price);
    if (!Number.isFinite(entry) || entry <= 0) return null;
    const position = openPositionFromPlan(item, { entry });
    const qty = Number(quantity);
    if (Number.isFinite(qty) && qty > 0) {
      position.quantity = qty;
      position.notional = qty * position.entry;
      position.riskAmount = qty * Math.abs(position.entry - position.stopLoss);
    }
    return position;
  }, [item, price, quantity]);

  return (
    <Sheet title={'Вход: ' + item.name} subtitle={item.plan.direction === 'LONG' ? 'лонг' : 'шорт'} onClose={onClose}>
      <div className="grid gap-3">
        <p className="text-[12.5px] leading-snug text-slate-400">
          Сделку вы открываете сами на бирже. Здесь укажите, по какой цене и каким объёмом вошли — приложение
          будет следить за ней и подскажет, когда фиксировать и закрывать.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Цена входа" value={price} onChange={setPrice} suffix="$" />
          <NumberField label="Объём" value={quantity} onChange={setQuantity} suffix={item.base} />
        </div>
        {preview && (
          <div className="rounded-2xl border border-white/8 bg-black/25 px-3 py-2">
            <Row label="Стоп-лосс" value={formatPrice(preview.stopLoss, item.precision)} color="var(--color-rose-signal)" />
            {preview.targets.map((t) => (
              <Row key={t.label} label={t.label + ' — закрыть ' + t.closeShare + '%'} value={formatPrice(t.price, item.precision)} color="var(--color-mint-500)" />
            ))}
            <Row label="Сумма позиции" value={'$' + formatMoney(preview.notional)} />
            <Row label="Риск до стопа" value={'$' + formatMoney(preview.riskAmount)} color="var(--color-rose-signal)" />
          </div>
        )}
        <p className="text-[11.5px] leading-snug text-slate-500">
          Поставьте стоп-лосс на бирже сразу после входа: приложение подсказывает, но ордера не выставляет.
        </p>
        <button disabled={!preview} onClick={() => onConfirm(preview)} className={primaryButton}>
          Начать сопровождение
        </button>
      </div>
    </Sheet>
  );
}

/** Закрытие сделки: фиксируем цену выхода, результат уходит в историю. */
export function CloseSheet({ position, advice, onConfirm, onClose }) {
  const suggested = advice?.exitPrice ?? advice?.price ?? position.entry;
  const [price, setPrice] = useState(String(suggested));
  const exit = Number(price);
  const valid = Number.isFinite(exit) && exit > 0;
  const sign = position.direction === 'LONG' ? 1 : -1;
  const risk = Math.abs(position.entry - position.initialStop);
  const resultR = valid && risk ? (((exit - position.entry) * sign) / risk) * position.remaining : null;

  return (
    <Sheet title={'Закрытие: ' + position.name} subtitle={advice?.title} onClose={onClose}>
      <div className="grid gap-3">
        <NumberField
          label={'Цена выхода' + (position.remaining < 1 ? ' (остаток ' + Math.round(position.remaining * 100) + '%)' : '')}
          value={price}
          onChange={setPrice}
          suffix="$"
          hint="Подставлена текущая цена или уровень, на котором сработал стоп или цель. Поправьте, если закрыли по другой."
        />
        {resultR != null && (
          <div className="rounded-2xl border border-white/8 bg-black/25 px-3 py-2">
            <Row
              label="Результат остатка"
              value={(resultR > 0 ? '+' : '') + resultR.toFixed(2) + 'R'}
              color={resultR >= 0 ? 'var(--color-mint-500)' : 'var(--color-rose-signal)'}
            />
          </div>
        )}
        <button disabled={!valid} onClick={() => onConfirm(exit)} className={primaryButton}>
          Закрыть и записать в историю
        </button>
      </div>
    </Sheet>
  );
}
