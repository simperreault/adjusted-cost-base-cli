import { Command } from "commander";
import { parseInlineTransaction, validateTicker } from "../../core/validation.ts";
import { parseDate, formatDate } from "../../utils/date.ts";
import { formatCurrency } from "../../utils/currency.ts";
import { openUserDatabase } from "../../services/userService.ts";
import { createStockRepository } from "../../db/repositories/stockRepository.ts";
import { createTransactionRepository } from "../../db/repositories/transactionRepository.ts";
import { getExchangeRateProvider } from "../../services/exchangeRate/index.ts";

export const sellCommand = new Command("sell")
  .description("Record a sell transaction")
  .requiredOption("-u, --user <username>", "User account")
  .requiredOption("-s, --stock <ticker>", "Stock ticker")
  .requiredOption("-t, --transaction <QTYxPRICE>", 'Transaction in format "5x25"')
  .option("-d, --date <date>", "Transaction date (YYYY-MM-DD or 'today')", "today")
  .option("-f, --fees <amount>", "Transaction fees", "0")
  .option("-p, --password <password>", "Database password")
  .action(async (options) => {
    try {
      const tickerResult = validateTicker(options.stock);
      if (!tickerResult.success) {
        console.error(`Error: ${tickerResult.error}`);
        process.exit(1);
      }

      const txResult = parseInlineTransaction(options.transaction);
      if (!txResult.success) {
        console.error(`Error: ${txResult.error}`);
        process.exit(1);
      }

      const date = parseDate(options.date);
      if (!date) {
        console.error("Error: Invalid date format. Use YYYY-MM-DD or 'today'");
        process.exit(1);
      }

      const fees = Number(options.fees);
      if (isNaN(fees) || fees < 0) {
        console.error("Error: Fees must be a non-negative number");
        process.exit(1);
      }

      const db = openUserDatabase(options.user, options.password);
      const stockRepo = createStockRepository(db);
      const txRepo = createTransactionRepository(db);

      const stock = stockRepo.findByTicker(tickerResult.value);
      if (!stock) {
        console.error(`Error: Stock "${tickerResult.value}" not found.`);
        process.exit(1);
      }

      const currentSnapshot = txRepo.getLatestSnapshot(stock.id);
      if (!currentSnapshot || currentSnapshot.totalShares < txResult.value.quantity) {
        const available = currentSnapshot?.totalShares ?? 0;
        console.error(
          `Error: Cannot sell ${txResult.value.quantity} shares. Only ${available} available.`
        );
        process.exit(1);
      }

      const exchangeRate = await getExchangeRateProvider().getRate(stock.currency, "CAD", date);

      const pricePerShareCad = txResult.value.price * exchangeRate.rate;
      const feesCad = fees * exchangeRate.rate;

      const { transaction, snapshot } = txRepo.create({
        stockId: stock.id,
        type: "SELL",
        date,
        quantity: txResult.value.quantity,
        pricePerShare: txResult.value.price,
        pricePerShareCad,
        exchangeRate: exchangeRate.rate,
        fees,
        feesCad,
        exchangeRateIsEstimate: exchangeRate.isEstimate,
      });

      const capitalGain = snapshot.realizedGainCad ?? 0;
      const gainLabel = capitalGain >= 0 ? "Capital Gain" : "Capital Loss";

      console.log(`\nSell recorded for ${stock.ticker}:`);
      console.log(`  Date: ${formatDate(date)}`);
      console.log(`  Quantity: ${txResult.value.quantity} shares`);
      console.log(`  Price: ${formatCurrency(txResult.value.price, stock.currency)}/share`);
      if (stock.currency === "USD") {
        console.log(`  Price (CAD): ${formatCurrency(pricePerShareCad, "CAD")}/share`);
      }
      if (fees > 0) {
        console.log(`  Fees: ${formatCurrency(fees, stock.currency)}`);
      }
      console.log(`\n${gainLabel}: ${formatCurrency(Math.abs(capitalGain), "CAD")}`);
      console.log(`\nRemaining shares: ${snapshot.totalShares}`);
      if (snapshot.totalShares > 0) {
        console.log(`ACB: ${formatCurrency(snapshot.acbPerShare, "CAD")}/share`);
        console.log(`Total cost: ${formatCurrency(snapshot.totalCostCad, "CAD")}`);
      }

      if (exchangeRate.isEstimate) {
        console.log(
          `\n⚠️  Exchange rate is an estimate (rate not yet published for this date). It will be auto-corrected on next use.`
        );
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });
