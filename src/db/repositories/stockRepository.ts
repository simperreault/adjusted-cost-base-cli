import { eq } from "drizzle-orm";
import type { AppDatabase } from "../index.ts";
import { stocks, type NewStockRow, type StockRow } from "../schema.ts";

export function createStockRepository(db: AppDatabase) {
  return {
    create(data: { name: string; ticker: string; currency: "CAD" | "USD" }): StockRow {
      const result = db
        .insert(stocks)
        .values({
          name: data.name,
          ticker: data.ticker.toUpperCase(),
          currency: data.currency,
          createdAt: new Date(),
        })
        .returning()
        .get();
      return result;
    },

    findAll(): StockRow[] {
      return db.select().from(stocks).all();
    },

    findById(id: number): StockRow | undefined {
      return db.select().from(stocks).where(eq(stocks.id, id)).get();
    },

    findByTicker(ticker: string): StockRow | undefined {
      return db
        .select()
        .from(stocks)
        .where(eq(stocks.ticker, ticker.toUpperCase()))
        .get();
    },

    update(
      id: number,
      data: Partial<{ name: string; ticker: string; currency: "CAD" | "USD" }>
    ): StockRow | undefined {
      const updateData: Partial<NewStockRow> = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.ticker !== undefined) updateData.ticker = data.ticker.toUpperCase();
      if (data.currency !== undefined) updateData.currency = data.currency;

      const result = db
        .update(stocks)
        .set(updateData)
        .where(eq(stocks.id, id))
        .returning()
        .get();
      return result;
    },

    delete(id: number): boolean {
      const existing = this.findById(id);
      if (!existing) return false;
      db.delete(stocks).where(eq(stocks.id, id)).run();
      return true;
    },
  };
}

export type StockRepository = ReturnType<typeof createStockRepository>;
