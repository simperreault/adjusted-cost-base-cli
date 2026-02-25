import { eq, and } from "drizzle-orm";
import type { AppDatabase } from "../../db/index.ts";
import { transactions, stockSnapshots } from "../../db/schema.ts";
import type { ExchangeRateProvider } from "./types.ts";
import {
  calculateAcbAfterBuy,
  calculateAcbAfterSell,
  getInitialAcbState,
} from "../../core/acb.ts";
import { asc } from "drizzle-orm";

export async function correctEstimateTransactions(
  db: AppDatabase,
  provider: ExchangeRateProvider
): Promise<void> {
  const estimatedTxs = db
    .select()
    .from(transactions)
    .where(eq(transactions.exchangeRateIsEstimate, 1))
    .all();

  if (estimatedTxs.length === 0) return;

  const affectedStockIds = new Set<number>();

  for (const tx of estimatedTxs) {
    const currency = tx.exchangeRate !== 1 ? "USD" : "CAD";
    if (currency === "CAD") continue;

    const exchangeRate = await provider.getRate(
      "USD",
      "CAD",
      new Date(tx.date)
    );

    if (!exchangeRate.isEstimate) {
      const pricePerShareCad = tx.pricePerShare * exchangeRate.rate;
      const feesCad = tx.fees * exchangeRate.rate;

      db.update(transactions)
        .set({
          exchangeRate: exchangeRate.rate,
          pricePerShareCad,
          feesCad,
          exchangeRateIsEstimate: 0,
        })
        .where(eq(transactions.id, tx.id))
        .run();

      affectedStockIds.add(tx.stockId);
    }
  }

  // Rebuild snapshots for affected stocks
  for (const stockId of affectedStockIds) {
    db.delete(stockSnapshots)
      .where(eq(stockSnapshots.stockId, stockId))
      .run();

    const stockTxs = db
      .select()
      .from(transactions)
      .where(eq(transactions.stockId, stockId))
      .orderBy(asc(transactions.date), asc(transactions.createdAt))
      .all();

    let state = getInitialAcbState();
    for (const tx of stockTxs) {
      let realizedGain: number | null = null;

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
        realizedGain = result.capitalGainCad;
      }

      db.insert(stockSnapshots)
        .values({
          stockId,
          transactionId: tx.id,
          totalShares: state.totalShares,
          totalCostCad: state.totalCostCad,
          acbPerShare: state.acbPerShare,
          realizedGainCad: realizedGain,
          calculatedAt: new Date(),
        })
        .run();
    }

    console.error(
      `[acb-cli] Corrected exchange rates for stock #${stockId}, rebuilt ${stockTxs.length} snapshots`
    );
  }
}
