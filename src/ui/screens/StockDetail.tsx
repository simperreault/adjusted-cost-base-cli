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
import { createStockSplitRepository } from "../../db/repositories/stockSplitRepository.ts";
import { isSupportedTicker } from "../../../data/distributions/index.ts";
import { resolveAcbState } from "../../db/repositories/acbStateResolver.ts";

interface StockDetailProps {
  db: AppDatabase;
  stock: Stock;
  onBack: () => void;
}

type TransactionMode = "BUY" | "SELL" | "DRIP";
type Field = "date" | "quantity" | "price" | "total" | "fees";

const LABEL_WIDTH = 14;
const MODES: TransactionMode[] = ["BUY", "SELL", "DRIP"];

function getFields(mode: TransactionMode): Field[] {
  // DRIP skips fees (always 0)
  if (mode === "DRIP") return ["date", "quantity", "price", "total"];
  return ["date", "quantity", "price", "total", "fees"];
}

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
  const [total, setTotal] = useState("");
  const [fees, setFees] = useState("");
  const [field, setField] = useState<Field>("date");
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  // Exchange rate state (fetched after date is entered for USD stocks)
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);

  // Distribution sync state
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const hasDistributionData = isSupportedTicker(stock.ticker);

  // Split input state
  const [splitMode, setSplitMode] = useState(false);
  const [splitRatio, setSplitRatio] = useState("");

  const txRepo = createTransactionRepository(db);
  const distRepo = createDistributionRepository(db);
  const splitRepo = createStockSplitRepository(db);

  const fields = getFields(mode);

  const refreshData = () => {
    const recent = txRepo.findRecent(stock.id, 50);
    setTransactions([...recent].reverse());
    setSnapshot(txRepo.getLatestSnapshot(stock.id) ?? null);
    setScrollOffset(Math.max(0, recent.length - getVisibleRowCount()));
  };

  const getVisibleRowCount = () => {
    const reservedRows = isWideTerminal ? 8 : 18;
    return Math.max(3, terminalHeight - reservedRows);
  };

  useEffect(() => {
    refreshData();
  }, [stock.id]);

  useInput((input, key) => {
    if (key.escape) {
      if (splitMode) {
        setSplitMode(false);
        setSplitRatio("");
        return;
      }
      onBack();
      return;
    }

    if (key.tab && !key.shift) {
      const idx = MODES.indexOf(mode);
      setMode(MODES[(idx + 1) % MODES.length]!);
      setError(null);
      return;
    }

    if (key.tab && key.shift) {
      const currentIndex = fields.indexOf(field);
      if (currentIndex > 0) {
        const prevField = fields[currentIndex - 1];
        if (prevField) {
          setField(prevField);
          setError(null);
        }
      }
      return;
    }

    // S: enter split mode
    if (input === "s" && !splitMode && field === "date") {
      setSplitMode(true);
      setSyncMessage(null);
      return;
    }

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

    if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
    }
    if (key.downArrow) {
      const maxOffset = Math.max(0, transactions.length - getVisibleRowCount());
      setScrollOffset((o) => Math.min(maxOffset, o + 1));
    }
  });

  const handleSplitSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setSplitMode(false);
      return;
    }

    // Parse ratio: accept "2:1", "1:10", or just "2"
    let ratio: number;
    const colonMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
    if (colonMatch) {
      const numerator = parseFloat(colonMatch[1]!);
      const denominator = parseFloat(colonMatch[2]!);
      if (denominator === 0) {
        setError("Invalid split ratio");
        return;
      }
      ratio = numerator / denominator;
    } else {
      ratio = parseFloat(trimmed);
    }

    if (isNaN(ratio) || ratio <= 0) {
      setError("Split ratio must be a positive number (e.g. 2:1 or 0.1)");
      return;
    }

    const currentState = resolveAcbState(db, stock.id);
    if (currentState.totalShares <= 0) {
      setError("No shares to split");
      return;
    }

    try {
      splitRepo.create({
        stockId: stock.id,
        date: new Date(),
        ratio,
        notes: `${trimmed} split`,
      });

      const newState = resolveAcbState(db, stock.id);
      setSyncMessage(
        `Split recorded: ${currentState.totalShares} → ${newState.totalShares.toFixed(2)} shares, ` +
        `ACB ${formatCurrency(currentState.acbPerShare, "CAD")} → ${formatCurrency(newState.acbPerShare, "CAD")}/share`
      );
      setSplitMode(false);
      setSplitRatio("");
      setError(null);
      refreshData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record split");
    }
  };

  const resetForm = () => {
    setDate("");
    setQuantity("");
    setPrice("");
    setTotal("");
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
    if (value.trim() === "") {
      // User skipped price — move to total field for manual entry
      setPrice("");
      setTotal("");
      setError(null);
      setField("total");
      return;
    }

    const result = validatePrice(value);
    if (!result.success) {
      setError(result.error);
      return;
    }

    const qty = parseFloat(quantity);
    const calculatedTotal = (result.value * qty).toFixed(2);

    setPrice(value);
    setTotal(calculatedTotal);
    setError(null);
    // Skip total field since it's auto-filled, go to fees (or done for DRIP)
    if (mode === "DRIP") {
      submitTransaction(result.value, 0);
    } else {
      setField("total");
    }
  };

  const handleTotalSubmit = (value: string) => {
    if (value.trim() === "" && price) {
      // User accepted the pre-filled total, move on
      if (mode === "DRIP") {
        const priceVal = parseFloat(price);
        submitTransaction(priceVal, 0);
      } else {
        setField("fees");
      }
      return;
    }

    const totalValue = value.trim() === "" ? total : value;
    if (!totalValue) {
      setError("Enter either a price per share or a total amount");
      return;
    }

    const totalResult = validatePrice(totalValue);
    if (!totalResult.success) {
      setError(totalResult.error);
      return;
    }

    const qty = parseFloat(quantity);
    const calculatedPrice = totalResult.value / qty;

    setTotal(totalValue);
    setPrice(calculatedPrice.toFixed(5));
    setError(null);

    if (mode === "DRIP") {
      submitTransaction(calculatedPrice, 0);
    } else {
      setField("fees");
    }
  };

  const handleFeesSubmit = async (value: string) => {
    const feeValue = value.trim() === "" ? "0" : value;
    const feeResult = validatePrice(feeValue);
    if (!feeResult.success) {
      setError(feeResult.error);
      return;
    }

    const priceVal = parseFloat(price);
    if (isNaN(priceVal)) {
      setError("Invalid form data");
      return;
    }

    await submitTransaction(priceVal, feeResult.value);
  };

  const submitTransaction = async (pricePerShare: number, feesValue: number) => {
    const dateResult = parseDate(date);
    const qtyResult = validateQuantity(quantity);

    if (!dateResult || !qtyResult.success) {
      setError("Invalid form data");
      return;
    }

    try {
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
        pricePerShare: pricePerShare,
        pricePerShareCad: pricePerShare * rate.rate,
        exchangeRate: rate.rate,
        fees: feesValue,
        feesCad: feesValue * rate.rate,
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
      case "date": return date;
      case "quantity": return quantity;
      case "price": return price;
      case "total": return total;
      case "fees": return fees;
    }
  };

  const getFieldLabel = (f: Field): string => {
    switch (f) {
      case "date": return "Date";
      case "quantity": return mode === "DRIP" ? "Shares" : "Quantity";
      case "price": return `Price (${stock.currency})`;
      case "total": return `Total (${stock.currency})`;
      case "fees": return `Fees (${stock.currency})`;
    }
  };

  const getFieldPlaceholder = (f: Field): string => {
    switch (f) {
      case "date": return "today";
      case "quantity": return mode === "DRIP" ? "12.95" : "100";
      case "price": return mode === "DRIP" ? "or Enter for total" : "150.50";
      case "total": return quantity ? `${(parseFloat(quantity) * 150.50).toFixed(2)}` : "10000";
      case "fees": return "0";
    }
  };

  const getFieldHandler = (f: Field) => {
    switch (f) {
      case "date": return handleDateSubmit;
      case "quantity": return handleQuantitySubmit;
      case "price": return handlePriceSubmit;
      case "total": return handleTotalSubmit;
      case "fees": return handleFeesSubmit;
    }
  };

  const getCadConversion = (f: Field): string | null => {
    if (stock.currency !== "USD" || !exchangeRate) return null;
    const value = getFieldValue(f);
    if (!value) return null;
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) return null;
    return formatCurrency(num * exchangeRate.rate, "CAD");
  };

  const getFieldHint = (f: Field): string | null => {
    if (f === "price" && total && field !== "price") {
      return `= ${formatCurrency(parseFloat(total), stock.currency)} total`;
    }
    if (f === "total" && price && field !== "total") {
      return `(${formatCurrency(parseFloat(price), stock.currency)}/share)`;
    }
    return null;
  };

  const renderFormField = (f: Field) => {
    const isActive = field === f;
    const isPending = fields.indexOf(f) > fields.indexOf(field);
    const value = getFieldValue(f);
    const label = getFieldLabel(f).padEnd(LABEL_WIDTH);
    const cadConversion = (f === "price" || f === "fees" || f === "total") ? getCadConversion(f) : null;
    const hint = getFieldHint(f);

    return (
      <Box key={f} flexDirection="column">
        <Box>
          <Text color={isActive ? "cyan" : "gray"}>{label}</Text>
          {isActive ? (
            <TextInput
              key={`${formKey}-${f}`}
              defaultValue={f === "total" && total ? total : undefined}
              placeholder={getFieldPlaceholder(f)}
              onSubmit={getFieldHandler(f)}
            />
          ) : isPending ? (
            <Text color="gray">—</Text>
          ) : (
            <Text>
              {value}
              {hint && <Text color="gray">{`  ${hint}`}</Text>}
              {cadConversion && !hint && (
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
              ) : tx.type === "DRIP" ? (
                <Text color="blue">DRIP</Text>
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

  const renderFormPanel = () => {
    if (splitMode) {
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} width={44}>
          <Text bold color="yellow">Stock Split</Text>
          <Box marginTop={1}>
            <Text color="cyan">{"Ratio".padEnd(LABEL_WIDTH)}</Text>
            <TextInput
              key={`split-${formKey}`}
              placeholder="2:1"
              onSubmit={handleSplitSubmit}
            />
          </Box>
          <Box marginTop={1}>
            <Text color="gray">Enter ratio (e.g. 2:1, 1:10, 3:2) or Esc to cancel</Text>
          </Box>
          {error && (
            <Box marginTop={1}>
              <Text color="red">{error}</Text>
            </Box>
          )}
        </Box>
      );
    }

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} width={44}>
        <Box>
          {MODES.map((m) => (
            <React.Fragment key={m}>
              <Text
                color={mode === m ? (m === "BUY" ? "green" : m === "SELL" ? "red" : "blue") : "gray"}
                bold={mode === m}
                inverse={mode === m}
              >
                {` ${m} `}
              </Text>
              {m !== MODES[MODES.length - 1] && <Text> </Text>}
            </React.Fragment>
          ))}
        </Box>

        <Box marginTop={1} flexDirection="column">
          {fields.map(renderFormField)}
        </Box>

        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}
      </Box>
    );
  };

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
          [Tab] Mode · [S] Split{hasDistributionData ? " · [D] Distributions" : ""} · [Esc] Exit
        </Text>
      </Box>
    </Box>
  );
}
