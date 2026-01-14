import type { ACBState } from "../types/index.ts";

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
  const purchaseCost =
    transaction.quantity * transaction.pricePerShareCad + transaction.feesCad;
  const newTotalCost = currentState.totalCostCad + purchaseCost;
  const newTotalShares = currentState.totalShares + transaction.quantity;

  return {
    totalShares: newTotalShares,
    totalCostCad: newTotalCost,
    acbPerShare: newTotalShares > 0 ? newTotalCost / newTotalShares : 0,
  };
}

export function calculateAcbAfterSell(
  currentState: ACBState,
  transaction: SellTransactionInput
): SellResult {
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

  return {
    newState: {
      totalShares: newTotalShares,
      totalCostCad: newTotalShares > 0 ? newTotalCost : 0,
      acbPerShare: newTotalShares > 0 ? newTotalCost / newTotalShares : 0,
    },
    capitalGainCad: capitalGain,
  };
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

  return state;
}
