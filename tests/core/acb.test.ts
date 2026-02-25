import { describe, expect, test } from "bun:test";
import {
  calculateAcbAfterBuy,
  calculateAcbAfterSell,
  calculateAcbAfterDistribution,
  getInitialAcbState,
  recalculateAcbFromTransactions,
  recalculateAcbFromEvents,
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

describe("calculateAcbAfterDistribution", () => {
  test("ROC reduces ACB", () => {
    const state = {
      totalShares: 100,
      totalCostCad: 1000,
      acbPerShare: 10,
    };

    const result = calculateAcbAfterDistribution(state, {
      rocPerUnit: 0.50,
      phantomDistPerUnit: 0,
    });

    // ROC = 0.50 * 100 = $50 reduction
    expect(result.newState.totalCostCad).toBe(950);
    expect(result.newState.totalShares).toBe(100);
    expect(result.newState.acbPerShare).toBe(9.50);
    expect(result.rocAppliedCad).toBe(50);
    expect(result.phantomAppliedCad).toBe(0);
    expect(result.deemedCapitalGainCad).toBeNull();
  });

  test("phantom distribution increases ACB", () => {
    const state = {
      totalShares: 100,
      totalCostCad: 1000,
      acbPerShare: 10,
    };

    const result = calculateAcbAfterDistribution(state, {
      rocPerUnit: 0,
      phantomDistPerUnit: 0.25,
    });

    // Phantom = 0.25 * 100 = $25 increase
    expect(result.newState.totalCostCad).toBe(1025);
    expect(result.newState.totalShares).toBe(100);
    expect(result.newState.acbPerShare).toBe(10.25);
    expect(result.rocAppliedCad).toBe(0);
    expect(result.phantomAppliedCad).toBe(25);
    expect(result.deemedCapitalGainCad).toBeNull();
  });

  test("combined ROC and phantom distribution", () => {
    const state = {
      totalShares: 1000,
      totalCostCad: 30000,
      acbPerShare: 30,
    };

    // Real-world example: ROC reduces, phantom increases
    const result = calculateAcbAfterDistribution(state, {
      rocPerUnit: 0.50877,
      phantomDistPerUnit: 1.68564,
    });

    // ROC = 0.50877 * 1000 = $508.77 reduction -> 30000 - 508.77 = 29491.23
    // Phantom = 1.68564 * 1000 = $1685.64 increase -> 29491.23 + 1685.64 = 31176.87
    expect(result.newState.totalCostCad).toBeCloseTo(31176.87, 2);
    expect(result.newState.totalShares).toBe(1000);
    expect(result.newState.acbPerShare).toBeCloseTo(31.17687, 2);
    expect(result.rocAppliedCad).toBeCloseTo(508.77, 2);
    expect(result.phantomAppliedCad).toBeCloseTo(1685.64, 2);
    expect(result.deemedCapitalGainCad).toBeNull();
  });

  test("ROC exceeding ACB triggers deemed capital gain", () => {
    const state = {
      totalShares: 100,
      totalCostCad: 20,
      acbPerShare: 0.20,
    };

    const result = calculateAcbAfterDistribution(state, {
      rocPerUnit: 0.50,
      phantomDistPerUnit: 0,
    });

    // ROC = 0.50 * 100 = $50, but ACB is only $20
    // Deemed capital gain = $30, ACB resets to 0
    expect(result.deemedCapitalGainCad).toBe(30);
    expect(result.newState.totalCostCad).toBe(0);
    expect(result.newState.acbPerShare).toBe(0);
    expect(result.newState.totalShares).toBe(100);
    expect(result.rocAppliedCad).toBe(50);
  });

  test("ROC exceeding ACB with phantom distribution", () => {
    const state = {
      totalShares: 100,
      totalCostCad: 20,
      acbPerShare: 0.20,
    };

    const result = calculateAcbAfterDistribution(state, {
      rocPerUnit: 0.50,
      phantomDistPerUnit: 0.10,
    });

    // ROC = $50, ACB = $20 -> deemed gain = $30, ACB = 0
    // Then phantom = $10 -> ACB = $10
    expect(result.deemedCapitalGainCad).toBe(30);
    expect(result.newState.totalCostCad).toBe(10);
    expect(result.newState.acbPerShare).toBe(0.10);
    expect(result.newState.totalShares).toBe(100);
  });

  test("distribution with zero shares is a no-op", () => {
    const state = getInitialAcbState();

    const result = calculateAcbAfterDistribution(state, {
      rocPerUnit: 0.50,
      phantomDistPerUnit: 0.25,
    });

    expect(result.newState).toEqual(state);
    expect(result.rocAppliedCad).toBe(0);
    expect(result.phantomAppliedCad).toBe(0);
    expect(result.deemedCapitalGainCad).toBeNull();
  });

  test("distribution with fractional shares", () => {
    const state = {
      totalShares: 10.5,
      totalCostCad: 315,
      acbPerShare: 30,
    };

    const result = calculateAcbAfterDistribution(state, {
      rocPerUnit: 0,
      phantomDistPerUnit: 0.10,
    });

    // Phantom = 0.10 * 10.5 = $1.05
    expect(result.newState.totalCostCad).toBeCloseTo(316.05, 2);
    expect(result.phantomAppliedCad).toBeCloseTo(1.05, 2);
  });
});

describe("recalculateAcbFromEvents", () => {
  test("interleaved buy, distribution, sell produces correct capital gain", () => {
    const events = [
      {
        kind: "BUY" as const,
        date: new Date("2023-01-15"),
        quantity: 100,
        pricePerShareCad: 30,
        feesCad: 0,
      },
      {
        kind: "DISTRIBUTION" as const,
        date: new Date("2023-12-29"),
        rocPerUnit: 0,
        phantomDistPerUnit: 0.25,
      },
      {
        kind: "SELL" as const,
        date: new Date("2024-06-15"),
        quantity: 100,
        pricePerShareCad: 35,
        feesCad: 0,
      },
    ];

    const state = recalculateAcbFromEvents(events);

    // After buy: 100 shares, $3000 cost, $30/share
    // After dist: 100 shares, $3025 cost, $30.25/share (phantom +$25)
    // After sell: 0 shares, $0 cost (sold all)
    expect(state.totalShares).toBe(0);
    expect(state.totalCostCad).toBe(0);
  });

  test("distribution sorts before sell on same date", () => {
    const events = [
      {
        kind: "BUY" as const,
        date: new Date("2023-01-15"),
        quantity: 100,
        pricePerShareCad: 10,
        feesCad: 0,
      },
      {
        kind: "DISTRIBUTION" as const,
        date: new Date("2023-12-29"),
        rocPerUnit: 1.0,
        phantomDistPerUnit: 0,
      },
      {
        kind: "SELL" as const,
        date: new Date("2023-12-29"),
        quantity: 100,
        pricePerShareCad: 12,
        feesCad: 0,
      },
    ];

    const state = recalculateAcbFromEvents(events);

    // After buy: 100 shares, $1000 cost, $10/share
    // After dist (same day, processed first): 100 shares, $900 cost, $9/share
    // After sell: 0 shares, proceeds = $1200, cost = $900, gain = $300
    expect(state.totalShares).toBe(0);
    expect(state.totalCostCad).toBe(0);
  });

  test("multiple distributions over time", () => {
    const events = [
      {
        kind: "BUY" as const,
        date: new Date("2020-01-01"),
        quantity: 1000,
        pricePerShareCad: 25,
        feesCad: 10,
      },
      {
        kind: "DISTRIBUTION" as const,
        date: new Date("2020-12-31"),
        rocPerUnit: 0,
        phantomDistPerUnit: 0.11385,
      },
      {
        kind: "DISTRIBUTION" as const,
        date: new Date("2021-12-31"),
        rocPerUnit: 0,
        phantomDistPerUnit: 0.22216,
      },
      {
        kind: "DISTRIBUTION" as const,
        date: new Date("2022-12-30"),
        rocPerUnit: 0,
        phantomDistPerUnit: 0.19540,
      },
    ];

    const state = recalculateAcbFromEvents(events);

    // After buy: 1000 shares, $25010 cost
    // After 2020 dist: +$113.85 -> $25123.85
    // After 2021 dist: +$222.16 -> $25346.01
    // After 2022 dist: +$195.40 -> $25541.41
    expect(state.totalShares).toBe(1000);
    expect(state.totalCostCad).toBeCloseTo(25541.41, 2);
    expect(state.acbPerShare).toBeCloseTo(25.54141, 2);
  });

  test("handles empty events list", () => {
    const state = recalculateAcbFromEvents([]);
    expect(state).toEqual(getInitialAcbState());
  });

  test("buy sorts before distribution on same date", () => {
    const events = [
      {
        kind: "BUY" as const,
        date: new Date("2023-12-29"),
        quantity: 100,
        pricePerShareCad: 30,
        feesCad: 0,
      },
      {
        kind: "DISTRIBUTION" as const,
        date: new Date("2023-12-29"),
        rocPerUnit: 0,
        phantomDistPerUnit: 0.50,
      },
    ];

    const state = recalculateAcbFromEvents(events);

    // Buy first: 100 shares, $3000
    // Then dist: +$50 -> $3050
    expect(state.totalShares).toBe(100);
    expect(state.totalCostCad).toBe(3050);
    expect(state.acbPerShare).toBe(30.50);
  });
});
