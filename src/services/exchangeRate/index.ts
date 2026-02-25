export type { ExchangeRate, ExchangeRateProvider } from "./types.ts";
export { BankOfCanadaExchangeRateProvider } from "./bankOfCanada.ts";

import { BankOfCanadaExchangeRateProvider } from "./bankOfCanada.ts";
import {
  createExchangeRateCache,
  type ExchangeRateCache,
} from "../../db/exchangeRateCache.ts";
import { fetchRates } from "./bankOfCanadaApi.ts";
import type { ExchangeRateProvider } from "./types.ts";

let providerInstance: ExchangeRateProvider | null = null;
let cacheInstance: ExchangeRateCache | null = null;

export function getExchangeRateProvider(): ExchangeRateProvider {
  if (!providerInstance) {
    cacheInstance = createExchangeRateCache();
    providerInstance = new BankOfCanadaExchangeRateProvider(
      cacheInstance,
      fetchRates
    );

    process.on("exit", () => {
      cacheInstance?.close();
      cacheInstance = null;
    });
  }
  return providerInstance;
}
