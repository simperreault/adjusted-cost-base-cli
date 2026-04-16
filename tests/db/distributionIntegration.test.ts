import { describe, expect, test, beforeEach } from "bun:test";
import { createInMemoryDatabase } from "../../src/db/index.ts";
import { createTransactionRepository } from "../../src/db/repositories/transactionRepository.ts";
import { createDistributionRepository } from "../../src/db/repositories/distributionRepository.ts";
import { resolveAcbState } from "../../src/db/repositories/acbStateResolver.ts";
import { stocks } from "../../src/db/schema.ts";
import type { AppDatabase } from "../../src/db/index.ts";

describe("distribution integration", () => {
  let db: AppDatabase;
  let stockId: number;

  beforeEach(() => {
    db = createInMemoryDatabase();
    const stock = db
      .insert(stocks)
      .values({ name: "Test ETF", ticker: "TEST", currency: "CAD", createdAt: new Date() })
      .returning()
      .get();
    stockId = stock.id;
  });

  test("buy → distribution → sell pipeline produces correct ACB and capital gain", () => {
    const txRepo = createTransactionRepository(db);
    const distRepo = createDistributionRepository(db);

    txRepo.create({
      stockId, type: "BUY", date: new Date("2023-01-15"),
      quantity: 100, pricePerShare: 30, pricePerShareCad: 30,
      exchangeRate: 1, fees: 0, feesCad: 0,
    });

    let state = resolveAcbState(db, stockId);
    expect(state.totalShares).toBe(100);
    expect(state.totalCostCad).toBe(3000);

    distRepo.create({
      stockId, recordDate: new Date("2023-12-29"),
      rocPerUnit: 0, phantomDistPerUnit: 0.25, source: "manual",
    });

    state = resolveAcbState(db, stockId);
    expect(state.totalCostCad).toBe(3025);
    expect(state.acbPerShare).toBe(30.25);

    const { snapshot } = txRepo.create({
      stockId, type: "SELL", date: new Date("2024-06-15"),
      quantity: 100, pricePerShare: 35, pricePerShareCad: 35,
      exchangeRate: 1, fees: 0, feesCad: 0,
    });

    // Capital gain = $3500 - $3025 = $475 (not $500 — phantom dist prevents double taxation)
    expect(snapshot.realizedGainCad).toBeCloseTo(475, 2);
  });

  test("ROC distribution reduces ACB for subsequent sells", () => {
    const txRepo = createTransactionRepository(db);
    const distRepo = createDistributionRepository(db);

    txRepo.create({
      stockId, type: "BUY", date: new Date("2023-01-01"),
      quantity: 200, pricePerShare: 20, pricePerShareCad: 20,
      exchangeRate: 1, fees: 0, feesCad: 0,
    });

    distRepo.create({
      stockId, recordDate: new Date("2023-12-30"),
      rocPerUnit: 0.50, phantomDistPerUnit: 0, source: "manual",
    });

    const state = resolveAcbState(db, stockId);
    expect(state.totalCostCad).toBe(3900);
    expect(state.acbPerShare).toBe(19.50);

    const { snapshot } = txRepo.create({
      stockId, type: "SELL", date: new Date("2024-06-15"),
      quantity: 100, pricePerShare: 25, pricePerShareCad: 25,
      exchangeRate: 1, fees: 0, feesCad: 0,
    });

    // Capital gain = $2500 - (100 × $19.50) = $550
    expect(snapshot.realizedGainCad).toBeCloseTo(550, 2);
  });

  test("multiple distributions between buys are handled correctly", () => {
    const txRepo = createTransactionRepository(db);
    const distRepo = createDistributionRepository(db);

    txRepo.create({
      stockId, type: "BUY", date: new Date("2020-01-01"),
      quantity: 1000, pricePerShare: 25, pricePerShareCad: 25,
      exchangeRate: 1, fees: 10, feesCad: 10,
    });

    distRepo.create({ stockId, recordDate: new Date("2020-12-31"), rocPerUnit: 0, phantomDistPerUnit: 0.11385, source: "bundled" });
    distRepo.create({ stockId, recordDate: new Date("2021-12-31"), rocPerUnit: 0, phantomDistPerUnit: 0.22216, source: "bundled" });
    distRepo.create({ stockId, recordDate: new Date("2022-12-30"), rocPerUnit: 0, phantomDistPerUnit: 0.19540, source: "bundled" });

    const state = resolveAcbState(db, stockId);
    expect(state.totalCostCad).toBeCloseTo(25541.41, 2);

    txRepo.create({
      stockId, type: "BUY", date: new Date("2023-06-01"),
      quantity: 500, pricePerShare: 28, pricePerShareCad: 28,
      exchangeRate: 1, fees: 10, feesCad: 10,
    });

    const stateAfter = resolveAcbState(db, stockId);
    expect(stateAfter.totalShares).toBe(1500);
    expect(stateAfter.totalCostCad).toBeCloseTo(39551.41, 2);
  });

  test("ROC exceeding ACB triggers deemed capital gain", () => {
    const txRepo = createTransactionRepository(db);
    const distRepo = createDistributionRepository(db);

    txRepo.create({
      stockId, type: "BUY", date: new Date("2023-01-01"),
      quantity: 100, pricePerShare: 1, pricePerShareCad: 1,
      exchangeRate: 1, fees: 0, feesCad: 0,
    });

    const { snapshot } = distRepo.create({
      stockId, recordDate: new Date("2023-12-30"),
      rocPerUnit: 2, phantomDistPerUnit: 0, source: "manual",
    });

    expect(snapshot.deemedCapitalGainCad).toBe(100);
    expect(snapshot.totalCostCad).toBe(0);
  });

  test("duplicate distribution on same record date is rejected", () => {
    const distRepo = createDistributionRepository(db);
    const txRepo = createTransactionRepository(db);

    txRepo.create({
      stockId, type: "BUY", date: new Date("2023-01-01"),
      quantity: 100, pricePerShare: 10, pricePerShareCad: 10,
      exchangeRate: 1, fees: 0, feesCad: 0,
    });

    distRepo.create({
      stockId, recordDate: new Date("2023-12-30"),
      rocPerUnit: 0, phantomDistPerUnit: 0.25, source: "manual",
    });

    expect(() =>
      distRepo.create({
        stockId, recordDate: new Date("2023-12-30"),
        rocPerUnit: 0, phantomDistPerUnit: 0.50, source: "manual",
      })
    ).toThrow();
  });

  test("distribution with zero shares creates snapshot but has no effect", () => {
    const distRepo = createDistributionRepository(db);

    const { snapshot } = distRepo.create({
      stockId, recordDate: new Date("2023-12-30"),
      rocPerUnit: 0.50, phantomDistPerUnit: 0.25, source: "manual",
    });

    expect(snapshot.rocAppliedCad).toBe(0);
    expect(snapshot.phantomAppliedCad).toBe(0);
    expect(snapshot.totalShares).toBe(0);
  });
});
