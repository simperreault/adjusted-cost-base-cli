export type { ExchangeRate, ExchangeRateProvider } from "./types.ts";
export { BankOfCanadaExchangeRateProvider } from "./bankOfCanada.ts";

import { BankOfCanadaExchangeRateProvider } from "./bankOfCanada.ts";
import { createExchangeRateCache } from "../../db/exchangeRateCache.ts";
import { fetchRates } from "./bankOfCanadaApi.ts";
import type { ExchangeRateProvider } from "./types.ts";

let providerInstance: ExchangeRateProvider | null = null;

export function getExchangeRateProvider(): ExchangeRateProvider {
  if (!providerInstance) {
    const cache = createExchangeRateCache();
    providerInstance = new BankOfCanadaExchangeRateProvider(cache, fetchRates);
  }
  return providerInstance;
}
