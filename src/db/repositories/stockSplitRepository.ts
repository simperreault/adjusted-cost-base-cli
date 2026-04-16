import { eq, desc } from "drizzle-orm";
import type { AppDatabase } from "../index.ts";
import { stockSplits, type StockSplitRow } from "../schema.ts";

export interface CreateStockSplitInput {
  stockId: number;
  date: Date;
  ratio: number;
  notes?: string;
}

export function createStockSplitRepository(db: AppDatabase) {
  return {
    create(data: CreateStockSplitInput): StockSplitRow {
      return db
        .insert(stockSplits)
        .values({
          stockId: data.stockId,
          date: data.date,
          ratio: data.ratio,
          notes: data.notes ?? null,
          createdAt: new Date(),
        })
        .returning()
        .get();
    },

    findByStockId(stockId: number): StockSplitRow[] {
      return db
        .select()
        .from(stockSplits)
        .where(eq(stockSplits.stockId, stockId))
        .orderBy(desc(stockSplits.date))
        .all();
    },

    delete(id: number): boolean {
      const existing = db
        .select()
        .from(stockSplits)
        .where(eq(stockSplits.id, id))
        .get();
      if (!existing) return false;
      db.delete(stockSplits).where(eq(stockSplits.id, id)).run();
      return true;
    },
  };
}

export type StockSplitRepository = ReturnType<typeof createStockSplitRepository>;
