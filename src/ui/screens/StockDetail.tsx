import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { TextInput } from "@inkjs/ui";
import type { AppDatabase } from "../../db/index.ts";
import { createTransactionRepository } from "../../db/repositories/transactionRepository.ts";
import {
  createDistributionRepository,
  getLatestAcbState,
} from "../../db/repositories/distributionRepository.ts";
import type { Stock } from "../../types/index.ts";
import { formatCurrency } from "../../utils/currency.ts";
import { formatDate, parseDate } from "../../utils/date.ts";
import { validatePrice, validateQuantity } from "../../core/validation.ts";
import {
  HardcodedExchangeRateProvider,
  EXCHANGE_RATE_WARNING,
} from "../../services/exchangeRate/index.ts";
import type { TransactionRow, StockSnapshotRow, DistributionRow } from "../../db/schema.ts";
import { isSupportedTicker } from "../../../data/distributions/index.ts";

interface StockDetailProps {
  db: AppDatabase;
  stock: Stock;
  onBack: () => void;
}

type TransactionMode = "BUY" | "SELL" | "DIST";
type Field = "date" | "quantity" | "price" | "fees" | "roc" | "phantom";

const TX_FIELDS: Field[] = ["date", "quantity", "price", "fees"];
const DIST_FIELDS: Field[] = ["date", "roc", "phantom"];
const LABEL_WIDTH = 12;

export function StockDetail({ db, stock, onBack }: StockDetailProps) {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;
  const terminalHeight = stdout?.rows ?? 24;
  const isWideTerminal = terminalWidth >= 80;

  const [mode, setMode] = useState<TransactionMode>("BUY");
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [distributions, setDistributions] = useState<DistributionRow[]>([]);
  const [snapshot, setSnapshot] = useState<StockSnapshotRow | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Form state
  const [date, setDate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fees, setFees] = useState("");
  const [roc, setRoc] = useState("");
  const [phantom, setPhantom] = useState("");
  const [field, setField] = useState<Field>("date");
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  const txRepo = createTransactionRepository(db);
  const distRepo = createDistributionRepository(db);

  const activeFields = mode === "DIST" ? DIST_FIELDS : TX_FIELDS;

  const refreshData = () => {
    const recent = txRepo.findRecent(stock.id, 50);
    // Reverse to show oldest first, newest at bottom
    setTransactions([...recent].reverse());
    setDistributions(distRepo.findByStockId(stock.id));
    const acbState = getLatestAcbState(db, stock.id);
    const txSnapshot = txRepo.getLatestSnapshot(stock.id) ?? null;
    // Use txSnapshot for display but with ACB from unified state
    if (txSnapshot) {
      setSnapshot({
        ...txSnapshot,
        totalCostCad: acbState.totalCostCad,
        acbPerShare: acbState.acbPerShare,
        totalShares: acbState.totalShares,
      });
    } else if (acbState.totalShares > 0) {
      setSnapshot({
        id: 0,
        stockId: stock.id,
        transactionId: 0,
        totalShares: acbState.totalShares,
        totalCostCad: acbState.totalCostCad,
        acbPerShare: acbState.acbPerShare,
        realizedGainCad: null,
        calculatedAt: new Date(),
      });
    } else {
      setSnapshot(null);
    }

    // Combine transactions and distributions for scroll count
    const totalEntries = recent.length + distRepo.findByStockId(stock.id).length;
    setScrollOffset(Math.max(0, totalEntries - getVisibleRowCount()));
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

    // Tab without shift: cycle BUY -> SELL -> DIST
    if (key.tab && !key.shift) {
      setMode((m) => {
        if (m === "BUY") return "SELL";
        if (m === "SELL") return "DIST";
        return "BUY";
      });
      resetForm();
      return;
    }

    // Shift+Tab: go back to previous field
    if (key.tab && key.shift) {
      const currentIndex = activeFields.indexOf(field);
      if (currentIndex > 0) {
        const prevField = activeFields[currentIndex - 1];
        if (prevField) {
          setField(prevField);
          setError(null);
        }
      }
      return;
    }

    // [S] key: sync bundled distributions (only when on date field to avoid capturing text input)
    if (input === "s" && field === "date" && date === "" && isSupportedTicker(stock.ticker)) {
      const { applied, skipped } = distRepo.applyBundledDistributions(stock.id, stock.ticker);
      if (applied > 0) {
        setSyncMessage(`Synced ${applied} distribution(s)${skipped > 0 ? `, ${skipped} skipped` : ""}`);
        refreshData();
      } else {
        setSyncMessage("All distributions already applied");
      }
      setTimeout(() => setSyncMessage(null), 3000);
      return;
    }

    // Arrow keys for scrolling
    if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
    }
    if (key.downArrow) {
      const totalEntries = transactions.length + distributions.length;
      const maxOffset = Math.max(0, totalEntries - getVisibleRowCount());
      setScrollOffset((o) => Math.min(maxOffset, o + 1));
    }
  });

  const resetForm = () => {
    setDate("");
    setQuantity("");
    setPrice("");
    setFees("");
    setRoc("");
    setPhantom("");
    setField("date");
    setError(null);
    setFormKey((k) => k + 1);
  };

  const handleDateSubmit = (value: string) => {
    const dateValue = value.trim() === "" ? "today" : value;
    const parsed = parseDate(dateValue);
    if (!parsed) {
      setError("Invalid date. Try: YYYY-MM-DD, DD/MM/YYYY, or 'today'");
      return;
    }
    setDate(formatDate(parsed));
    setError(null);
    // Next field depends on mode
    setField(mode === "DIST" ? "roc" : "quantity");
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

  const handleRocSubmit = (value: string) => {
    const rocValue = value.trim() === "" ? "0" : value;
    const result = validatePrice(rocValue);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setRoc(rocValue);
    setError(null);
    setField("phantom");
  };

  const handlePhantomSubmit = async (value: string) => {
    const phantomValue = value.trim() === "" ? "0" : value;
    const phantomResult = validatePrice(phantomValue);
    if (!phantomResult.success) {
      setError(phantomResult.error);
      return;
    }

    const rocValue = roc.trim() === "" ? 0 : Number(roc);
    const phantomNum = Number(phantomValue);

    if (rocValue === 0 && phantomNum === 0) {
      setError("At least one of ROC or phantom must be non-zero");
      return;
    }

    const dateResult = parseDate(date);
    if (!dateResult) {
      setError("Invalid form data");
      return;
    }

    try {
      const existing = distRepo.findByRecordDate(stock.id, dateResult);
      if (existing) {
        setError(`Distribution already exists for ${formatDate(dateResult)}`);
        return;
      }

      distRepo.create({
        stockId: stock.id,
        recordDate: dateResult,
        rocPerUnit: rocValue,
        phantomDistPerUnit: phantomNum,
        source: "manual",
      });

      resetForm();
      refreshData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create distribution");
    }
  };

  const getFieldValue = (f: Field): string => {
    switch (f) {
      case "date": return date;
      case "quantity": return quantity;
      case "price": return price;
      case "fees": return fees;
      case "roc": return roc;
      case "phantom": return phantom;
    }
  };

  const getFieldLabel = (f: Field): string => {
    switch (f) {
      case "date": return mode === "DIST" ? "Record Date" : "Date";
      case "quantity": return "Quantity";
      case "price": return `Price (${stock.currency})`;
      case "fees": return `Fees (${stock.currency})`;
      case "roc": return "ROC/unit";
      case "phantom": return "Phantom/unit";
    }
  };

  const getFieldPlaceholder = (f: Field): string => {
    switch (f) {
      case "date": return "today";
      case "quantity": return "100";
      case "price": return "150.50";
      case "fees": return "0";
      case "roc": return "0";
      case "phantom": return "0";
    }
  };

  const getFieldHandler = (f: Field) => {
    switch (f) {
      case "date": return handleDateSubmit;
      case "quantity": return handleQuantitySubmit;
      case "price": return handlePriceSubmit;
      case "fees": return handleFeesSubmit;
      case "roc": return handleRocSubmit;
      case "phantom": return handlePhantomSubmit;
    }
  };

  const renderFormField = (f: Field) => {
    const isActive = field === f;
    const isPending = activeFields.indexOf(f) > activeFields.indexOf(field);
    const value = getFieldValue(f);
    const label = getFieldLabel(f).padEnd(LABEL_WIDTH);

    return (
      <Box key={f}>
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
          <Text>{value}</Text>
        )}
      </Box>
    );
  };

  // Merge transactions and distributions into a unified timeline
  type TimelineEntry =
    | { kind: "tx"; date: Date; data: TransactionRow }
    | { kind: "dist"; date: Date; data: DistributionRow };

  const timeline: TimelineEntry[] = [
    ...transactions.map((tx): TimelineEntry => ({
      kind: "tx",
      date: new Date(tx.date),
      data: tx,
    })),
    ...distributions.map((d): TimelineEntry => ({
      kind: "dist",
      date: new Date(d.recordDate),
      data: d,
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  const visibleRows = getVisibleRowCount();
  const visibleEntries = timeline.slice(scrollOffset, scrollOffset + visibleRows);
  const hasScrollUp = scrollOffset > 0;
  const hasScrollDown = scrollOffset + visibleRows < timeline.length;

  const renderTransactionsPanel = () => (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>History</Text>
      <Text color="gray">{"─".repeat(28)}</Text>

      {timeline.length === 0 ? (
        <Text color="gray">No transactions yet</Text>
      ) : (
        <>
          {hasScrollUp && <Text color="gray">  ↑ more</Text>}
          {visibleEntries.map((entry) => {
            if (entry.kind === "tx") {
              const tx = entry.data;
              return (
                <Text key={`tx-${tx.id}`}>
                  <Text color="gray">{formatDate(entry.date)} </Text>
                  {tx.type === "BUY" ? (
                    <Text color="green">BUY </Text>
                  ) : (
                    <Text color="red">SELL</Text>
                  )}
                  <Text> {tx.quantity.toString().padStart(4)} </Text>
                  <Text>{formatCurrency(tx.pricePerShare, stock.currency)}</Text>
                </Text>
              );
            } else {
              const dist = entry.data;
              const parts: string[] = [];
              if (dist.rocPerUnit > 0) parts.push(`R:${dist.rocPerUnit.toFixed(4)}`);
              if (dist.phantomDistPerUnit > 0) parts.push(`P:${dist.phantomDistPerUnit.toFixed(4)}`);
              return (
                <Text key={`dist-${dist.id}`}>
                  <Text color="gray">{formatDate(entry.date)} </Text>
                  <Text color="magenta">DIST</Text>
                  <Text> {parts.join(" ")}</Text>
                </Text>
              );
            }
          })}
          {hasScrollDown && <Text color="gray">  ↓ more</Text>}
        </>
      )}

      {timeline.length > visibleRows && (
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
        <Text> </Text>
        <Text
          color={mode === "DIST" ? "magenta" : "gray"}
          bold={mode === "DIST"}
          inverse={mode === "DIST"}
        >
          {" DIST "}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {activeFields.map(renderFormField)}
      </Box>

      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      {syncMessage && (
        <Box marginTop={1}>
          <Text color="green">{syncMessage}</Text>
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
          <Text color="yellow" wrap="wrap">
            {EXCHANGE_RATE_WARNING}
          </Text>
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

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray">
          [Tab] Mode · [Shift+Tab] Back · [Enter] Next · [Esc] Exit
          {isSupportedTicker(stock.ticker) ? " · [S] Sync distributions" : ""}
        </Text>
      </Box>
    </Box>
  );
}
