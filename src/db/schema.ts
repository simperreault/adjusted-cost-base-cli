import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const stocks = sqliteTable("stocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  ticker: text("ticker").notNull().unique(),
  currency: text("currency", { enum: ["CAD", "USD"] }).notNull().default("CAD"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stockId: integer("stock_id")
    .notNull()
    .references(() => stocks.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["BUY", "SELL", "DRIP"] }).notNull(),
  date: integer("date", { mode: "timestamp" }).notNull(),
  quantity: real("quantity").notNull(),
  pricePerShare: real("price_per_share").notNull(),
  pricePerShareCad: real("price_per_share_cad").notNull(),
  exchangeRate: real("exchange_rate").notNull().default(1),
  fees: real("fees").notNull().default(0),
  feesCad: real("fees_cad").notNull().default(0),
  exchangeRateIsEstimate: integer("exchange_rate_is_estimate")
    .notNull()
    .default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const stockSnapshots = sqliteTable("stock_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stockId: integer("stock_id")
    .notNull()
    .references(() => stocks.id, { onDelete: "cascade" }),
  transactionId: integer("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  totalShares: real("total_shares").notNull(),
  totalCostCad: real("total_cost_cad").notNull(),
  acbPerShare: real("acb_per_share").notNull(),
  realizedGainCad: real("realized_gain_cad"),
  calculatedAt: integer("calculated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const distributions = sqliteTable("distributions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stockId: integer("stock_id")
    .notNull()
    .references(() => stocks.id, { onDelete: "cascade" }),
  recordDate: integer("record_date", { mode: "timestamp" }).notNull(),
  rocPerUnit: real("roc_per_unit").notNull().default(0),
  phantomDistPerUnit: real("phantom_dist_per_unit").notNull().default(0),
  source: text("source", { enum: ["manual", "bundled", "synced"] })
    .notNull()
    .default("manual"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const distributionSnapshots = sqliteTable("distribution_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stockId: integer("stock_id")
    .notNull()
    .references(() => stocks.id, { onDelete: "cascade" }),
  distributionId: integer("distribution_id")
    .notNull()
    .references(() => distributions.id, { onDelete: "cascade" }),
  totalShares: real("total_shares").notNull(),
  totalCostCad: real("total_cost_cad").notNull(),
  acbPerShare: real("acb_per_share").notNull(),
  rocAppliedCad: real("roc_applied_cad").notNull(),
  phantomAppliedCad: real("phantom_applied_cad").notNull(),
  deemedCapitalGainCad: real("deemed_capital_gain_cad"),
  calculatedAt: integer("calculated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const stockSplits = sqliteTable("stock_splits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stockId: integer("stock_id")
    .notNull()
    .references(() => stocks.id, { onDelete: "cascade" }),
  date: integer("date", { mode: "timestamp" }).notNull(),
  ratio: real("ratio").notNull(),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type StockRow = typeof stocks.$inferSelect;
export type NewStockRow = typeof stocks.$inferInsert;
export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransactionRow = typeof transactions.$inferInsert;
export type StockSnapshotRow = typeof stockSnapshots.$inferSelect;
export type NewStockSnapshotRow = typeof stockSnapshots.$inferInsert;
export type DistributionRow = typeof distributions.$inferSelect;
export type NewDistributionRow = typeof distributions.$inferInsert;
export type DistributionSnapshotRow = typeof distributionSnapshots.$inferSelect;
export type NewDistributionSnapshotRow = typeof distributionSnapshots.$inferInsert;
export type StockSplitRow = typeof stockSplits.$inferSelect;
export type NewStockSplitRow = typeof stockSplits.$inferInsert;
