export type Currency = "CAD" | "USD";
export type TransactionType = "BUY" | "SELL";

export interface ACBState {
  totalShares: number;
  totalCostCad: number;
  acbPerShare: number;
}

export interface Stock {
  id: number;
  name: string;
  ticker: string;
  currency: Currency;
  createdAt: Date;
}

export interface Transaction {
  id: number;
  stockId: number;
  type: TransactionType;
  date: Date;
  quantity: number;
  pricePerShare: number;
  pricePerShareCad: number;
  exchangeRate: number;
  fees: number;
  feesCad: number;
  createdAt: Date;
}

export interface StockSnapshot {
  id: number;
  stockId: number;
  transactionId: number;
  totalShares: number;
  totalCostCad: number;
  acbPerShare: number;
  realizedGainCad: number | null;
  calculatedAt: Date;
}

export interface ExchangeRate {
  from: Currency;
  to: Currency;
  rate: number;
  date: Date;
  source: string;
  isEstimate: boolean;
}

export interface NewStock {
  name: string;
  ticker: string;
  currency: Currency;
}

export interface NewTransaction {
  stockId: number;
  type: TransactionType;
  date: Date;
  quantity: number;
  pricePerShare: number;
  pricePerShareCad: number;
  exchangeRate: number;
  fees: number;
  feesCad: number;
}
