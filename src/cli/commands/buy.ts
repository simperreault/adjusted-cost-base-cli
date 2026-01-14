import { Command } from "commander";
import { parseInlineTransaction, validateTicker } from "../../core/validation.ts";
import { parseDate, formatDate } from "../../utils/date.ts";
import { formatCurrency } from "../../utils/currency.ts";
import { openUserDatabase } from "../../services/userService.ts";
import { createStockRepository } from "../../db/repositories/stockRepository.ts";
import { createTransactionRepository } from "../../db/repositories/transactionRepository.ts";
import { HardcodedExchangeRateProvider, EXCHANGE_RATE_WARNING } from "../../services/exchangeRate/index.ts";

export const buyCommand = new Command("buy")
  .description("Record a buy transaction")
  .requiredOption("-u, --user <username>", "User account")
  .requiredOption("-s, --stock <ticker>", "Stock ticker")
  .requiredOption("-t, --transaction <QTYxPRICE>", 'Transaction in format "2x20"')
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
        console.error(`Error: Stock "${tickerResult.value}" not found. Create it first.`);
        process.exit(1);
      }

      const exchangeProvider = new HardcodedExchangeRateProvider();
      const exchangeRate = await exchangeProvider.getRate(stock.currency, "CAD", date);

      const pricePerShareCad = txResult.value.price * exchangeRate.rate;
      const feesCad = fees * exchangeRate.rate;

      const { transaction, snapshot } = txRepo.create({
        stockId: stock.id,
        type: "BUY",
        date,
        quantity: txResult.value.quantity,
        pricePerShare: txResult.value.price,
        pricePerShareCad,
        exchangeRate: exchangeRate.rate,
        fees,
        feesCad,
      });

      console.log(`\nBuy recorded for ${stock.ticker}:`);
      console.log(`  Date: ${formatDate(date)}`);
      console.log(`  Quantity: ${txResult.value.quantity} shares`);
      console.log(`  Price: ${formatCurrency(txResult.value.price, stock.currency)}/share`);
      if (stock.currency === "USD") {
        console.log(`  Price (CAD): ${formatCurrency(pricePerShareCad, "CAD")}/share`);
      }
      if (fees > 0) {
        console.log(`  Fees: ${formatCurrency(fees, stock.currency)}`);
      }
      console.log(`\nNew ACB: ${formatCurrency(snapshot.acbPerShare, "CAD")}/share`);
      console.log(`Total shares: ${snapshot.totalShares}`);
      console.log(`Total cost: ${formatCurrency(snapshot.totalCostCad, "CAD")}`);

      if (exchangeRate.isEstimate) {
        console.log(`\n⚠️  ${EXCHANGE_RATE_WARNING}`);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });
