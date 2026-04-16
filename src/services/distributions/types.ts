/**
 * Types for distribution data that affects ACB.
 *
 * Data is sourced from CDS CTBS (Canadian Tax Breakdown Reporting Service)
 * T3/R16 filings. Only ACB-relevant fields are stored:
 * - Return of Capital (Box 42/M): decreases ACB
 * - Phantom/Reinvested Distributions (Non-Cash): increases ACB
 */

export interface DistributionRecord {
  /** Date unitholders must hold to receive distribution (YYYY-MM-DD) */
  recordDate: string;
  /** Return of capital per unit — decreases ACB */
  rocPerUnit: number;
  /** Phantom distribution (reinvested capital gain) per unit — increases ACB */
  phantomDistPerUnit: number;
  /** Where this data came from */
  source: string;
}

export interface SecurityDistributionData {
  /** Trading symbol (e.g. "XEQT") */
  ticker: string;
  /** Full security name as filed with CDS */
  name: string;
  /** CUSIP identifier */
  cusip: string;
  /** Fund provider/issuer */
  provider: string;
  /** Currency of the amounts */
  currency: string;
  /** ISO date of last update */
  lastUpdated: string;
  /** Notes about data sourcing */
  notes: string;
  /** Per-period distribution data */
  distributions: DistributionRecord[];
}
