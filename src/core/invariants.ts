import type { ACBState } from "../types/index.ts";

export class ACBInvariantViolation extends Error {
  constructor(
    public readonly violation: string,
    public readonly state: ACBState,
    public readonly context?: Record<string, unknown>
  ) {
    super(`ACB invariant violated: ${violation} (state: ${JSON.stringify(state)})`);
    this.name = "ACBInvariantViolation";
  }
}

const TOLERANCE = 1e-9;

export function assertACBState(
  state: ACBState,
  context?: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(state) as [keyof ACBState, number][]) {
    if (!Number.isFinite(value)) {
      throw new ACBInvariantViolation(`${key} is ${value}`, state, context);
    }
  }

  if (state.totalShares < -TOLERANCE) {
    throw new ACBInvariantViolation(
      `totalShares is negative (${state.totalShares})`, state, context
    );
  }

  if (state.totalCostCad < -TOLERANCE) {
    throw new ACBInvariantViolation(
      `totalCostCad is negative (${state.totalCostCad})`, state, context
    );
  }

  if (state.totalShares < TOLERANCE && Math.abs(state.totalCostCad) > TOLERANCE) {
    throw new ACBInvariantViolation(
      `totalShares is 0 but totalCostCad is ${state.totalCostCad}`, state, context
    );
  }

  if (state.totalShares > TOLERANCE) {
    const expectedAcb = state.totalCostCad / state.totalShares;
    if (Math.abs(state.acbPerShare - expectedAcb) > TOLERANCE) {
      throw new ACBInvariantViolation(
        `acbPerShare (${state.acbPerShare}) !== totalCostCad / totalShares (${expectedAcb})`,
        state,
        context
      );
    }
  }
}
