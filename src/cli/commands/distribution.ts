import { Command } from "commander";
import { validateTicker } from "../../core/validation.ts";
import { parseDate, formatDate } from "../../utils/date.ts";
import { formatCurrency } from "../../utils/currency.ts";
import { openUserDatabase } from "../../services/userService.ts";
import { createStockRepository } from "../../db/repositories/stockRepository.ts";
import { createDistributionRepository } from "../../db/repositories/distributionRepository.ts";
import { resolveAcbState } from "../../db/repositories/acbStateResolver.ts";
import { isSupportedTicker, getBundledDistributions } from "../../../data/distributions/index.ts";

const addCommand = new Command("add")
  .description("Record a manual distribution event")
  .requiredOption("-u, --user <username>", "User account")
  .requiredOption("-s, --stock <ticker>", "Stock ticker")
  .requiredOption("-d, --date <date>", "Record date (YYYY-MM-DD)")
  .option("--roc <amount>", "Return of capital per unit", "0")
  .option("--phantom <amount>", "Phantom distribution (reinvested capital gain) per unit", "0")
  .option("--notes <text>", "Optional notes")
  .option("-p, --password <password>", "Database password")
  .action((options) => {
    try {
      const tickerResult = validateTicker(options.stock);
      if (!tickerResult.success) {
        console.error(`Error: ${tickerResult.error}`);
        process.exit(1);
      }

      const date = parseDate(options.date);
      if (!date) {
        console.error("Error: Invalid date format. Use YYYY-MM-DD");
        process.exit(1);
      }

      const rocPerUnit = Number(options.roc);
      if (isNaN(rocPerUnit) || rocPerUnit < 0) {
        console.error("Error: ROC must be a non-negative number");
        process.exit(1);
      }

      const phantomDistPerUnit = Number(options.phantom);
      if (isNaN(phantomDistPerUnit) || phantomDistPerUnit < 0) {
        console.error("Error: Phantom distribution must be a non-negative number");
        process.exit(1);
      }

      if (rocPerUnit === 0 && phantomDistPerUnit === 0) {
        console.error("Error: At least one of --roc or --phantom must be non-zero");
        process.exit(1);
      }

      const db = openUserDatabase(options.user, options.password);
      const stockRepo = createStockRepository(db);
      const distRepo = createDistributionRepository(db);

      const stock = stockRepo.findByTicker(tickerResult.value);
      if (!stock) {
        console.error(`Error: Stock "${tickerResult.value}" not found. Create it first.`);
        process.exit(1);
      }

      const state = resolveAcbState(db, stock.id);
      if (state.totalShares === 0) {
        console.warn(`Warning: ${stock.ticker} has 0 shares. Distribution will have no effect on ACB.`);
      }

      const existing = distRepo.findByRecordDate(stock.id, date);
      if (existing) {
        console.error(`Error: A distribution already exists for ${stock.ticker} on ${formatDate(date)}`);
        process.exit(1);
      }

      const { snapshot } = distRepo.create({
        stockId: stock.id,
        recordDate: date,
        rocPerUnit,
        phantomDistPerUnit,
        source: "manual",
        notes: options.notes,
      });

      console.log(`\nDistribution recorded for ${stock.ticker}:`);
      console.log(`  Record date: ${formatDate(date)}`);
      if (rocPerUnit > 0) {
        console.log(`  ROC per unit: ${formatCurrency(rocPerUnit, "CAD")}`);
        console.log(`  ROC applied: ${formatCurrency(snapshot.rocAppliedCad, "CAD")}`);
      }
      if (phantomDistPerUnit > 0) {
        console.log(`  Phantom dist per unit: ${formatCurrency(phantomDistPerUnit, "CAD")}`);
        console.log(`  Phantom applied: ${formatCurrency(snapshot.phantomAppliedCad, "CAD")}`);
      }
      if (snapshot.deemedCapitalGainCad !== null) {
        console.log(`  Deemed capital gain: ${formatCurrency(snapshot.deemedCapitalGainCad, "CAD")}`);
      }
      console.log(`\nNew ACB: ${formatCurrency(snapshot.acbPerShare, "CAD")}/share`);
      console.log(`Total shares: ${snapshot.totalShares}`);
      console.log(`Total cost: ${formatCurrency(snapshot.totalCostCad, "CAD")}`);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

const syncCommand = new Command("sync")
  .description("Apply bundled distribution data for a supported ETF")
  .requiredOption("-u, --user <username>", "User account")
  .requiredOption("-s, --stock <ticker>", "Stock ticker")
  .option("--dry-run", "Show what would be applied without applying")
  .option("-p, --password <password>", "Database password")
  .action((options) => {
    try {
      const tickerResult = validateTicker(options.stock);
      if (!tickerResult.success) {
        console.error(`Error: ${tickerResult.error}`);
        process.exit(1);
      }

      const ticker = tickerResult.value;
      if (!isSupportedTicker(ticker)) {
        console.error(`Error: No bundled distribution data for "${ticker}".`);
        console.error("Supported tickers: XEQT, XGRO, XBAL, VEQT, VGRO, VBAL");
        process.exit(1);
      }

      const db = openUserDatabase(options.user, options.password);
      const stockRepo = createStockRepository(db);
      const distRepo = createDistributionRepository(db);

      const stock = stockRepo.findByTicker(ticker);
      if (!stock) {
        console.error(`Error: Stock "${ticker}" not found. Create it first.`);
        process.exit(1);
      }

      if (options.dryRun) {
        const bundled = getBundledDistributions(ticker);
        if (!bundled) return;

        console.log(`\nDry run: distributions for ${ticker} (${bundled.provider}):`);
        for (const dist of bundled.distributions) {
          const existing = distRepo.findByRecordDate(stock.id, new Date(dist.recordDate));
          const status = existing ? "[skip - exists]" : "[would apply]";
          const parts = [];
          if (dist.rocPerUnit > 0) parts.push(`ROC: $${dist.rocPerUnit}`);
          if (dist.phantomDistPerUnit > 0) parts.push(`phantom: $${dist.phantomDistPerUnit}`);
          console.log(`  ${dist.recordDate} ${parts.join(", ")} ${status}`);
        }
        return;
      }

      const { applied, skipped } = distRepo.applyBundledDistributions(stock.id, ticker);
      console.log(`\nSync complete for ${ticker}:`);
      console.log(`  Applied: ${applied} distribution(s)`);
      if (skipped > 0) {
        console.log(`  Skipped: ${skipped} (already exist)`);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

const listDistCommand = new Command("list")
  .description("List distributions for a stock")
  .requiredOption("-u, --user <username>", "User account")
  .requiredOption("-s, --stock <ticker>", "Stock ticker")
  .option("-p, --password <password>", "Database password")
  .action((options) => {
    try {
      const tickerResult = validateTicker(options.stock);
      if (!tickerResult.success) {
        console.error(`Error: ${tickerResult.error}`);
        process.exit(1);
      }

      const db = openUserDatabase(options.user, options.password);
      const stockRepo = createStockRepository(db);
      const distRepo = createDistributionRepository(db);

      const stock = stockRepo.findByTicker(tickerResult.value);
      if (!stock) {
        console.error(`Error: Stock "${tickerResult.value}" not found.`);
        process.exit(1);
      }

      const distributions = distRepo.findByStockId(stock.id);

      if (distributions.length === 0) {
        console.log(`\nNo distributions recorded for ${stock.ticker}.`);
        if (isSupportedTicker(stock.ticker)) {
          console.log(`Tip: Run 'distribution sync -u ${options.user} -s ${stock.ticker}' to apply bundled data.`);
        }
        return;
      }

      console.log(`\nDistributions for ${stock.ticker} (${distributions.length} total):\n`);
      console.log("  Date        ROC/unit  Phantom/unit  Source");
      console.log("  ----------  --------  ------------  ------");

      for (const dist of distributions) {
        const date = formatDate(dist.recordDate);
        const roc = dist.rocPerUnit.toFixed(6).padStart(8);
        const phantom = dist.phantomDistPerUnit.toFixed(6).padStart(12);
        console.log(`  ${date}  ${roc}  ${phantom}  ${dist.source}`);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

export const distributionCommand = new Command("distribution")
  .description("Manage distribution events (ROC, phantom distributions)")
  .addCommand(addCommand)
  .addCommand(syncCommand)
  .addCommand(listDistCommand);
