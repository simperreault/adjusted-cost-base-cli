import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput, Select } from "@inkjs/ui";
import type { AppDatabase } from "../../db/index.ts";
import { createStockRepository } from "../../db/repositories/stockRepository.ts";
import { validateTicker } from "../../core/validation.ts";
import type { Stock, Currency } from "../../types/index.ts";

interface StockCreateProps {
  db: AppDatabase;
  onCreated: (stock: Stock) => void;
  onCancel: () => void;
}

type Field = "name" | "ticker" | "currency";

export function StockCreate({ db, onCreated, onCancel }: StockCreateProps) {
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [field, setField] = useState<Field>("name");
  const [error, setError] = useState<string | null>(null);

  const stockRepo = createStockRepository(db);

  const handleNameSubmit = (value: string) => {
    if (value.trim().length === 0) {
      setError("Name cannot be empty");
      return;
    }
    setName(value.trim());
    setError(null);
    setField("ticker");
  };

  const handleTickerSubmit = (value: string) => {
    const result = validateTicker(value);
    if (!result.success) {
      setError(result.error);
      return;
    }

    const existing = stockRepo.findByTicker(result.value);
    if (existing) {
      setError(`Stock ${result.value} already exists`);
      return;
    }

    setTicker(result.value);
    setError(null);
    setField("currency");
  };

  const handleCurrencySelect = (value: string) => {
    createStock(value as Currency);
  };

  const createStock = (curr: Currency) => {
    try {
      const stock = stockRepo.create({
        name: name,
        ticker: ticker,
        currency: curr,
      });

      onCreated({
        id: stock.id,
        name: stock.name,
        ticker: stock.ticker,
        currency: stock.currency as Currency,
        createdAt: new Date(stock.createdAt),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create stock");
    }
  };

  useInput((_, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Add New Stock</Text>

      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color={field === "name" ? "cyan" : "gray"}>Name: </Text>
          {field === "name" ? (
            <TextInput
              placeholder="e.g., Apple Inc."
              onSubmit={handleNameSubmit}
            />
          ) : (
            <Text>{name}</Text>
          )}
        </Box>

        {(field === "ticker" || field === "currency") && (
          <Box marginTop={1}>
            <Text color={field === "ticker" ? "cyan" : "gray"}>Ticker: </Text>
            {field === "ticker" ? (
              <TextInput
                placeholder="e.g., AAPL"
                onSubmit={handleTickerSubmit}
              />
            ) : (
              <Text>{ticker}</Text>
            )}
          </Box>
        )}

        {field === "currency" && (
          <Box marginTop={1} flexDirection="column">
            <Text color="cyan">Currency:</Text>
            <Select
              options={[
                { label: "CAD - Canadian Dollar", value: "CAD" },
                { label: "USD - US Dollar", value: "USD" },
              ]}
              onChange={handleCurrencySelect}
            />
            <Box marginTop={1}>
              <Text color="gray" wrap="wrap">
                Note: USD transactions use daily Bank of Canada exchange rates.
              </Text>
            </Box>
          </Box>
        )}
      </Box>

      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">[Esc] Cancel</Text>
      </Box>
    </Box>
  );
}
