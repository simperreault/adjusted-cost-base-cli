import { Database } from "bun:sqlite";
import {
  getExchangeRateDatabasePath,
  ensureDataDirectoriesExist,
} from "../utils/paths.ts";

export interface CachedRate {
  date: string;
  currencyPair: string;
  rate: number;
}

export interface ExchangeRateCache {
  getRate(pair: string, date: string): number | null;
  getClosestRate(pair: string, date: string): { date: string; rate: number } | null;
  insertRates(rates: CachedRate[]): void;
  close(): void;
}

function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS exchange_rates (
      date TEXT NOT NULL,
      currency_pair TEXT NOT NULL,
      rate REAL NOT NULL,
      UNIQUE(date, currency_pair)
    )
  `);
}

function createCacheFromDb(db: Database): ExchangeRateCache {
  initSchema(db);

  const getStmt = db.prepare(
    "SELECT rate FROM exchange_rates WHERE currency_pair = ? AND date = ?"
  );
  const closestStmt = db.prepare(
    "SELECT date, rate FROM exchange_rates WHERE currency_pair = ? AND date <= ? ORDER BY date DESC LIMIT 1"
  );
  const insertStmt = db.prepare(
    "INSERT OR REPLACE INTO exchange_rates (date, currency_pair, rate) VALUES (?, ?, ?)"
  );

  return {
    getRate(pair: string, date: string): number | null {
      const row = getStmt.get(pair, date) as { rate: number } | null;
      return row?.rate ?? null;
    },

    getClosestRate(pair: string, date: string): { date: string; rate: number } | null {
      const row = closestStmt.get(pair, date) as { date: string; rate: number } | null;
      return row ?? null;
    },

    insertRates(rates: CachedRate[]): void {
      const tx = db.transaction(() => {
        for (const r of rates) {
          insertStmt.run(r.date, r.currencyPair, r.rate);
        }
      });
      tx();
    },

    close(): void {
      db.close();
    },
  };
}

export function createExchangeRateCache(): ExchangeRateCache {
  ensureDataDirectoriesExist();
  const db = new Database(getExchangeRateDatabasePath());
  db.exec("PRAGMA journal_mode = WAL;");
  return createCacheFromDb(db);
}

export function createInMemoryExchangeRateCache(): ExchangeRateCache {
  const db = new Database(":memory:");
  return createCacheFromDb(db);
}
