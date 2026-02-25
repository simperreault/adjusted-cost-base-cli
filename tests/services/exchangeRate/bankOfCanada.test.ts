import { describe, expect, test, mock } from "bun:test";
import { BankOfCanadaExchangeRateProvider } from "../../../src/services/exchangeRate/bankOfCanada.ts";
import { createInMemoryExchangeRateCache } from "../../../src/db/exchangeRateCache.ts";
import type { ObservationRate } from "../../../src/services/exchangeRate/bankOfCanadaApi.ts";

function createProvider(
  mockRates: ObservationRate[] = [],
  shouldThrow = false
) {
  const cache = createInMemoryExchangeRateCache();
  const fetchFn = mock(async () => {
    if (shouldThrow) throw new Error("Network error");
    return mockRates;
  }) as (start: string, end: string) => Promise<ObservationRate[]>;

  const provider = new BankOfCanadaExchangeRateProvider(cache, fetchFn);
  return { provider, cache, fetchFn };
}

// Use local Date constructors to match how parseDate() creates dates
function localDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

describe("BankOfCanadaExchangeRateProvider", () => {
  test("same currency returns rate 1, no API call", async () => {
    const { provider, fetchFn } = createProvider();
    const result = await provider.getRate("CAD", "CAD", localDate(2025, 1, 15));

    expect(result.rate).toBe(1);
    expect(result.isEstimate).toBe(false);
    expect(result.source).toBe("identity");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("cache hit skips API call", async () => {
    const cache = createInMemoryExchangeRateCache();
    cache.insertRates([
      { date: "2025-01-15", currencyPair: "FXUSDCAD", rate: 1.44 },
    ]);
    const fetchFn = mock(async () => []) as (start: string, end: string) => Promise<ObservationRate[]>;
    const provider = new BankOfCanadaExchangeRateProvider(cache, fetchFn);

    const result = await provider.getRate("USD", "CAD", localDate(2025, 1, 15));

    expect(result.rate).toBe(1.44);
    expect(result.isEstimate).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
    cache.close();
  });

  test("fetches from API on cache miss and caches result", async () => {
    const { provider, fetchFn } = createProvider([
      { date: "2025-01-14", rate: 1.43 },
      { date: "2025-01-15", rate: 1.44 },
    ]);

    const result = await provider.getRate("USD", "CAD", localDate(2025, 1, 15));

    expect(result.rate).toBe(1.44);
    expect(result.isEstimate).toBe(false);
    expect(result.source).toBe("bank-of-canada");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("weekend date returns Friday's rate", async () => {
    const { provider } = createProvider([
      { date: "2025-01-10", rate: 1.43 }, // Friday
    ]);

    // Saturday Jan 11
    const result = await provider.getRate("USD", "CAD", localDate(2025, 1, 11));

    expect(result.rate).toBe(1.43);
    expect(result.isEstimate).toBe(false);
  });

  test("CAD to USD inverts the rate", async () => {
    const { provider } = createProvider([
      { date: "2025-01-15", rate: 1.44 },
    ]);

    const result = await provider.getRate("CAD", "USD", localDate(2025, 1, 15));

    expect(result.rate).toBeCloseTo(1 / 1.44, 10);
    expect(result.from).toBe("CAD");
    expect(result.to).toBe("USD");
  });

  test("future date with no rate sets isEstimate", async () => {
    const cache = createInMemoryExchangeRateCache();
    cache.insertRates([
      { date: "2025-01-01", currencyPair: "FXUSDCAD", rate: 1.40 },
    ]);
    const fetchFn = mock(async () => []) as (start: string, end: string) => Promise<ObservationRate[]>;
    const provider = new BankOfCanadaExchangeRateProvider(cache, fetchFn);

    const result = await provider.getRate("USD", "CAD", localDate(2025, 1, 15));

    expect(result.rate).toBe(1.40);
    expect(result.isEstimate).toBe(true);
    expect(result.source).toBe("bank-of-canada (estimate)");
    cache.close();
  });

  test("API failure with cached data uses cache", async () => {
    const cache = createInMemoryExchangeRateCache();
    cache.insertRates([
      { date: "2025-01-15", currencyPair: "FXUSDCAD", rate: 1.44 },
    ]);
    const fetchFn = mock(async () => {
      throw new Error("Network error");
    }) as unknown as (start: string, end: string) => Promise<ObservationRate[]>;
    const provider = new BankOfCanadaExchangeRateProvider(cache, fetchFn);

    const result = await provider.getRate("USD", "CAD", localDate(2025, 1, 15));

    expect(result.rate).toBe(1.44);
    expect(result.isEstimate).toBe(false);
    cache.close();
  });

  test("API failure without cached data throws", async () => {
    const { provider } = createProvider([], true);

    await expect(
      provider.getRate("USD", "CAD", localDate(2025, 1, 15))
    ).rejects.toThrow("Network error");
  });

  test("late-night date uses correct local calendar day", async () => {
    // Simulate 11 PM on Jan 15 local time (which is Jan 16 UTC in EST)
    const lateNight = new Date(2025, 0, 15, 23, 0, 0);
    const { provider } = createProvider([
      { date: "2025-01-15", rate: 1.44 },
    ]);

    const result = await provider.getRate("USD", "CAD", lateNight);

    expect(result.rate).toBe(1.44);
    expect(result.isEstimate).toBe(false);
  });
});
