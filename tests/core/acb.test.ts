import { describe, expect, test } from "bun:test";
import {
  calculateAcbAfterBuy,
  calculateAcbAfterSell,
  getInitialAcbState,
  recalculateAcbFromTransactions,
} from "../../src/core/acb.ts";

describe("getInitialAcbState", () => {
  test("returns zero state", () => {
    const state = getInitialAcbState();
    expect(state).toEqual({
      totalShares: 0,
      totalCostCad: 0,
      acbPerShare: 0,
    });
  });
});

describe("calculateAcbAfterBuy", () => {
  test("first buy sets ACB correctly", () => {
    const initial = getInitialAcbState();
    const result = calculateAcbAfterBuy(initial, {
      quantity: 100,
      pricePerShareCad: 10,
      feesCad: 5,
    });

    expect(result.totalShares).toBe(100);
    expect(result.totalCostCad).toBe(1005); // 100 * 10 + 5
    expect(result.acbPerShare).toBeCloseTo(10.05, 2);
  });

  test("second buy averages ACB correctly", () => {
    const firstState = {
      totalShares: 100,
      totalCostCad: 1000,
      acbPerShare: 10,
    };

    const result = calculateAcbAfterBuy(firstState, {
      quantity: 100,
      pricePerShareCad: 20,
      feesCad: 10,
    });

    expect(result.totalShares).toBe(200);
    expect(result.totalCostCad).toBe(3010); // 1000 + 100*20 + 10
    expect(result.acbPerShare).toBeCloseTo(15.05, 2);
  });

  test("buy with zero fees works", () => {
    const initial = getInitialAcbState();
    const result = calculateAcbAfterBuy(initial, {
      quantity: 50,
      pricePerShareCad: 25,
      feesCad: 0,
    });

    expect(result.totalShares).toBe(50);
    expect(result.totalCostCad).toBe(1250);
    expect(result.acbPerShare).toBe(25);
  });

  test("buy fractional shares", () => {
    const initial = getInitialAcbState();
    const result = calculateAcbAfterBuy(initial, {
      quantity: 1.5,
      pricePerShareCad: 100,
      feesCad: 0,
    });

    expect(result.totalShares).toBe(1.5);
    expect(result.totalCostCad).toBe(150);
    expect(result.acbPerShare).toBe(100);
  });
});

describe("calculateAcbAfterSell", () => {
  test("sell calculates capital gain correctly", () => {
    const state = {
      totalShares: 100,
      totalCostCad: 1000, // ACB = $10/share
      acbPerShare: 10,
    };

    const result = calculateAcbAfterSell(state, {
      quantity: 50,
      proceedsPerShareCad: 15, // Selling at $15
      feesCad: 5,
    });

    // Proceeds = 50 * 15 - 5 = 745
    // Cost of shares sold = 50 * 10 = 500
    // Capital gain = 745 - 500 = 245
    expect(result.capitalGainCad).toBeCloseTo(245, 2);
    expect(result.newState.totalShares).toBe(50);
    expect(result.newState.totalCostCad).toBe(500);
    expect(result.newState.acbPerShare).toBe(10);
  });

  test("sell at a loss calculates negative capital gain", () => {
    const state = {
      totalShares: 100,
      totalCostCad: 2000, // ACB = $20/share
      acbPerShare: 20,
    };

    const result = calculateAcbAfterSell(state, {
      quantity: 50,
      proceedsPerShareCad: 10, // Selling at $10
      feesCad: 0,
    });

    // Proceeds = 50 * 10 = 500
    // Cost = 50 * 20 = 1000
    // Capital loss = 500 - 1000 = -500
    expect(result.capitalGainCad).toBe(-500);
    expect(result.newState.totalShares).toBe(50);
    expect(result.newState.totalCostCad).toBe(1000);
    expect(result.newState.acbPerShare).toBe(20);
  });

  test("sell all shares resets to zero", () => {
    const state = {
      totalShares: 100,
      totalCostCad: 1000,
      acbPerShare: 10,
    };

    const result = calculateAcbAfterSell(state, {
      quantity: 100,
      proceedsPerShareCad: 15,
      feesCad: 0,
    });

    expect(result.newState.totalShares).toBe(0);
    expect(result.newState.totalCostCad).toBe(0);
    expect(result.newState.acbPerShare).toBe(0);
    expect(result.capitalGainCad).toBe(500);
  });

  test("throws error when selling more than owned", () => {
    const state = {
      totalShares: 50,
      totalCostCad: 500,
      acbPerShare: 10,
    };

    expect(() =>
      calculateAcbAfterSell(state, {
        quantity: 100,
        proceedsPerShareCad: 15,
        feesCad: 0,
      })
    ).toThrow("Cannot sell 100 shares, only 50 available");
  });
});

describe("recalculateAcbFromTransactions", () => {
  test("recalculates ACB from transaction history", () => {
    const transactions = [
      { type: "BUY" as const, quantity: 100, pricePerShareCad: 10, feesCad: 5 },
      { type: "BUY" as const, quantity: 50, pricePerShareCad: 20, feesCad: 5 },
      { type: "SELL" as const, quantity: 25, pricePerShareCad: 25, feesCad: 5 },
    ];

    const result = recalculateAcbFromTransactions(transactions);

    // After first buy: 100 shares, $1005 cost, $10.05/share
    // After second buy: 150 shares, $2010 cost, $13.40/share
    // After sell: 125 shares, cost = 2010 - (25 * 13.40) = 1675, $13.40/share
    expect(result.totalShares).toBe(125);
    expect(result.acbPerShare).toBeCloseTo(13.4, 2);
  });

  test("handles empty transaction list", () => {
    const result = recalculateAcbFromTransactions([]);
    expect(result).toEqual(getInitialAcbState());
  });
});
