import type { Currency } from "../../types/index.ts";
import type { ExchangeRate, ExchangeRateProvider } from "./types.ts";

const HARDCODED_USD_TO_CAD = 1.38;

export class HardcodedExchangeRateProvider implements ExchangeRateProvider {
  async getRate(from: Currency, to: Currency, date: Date): Promise<ExchangeRate> {
    if (from === to) {
      return {
        from,
        to,
        rate: 1,
        date,
        source: "identity",
        isEstimate: false,
      };
    }

    if (from === "USD" && to === "CAD") {
      return {
        from,
        to,
        rate: HARDCODED_USD_TO_CAD,
        date,
        source: "hardcoded",
        isEstimate: true,
      };
    }

    if (from === "CAD" && to === "USD") {
      return {
        from,
        to,
        rate: 1 / HARDCODED_USD_TO_CAD,
        date,
        source: "hardcoded",
        isEstimate: true,
      };
    }

    throw new Error(`Unsupported currency conversion: ${from} to ${to}`);
  }
}

export const EXCHANGE_RATE_WARNING =
  "USD prices converted at hardcoded rate of 1.38 CAD/USD. " +
  "Actual Bank of Canada rates will be used in a future update.";
