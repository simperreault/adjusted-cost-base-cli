import { describe, expect, test } from "bun:test";
import { createInMemoryExchangeRateCache } from "../../src/db/exchangeRateCache.ts";

describe("ExchangeRateCache", () => {
  test("getRate returns null for missing date", () => {
    const cache = createInMemoryExchangeRateCache();
    expect(cache.getRate("FXUSDCAD", "2025-01-15")).toBeNull();
    cache.close();
  });

  test("insertRates and getRate exact match", () => {
    const cache = createInMemoryExchangeRateCache();
    cache.insertRates([
      { date: "2025-01-15", currencyPair: "FXUSDCAD", rate: 1.44 },
    ]);
    expect(cache.getRate("FXUSDCAD", "2025-01-15")).toBe(1.44);
    cache.close();
  });

  test("getClosestRate finds previous business day", () => {
    const cache = createInMemoryExchangeRateCache();
    cache.insertRates([
      { date: "2025-01-10", currencyPair: "FXUSDCAD", rate: 1.43 },
      { date: "2025-01-13", currencyPair: "FXUSDCAD", rate: 1.44 },
    ]);

    // Saturday Jan 11 should find Friday Jan 10
    const result = cache.getClosestRate("FXUSDCAD", "2025-01-11");
    expect(result).toEqual({ date: "2025-01-10", rate: 1.43 });
    cache.close();
  });

  test("getClosestRate returns exact match when available", () => {
    const cache = createInMemoryExchangeRateCache();
    cache.insertRates([
      { date: "2025-01-15", currencyPair: "FXUSDCAD", rate: 1.44 },
    ]);

    const result = cache.getClosestRate("FXUSDCAD", "2025-01-15");
    expect(result).toEqual({ date: "2025-01-15", rate: 1.44 });
    cache.close();
  });

  test("getClosestRate returns null when no prior dates exist", () => {
    const cache = createInMemoryExchangeRateCache();
    cache.insertRates([
      { date: "2025-01-15", currencyPair: "FXUSDCAD", rate: 1.44 },
    ]);

    const result = cache.getClosestRate("FXUSDCAD", "2025-01-14");
    expect(result).toBeNull();
    cache.close();
  });

  test("duplicate insert replaces with new rate", () => {
    const cache = createInMemoryExchangeRateCache();
    cache.insertRates([
      { date: "2025-01-15", currencyPair: "FXUSDCAD", rate: 1.44 },
    ]);
    // Insert again with different rate — should replace (INSERT OR REPLACE)
    cache.insertRates([
      { date: "2025-01-15", currencyPair: "FXUSDCAD", rate: 9.99 },
    ]);

    expect(cache.getRate("FXUSDCAD", "2025-01-15")).toBe(9.99);
    cache.close();
  });

  test("different currency pairs are independent", () => {
    const cache = createInMemoryExchangeRateCache();
    cache.insertRates([
      { date: "2025-01-15", currencyPair: "FXUSDCAD", rate: 1.44 },
      { date: "2025-01-15", currencyPair: "FXEURCAD", rate: 1.50 },
    ]);

    expect(cache.getRate("FXUSDCAD", "2025-01-15")).toBe(1.44);
    expect(cache.getRate("FXEURCAD", "2025-01-15")).toBe(1.50);
    cache.close();
  });
});
