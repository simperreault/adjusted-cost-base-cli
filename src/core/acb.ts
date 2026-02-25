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

export function recalculateAcbFromTransactions(
  transactions: Array<{
    type: "BUY" | "SELL";
    quantity: number;
    pricePerShareCad: number;
    feesCad: number;
  }>
): ACBState {
  let state = getInitialAcbState();

  for (const tx of transactions) {
    if (tx.type === "BUY") {
      state = calculateAcbAfterBuy(state, {
        quantity: tx.quantity,
        pricePerShareCad: tx.pricePerShareCad,
        feesCad: tx.feesCad,
      });
    } else {
      const result = calculateAcbAfterSell(state, {
        quantity: tx.quantity,
        proceedsPerShareCad: tx.pricePerShareCad,
        feesCad: tx.feesCad,
      });
      state = result.newState;
    }
  }

  assertACBState(state, { operation: "recalculate", transactionCount: transactions.length });
  return state;
}
