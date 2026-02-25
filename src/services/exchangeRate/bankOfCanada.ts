import type { Currency } from "../../types/index.ts";
import type { ExchangeRate, ExchangeRateProvider } from "./types.ts";
import type { ExchangeRateCache } from "../../db/exchangeRateCache.ts";
import type { ObservationRate } from "./bankOfCanadaApi.ts";

type FetchRatesFn = (
  startDate: string,
  endDate: string
) => Promise<ObservationRate[]>;

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

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

    // Check cache first
    let cached = this.cache.getClosestRate(pair, dateStr);

    if (!cached || !this.isWithinWindow(cached.date, dateStr)) {
      // Fetch a 10-day window and cache results
      const startDate = formatDate(subtractDays(date, 9));
      try {
        const rates = await this.fetchRates(startDate, dateStr);
        if (rates.length > 0) {
          this.cache.insertRates(
            rates.map((r) => ({ date: r.date, currencyPair: pair, rate: r.rate }))
          );
        }
      } catch (error) {
        // If API fails but we have cached data, we'll use it below
        if (!cached) throw error;
      }

      cached = this.cache.getClosestRate(pair, dateStr);
    }

    if (!cached) {
      throw new Error(
        `No exchange rate available for ${from}→${to} on ${dateStr}`
      );
    }

    // It's an estimate only if the closest rate is older than the 10-day window
    const isEstimate = !this.isWithinWindow(cached.date, dateStr);
    let rate = cached.rate;

    if (from === "CAD" && to === "USD") {
      rate = 1 / rate;
    }

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
    const cached = new Date(cachedDate + "T00:00:00");
    const requested = new Date(requestedDate + "T00:00:00");
    const diffMs = requested.getTime() - cached.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= 9;
  }
}
