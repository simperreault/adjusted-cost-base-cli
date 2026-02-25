import { describe, expect, test } from "bun:test";
import { createInMemoryDatabase } from "../../../src/db/index.ts";
import { createStockRepository } from "../../../src/db/repositories/stockRepository.ts";
import { createTransactionRepository } from "../../../src/db/repositories/transactionRepository.ts";
import { correctEstimateTransactions } from "../../../src/services/exchangeRate/correctEstimates.ts";
import type { ExchangeRateProvider } from "../../../src/services/exchangeRate/types.ts";
import type { Currency } from "../../../src/types/index.ts";

function createMockProvider(rateMap: Record<string, number>): ExchangeRateProvider {
  return {
    async getRate(from: Currency, to: Currency, date: Date) {
      const dateStr = date.toISOString().split("T")[0] ?? "";
      const rate = rateMap[dateStr];
      if (rate === undefined) {
        return {
          from,
          to,
          rate: 1.40,
          date,
          source: "bank-of-canada (estimate)",
          isEstimate: true,
        };
      }
      return {
        from,
        to,
        rate,
        date,
        source: "bank-of-canada",
        isEstimate: false,
      };
    },
  };
}

describe("correctEstimateTransactions", () => {
  test("corrects estimate transactions when real rate becomes available", async () => {
    const db = createInMemoryDatabase();
    const stockRepo = createStockRepository(db);
    const txRepo = createTransactionRepository(db);

    const stock = stockRepo.create({
      name: "Apple",
      ticker: "AAPL",
      currency: "USD",
    });

    // Create a transaction with an estimated rate
    txRepo.create({
      stockId: stock.id,
      type: "BUY",
      date: new Date("2025-01-15"),
      quantity: 10,
      pricePerShare: 100,
      pricePerShareCad: 100 * 1.40, // estimated rate
      exchangeRate: 1.40,
      fees: 5,
      feesCad: 5 * 1.40,
      exchangeRateIsEstimate: true,
    });

    // Real rate is now available
    const provider = createMockProvider({ "2025-01-15": 1.44 });
    await correctEstimateTransactions(db, provider);

    // Verify the transaction was corrected
    const txs = txRepo.findByStockId(stock.id);
    expect(txs).toHaveLength(1);
    const tx = txs[0]!;
    expect(tx.exchangeRate).toBe(1.44);
    expect(tx.pricePerShareCad).toBeCloseTo(144, 2);
    expect(tx.feesCad).toBeCloseTo(7.2, 2);
    expect(tx.exchangeRateIsEstimate).toBe(0);

    // Verify snapshot was rebuilt
    const snapshot = txRepo.getLatestSnapshot(stock.id);
    expect(snapshot).toBeDefined();
    expect(snapshot!.totalShares).toBe(10);
    // totalCost = 10 * 144 + 7.2 = 1447.2
    expect(snapshot!.totalCostCad).toBeCloseTo(1447.2, 1);
  });

  test("does not correct transactions when rate is still estimated", async () => {
    const db = createInMemoryDatabase();
    const stockRepo = createStockRepository(db);
    const txRepo = createTransactionRepository(db);

    const stock = stockRepo.create({
      name: "Apple",
      ticker: "AAPL",
      currency: "USD",
    });

    txRepo.create({
      stockId: stock.id,
      type: "BUY",
      date: new Date("2025-01-15"),
      quantity: 10,
      pricePerShare: 100,
      pricePerShareCad: 100 * 1.40,
      exchangeRate: 1.40,
      fees: 0,
      feesCad: 0,
      exchangeRateIsEstimate: true,
    });

    // Provider still returns estimate
    const provider = createMockProvider({});
    await correctEstimateTransactions(db, provider);

    const txs = txRepo.findByStockId(stock.id);
    expect(txs[0]!.exchangeRate).toBe(1.40);
    expect(txs[0]!.exchangeRateIsEstimate).toBe(1);
  });

  test("does nothing when no estimate transactions exist", async () => {
    const db = createInMemoryDatabase();
    const stockRepo = createStockRepository(db);
    const txRepo = createTransactionRepository(db);

    const stock = stockRepo.create({
      name: "Apple",
      ticker: "AAPL",
      currency: "USD",
    });

    txRepo.create({
      stockId: stock.id,
      type: "BUY",
      date: new Date("2025-01-15"),
      quantity: 10,
      pricePerShare: 100,
      pricePerShareCad: 144,
      exchangeRate: 1.44,
      fees: 0,
      feesCad: 0,
      exchangeRateIsEstimate: false,
    });

    const provider = createMockProvider({ "2025-01-15": 1.44 });
    await correctEstimateTransactions(db, provider);

    // Transaction unchanged
    const txs = txRepo.findByStockId(stock.id);
    expect(txs[0]!.exchangeRate).toBe(1.44);
  });

  test("rebuilds snapshots correctly for multiple transactions", async () => {
    const db = createInMemoryDatabase();
    const stockRepo = createStockRepository(db);
    const txRepo = createTransactionRepository(db);

    const stock = stockRepo.create({
      name: "Apple",
      ticker: "AAPL",
      currency: "USD",
    });

    // First buy with correct rate
    txRepo.create({
      stockId: stock.id,
      type: "BUY",
      date: new Date("2025-01-13"),
      quantity: 10,
      pricePerShare: 100,
      pricePerShareCad: 143,
      exchangeRate: 1.43,
      fees: 0,
      feesCad: 0,
      exchangeRateIsEstimate: false,
    });

    // Second buy with estimated rate
    txRepo.create({
      stockId: stock.id,
      type: "BUY",
      date: new Date("2025-01-15"),
      quantity: 10,
      pricePerShare: 100,
      pricePerShareCad: 140,
      exchangeRate: 1.40,
      fees: 0,
      feesCad: 0,
      exchangeRateIsEstimate: true,
    });

    const provider = createMockProvider({ "2025-01-15": 1.44 });
    await correctEstimateTransactions(db, provider);

    // Final snapshot should reflect corrected rate
    const snapshot = txRepo.getLatestSnapshot(stock.id);
    expect(snapshot!.totalShares).toBe(20);
    // totalCost = 10*143 + 10*144 = 1430 + 1440 = 2870
    expect(snapshot!.totalCostCad).toBeCloseTo(2870, 1);
    expect(snapshot!.acbPerShare).toBeCloseTo(143.5, 1);
  });
});
