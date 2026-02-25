import type { Currency } from "../../types/index.ts";
import type { ExchangeRate, ExchangeRateProvider } from "./types.ts";
import type { ExchangeRateCache } from "../../db/exchangeRateCache.ts";
import type { ObservationRate } from "./bankOfCanadaApi.ts";
import { formatDate } from "../../utils/date.ts";

type FetchRatesFn = (
  startDate: string,
  endDate: string
) => Promise<ObservationRate[]>;

function subtractDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
}

export class BankOfCanadaExchangeRateProvider implements ExchangeRateProvider {
  constructor(
    private cache: ExchangeRateCache,
    private fetchRates: FetchRatesFn
  ) {}

  async getRate(
    from: Currency,
    to: Currency,
    date: Date
  ): Promise<ExchangeRate> {
    if (from === to) {
      return { from, to, rate: 1, date, source: "identity", isEstimate: false };
    }

    const dateStr = formatDate(date);
    const pair = "FXUSDCAD";

    // Exact cache hit — no fetch needed
    const exactRate = this.cache.getRate(pair, dateStr);
    if (exactRate !== null) {
      return this.buildResult(from, to, exactRate, date, false);
    }

    // No exact match — fetch 10-day window and cache results
    const startDate = formatDate(subtractDays(date, 9));
    try {
      const rates = await this.fetchRates(startDate, dateStr);
      if (rates.length > 0) {
        this.cache.insertRates(
          rates.map((r) => ({ date: r.date, currencyPair: pair, rate: r.rate }))
        );
      }
    } catch (error) {
      // If there's no cached data at all, we can't recover
      const fallback = this.cache.getClosestRate(pair, dateStr);
      if (!fallback) throw error;
    }

    const closest = this.cache.getClosestRate(pair, dateStr);
    if (!closest) {
      throw new Error(
        `No exchange rate available for ${from}→${to} on ${dateStr}`
      );
    }

    const isEstimate = !this.isWithinWindow(closest.date, dateStr);
    return this.buildResult(from, to, closest.rate, date, isEstimate);
  }

  private buildResult(
    from: Currency,
    to: Currency,
    usdCadRate: number,
    date: Date,
    isEstimate: boolean
  ): ExchangeRate {
    const rate = from === "CAD" && to === "USD" ? 1 / usdCadRate : usdCadRate;
    return {
      from,
      to,
      rate,
      date,
      source: isEstimate ? "bank-of-canada (estimate)" : "bank-of-canada",
      isEstimate,
    };
  }

  private isWithinWindow(cachedDate: string, requestedDate: string): boolean {
    const cached = new Date(cachedDate + "T00:00:00Z");
    const requested = new Date(requestedDate + "T00:00:00Z");
    const diffMs = requested.getTime() - cached.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= 9;
  }
}
