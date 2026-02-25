import { eq, desc, and } from "drizzle-orm";
import type { AppDatabase } from "../index.ts";
import {
  transactions,
  stockSnapshots,
  type TransactionRow,
  type StockSnapshotRow,
} from "../schema.ts";
import {
  calculateAcbAfterBuy,
  calculateAcbAfterSell,
  getInitialAcbState,
  recalculateAcbFromTransactions,
} from "../../core/acb.ts";

export interface CreateTransactionInput {
  stockId: number;
  type: "BUY" | "SELL";
  date: Date;
  quantity: number;
  pricePerShare: number;
  pricePerShareCad: number;
  exchangeRate: number;
  fees: number;
  feesCad: number;
  exchangeRateIsEstimate?: boolean;
}

export interface TransactionWithSnapshot {
  transaction: TransactionRow;
  snapshot: StockSnapshotRow;
}

export function createTransactionRepository(db: AppDatabase) {
  return {
    create(data: CreateTransactionInput): TransactionWithSnapshot {
      const currentSnapshot = this.getLatestSnapshot(data.stockId);
      const currentState = currentSnapshot
        ? {
            totalShares: currentSnapshot.totalShares,
            totalCostCad: currentSnapshot.totalCostCad,
            acbPerShare: currentSnapshot.acbPerShare,
          }
        : getInitialAcbState();

      let newState;
      let realizedGain: number | null = null;

      if (data.type === "BUY") {
        newState = calculateAcbAfterBuy(currentState, {
          quantity: data.quantity,
          pricePerShareCad: data.pricePerShareCad,
          feesCad: data.feesCad,
        });
      } else {
        const result = calculateAcbAfterSell(currentState, {
          quantity: data.quantity,
          proceedsPerShareCad: data.pricePerShareCad,
          feesCad: data.feesCad,
        });
        newState = result.newState;
        realizedGain = result.capitalGainCad;
      }

      const transaction = db
        .insert(transactions)
        .values({
          stockId: data.stockId,
          type: data.type,
          date: data.date,
          quantity: data.quantity,
          pricePerShare: data.pricePerShare,
          pricePerShareCad: data.pricePerShareCad,
          exchangeRate: data.exchangeRate,
          fees: data.fees,
          feesCad: data.feesCad,
          exchangeRateIsEstimate: data.exchangeRateIsEstimate ? 1 : 0,
          createdAt: new Date(),
        })
        .returning()
        .get();

      const snapshot = db
        .insert(stockSnapshots)
        .values({
          stockId: data.stockId,
          transactionId: transaction.id,
          totalShares: newState.totalShares,
          totalCostCad: newState.totalCostCad,
          acbPerShare: newState.acbPerShare,
          realizedGainCad: realizedGain,
          calculatedAt: new Date(),
        })
        .returning()
        .get();

      // Dual-path verification: replay full history and compare
      const allTransactions = db
        .select()
        .from(transactions)
        .where(eq(transactions.stockId, data.stockId))
        .orderBy(transactions.date, transactions.createdAt)
        .all();

      const replayState = recalculateAcbFromTransactions(
        allTransactions.map((tx) => ({
          type: tx.type as "BUY" | "SELL",
          quantity: tx.quantity,
          pricePerShareCad: tx.pricePerShareCad,
          feesCad: tx.feesCad,
        }))
      );

      const TOLERANCE = 0.01;
      if (
        Math.abs(replayState.totalShares - snapshot.totalShares) > TOLERANCE ||
        Math.abs(replayState.totalCostCad - snapshot.totalCostCad) > TOLERANCE ||
        Math.abs(replayState.acbPerShare - snapshot.acbPerShare) > TOLERANCE
      ) {
        throw new Error(
          `ACB verification failed: incremental and replay paths disagree. ` +
          `Snapshot: ${JSON.stringify({ totalShares: snapshot.totalShares, totalCostCad: snapshot.totalCostCad, acbPerShare: snapshot.acbPerShare })} ` +
          `Replay: ${JSON.stringify(replayState)}`
        );
      }

      return { transaction, snapshot };
    },

    findByStockId(stockId: number): TransactionRow[] {
      return db
        .select()
        .from(transactions)
        .where(eq(transactions.stockId, stockId))
        .orderBy(desc(transactions.date), desc(transactions.createdAt))
        .all();
    },

    findRecent(stockId: number, limit: number = 10): TransactionRow[] {
      return db
        .select()
        .from(transactions)
        .where(eq(transactions.stockId, stockId))
        .orderBy(desc(transactions.date), desc(transactions.createdAt))
        .limit(limit)
        .all();
    },

    getLatestSnapshot(stockId: number): StockSnapshotRow | undefined {
      return db
        .select()
        .from(stockSnapshots)
        .where(eq(stockSnapshots.stockId, stockId))
        .orderBy(desc(stockSnapshots.calculatedAt), desc(stockSnapshots.id))
        .limit(1)
        .get();
    },

    getSnapshotForTransaction(transactionId: number): StockSnapshotRow | undefined {
      return db
        .select()
        .from(stockSnapshots)
        .where(eq(stockSnapshots.transactionId, transactionId))
        .get();
    },

    delete(id: number): boolean {
      const existing = db
        .select()
        .from(transactions)
        .where(eq(transactions.id, id))
        .get();
      if (!existing) return false;
      db.delete(transactions).where(eq(transactions.id, id)).run();
      return true;
    },

    getTotalRealizedGains(stockId: number): number {
      const snapshots = db
        .select()
        .from(stockSnapshots)
        .where(
          and(
            eq(stockSnapshots.stockId, stockId),
          )
        )
        .all();

      return snapshots.reduce((sum, s) => sum + (s.realizedGainCad ?? 0), 0);
    },
  };
}

export type TransactionRepository = ReturnType<typeof createTransactionRepository>;
