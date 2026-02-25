import { eq, asc } from "drizzle-orm";
import type { AppDatabase } from "../../db/index.ts";
import { transactions, stockSnapshots, stocks } from "../../db/schema.ts";
import type { ExchangeRateProvider } from "./types.ts";
import {
  calculateAcbAfterBuy,
  calculateAcbAfterSell,
  getInitialAcbState,
} from "../../core/acb.ts";

export async function correctEstimateTransactions(
  db: AppDatabase,
  provider: ExchangeRateProvider
): Promise<void> {
  const estimatedTxs = db
    .select({
      id: transactions.id,
      stockId: transactions.stockId,
      pricePerShare: transactions.pricePerShare,
      fees: transactions.fees,
      date: transactions.date,
      currency: stocks.currency,
    })
    .from(transactions)
    .innerJoin(stocks, eq(transactions.stockId, stocks.id))
    .where(eq(transactions.exchangeRateIsEstimate, 1))
    .all();

  if (estimatedTxs.length === 0) return;

  const affectedStockIds = new Set<number>();

  for (const tx of estimatedTxs) {
    if (tx.currency === "CAD") continue;

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

  for (const stockId of affectedStockIds) {
    rebuildSnapshots(db, stockId);
  }
}

function rebuildSnapshots(db: AppDatabase, stockId: number): void {
  db.transaction((tx) => {
    tx.delete(stockSnapshots)
      .where(eq(stockSnapshots.stockId, stockId))
      .run();

    const stockTxs = tx
      .select()
      .from(transactions)
      .where(eq(transactions.stockId, stockId))
      .orderBy(asc(transactions.date), asc(transactions.createdAt))
      .all();

    let state = getInitialAcbState();
    for (const t of stockTxs) {
      let realizedGain: number | null = null;

      if (t.type === "BUY") {
        state = calculateAcbAfterBuy(state, {
          quantity: t.quantity,
          pricePerShareCad: t.pricePerShareCad,
          feesCad: t.feesCad,
        });
      } else {
        const result = calculateAcbAfterSell(state, {
          quantity: t.quantity,
          proceedsPerShareCad: t.pricePerShareCad,
          feesCad: t.feesCad,
        });
        state = result.newState;
        realizedGain = result.capitalGainCad;
      }

      tx.insert(stockSnapshots)
        .values({
          stockId,
          transactionId: t.id,
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
  });
}
