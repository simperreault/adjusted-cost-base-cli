import React, { useState, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { UserSelect } from "./screens/UserSelect.tsx";
import { PasswordPrompt } from "./screens/PasswordPrompt.tsx";
import { Portfolio } from "./screens/Portfolio.tsx";
import { StockCreate } from "./screens/StockCreate.tsx";
import { StockDetail } from "./screens/StockDetail.tsx";
import { openUserDatabase, createUser } from "../services/userService.ts";
import { getExchangeRateProvider } from "../services/exchangeRate/index.ts";
import { correctEstimateTransactions } from "../services/exchangeRate/correctEstimates.ts";
import type { AppDatabase } from "../db/index.ts";
import type { Stock } from "../types/index.ts";

type Screen =
  | "user-select"
  | "password"
  | "portfolio"
  | "stock-create"
  | "stock-detail";

interface AppProps {
  initialUser?: string;
}

export function App({ initialUser }: AppProps) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>(
    initialUser ? "password" : "user-select"
  );
  const [username, setUsername] = useState<string | null>(initialUser ?? null);
  const [db, setDb] = useState<AppDatabase | null>(null);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUserSelect = useCallback(
    (user: string, needsPassword: boolean, isNew: boolean) => {
      setUsername(user);
      setError(null);

      if (isNew) {
        try {
          const database = createUser(user);
          setDb(database);
          correctEstimateTransactions(database, getExchangeRateProvider()).catch(() => {});
          setScreen("portfolio");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to create user");
        }
      } else if (needsPassword) {
        setScreen("password");
      } else {
        try {
          const database = openUserDatabase(user);
          setDb(database);
          correctEstimateTransactions(database, getExchangeRateProvider()).catch(() => {});
          setScreen("portfolio");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to open database");
        }
      }
    },
    []
  );

  const handlePasswordSubmit = useCallback(
    (password: string) => {
      if (!username) return;

      try {
        const database = openUserDatabase(username, password);
        setDb(database);
        correctEstimateTransactions(database, getExchangeRateProvider()).catch(() => {});
        setError(null);
        setScreen("portfolio");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Invalid password");
      }
    },
    [username]
  );

  const handleStockSelect = useCallback((stock: Stock) => {
    setSelectedStock(stock);
    setScreen("stock-detail");
  }, []);

  const handleBack = useCallback(() => {
    if (screen === "stock-detail" || screen === "stock-create") {
      setSelectedStock(null);
      setScreen("portfolio");
    } else if (screen === "password") {
      setUsername(null);
      setScreen("user-select");
    } else {
      exit();
    }
  }, [screen, exit]);

  const handleNewStock = useCallback(() => {
    setScreen("stock-create");
  }, []);

  const handleStockCreated = useCallback((stock: Stock) => {
    setSelectedStock(stock);
    setScreen("stock-detail");
  }, []);

  useInput((input, key) => {
    if (key.escape) {
      handleBack();
    }
    if (input === "q" && screen === "portfolio") {
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ACB CLI
        </Text>
        {username && (
          <Text color="gray"> - {username}</Text>
        )}
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {screen === "user-select" && (
        <UserSelect onSelect={handleUserSelect} />
      )}

      {screen === "password" && username && (
        <PasswordPrompt
          username={username}
          onSubmit={handlePasswordSubmit}
          onCancel={handleBack}
        />
      )}

      {screen === "portfolio" && db && (
        <Portfolio
          db={db}
          onStockSelect={handleStockSelect}
          onNewStock={handleNewStock}
          onQuit={exit}
        />
      )}

      {screen === "stock-create" && db && (
        <StockCreate
          db={db}
          onCreated={handleStockCreated}
          onCancel={handleBack}
        />
      )}

      {screen === "stock-detail" && db && selectedStock && (
        <StockDetail
          db={db}
          stock={selectedStock}
          onBack={handleBack}
        />
      )}
    </Box>
  );
}
