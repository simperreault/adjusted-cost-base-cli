import { eq, desc, and } from "drizzle-orm";
import type { AppDatabase } from "../index.ts";
import {
  distributions,
  distributionSnapshots,
  stockSnapshots,
  type DistributionRow,
  type DistributionSnapshotRow,
  type StockSnapshotRow,
} from "../schema.ts";
import {
  calculateAcbAfterDistribution,
  getInitialAcbState,
} from "../../core/acb.ts";
import type { ACBState } from "../../types/index.ts";
import { getBundledDistributions } from "../../../data/distributions/index.ts";

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

/**
 * Gets the latest ACB state for a stock by checking both transaction snapshots
 * and distribution snapshots, returning whichever is most recent.
 */
export function getLatestAcbState(
  db: AppDatabase,
  stockId: number
): ACBState {
  const latestTxSnapshot: StockSnapshotRow | undefined = db
    .select()
    .from(stockSnapshots)
    .where(eq(stockSnapshots.stockId, stockId))
    .orderBy(desc(stockSnapshots.calculatedAt))
    .limit(1)
    .get();

  const latestDistSnapshot: DistributionSnapshotRow | undefined = db
    .select()
    .from(distributionSnapshots)
    .where(eq(distributionSnapshots.stockId, stockId))
    .orderBy(desc(distributionSnapshots.calculatedAt))
    .limit(1)
    .get();

  if (!latestTxSnapshot && !latestDistSnapshot) {
    return getInitialAcbState();
  }

  if (!latestDistSnapshot) {
    return {
      totalShares: latestTxSnapshot!.totalShares,
      totalCostCad: latestTxSnapshot!.totalCostCad,
      acbPerShare: latestTxSnapshot!.acbPerShare,
    };
  }

  if (!latestTxSnapshot) {
    return {
      totalShares: latestDistSnapshot.totalShares,
      totalCostCad: latestDistSnapshot.totalCostCad,
      acbPerShare: latestDistSnapshot.acbPerShare,
    };
  }

  // Return whichever is more recent
  const txTime = latestTxSnapshot.calculatedAt.getTime();
  const distTime = latestDistSnapshot.calculatedAt.getTime();
  const latest = distTime > txTime ? latestDistSnapshot : latestTxSnapshot;

  return {
    totalShares: latest.totalShares,
    totalCostCad: latest.totalCostCad,
    acbPerShare: latest.acbPerShare,
  };
}

export function createDistributionRepository(db: AppDatabase) {
  return {
    create(data: CreateDistributionInput): DistributionWithSnapshot {
      const currentState = getLatestAcbState(db, data.stockId);

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
     * Applies bundled distribution data for a ticker, skipping any that
     * already exist (matched by record date).
     */
    applyBundledDistributions(
      stockId: number,
      ticker: string
    ): { applied: number; skipped: number } {
      const bundled = getBundledDistributions(ticker);
      if (!bundled) return { applied: 0, skipped: 0 };

      let applied = 0;
      let skipped = 0;

      for (const dist of bundled.distributions) {
        const recordDate = new Date(dist.recordDate);
        const existing = this.findByRecordDate(stockId, recordDate);

        if (existing) {
          skipped++;
          continue;
        }

        this.create({
          stockId,
          recordDate,
          rocPerUnit: dist.rocPerUnit,
          phantomDistPerUnit: dist.phantomDistPerUnit,
          source: "bundled",
          notes: `Auto-applied from ${bundled.provider} data`,
        });
        applied++;
      }

      return { applied, skipped };
    },
  };
}

export type DistributionRepository = ReturnType<
  typeof createDistributionRepository
>;
