import type { Currency } from "../types/index.ts";

export function formatCurrency(amount: number, currency: Currency = "CAD"): string {
  const symbol = currency === "CAD" ? "C$" : "US$";
  return `${symbol}${amount.toFixed(2)}`;
}

export function formatCurrencyShort(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
