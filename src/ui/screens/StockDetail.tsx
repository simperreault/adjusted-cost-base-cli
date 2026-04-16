import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { TextInput } from "@inkjs/ui";
import type { AppDatabase } from "../../db/index.ts";
import { createTransactionRepository } from "../../db/repositories/transactionRepository.ts";
import type { Stock } from "../../types/index.ts";
import { formatCurrency } from "../../utils/currency.ts";
import { formatDate, parseDate } from "../../utils/date.ts";
import { validatePrice, validateQuantity } from "../../core/validation.ts";
import {
  getExchangeRateProvider,
  type ExchangeRate,
} from "../../services/exchangeRate/index.ts";
import type { TransactionRow, StockSnapshotRow } from "../../db/schema.ts";
import { createDistributionRepository } from "../../db/repositories/distributionRepository.ts";
import { isSupportedTicker } from "../../../data/distributions/index.ts";

interface StockDetailProps {
  db: AppDatabase;
  stock: Stock;
  onBack: () => void;
}

type TransactionMode = "BUY" | "SELL";
type Field = "date" | "quantity" | "price" | "fees";

const FIELDS: Field[] = ["date", "quantity", "price", "fees"];
const LABEL_WIDTH = 12;

export function StockDetail({ db, stock, onBack }: StockDetailProps) {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;
  const terminalHeight = stdout?.rows ?? 24;
  const isWideTerminal = terminalWidth >= 80;

  const [mode, setMode] = useState<TransactionMode>("BUY");
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [snapshot, setSnapshot] = useState<StockSnapshotRow | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Form state
  const [date, setDate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fees, setFees] = useState("");
  const [field, setField] = useState<Field>("date");
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  // Exchange rate state (fetched after date is entered for USD stocks)
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);

  // Distribution sync state
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const hasDistributionData = isSupportedTicker(stock.ticker);

  const txRepo = createTransactionRepository(db);
  const distRepo = createDistributionRepository(db);

  const refreshData = () => {
    const recent = txRepo.findRecent(stock.id, 50);
    // Reverse to show oldest first, newest at bottom
    setTransactions([...recent].reverse());
    setSnapshot(txRepo.getLatestSnapshot(stock.id) ?? null);
    // Auto-scroll to bottom
    setScrollOffset(Math.max(0, recent.length - getVisibleRowCount()));
  };

  const getVisibleRowCount = () => {
    // Reserve space for header, form, footer
    const reservedRows = isWideTerminal ? 8 : 18;
    return Math.max(3, terminalHeight - reservedRows);
  };

  useEffect(() => {
    refreshData();
  }, [stock.id]);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }

    // Tab without shift: toggle Buy/Sell mode
    if (key.tab && !key.shift) {
      setMode((m) => (m === "BUY" ? "SELL" : "BUY"));
      setError(null);
      return;
    }

    // Shift+Tab: go back to previous field
    if (key.tab && key.shift) {
      const currentIndex = FIELDS.indexOf(field);
      if (currentIndex > 0) {
        const prevField = FIELDS[currentIndex - 1];
        if (prevField) {
          setField(prevField);
          setError(null);
        }
      }
      return;
    }

    // D: sync distribution data
    if (input === "d" && hasDistributionData && field === "date") {
      try {
        const { applied, updated, skipped } = distRepo.applyBundledDistributions(stock.id, stock.ticker);
        const parts = [];
        if (applied > 0) parts.push(`${applied} applied`);
        if (updated > 0) parts.push(`${updated} updated`);
        if (skipped > 0) parts.push(`${skipped} unchanged`);
        setSyncMessage(`Distributions synced: ${parts.join(", ")}`);
        refreshData();
      } catch (e) {
        setSyncMessage(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }

    // Arrow keys for scrolling transactions
    if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
    }
    if (key.downArrow) {
      const maxOffset = Math.max(0, transactions.length - getVisibleRowCount());
      setScrollOffset((o) => Math.min(maxOffset, o + 1));
    }
  });

  const resetForm = () => {
    setDate("");
    setQuantity("");
    setPrice("");
    setFees("");
    setField("date");
    setError(null);
    setExchangeRate(null);
    setFormKey((k) => k + 1);
  };

  const handleDateSubmit = async (value: string) => {
    const dateValue = value.trim() === "" ? "today" : value;
    const parsed = parseDate(dateValue);
    if (!parsed) {
      setError("Invalid date. Try: YYYY-MM-DD, DD/MM/YYYY, or 'today'");
      return;
    }
    setDate(formatDate(parsed));
    setError(null);

    // Fetch exchange rate for USD stocks
    if (stock.currency === "USD") {
      try {
        const rate = await getExchangeRateProvider().getRate("USD", "CAD", parsed);
        setExchangeRate(rate);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch exchange rate");
        return;
      }
    }

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
      // Use already-fetched rate for USD stocks, or fetch for CAD
      const rate = exchangeRate ?? await getExchangeRateProvider().getRate(
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
        pricePerShareCad: priceResult.value * rate.rate,
        exchangeRate: rate.rate,
        fees: feeResult.value,
        feesCad: feeResult.value * rate.rate,
        exchangeRateIsEstimate: rate.isEstimate,
      });

      resetForm();
      refreshData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create transaction");
    }
  };

  const getFieldValue = (f: Field): string => {
    switch (f) {
      case "date":
        return date;
      case "quantity":
        return quantity;
      case "price":
        return price;
      case "fees":
        return fees;
    }
  };

  const getFieldLabel = (f: Field): string => {
    switch (f) {
      case "date":
        return "Date";
      case "quantity":
        return "Quantity";
      case "price":
        return `Price (${stock.currency})`;
      case "fees":
        return `Fees (${stock.currency})`;
    }
  };

  const getFieldPlaceholder = (f: Field): string => {
    switch (f) {
      case "date":
        return "today";
      case "quantity":
        return "100";
      case "price":
        return "150.50";
      case "fees":
        return "0";
    }
  };

  const getFieldHandler = (f: Field) => {
    switch (f) {
      case "date":
        return handleDateSubmit;
      case "quantity":
        return handleQuantitySubmit;
      case "price":
        return handlePriceSubmit;
      case "fees":
        return handleFeesSubmit;
    }
  };

  const getCadConversion = (f: Field): string | null => {
    if (stock.currency !== "USD" || !exchangeRate) return null;
    const value = getFieldValue(f);
    if (!value) return null;

    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) return null;

    const cad = num * exchangeRate.rate;
    return formatCurrency(cad, "CAD");
  };

  const renderFormField = (f: Field) => {
    const isActive = field === f;
    const isPending = FIELDS.indexOf(f) > FIELDS.indexOf(field);
    const value = getFieldValue(f);
    const label = getFieldLabel(f).padEnd(LABEL_WIDTH);
    const cadConversion = (f === "price" || f === "fees") ? getCadConversion(f) : null;

    return (
      <Box key={f} flexDirection="column">
        <Box>
          <Text color={isActive ? "cyan" : "gray"}>{label}</Text>
          {isActive ? (
            <TextInput
              key={`${formKey}-${f}`}
              placeholder={getFieldPlaceholder(f)}
              onSubmit={getFieldHandler(f)}
            />
          ) : isPending ? (
            <Text color="gray">—</Text>
          ) : (
            <Text>
              {value}
              {cadConversion && !isActive && (
                <Text color="gray">{`  → ${cadConversion}`}</Text>
              )}
            </Text>
          )}
        </Box>
        {f === "date" && exchangeRate && !isPending && (
          <Box>
            <Text color="gray">{"".padEnd(LABEL_WIDTH)}</Text>
            <Text color={exchangeRate.isEstimate ? "yellow" : "gray"}>
              {`1 USD = ${exchangeRate.rate.toFixed(4)} CAD`}
              {exchangeRate.isEstimate ? " (estimate)" : ""}
            </Text>
          </Box>
        )}
      </Box>
    );
  };

  const visibleRows = getVisibleRowCount();
  const visibleTransactions = transactions.slice(scrollOffset, scrollOffset + visibleRows);
  const hasScrollUp = scrollOffset > 0;
  const hasScrollDown = scrollOffset + visibleRows < transactions.length;

  const renderTransactionsPanel = () => (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>Transactions</Text>
      <Text color="gray">{"─".repeat(28)}</Text>

      {transactions.length === 0 ? (
        <Text color="gray">No transactions yet</Text>
      ) : (
        <>
          {hasScrollUp && <Text color="gray">  ↑ more</Text>}
          {visibleTransactions.map((tx) => (
            <Text key={tx.id}>
              <Text color="gray">{formatDate(new Date(tx.date))} </Text>
              {tx.type === "BUY" ? (
                <Text color="green">BUY </Text>
              ) : (
                <Text color="red">SELL</Text>
              )}
              <Text> {tx.quantity.toString().padStart(4)} </Text>
              <Text>{formatCurrency(tx.pricePerShare, stock.currency)}</Text>
            </Text>
          ))}
          {hasScrollDown && <Text color="gray">  ↓ more</Text>}
        </>
      )}

      {transactions.length > visibleRows && (
        <Text color="gray" dimColor>
          [↑/↓] scroll
        </Text>
      )}
    </Box>
  );

  const renderFormPanel = () => (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} width={42}>
      <Box>
        <Text
          color={mode === "BUY" ? "green" : "gray"}
          bold={mode === "BUY"}
          inverse={mode === "BUY"}
        >
          {" BUY "}
        </Text>
        <Text> </Text>
        <Text
          color={mode === "SELL" ? "red" : "gray"}
          bold={mode === "SELL"}
          inverse={mode === "SELL"}
        >
          {" SELL "}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {FIELDS.map(renderFormField)}
      </Box>

      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}
    </Box>
  );

  return (
    <Box flexDirection="column" key={formKey}>
      {/* Stock Header */}
      <Box
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
        flexDirection="column"
        marginBottom={1}
      >
        <Box justifyContent="space-between">
          <Text bold color="cyan">
            {stock.name} ({stock.ticker})
          </Text>
          <Text color="gray">{stock.currency}</Text>
        </Box>

        {snapshot && (
          <Text>
            <Text bold>{snapshot.totalShares}</Text>
            <Text color="gray"> shares</Text>
            <Text color="gray"> · </Text>
            <Text>ACB: </Text>
            <Text bold>{formatCurrency(snapshot.acbPerShare, "CAD")}</Text>
            <Text>/share</Text>
            <Text color="gray"> · </Text>
            <Text>Total: </Text>
            <Text bold>{formatCurrency(snapshot.totalCostCad, "CAD")}</Text>
          </Text>
        )}

        {stock.currency === "USD" && (
          <Text color="gray">USD rates from Bank of Canada</Text>
        )}
      </Box>

      {/* Main Content: Form + Transactions */}
      {isWideTerminal ? (
        <Box>
          {renderFormPanel()}
          <Box marginLeft={1} flexGrow={1}>
            {renderTransactionsPanel()}
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {renderFormPanel()}
          <Box marginTop={1}>{renderTransactionsPanel()}</Box>
        </Box>
      )}

      {/* Sync message */}
      {syncMessage && (
        <Box marginTop={1}>
          <Text color="yellow">{syncMessage}</Text>
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray">
          [Tab] Buy/Sell · [Shift+Tab] Back · [Enter] Next{hasDistributionData ? " · [D] Sync distributions" : ""} · [Esc] Exit
        </Text>
      </Box>
    </Box>
  );
}
