import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput } from "@inkjs/ui";
import type { AppDatabase } from "../../db/index.ts";
import { createTransactionRepository } from "../../db/repositories/transactionRepository.ts";
import type { Stock } from "../../types/index.ts";
import { formatCurrency } from "../../utils/currency.ts";
import { formatDate, parseDate } from "../../utils/date.ts";
import { validatePrice, validateQuantity } from "../../core/validation.ts";
import {
  HardcodedExchangeRateProvider,
  EXCHANGE_RATE_WARNING,
} from "../../services/exchangeRate/index.ts";
import type { TransactionRow, StockSnapshotRow } from "../../db/schema.ts";

interface StockDetailProps {
  db: AppDatabase;
  stock: Stock;
  onBack: () => void;
}

type TransactionMode = "BUY" | "SELL";
type Field = "date" | "quantity" | "price" | "fees";

export function StockDetail({ db, stock, onBack }: StockDetailProps) {
  const [mode, setMode] = useState<TransactionMode>("BUY");
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [snapshot, setSnapshot] = useState<StockSnapshotRow | null>(null);

  // Form state - stores submitted values
  const [date, setDate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [field, setField] = useState<Field>("date");
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  const txRepo = createTransactionRepository(db);

  const refreshData = () => {
    setTransactions(txRepo.findRecent(stock.id, 10));
    setSnapshot(txRepo.getLatestSnapshot(stock.id) ?? null);
  };

  useEffect(() => {
    refreshData();
  }, [stock.id]);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
    }
    if (key.tab) {
      setMode((m) => (m === "BUY" ? "SELL" : "BUY"));
      setError(null);
    }
  });

  const resetForm = () => {
    setDate("");
    setQuantity("");
    setPrice("");
    setField("date");
    setError(null);
    setFormKey((k) => k + 1);
  };

  const handleDateSubmit = (value: string) => {
    const dateValue = value.trim() === "" ? "today" : value;
    const parsed = parseDate(dateValue);
    if (!parsed) {
      setError("Invalid date format. Use YYYY-MM-DD or 'today'");
      return;
    }
    setDate(formatDate(parsed));
    setError(null);
    setField("quantity");
  };

  const handleQuantitySubmit = (value: string) => {
    const result = validateQuantity(value);
    if (!result.success) {
      setError(result.error);
      return;
    }

    if (mode === "SELL") {
      const available = snapshot?.totalShares ?? 0;
      if (result.value > available) {
        setError(`Cannot sell ${result.value} shares. Only ${available} available.`);
        return;
      }
    }

    setQuantity(value);
    setError(null);
    setField("price");
  };

  const handlePriceSubmit = (value: string) => {
    const result = validatePrice(value);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setPrice(value);
    setError(null);
    setField("fees");
  };

  const handleFeesSubmit = async (value: string) => {
    const feeValue = value.trim() === "" ? "0" : value;
    const feeResult = validatePrice(feeValue);
    if (!feeResult.success) {
      setError(feeResult.error);
      return;
    }

    const dateResult = parseDate(date);
    const qtyResult = validateQuantity(quantity);
    const priceResult = validatePrice(price);

    if (!dateResult || !qtyResult.success || !priceResult.success) {
      setError("Invalid form data");
      return;
    }

    try {
      const exchangeProvider = new HardcodedExchangeRateProvider();
      const exchangeRate = await exchangeProvider.getRate(
        stock.currency,
        "CAD",
        dateResult
      );

      txRepo.create({
        stockId: stock.id,
        type: mode,
        date: dateResult,
        quantity: qtyResult.value,
        pricePerShare: priceResult.value,
        pricePerShareCad: priceResult.value * exchangeRate.rate,
        exchangeRate: exchangeRate.rate,
        fees: feeResult.value,
        feesCad: feeResult.value * exchangeRate.rate,
      });

      resetForm();
      refreshData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create transaction");
    }
  };

  return (
    <Box flexDirection="column" key={formKey}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {stock.name} ({stock.ticker})
        </Text>
        <Text color="gray"> - {stock.currency}</Text>
      </Box>

      {stock.currency === "USD" && (
        <Box marginBottom={1}>
          <Text color="yellow" wrap="wrap">
            ⚠️ {EXCHANGE_RATE_WARNING}
          </Text>
        </Box>
      )}

      {snapshot && (
        <Box marginBottom={1} flexDirection="column">
          <Text>
            <Text bold>Shares:</Text> {snapshot.totalShares}
          </Text>
          <Text>
            <Text bold>ACB:</Text> {formatCurrency(snapshot.acbPerShare, "CAD")}/share
          </Text>
          <Text>
            <Text bold>Total Cost:</Text>{" "}
            {formatCurrency(snapshot.totalCostCad, "CAD")}
          </Text>
        </Box>
      )}

      <Box marginBottom={1}>
        <Text color={mode === "BUY" ? "green" : "gray"} bold={mode === "BUY"}>
          [Buy]
        </Text>
        <Text> </Text>
        <Text color={mode === "SELL" ? "red" : "gray"} bold={mode === "SELL"}>
          [Sell]
        </Text>
        <Text color="gray"> (Press Tab to switch)</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold>New {mode} Transaction:</Text>

        <Box marginTop={1}>
          <Text color={field === "date" ? "cyan" : "gray"}>Date: </Text>
          {field === "date" ? (
            <TextInput
              placeholder="YYYY-MM-DD or 'today' (default)"
              onSubmit={handleDateSubmit}
            />
          ) : (
            <Text>{date}</Text>
          )}
        </Box>

        {["quantity", "price", "fees"].includes(field) && (
          <Box marginTop={1}>
            <Text color={field === "quantity" ? "cyan" : "gray"}>Quantity: </Text>
            {field === "quantity" ? (
              <TextInput
                placeholder="e.g., 100"
                onSubmit={handleQuantitySubmit}
              />
            ) : (
              <Text>{quantity}</Text>
            )}
          </Box>
        )}

        {["price", "fees"].includes(field) && (
          <Box marginTop={1}>
            <Text color={field === "price" ? "cyan" : "gray"}>
              Price per share ({stock.currency}):{" "}
            </Text>
            {field === "price" ? (
              <TextInput
                placeholder="e.g., 150.50"
                onSubmit={handlePriceSubmit}
              />
            ) : (
              <Text>{price}</Text>
            )}
          </Box>
        )}

        {field === "fees" && (
          <Box marginTop={1}>
            <Text color="cyan">Fees ({stock.currency}): </Text>
            <TextInput
              placeholder="0 (default)"
              onSubmit={handleFeesSubmit}
            />
          </Box>
        )}
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      {transactions.length > 0 && (
        <Box flexDirection="column">
          <Text bold>Recent Transactions:</Text>
          <Text color="gray">
            {"Date       Type Qty    Price      Fees"}
          </Text>
          <Text color="gray">{"─".repeat(45)}</Text>
          {transactions.slice(0, 10).map((tx) => (
            <Text key={tx.id}>
              {formatDate(new Date(tx.date))}{" "}
              {tx.type === "BUY" ? (
                <Text color="green">BUY </Text>
              ) : (
                <Text color="red">SELL</Text>
              )}{" "}
              {tx.quantity.toString().padStart(6)}{" "}
              {formatCurrency(tx.pricePerShare, stock.currency).padStart(10)}{" "}
              {tx.fees > 0 ? formatCurrency(tx.fees, stock.currency) : "-"}
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">[Tab] Switch Buy/Sell | [Esc] Back to portfolio</Text>
      </Box>
    </Box>
  );
}
