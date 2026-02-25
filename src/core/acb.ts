import type { ACBState } from "../types/index.ts";
import { assertACBState } from "./invariants.ts";

export interface BuyTransactionInput {
  quantity: number;
  pricePerShareCad: number;
  feesCad: number;
}

export interface SellTransactionInput {
  quantity: number;
  proceedsPerShareCad: number;
  feesCad: number;
}

export interface SellResult {
  newState: ACBState;
  capitalGainCad: number;
}

function validateFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number, got ${value}`);
  }
}

function validateNonNegative(value: number, label: string): void {
  validateFinite(value, label);
  if (value < 0) {
    throw new Error(`${label} must be non-negative, got ${value}`);
  }
}

function validatePositive(value: number, label: string): void {
  validateFinite(value, label);
  if (value <= 0) {
    throw new Error(`${label} must be positive, got ${value}`);
  }
}

export function getInitialAcbState(): ACBState {
  return {
    totalShares: 0,
    totalCostCad: 0,
    acbPerShare: 0,
  };
}

export function calculateAcbAfterBuy(
  currentState: ACBState,
  transaction: BuyTransactionInput
): ACBState {
  validatePositive(transaction.quantity, "Buy quantity");
  validateNonNegative(transaction.pricePerShareCad, "Buy price per share");
  validateNonNegative(transaction.feesCad, "Buy fees");

  const purchaseCost =
    transaction.quantity * transaction.pricePerShareCad + transaction.feesCad;
  const newTotalCost = currentState.totalCostCad + purchaseCost;
  const newTotalShares = currentState.totalShares + transaction.quantity;

  const newState: ACBState = {
    totalShares: newTotalShares,
    totalCostCad: newTotalCost,
    acbPerShare: newTotalShares > 0 ? newTotalCost / newTotalShares : 0,
  };
  assertACBState(newState, { operation: "buy", transaction });
  return newState;
}

export function calculateAcbAfterSell(
  currentState: ACBState,
  transaction: SellTransactionInput
): SellResult {
  validatePositive(transaction.quantity, "Sell quantity");
  validateNonNegative(transaction.proceedsPerShareCad, "Sell price per share");
  validateNonNegative(transaction.feesCad, "Sell fees");

  if (transaction.quantity > currentState.totalShares) {
    throw new Error(
      `Cannot sell ${transaction.quantity} shares, only ${currentState.totalShares} available`
    );
  }

  const proceeds =
    transaction.quantity * transaction.proceedsPerShareCad - transaction.feesCad;
  const costOfSharesSold = transaction.quantity * currentState.acbPerShare;
  const capitalGain = proceeds - costOfSharesSold;

  const newTotalShares = currentState.totalShares - transaction.quantity;
  const newTotalCost = currentState.totalCostCad - costOfSharesSold;

  const newState: ACBState = {
    totalShares: newTotalShares,
    totalCostCad: newTotalShares > 0 ? newTotalCost : 0,
    acbPerShare: newTotalShares > 0 ? newTotalCost / newTotalShares : 0,
  };
  assertACBState(newState, { operation: "sell", transaction });
  return { newState, capitalGainCad: capitalGain };
}

export interface DistributionInput {
  rocPerUnit: number;
  phantomDistPerUnit: number;
}

export interface DistributionResult {
  newState: ACBState;
  rocAppliedCad: number;
  phantomAppliedCad: number;
  deemedCapitalGainCad: number | null;
}

export function calculateAcbAfterDistribution(
  currentState: ACBState,
  distribution: DistributionInput
): DistributionResult {
  validateNonNegative(distribution.rocPerUnit, "ROC per unit");
  validateNonNegative(distribution.phantomDistPerUnit, "Phantom distribution per unit");

  if (currentState.totalShares <= 0) {
    return {
      newState: currentState,
      rocAppliedCad: 0,
      phantomAppliedCad: 0,
      deemedCapitalGainCad: null,
    };
  }

  const rocAmount = distribution.rocPerUnit * currentState.totalShares;
  const phantomAmount = distribution.phantomDistPerUnit * currentState.totalShares;

  let newTotalCost = currentState.totalCostCad;
  let deemedGain: number | null = null;

  // ROC decreases ACB
  newTotalCost -= rocAmount;

  // If ROC exceeds ACB, excess is deemed a capital gain and ACB resets to 0
  if (newTotalCost < 0) {
    deemedGain = Math.abs(newTotalCost);
    newTotalCost = 0;
  }

  // Phantom distribution increases ACB
  newTotalCost += phantomAmount;

  const newState: ACBState = {
    totalShares: currentState.totalShares,
    totalCostCad: newTotalCost,
    acbPerShare: newTotalCost / currentState.totalShares,
  };
  assertACBState(newState, { operation: "distribution", distribution });
  return {
    newState,
    rocAppliedCad: rocAmount,
    phantomAppliedCad: phantomAmount,
    deemedCapitalGainCad: deemedGain,
  };
}

export type AcbEvent =
  | { kind: "BUY"; date: Date; quantity: number; pricePerShareCad: number; feesCad: number }
  | { kind: "SELL"; date: Date; quantity: number; pricePerShareCad: number; feesCad: number }
  | { kind: "DISTRIBUTION"; date: Date; rocPerUnit: number; phantomDistPerUnit: number };

export function recalculateAcbFromEvents(events: AcbEvent[]): ACBState {
  const order = { BUY: 0, DISTRIBUTION: 1, SELL: 2 };
  const sorted = [...events].sort((a, b) => {
    const dateDiff = a.date.getTime() - b.date.getTime();
    if (dateDiff !== 0) return dateDiff;
    return order[a.kind] - order[b.kind];
  });

  let state = getInitialAcbState();

  for (const event of sorted) {
    if (event.kind === "BUY") {
      state = calculateAcbAfterBuy(state, {
        quantity: event.quantity,
        pricePerShareCad: event.pricePerShareCad,
        feesCad: event.feesCad,
      });
    } else if (event.kind === "SELL") {
      const result = calculateAcbAfterSell(state, {
        quantity: event.quantity,
        proceedsPerShareCad: event.pricePerShareCad,
        feesCad: event.feesCad,
      });
      state = result.newState;
    } else {
      const result = calculateAcbAfterDistribution(state, {
        rocPerUnit: event.rocPerUnit,
        phantomDistPerUnit: event.phantomDistPerUnit,
      });
      state = result.newState;
    }
  }

  return state;
}

export function recalculateAcbFromTransactions(
  transactions: Array<{
    type: "BUY" | "SELL";
    quantity: number;
    pricePerShareCad: number;
    feesCad: number;
  }>
): ACBState {
  const events: AcbEvent[] = transactions.map((tx, i) => ({
    kind: tx.type,
    // Preserve order by using index-based timestamps since transactions are pre-sorted
    date: new Date(i),
    quantity: tx.quantity,
    pricePerShareCad: tx.pricePerShareCad,
    feesCad: tx.feesCad,
  }));

  const state = recalculateAcbFromEvents(events);
  assertACBState(state, { operation: "recalculate", transactionCount: transactions.length });
  return state;
}
