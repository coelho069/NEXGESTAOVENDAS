import Decimal from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export type MoneyString = `${number}` | string;

export function money(value: MoneyString | number): Decimal {
  return new Decimal(value);
}

export function formatBRL(value: MoneyString | number): string {
  const amount = money(value);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amount.toNumber());
}

export function toMoneyString(value: Decimal): string {
  return value.toFixed(2);
}

export function sumMoney(values: Array<MoneyString | number>): string {
  return values
    .reduce((acc, current) => acc.plus(money(current)), money(0))
    .toFixed(2);
}

export function multiplyMoney(unitPrice: MoneyString, quantity: number | string): string {
  return money(unitPrice).times(quantity).toFixed(2);
}

export function subtractMoney(a: MoneyString, b: MoneyString): string {
  return money(a).minus(money(b)).toFixed(2);
}
