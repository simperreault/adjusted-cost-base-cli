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

type TransactionMode = "BUY" | "SELL" | "DRIP" | "SPLIT";
type Field = "date" | "quantity" | "price" | "total" | "fees" | "ratio";

const LABEL_WIDTH = 14;
const MODES: TransactionMode[] = ["BUY", "SELL", "DRIP", "SPLIT"];

const MODE_COLORS: Record<TransactionMode, string> = {
  BUY: "green",
  SELL: "red",
  DRIP: "blue",
  SPLIT: "yellow",
};

function getFields(mode: TransactionMode): Field[] {
  if (mode === "SPLIT") return ["date", "ratio"];
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
  const [ratio, setRatio] = useState("");
  const [field, setField] = useState<Field>("date");
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  // Exchange rate state (fetched after date is entered for USD stocks)
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);

  // Status message (distributions sync, split confirmation, etc.)
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const hasDistributionData = isSupportedTicker(stock.ticker);

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
      onBack();
      return;
    }

    if (key.tab && !key.shift) {
      const idx = MODES.indexOf(mode);
      const nextMode = MODES[(idx + 1) % MODES.length]!;
      setMode(nextMode);
      setField("date");
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

    if (input === "d" && hasDistributionData && field === "date" && mode !== "SPLIT") {
      try {
        const { applied, updated, skipped } = distRepo.applyBundledDistributions(stock.id, stock.ticker);
        const parts = [];
        if (applied > 0) parts.push(`${applied} applied`);
        if (updated > 0) parts.push(`${updated} updated`);
        if (skipped > 0) parts.push(`${skipped} unchanged`);
        setStatusMessage(`Distributions synced: ${parts.join(", ")}`);
        refreshData();
      } catch (e) {
        setStatusMessage(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
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

  const resetForm = () => {
    setDate("");
    setQuantity("");
    setPrice("");
    setTotal("");
    setFees("");
    setRatio("");
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

    // Fetch exchange rate for USD stocks (not needed for splits)
    if (stock.currency === "USD" && mode !== "SPLIT") {
      try {
        const rate = await getExchangeRateProvider().getRate("USD", "CAD", parsed);
        setExchangeRate(rate);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch exchange rate");
        return;
      }
    }

    // Advance to next field based on mode
    const nextField = fields[fields.indexOf("date") + 1];
    if (nextField) setField(nextField);
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
    if (mode === "DRIP") {
      submitTransaction(result.value, 0);
    } else {
      setField("total");
    }
  };

  const handleTotalSubmit = (value: string) => {
    if (value.trim() === "" && price) {
      if (mode === "DRIP") {
        submitTransaction(parseFloat(price), 0);
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

  const parseSplitRatio = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const colonMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
    if (colonMatch) {
      const numerator = parseFloat(colonMatch[1]!);
      const denominator = parseFloat(colonMatch[2]!);
      if (denominator === 0) return null;
      return numerator / denominator;
    }

    const num = parseFloat(trimmed);
    if (isNaN(num) || num <= 0) return null;
    return num;
  };

  const handleRatioSubmit = (value: string) => {
    const splitRatio = parseSplitRatio(value);
    if (splitRatio === null) {
      setError("Enter a ratio like 2:1, 1:10, or 3:2");
      return;
    }

    const currentState = resolveAcbState(db, stock.id);
    if (currentState.totalShares <= 0) {
      setError("No shares to split");
      return;
    }

    const dateResult = parseDate(date);
    if (!dateResult) {
      setError("Invalid date");
      return;
    }

    try {
      splitRepo.create({
        stockId: stock.id,
        date: dateResult,
        ratio: splitRatio,
        notes: `${value.trim()} split`,
      });

      const newState = resolveAcbState(db, stock.id);
      setStatusMessage(
        `Split recorded: ${currentState.totalShares} → ${newState.totalShares} shares, ` +
        `ACB ${formatCurrency(currentState.acbPerShare, "CAD")} → ${formatCurrency(newState.acbPerShare, "CAD")}/share`
      );
      resetForm();
      refreshData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record split");
    }
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
        type: mode as "BUY" | "SELL" | "DRIP",
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
      case "ratio": return ratio;
    }
  };

  const getFieldLabel = (f: Field): string => {
    switch (f) {
      case "date": return "Date";
      case "quantity": return "Quantity";
      case "price": return `Price (${stock.currency})`;
      case "total": return `Total (${stock.currency})`;
      case "fees": return `Fees (${stock.currency})`;
      case "ratio": return "Ratio";
    }
  };

  const getFieldPlaceholder = (f: Field): string => {
    switch (f) {
      case "date": return "today";
      case "quantity": return "100";
      case "price": return mode === "DRIP" ? "or Enter for total" : "150.50";
      case "total": return quantity ? `${(parseFloat(quantity) * 150.50).toFixed(2)}` : "10000";
      case "fees": return "0";
      case "ratio": return "2:1";
    }
  };

  const getFieldHandler = (f: Field) => {
    switch (f) {
      case "date": return handleDateSubmit;
      case "quantity": return handleQuantitySubmit;
      case "price": return handlePriceSubmit;
      case "total": return handleTotalSubmit;
      case "fees": return handleFeesSubmit;
      case "ratio": return handleRatioSubmit;
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
        {f === "date" && exchangeRate && !isPending && mode !== "SPLIT" && (
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

  const renderFormPanel = () => (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} width={44}>
      <Box>
        {MODES.map((m) => (
          <React.Fragment key={m}>
            <Text
              color={mode === m ? MODE_COLORS[m] : "gray"}
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

      {/* Status message */}
      {statusMessage && (
        <Box marginTop={1}>
          <Text color="yellow">{statusMessage}</Text>
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray">
          [Tab] Mode{hasDistributionData ? " · [D] Distributions" : ""} · [Esc] Exit
        </Text>
      </Box>
    </Box>
  );
}
