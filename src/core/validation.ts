export interface ValidationResult<T> {
  success: true;
  value: T;
}

export interface ValidationError {
  success: false;
  error: string;
}

export type Result<T> = ValidationResult<T> | ValidationError;

export function validateQuantity(input: string): Result<number> {
  const qty = Number(input);
  if (isNaN(qty) || qty <= 0) {
    return { success: false, error: "Quantity must be a positive number" };
  }
  return { success: true, value: qty };
}

export function validatePrice(input: string): Result<number> {
  const price = Number(input);
  if (isNaN(price) || price < 0) {
    return { success: false, error: "Price must be a non-negative number" };
  }
  return { success: true, value: price };
}

export function validateTicker(input: string): Result<string> {
  const ticker = input.trim().toUpperCase();
  if (ticker.length === 0) {
    return { success: false, error: "Ticker cannot be empty" };
  }
  if (ticker.length > 10) {
    return { success: false, error: "Ticker cannot exceed 10 characters" };
  }
  if (!/^[A-Z0-9.]+$/.test(ticker)) {
    return {
      success: false,
      error: "Ticker can only contain letters, numbers, and periods",
    };
  }
  return { success: true, value: ticker };
}

export function validateUsername(input: string): Result<string> {
  const username = input.trim().toLowerCase();
  if (username.length === 0) {
    return { success: false, error: "Username cannot be empty" };
  }
  if (username.length > 50) {
    return { success: false, error: "Username cannot exceed 50 characters" };
  }
  if (!/^[a-z0-9_-]+$/.test(username)) {
    return {
      success: false,
      error: "Username can only contain lowercase letters, numbers, underscores, and hyphens",
    };
  }
  return { success: true, value: username };
}

export interface ParsedTransaction {
  quantity: number;
  price: number;
}

export function parseInlineTransaction(input: string): Result<ParsedTransaction> {
  const match = input.match(/^(\d+(?:\.\d+)?)[xX](\d+(?:\.\d+)?)$/);
  if (!match) {
    return {
      success: false,
      error: 'Transaction must be in format "QTYxPRICE" (e.g., "2x20" for 2 shares at $20)',
    };
  }

  const quantity = Number(match[1]);
  const price = Number(match[2]);

  if (quantity <= 0) {
    return { success: false, error: "Quantity must be positive" };
  }
  if (price < 0) {
    return { success: false, error: "Price cannot be negative" };
  }

  return { success: true, value: { quantity, price } };
}
