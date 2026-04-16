import { eq, desc, and } from "drizzle-orm";
import type { AppDatabase } from "../index.ts";
import {
  distributions,
  distributionSnapshots,
  type DistributionRow,
  type DistributionSnapshotRow,
} from "../schema.ts";
import { calculateAcbAfterDistribution } from "../../core/acb.ts";
import { getBundledDistributions } from "../../../data/distributions/index.ts";
import { resolveAcbState } from "./acbStateResolver.ts";

export interface CreateDistributionInput {
  stockId: number;
  recordDate: Date;
  rocPerUnit: number;
  phantomDistPerUnit: number;
  source: "manual" | "bundled" | "synced";
  notes?: string;
}

export interface DistributionWithSnapshot {
  distribution: DistributionRow;
  snapshot: DistributionSnapshotRow;
}

export function createDistributionRepository(db: AppDatabase) {
  return {
    create(data: CreateDistributionInput): DistributionWithSnapshot {
      // Replay full event history for correct pre-distribution state
      const currentState = resolveAcbState(db, data.stockId);

      const result = calculateAcbAfterDistribution(currentState, {
        rocPerUnit: data.rocPerUnit,
        phantomDistPerUnit: data.phantomDistPerUnit,
      });

      const distribution = db
        .insert(distributions)
        .values({
          stockId: data.stockId,
          recordDate: data.recordDate,
          rocPerUnit: data.rocPerUnit,
          phantomDistPerUnit: data.phantomDistPerUnit,
          source: data.source,
          notes: data.notes ?? null,
          createdAt: new Date(),
        })
        .returning()
        .get();

      const snapshot = db
        .insert(distributionSnapshots)
        .values({
          stockId: data.stockId,
          distributionId: distribution.id,
          totalShares: result.newState.totalShares,
          totalCostCad: result.newState.totalCostCad,
          acbPerShare: result.newState.acbPerShare,
          rocAppliedCad: result.rocAppliedCad,
          phantomAppliedCad: result.phantomAppliedCad,
          deemedCapitalGainCad: result.deemedCapitalGainCad,
          calculatedAt: new Date(),
        })
        .returning()
        .get();

      // Dual-path verification: replay full history (transactions + distributions)
      const replayState = resolveAcbState(db, data.stockId);

      const TOLERANCE = 0.01;
      if (
        Math.abs(replayState.totalShares - snapshot.totalShares) > TOLERANCE ||
        Math.abs(replayState.totalCostCad - snapshot.totalCostCad) > TOLERANCE ||
        Math.abs(replayState.acbPerShare - snapshot.acbPerShare) > TOLERANCE
      ) {
        throw new Error(
          `ACB verification failed after distribution: incremental and replay paths disagree. ` +
          `Snapshot: ${JSON.stringify({ totalShares: snapshot.totalShares, totalCostCad: snapshot.totalCostCad, acbPerShare: snapshot.acbPerShare })} ` +
          `Replay: ${JSON.stringify(replayState)}`
        );
      }

      return { distribution, snapshot };
    },

    findByStockId(stockId: number): DistributionRow[] {
      return db
        .select()
        .from(distributions)
        .where(eq(distributions.stockId, stockId))
        .orderBy(desc(distributions.recordDate))
        .all();
    },

    findByRecordDate(
      stockId: number,
      recordDate: Date
    ): DistributionRow | undefined {
      return db
        .select()
        .from(distributions)
        .where(
          and(
            eq(distributions.stockId, stockId),
            eq(distributions.recordDate, recordDate)
          )
        )
        .get();
    },

    getLatestSnapshot(
      stockId: number
    ): DistributionSnapshotRow | undefined {
      return db
        .select()
        .from(distributionSnapshots)
        .where(eq(distributionSnapshots.stockId, stockId))
        .orderBy(desc(distributionSnapshots.calculatedAt))
        .limit(1)
        .get();
    },

    delete(id: number): boolean {
      const existing = db
        .select()
        .from(distributions)
        .where(eq(distributions.id, id))
        .get();
      if (!existing) return false;
      db.delete(distributions).where(eq(distributions.id, id)).run();
      return true;
    },

    /**
     * Applies bundled distribution data for a ticker.
     * - New record dates are inserted.
     * - Existing records with changed values are deleted and re-created.
     * - Matching records are skipped.
     */
    applyBundledDistributions(
      stockId: number,
      ticker: string
    ): { applied: number; updated: number; skipped: number } {
      const bundled = getBundledDistributions(ticker);
      if (!bundled) return { applied: 0, updated: 0, skipped: 0 };

      let applied = 0;
      let updated = 0;
      let skipped = 0;

      for (const dist of bundled.distributions) {
        const recordDate = new Date(dist.recordDate);
        const existing = this.findByRecordDate(stockId, recordDate);

        if (existing) {
          const valuesMatch =
            Math.abs(existing.rocPerUnit - dist.rocPerUnit) < 1e-10 &&
            Math.abs(existing.phantomDistPerUnit - dist.phantomDistPerUnit) < 1e-10;

          if (valuesMatch) {
            skipped++;
            continue;
          }

          // Values changed — delete old and re-create
          this.delete(existing.id);
          updated++;
        } else {
          applied++;
        }

        this.create({
          stockId,
          recordDate,
          rocPerUnit: dist.rocPerUnit,
          phantomDistPerUnit: dist.phantomDistPerUnit,
          source: "bundled",
          notes: `Auto-applied from ${bundled.provider} data`,
        });
      }

      return { applied, updated, skipped };
    },
  };
}

export type DistributionRepository = ReturnType<
  typeof createDistributionRepository
>;
