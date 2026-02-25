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

    // Buy 100 shares at $30
    txRepo.create({
      stockId,
      type: "BUY",
      date: new Date("2023-01-15"),
      quantity: 100,
      pricePerShare: 30,
      pricePerShareCad: 30,
      exchangeRate: 1,
      fees: 0,
      feesCad: 0,
    });

    let state = resolveAcbState(db, stockId);
    expect(state.totalShares).toBe(100);
    expect(state.totalCostCad).toBe(3000);
    expect(state.acbPerShare).toBe(30);

    // Phantom distribution: +$0.25/unit
    distRepo.create({
      stockId,
      recordDate: new Date("2023-12-29"),
      rocPerUnit: 0,
      phantomDistPerUnit: 0.25,
      source: "manual",
    });

    state = resolveAcbState(db, stockId);
    expect(state.totalShares).toBe(100);
    expect(state.totalCostCad).toBe(3025); // +$25
    expect(state.acbPerShare).toBe(30.25);

    // Sell all 100 shares at $35
    const { snapshot } = txRepo.create({
      stockId,
      type: "SELL",
      date: new Date("2024-06-15"),
      quantity: 100,
      pricePerShare: 35,
      pricePerShareCad: 35,
      exchangeRate: 1,
      fees: 0,
      feesCad: 0,
    });

    // Capital gain = proceeds ($3500) - cost ($3025) = $475
    // Without phantom dist tracking, gain would be $500 (double-taxed on the $25)
    expect(snapshot.realizedGainCad).toBeCloseTo(475, 2);

    state = resolveAcbState(db, stockId);
    expect(state.totalShares).toBe(0);
    expect(state.totalCostCad).toBe(0);
  });

  test("ROC distribution reduces ACB for subsequent sells", () => {
    const txRepo = createTransactionRepository(db);
    const distRepo = createDistributionRepository(db);

    // Buy 200 shares at $20
    txRepo.create({
      stockId,
      type: "BUY",
      date: new Date("2023-01-01"),
      quantity: 200,
      pricePerShare: 20,
      pricePerShareCad: 20,
      exchangeRate: 1,
      fees: 0,
      feesCad: 0,
    });

    // ROC of $0.50/unit → $100 reduction
    distRepo.create({
      stockId,
      recordDate: new Date("2023-12-30"),
      rocPerUnit: 0.50,
      phantomDistPerUnit: 0,
      source: "manual",
    });

    const state = resolveAcbState(db, stockId);
    expect(state.totalCostCad).toBe(3900); // 4000 - 100
    expect(state.acbPerShare).toBe(19.50);

    // Sell 100 shares at $25
    const { snapshot } = txRepo.create({
      stockId,
      type: "SELL",
      date: new Date("2024-06-15"),
      quantity: 100,
      pricePerShare: 25,
      pricePerShareCad: 25,
      exchangeRate: 1,
      fees: 0,
      feesCad: 0,
    });

    // Capital gain = proceeds ($2500) - cost (100 × $19.50 = $1950) = $550
    expect(snapshot.realizedGainCad).toBeCloseTo(550, 2);
  });

  test("multiple distributions between buys are handled correctly", () => {
    const txRepo = createTransactionRepository(db);
    const distRepo = createDistributionRepository(db);

    txRepo.create({
      stockId,
      type: "BUY",
      date: new Date("2020-01-01"),
      quantity: 1000,
      pricePerShare: 25,
      pricePerShareCad: 25,
      exchangeRate: 1,
      fees: 10,
      feesCad: 10,
    });

    // Three years of distributions
    distRepo.create({
      stockId,
      recordDate: new Date("2020-12-31"),
      rocPerUnit: 0,
      phantomDistPerUnit: 0.11385,
      source: "bundled",
    });
    distRepo.create({
      stockId,
      recordDate: new Date("2021-12-31"),
      rocPerUnit: 0,
      phantomDistPerUnit: 0.22216,
      source: "bundled",
    });
    distRepo.create({
      stockId,
      recordDate: new Date("2022-12-30"),
      rocPerUnit: 0,
      phantomDistPerUnit: 0.19540,
      source: "bundled",
    });

    const state = resolveAcbState(db, stockId);
    expect(state.totalShares).toBe(1000);
    // 25010 + 113.85 + 222.16 + 195.40 = 25541.41
    expect(state.totalCostCad).toBeCloseTo(25541.41, 2);

    // Buy more shares — second buy should average with distribution-adjusted ACB
    txRepo.create({
      stockId,
      type: "BUY",
      date: new Date("2023-06-01"),
      quantity: 500,
      pricePerShare: 28,
      pricePerShareCad: 28,
      exchangeRate: 1,
      fees: 10,
      feesCad: 10,
    });

    const stateAfter = resolveAcbState(db, stockId);
    expect(stateAfter.totalShares).toBe(1500);
    // 25541.41 + (500*28 + 10) = 25541.41 + 14010 = 39551.41
    expect(stateAfter.totalCostCad).toBeCloseTo(39551.41, 2);
  });

  test("ROC exceeding ACB triggers deemed capital gain", () => {
    const txRepo = createTransactionRepository(db);
    const distRepo = createDistributionRepository(db);

    // Buy 100 shares at $1 (low ACB to trigger deemed gain)
    txRepo.create({
      stockId,
      type: "BUY",
      date: new Date("2023-01-01"),
      quantity: 100,
      pricePerShare: 1,
      pricePerShareCad: 1,
      exchangeRate: 1,
      fees: 0,
      feesCad: 0,
    });

    // ROC of $2/unit → $200, but ACB is only $100
    const { snapshot } = distRepo.create({
      stockId,
      recordDate: new Date("2023-12-30"),
      rocPerUnit: 2,
      phantomDistPerUnit: 0,
      source: "manual",
    });

    expect(snapshot.deemedCapitalGainCad).toBe(100);
    expect(snapshot.totalCostCad).toBe(0);

    const state = resolveAcbState(db, stockId);
    expect(state.totalCostCad).toBe(0);
    expect(state.totalShares).toBe(100);
  });

  test("duplicate distribution on same record date is rejected", () => {
    const distRepo = createDistributionRepository(db);
    const txRepo = createTransactionRepository(db);

    // Need shares for distribution to have effect
    txRepo.create({
      stockId,
      type: "BUY",
      date: new Date("2023-01-01"),
      quantity: 100,
      pricePerShare: 10,
      pricePerShareCad: 10,
      exchangeRate: 1,
      fees: 0,
      feesCad: 0,
    });

    distRepo.create({
      stockId,
      recordDate: new Date("2023-12-30"),
      rocPerUnit: 0,
      phantomDistPerUnit: 0.25,
      source: "manual",
    });

    // Second distribution on same date should fail due to unique constraint
    expect(() =>
      distRepo.create({
        stockId,
        recordDate: new Date("2023-12-30"),
        rocPerUnit: 0,
        phantomDistPerUnit: 0.50,
        source: "manual",
      })
    ).toThrow();
  });

  test("distribution with zero shares creates snapshot but has no effect", () => {
    const distRepo = createDistributionRepository(db);

    // No shares bought yet
    const { snapshot } = distRepo.create({
      stockId,
      recordDate: new Date("2023-12-30"),
      rocPerUnit: 0.50,
      phantomDistPerUnit: 0.25,
      source: "manual",
    });

    expect(snapshot.rocAppliedCad).toBe(0);
    expect(snapshot.phantomAppliedCad).toBe(0);
    expect(snapshot.totalShares).toBe(0);
    expect(snapshot.totalCostCad).toBe(0);
  });
});
