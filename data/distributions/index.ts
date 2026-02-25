import XEQT from "./XEQT.json";
import XGRO from "./XGRO.json";
import XBAL from "./XBAL.json";
import VEQT from "./VEQT.json";
import VGRO from "./VGRO.json";
import VBAL from "./VBAL.json";

export interface BundledDistribution {
  recordDate: string;
  rocPerUnit: number;
  phantomDistPerUnit: number;
  source: string;
}

export interface BundledETFData {
  ticker: string;
  name: string;
  provider: string;
  currency: string;
  lastUpdated: string;
  notes: string;
  distributions: BundledDistribution[];
}

const BUNDLED_DISTRIBUTIONS: Record<string, BundledETFData> = {
  XEQT: XEQT as BundledETFData,
  XGRO: XGRO as BundledETFData,
  XBAL: XBAL as BundledETFData,
  VEQT: VEQT as BundledETFData,
  VGRO: VGRO as BundledETFData,
  VBAL: VBAL as BundledETFData,
};

export function getBundledDistributions(
  ticker: string
): BundledETFData | undefined {
  return BUNDLED_DISTRIBUTIONS[ticker.toUpperCase()];
}

export function isSupportedTicker(ticker: string): boolean {
  return ticker.toUpperCase() in BUNDLED_DISTRIBUTIONS;
}

export function getSupportedTickers(): string[] {
  return Object.keys(BUNDLED_DISTRIBUTIONS);
}
