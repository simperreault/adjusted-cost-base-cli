import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";
import {
  getUserDatabasePath,
  ensureDataDirectoriesExist,
} from "../utils/paths.ts";

export type AppDatabase = BunSQLiteDatabase<typeof schema>;

export interface DatabaseConfig {
  username: string;
  password?: string;
}

export function createDatabaseConnection(config: DatabaseConfig): AppDatabase {
  ensureDataDirectoriesExist();

  const dbPath = getUserDatabasePath(config.username);
  const sqlite = new Database(dbPath);

  // Note: Password encryption not yet supported with bun:sqlite
  // TODO: Implement application-level encryption or wait for SQLCipher support
  if (config.password) {
    console.warn(
      "Warning: Database encryption is not yet supported. Password will be ignored."
    );
  }

  sqlite.exec("PRAGMA journal_mode = WAL;");

  const db = drizzle(sqlite, { schema });

  initializeSchema(sqlite);

  return db;
}

function initializeSchema(sqlite: Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS stocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ticker TEXT NOT NULL UNIQUE,
      currency TEXT NOT NULL DEFAULT 'CAD',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      date INTEGER NOT NULL,
      quantity REAL NOT NULL,
      price_per_share REAL NOT NULL,
      price_per_share_cad REAL NOT NULL,
      exchange_rate REAL NOT NULL DEFAULT 1,
      fees REAL NOT NULL DEFAULT 0,
      fees_cad REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      total_shares REAL NOT NULL,
      total_cost_cad REAL NOT NULL,
      acb_per_share REAL NOT NULL,
      realized_gain_cad REAL,
      calculated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
      date INTEGER NOT NULL,
      ratio REAL NOT NULL,
      notes TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS distributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
      record_date INTEGER NOT NULL,
      roc_per_unit REAL NOT NULL DEFAULT 0,
      phantom_dist_per_unit REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      notes TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS distribution_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
      distribution_id INTEGER NOT NULL REFERENCES distributions(id) ON DELETE CASCADE,
      total_shares REAL NOT NULL,
      total_cost_cad REAL NOT NULL,
      acb_per_share REAL NOT NULL,
      roc_applied_cad REAL NOT NULL,
      phantom_applied_cad REAL NOT NULL,
      deemed_capital_gain_cad REAL,
      calculated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_stock_id ON transactions(stock_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_stock_snapshots_stock_id ON stock_snapshots(stock_id);
    CREATE INDEX IF NOT EXISTS idx_stock_snapshots_transaction_id ON stock_snapshots(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_stock_splits_stock_id ON stock_splits(stock_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_distributions_stock_record_date ON distributions(stock_id, record_date);
    CREATE INDEX IF NOT EXISTS idx_distributions_record_date ON distributions(record_date);
    CREATE INDEX IF NOT EXISTS idx_distribution_snapshots_stock_id ON distribution_snapshots(stock_id);
    CREATE INDEX IF NOT EXISTS idx_distribution_snapshots_distribution_id ON distribution_snapshots(distribution_id);
  `);

  // Migration: add exchange_rate_is_estimate column
  try {
    sqlite.exec(
      "ALTER TABLE transactions ADD COLUMN exchange_rate_is_estimate INTEGER NOT NULL DEFAULT 0"
    );
  } catch {
    // Column already exists — safe to ignore
  }
}

export function createInMemoryDatabase(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL;");

  const db = drizzle(sqlite, { schema });
  initializeSchema(sqlite);

  return db;
}

export function testDatabaseConnection(
  username: string,
  _password?: string
): boolean {
  try {
    const dbPath = getUserDatabasePath(username);
    const sqlite = new Database(dbPath);

    // Try to read from the database
    sqlite.query("SELECT 1").get();
    sqlite.close();
    return true;
  } catch {
    return false;
  }
}
