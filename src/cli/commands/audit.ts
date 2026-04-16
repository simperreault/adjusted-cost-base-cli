import { Command } from "commander";
import { validateTicker } from "../../core/validation.ts";
import { openUserDatabase } from "../../services/userService.ts";
import { createStockRepository } from "../../db/repositories/stockRepository.ts";
import { createTransactionRepository } from "../../db/repositories/transactionRepository.ts";
import { generateAuditReport, formatAuditReport } from "../../core/audit.ts";
import type { AuditTransaction } from "../../core/audit.ts";

export const auditCommand = new Command("audit")
  .description("Show step-by-step ACB calculation audit trail")
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
      const txRepo = createTransactionRepository(db);

      const stock = stockRepo.findByTicker(tickerResult.value);
      if (!stock) {
        console.error(`Error: Stock "${tickerResult.value}" not found.`);
        process.exit(1);
      }

      const allTransactions = txRepo.findByStockId(stock.id);

      if (allTransactions.length === 0) {
        console.log(`No transactions found for ${stock.ticker}.`);
        return;
      }

      // findByStockId returns desc order; reverse for chronological
      const chronological = [...allTransactions].reverse();

      const auditTransactions: AuditTransaction[] = chronological.map((tx) => ({
        type: tx.type as "BUY" | "SELL" | "DRIP",
        date: new Date(tx.date),
        quantity: tx.quantity,
        pricePerShareCad: tx.pricePerShareCad,
        feesCad: tx.feesCad,
      }));

      const report = generateAuditReport(auditTransactions);

      console.log(`\nAudit trail for ${stock.name} (${stock.ticker})\n`);
      console.log(formatAuditReport(report));
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });
