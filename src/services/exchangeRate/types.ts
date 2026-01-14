import type { Currency } from "../../types/index.ts";

export interface ExchangeRate {
  from: Currency;
  to: Currency;
  rate: number;
  date: Date;
  source: string;
  isEstimate: boolean;
}

export interface ExchangeRateProvider {
  getRate(from: Currency, to: Currency, date: Date): Promise<ExchangeRate>;
}
