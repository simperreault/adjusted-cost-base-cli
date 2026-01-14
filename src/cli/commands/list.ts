import { Command } from "commander";
import { validateTicker } from "../../core/validation.ts";
import { formatDate } from "../../utils/date.ts";
import { formatCurrency } from "../../utils/currency.ts";
import { openUserDatabase, listUsers, userExists } from "../../services/userService.ts";
import { createStockRepository } from "../../db/repositories/stockRepository.ts";
import { createTransactionRepository } from "../../db/repositories/transactionRepository.ts";

export const listCommand = new Command("list")
  .description("List portfolio or transactions")
  .requiredOption("-u, --user <username>", "User account")
  .option("-s, --stock <ticker>", "Show transactions for specific stock")
  .option("-p, --password <password>", "Database password")
  .option("-n, --limit <count>", "Number of transactions to show", "10")
  .action((options) => {
    try {
      if (!userExists(options.user)) {
        console.error(`Error: User "${options.user}" not found.`);
        console.log("\nAvailable users:");
        const users = listUsers();
        if (users.length === 0) {
          console.log("  (no users created yet)");
        } else {
          users.forEach((u) => console.log(`  - ${u}`));
        }
        process.exit(1);
      }

      const db = openUserDatabase(options.user, options.password);
      const stockRepo = createStockRepository(db);
      const txRepo = createTransactionRepository(db);

      if (options.stock) {
        const tickerResult = validateTicker(options.stock);
        if (!tickerResult.success) {
          console.error(`Error: ${tickerResult.error}`);
          process.exit(1);
        }

        const stock = stockRepo.findByTicker(tickerResult.value);
        if (!stock) {
          console.error(`Error: Stock "${tickerResult.value}" not found.`);
          process.exit(1);
        }

        const limit = parseInt(options.limit, 10) || 10;
        const transactions = txRepo.findRecent(stock.id, limit);
        const snapshot = txRepo.getLatestSnapshot(stock.id);

        console.log(`\n${stock.name} (${stock.ticker}) - ${stock.currency}`);
        console.log("─".repeat(50));

        if (snapshot) {
          console.log(`Shares: ${snapshot.totalShares}`);
          console.log(`ACB: ${formatCurrency(snapshot.acbPerShare, "CAD")}/share`);
          console.log(`Total Cost: ${formatCurrency(snapshot.totalCostCad, "CAD")}`);

          const totalGains = txRepo.getTotalRealizedGains(stock.id);
          if (totalGains !== 0) {
            const label = totalGains >= 0 ? "Total Realized Gains" : "Total Realized Losses";
            console.log(`${label}: ${formatCurrency(Math.abs(totalGains), "CAD")}`);
          }
        } else {
          console.log("No transactions yet");
        }

        if (transactions.length > 0) {
          console.log(`\nRecent Transactions (last ${transactions.length}):`);
          console.log("─".repeat(50));
          console.log("Date       | Type | Qty    | Price      | Fees");
          console.log("─".repeat(50));

          for (const tx of transactions) {
            const date = formatDate(new Date(tx.date));
            const type = tx.type.padEnd(4);
            const qty = tx.quantity.toString().padStart(6);
            const price = formatCurrency(tx.pricePerShare, stock.currency).padStart(10);
            const fees = tx.fees > 0 ? formatCurrency(tx.fees, stock.currency) : "-";
            console.log(`${date} | ${type} | ${qty} | ${price} | ${fees}`);
          }
        }
      } else {
        const stocks = stockRepo.findAll();

        console.log(`\nPortfolio for ${options.user}`);
        console.log("─".repeat(60));

        if (stocks.length === 0) {
          console.log("No stocks tracked yet.");
          console.log("\nUse the interactive mode to add stocks, or create stocks first.");
        } else {
          console.log("Ticker | Name                 | Currency | Shares | ACB/Share");
          console.log("─".repeat(60));

          for (const stock of stocks) {
            const snapshot = txRepo.getLatestSnapshot(stock.id);
            const ticker = stock.ticker.padEnd(6);
            const name = stock.name.slice(0, 20).padEnd(20);
            const currency = stock.currency.padEnd(8);
            const shares = (snapshot?.totalShares ?? 0).toString().padStart(6);
            const acb = snapshot
              ? formatCurrency(snapshot.acbPerShare, "CAD")
              : "-";

            console.log(`${ticker} | ${name} | ${currency} | ${shares} | ${acb}`);
          }
        }
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });
