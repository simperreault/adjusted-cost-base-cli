import { eq } from "drizzle-orm";
import type { AppDatabase } from "../index.ts";
import { transactions, distributions } from "../schema.ts";
import {
  type AcbEvent,
  recalculateAcbFromEvents,
  getInitialAcbState,
} from "../../core/acb.ts";
import type { ACBState } from "../../types/index.ts";

/**
 * Builds the full event timeline for a stock by querying both
 * transactions and distributions tables.
 */
export function buildAcbEvents(
  db: AppDatabase,
  stockId: number
): AcbEvent[] {
  const allTx = db
    .select()
    .from(transactions)
    .where(eq(transactions.stockId, stockId))
    .all();

  const allDist = db
    .select()
    .from(distributions)
    .where(eq(distributions.stockId, stockId))
    .all();

  const events: AcbEvent[] = [];

  for (const tx of allTx) {
    events.push({
      kind: tx.type as "BUY" | "SELL",
      date: tx.date,
      quantity: tx.quantity,
      pricePerShareCad: tx.pricePerShareCad,
      feesCad: tx.feesCad,
    });
  }

  for (const dist of allDist) {
    events.push({
      kind: "DISTRIBUTION",
      date: dist.recordDate,
      rocPerUnit: dist.rocPerUnit,
      phantomDistPerUnit: dist.phantomDistPerUnit,
    });
  }

  return events;
}

/**
 * Replays the full event history (transactions + distributions) for a stock
 * and returns the authoritative ACB state. This is the single source of truth
 * for ACB — it avoids timestamp-based comparisons between snapshot tables.
 */
export function resolveAcbState(
  db: AppDatabase,
  stockId: number
): ACBState {
  const events = buildAcbEvents(db, stockId);
  if (events.length === 0) return getInitialAcbState();
  return recalculateAcbFromEvents(events);
}
