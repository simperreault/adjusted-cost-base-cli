import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { Select } from "@inkjs/ui";
import type { AppDatabase } from "../../db/index.ts";
import { createStockRepository } from "../../db/repositories/stockRepository.ts";
import { createTransactionRepository } from "../../db/repositories/transactionRepository.ts";
import { formatCurrency } from "../../utils/currency.ts";
import type { Stock } from "../../types/index.ts";
import type { StockRow } from "../../db/schema.ts";

interface PortfolioProps {
  db: AppDatabase;
  onStockSelect: (stock: Stock) => void;
  onNewStock: () => void;
  onQuit: () => void;
}

function toStock(row: StockRow): Stock {
  return {
    id: row.id,
    name: row.name,
    ticker: row.ticker,
    currency: row.currency as "CAD" | "USD",
    createdAt: new Date(row.createdAt),
  };
}

export function Portfolio({ db, onStockSelect, onNewStock, onQuit }: PortfolioProps) {
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const stockRepo = createStockRepository(db);
  const txRepo = createTransactionRepository(db);

  useEffect(() => {
    setStocks(stockRepo.findAll());
  }, []);

  useInput((input) => {
    if (input === "n") {
      onNewStock();
    }
    if (input === "q") {
      onQuit();
    }
  });

  const handleSelect = (ticker: string) => {
    const stock = stocks.find((s) => s.ticker === ticker);
    if (stock) {
      onStockSelect(toStock(stock));
    }
  };

  if (stocks.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No stocks tracked yet.</Text>
        <Box marginTop={1}>
          <Text color="gray">[N] Add new stock | [Q] Quit</Text>
        </Box>
      </Box>
    );
  }

  const options = stocks.map((stock) => {
    const snapshot = txRepo.getLatestSnapshot(stock.id);
    const shares = snapshot?.totalShares ?? 0;
    const acb = snapshot ? formatCurrency(snapshot.acbPerShare, "CAD") : "-";

    return {
      label: `${stock.ticker.padEnd(8)} ${stock.name.slice(0, 20).padEnd(20)} ${shares.toString().padStart(6)} shares  ACB: ${acb}`,
      value: stock.ticker,
    };
  });

  return (
    <Box flexDirection="column">
      <Text bold>Portfolio</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
          {"Ticker   Name                 Shares        ACB/Share"}
        </Text>
        <Text color="gray">{"─".repeat(55)}</Text>
      </Box>
      <Box marginTop={1}>
        <Select options={options} onChange={handleSelect} />
      </Box>
      <Box marginTop={1}>
        <Text color="gray">[N] Add new stock | [Q] Quit</Text>
      </Box>
    </Box>
  );
}
