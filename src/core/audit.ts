import type { ACBState } from "../types/index.ts";
import {
  calculateAcbAfterBuy,
  calculateAcbAfterSell,
  getInitialAcbState,
} from "./acb.ts";

export interface AuditTransaction {
  type: "BUY" | "SELL" | "DRIP";
  date: Date;
  quantity: number;
  pricePerShareCad: number;
  feesCad: number;
}

export interface AuditStep {
  index: number;
  transaction: AuditTransaction;
  before: ACBState;
  after: ACBState;
  arithmetic: string[];
  capitalGainCad?: number;
}

export interface AuditReport {
  steps: AuditStep[];
  finalState: ACBState;
  totalRealizedGainCad: number;
}

function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function generateAuditReport(transactions: AuditTransaction[]): AuditReport {
  let state = getInitialAcbState();
  const steps: AuditStep[] = [];
  let totalRealizedGain = 0;

  let stepNumber = 0;
  for (const tx of transactions) {
    stepNumber++;
    const before = { ...state };
    const arithmetic: string[] = [];

    if (tx.type === "BUY" || tx.type === "DRIP") {
      const purchaseCost = tx.quantity * tx.pricePerShareCad + tx.feesCad;
      arithmetic.push(`Purchase cost = ${tx.quantity} × ${fmt(tx.pricePerShareCad)} + ${fmt(tx.feesCad)} = ${fmt(purchaseCost)}`);
      arithmetic.push(`New total cost = ${fmt(before.totalCostCad)} + ${fmt(purchaseCost)} = ${fmt(before.totalCostCad + purchaseCost)}`);
      arithmetic.push(`New total shares = ${before.totalShares} + ${tx.quantity} = ${before.totalShares + tx.quantity}`);

      state = calculateAcbAfterBuy(state, {
        quantity: tx.quantity,
        pricePerShareCad: tx.pricePerShareCad,
        feesCad: tx.feesCad,
      });

      arithmetic.push(`New ACB/share = ${fmt(state.totalCostCad)} / ${state.totalShares} = ${fmt(state.acbPerShare)}`);

      steps.push({ index: stepNumber, transaction: tx, before, after: { ...state }, arithmetic });
    } else {
      const proceeds = tx.quantity * tx.pricePerShareCad - tx.feesCad;
      const costOfSharesSold = tx.quantity * before.acbPerShare;

      arithmetic.push(`Proceeds = ${tx.quantity} × ${fmt(tx.pricePerShareCad)} − ${fmt(tx.feesCad)} = ${fmt(proceeds)}`);
      arithmetic.push(`Cost of shares sold = ${tx.quantity} × ${fmt(before.acbPerShare)} = ${fmt(costOfSharesSold)}`);

      const result = calculateAcbAfterSell(state, {
        quantity: tx.quantity,
        proceedsPerShareCad: tx.pricePerShareCad,
        feesCad: tx.feesCad,
      });
      state = result.newState;

      const gainLabel = result.capitalGainCad >= 0 ? "Capital gain" : "Capital loss";
      arithmetic.push(`${gainLabel} = ${fmt(proceeds)} − ${fmt(costOfSharesSold)} = ${fmt(result.capitalGainCad)}`);
      arithmetic.push(`Remaining shares = ${before.totalShares} − ${tx.quantity} = ${state.totalShares}`);
      if (state.totalShares > 0) {
        arithmetic.push(`Remaining cost = ${fmt(before.totalCostCad)} − ${fmt(costOfSharesSold)} = ${fmt(state.totalCostCad)}`);
        arithmetic.push(`ACB/share unchanged = ${fmt(state.acbPerShare)}`);
      } else {
        arithmetic.push(`Position closed — all values reset to $0.00`);
      }

      totalRealizedGain += result.capitalGainCad;

      steps.push({
        index: stepNumber,
        transaction: tx,
        before,
        after: { ...state },
        arithmetic,
        capitalGainCad: result.capitalGainCad,
      });
    }
  }

  return { steps, finalState: { ...state }, totalRealizedGainCad: totalRealizedGain };
}

export function formatAuditReport(report: AuditReport): string {
  const lines: string[] = [];

  for (const step of report.steps) {
    const date = step.transaction.date.toISOString().slice(0, 10);
    const type = step.transaction.type;
    lines.push(`── Transaction ${step.index}: ${type} on ${date} ──`);
    lines.push(`   ${step.transaction.quantity} shares @ ${fmt(step.transaction.pricePerShareCad)}/share, fees ${fmt(step.transaction.feesCad)}`);
    lines.push("");
    for (const line of step.arithmetic) {
      lines.push(`   ${line}`);
    }
    lines.push("");
    lines.push(`   State: ${step.after.totalShares} shares, total cost ${fmt(step.after.totalCostCad)}, ACB ${fmt(step.after.acbPerShare)}/share`);
    lines.push("");
  }

  lines.push("── Summary ──");
  lines.push(`   Final: ${report.finalState.totalShares} shares, total cost ${fmt(report.finalState.totalCostCad)}, ACB ${fmt(report.finalState.acbPerShare)}/share`);
  if (report.totalRealizedGainCad !== 0) {
    const label = report.totalRealizedGainCad >= 0 ? "Total realized gains" : "Total realized losses";
    lines.push(`   ${label}: ${fmt(Math.abs(report.totalRealizedGainCad))}`);
  }

  return lines.join("\n");
}
