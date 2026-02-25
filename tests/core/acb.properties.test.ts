import { describe, expect, test } from "bun:test";
import {
  calculateAcbAfterBuy,
  calculateAcbAfterSell,
  getInitialAcbState,
  recalculateAcbFromTransactions,
} from "../../src/core/acb.ts";

// Hand-rolled random helpers
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

interface RandomTransaction {
  type: "BUY" | "SELL";
  quantity: number;
  pricePerShareCad: number;
  feesCad: number;
}

function generateTransactionSequence(length: number): RandomTransaction[] {
  const txs: RandomTransaction[] = [];
  let sharesHeld = 0;

  for (let i = 0; i < length; i++) {
    const canSell = sharesHeld > 0;
    const isBuy = !canSell || Math.random() < 0.6;

    if (isBuy) {
      const qty = randomInt(1, 200);
      txs.push({
        type: "BUY",
        quantity: qty,
        pricePerShareCad: randomFloat(0.01, 500),
        feesCad: randomFloat(0, 20),
      });
      sharesHeld += qty;
    } else {
      const qty = randomInt(1, sharesHeld);
      txs.push({
        type: "SELL",
        quantity: qty,
        pricePerShareCad: randomFloat(0.01, 500),
        feesCad: randomFloat(0, 20),
      });
      sharesHeld -= qty;
    }
  }

  return txs;
}

const RUNS = 1000;

describe("ACB property-based tests", () => {
  test("incremental application equals full replay", () => {
    for (let i = 0; i < RUNS; i++) {
      const txs = generateTransactionSequence(randomInt(1, 15));

      // Incremental
      let state = getInitialAcbState();
      for (const tx of txs) {
        if (tx.type === "BUY") {
          state = calculateAcbAfterBuy(state, {
            quantity: tx.quantity,
            pricePerShareCad: tx.pricePerShareCad,
            feesCad: tx.feesCad,
          });
        } else {
          state = calculateAcbAfterSell(state, {
            quantity: tx.quantity,
            proceedsPerShareCad: tx.pricePerShareCad,
            feesCad: tx.feesCad,
          }).newState;
        }
      }

      // Replay
      const replayed = recalculateAcbFromTransactions(txs);

      expect(state.totalShares).toBeCloseTo(replayed.totalShares, 10);
      expect(state.totalCostCad).toBeCloseTo(replayed.totalCostCad, 10);
      expect(state.acbPerShare).toBeCloseTo(replayed.acbPerShare, 10);
    }
  });

  test("share accounting: buy adds exact quantity", () => {
    for (let i = 0; i < RUNS; i++) {
      const state = {
        totalShares: randomInt(0, 1000),
        totalCostCad: randomFloat(0, 100000),
        acbPerShare: 0,
      };
      state.acbPerShare = state.totalShares > 0 ? state.totalCostCad / state.totalShares : 0;

      const qty = randomInt(1, 200);
      const result = calculateAcbAfterBuy(state, {
        quantity: qty,
        pricePerShareCad: randomFloat(0.01, 500),
        feesCad: randomFloat(0, 20),
      });

      expect(result.totalShares).toBe(state.totalShares + qty);
    }
  });

  test("value conservation on buy: cost increase = quantity * price + fees", () => {
    for (let i = 0; i < RUNS; i++) {
      const state = {
        totalShares: randomInt(0, 1000),
        totalCostCad: randomFloat(0, 100000),
        acbPerShare: 0,
      };
      state.acbPerShare = state.totalShares > 0 ? state.totalCostCad / state.totalShares : 0;

      const qty = randomInt(1, 200);
      const price = randomFloat(0.01, 500);
      const fees = randomFloat(0, 20);

      const result = calculateAcbAfterBuy(state, {
        quantity: qty,
        pricePerShareCad: price,
        feesCad: fees,
      });

      const expectedIncrease = qty * price + fees;
      expect(result.totalCostCad - state.totalCostCad).toBeCloseTo(expectedIncrease, 8);
    }
  });

  test("value conservation on sell: capitalGain + costOfSharesSold = proceeds", () => {
    for (let i = 0; i < RUNS; i++) {
      const totalShares = randomInt(10, 1000);
      const totalCostCad = randomFloat(100, 100000);
      const acbPerShare = totalCostCad / totalShares;
      const state = { totalShares, totalCostCad, acbPerShare };

      const qty = randomInt(1, totalShares);
      const price = randomFloat(0.01, 500);
      const fees = randomFloat(0, 20);

      const result = calculateAcbAfterSell(state, {
        quantity: qty,
        proceedsPerShareCad: price,
        feesCad: fees,
      });

      const proceeds = qty * price - fees;
      const costOfSharesSold = qty * acbPerShare;
      expect(result.capitalGainCad).toBeCloseTo(proceeds - costOfSharesSold, 8);
    }
  });

  test("sell-all resets to zero state", () => {
    for (let i = 0; i < RUNS; i++) {
      const totalShares = randomInt(1, 500);
      const totalCostCad = randomFloat(1, 100000);
      const acbPerShare = totalCostCad / totalShares;
      const state = { totalShares, totalCostCad, acbPerShare };

      const result = calculateAcbAfterSell(state, {
        quantity: totalShares,
        proceedsPerShareCad: randomFloat(0.01, 500),
        feesCad: randomFloat(0, 20),
      });

      expect(result.newState.totalShares).toBe(0);
      expect(result.newState.totalCostCad).toBe(0);
      expect(result.newState.acbPerShare).toBe(0);
    }
  });

  test("state is always non-negative across random sequences", () => {
    for (let i = 0; i < RUNS; i++) {
      const txs = generateTransactionSequence(randomInt(1, 20));

      let state = getInitialAcbState();
      for (const tx of txs) {
        if (tx.type === "BUY") {
          state = calculateAcbAfterBuy(state, {
            quantity: tx.quantity,
            pricePerShareCad: tx.pricePerShareCad,
            feesCad: tx.feesCad,
          });
        } else {
          state = calculateAcbAfterSell(state, {
            quantity: tx.quantity,
            proceedsPerShareCad: tx.pricePerShareCad,
            feesCad: tx.feesCad,
          }).newState;
        }

        // Invariants checked by assertACBState inside each function,
        // but verify explicitly here too
        expect(state.totalShares).toBeGreaterThanOrEqual(0);
        expect(state.totalCostCad).toBeGreaterThanOrEqual(0);
        expect(state.acbPerShare).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
