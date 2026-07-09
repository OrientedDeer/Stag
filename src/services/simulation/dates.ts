/**
 * dates.ts — shared simulation date literals.
 */

/**
 * The mid-year (June 15) local-time date at which a simulation year's ESPP/RSU
 * sales are assumed to occur.
 *
 * COORDINATION CONSTRAINT (#179): three sites MUST agree on this exact date:
 *   1. WithdrawalPlanner — the `snapshotDate` at which lots are TAXED
 *      (qualifying vs disqualifying ESPP disposition, RSU holding-period).
 *   2. AccountGrowth (ESPP sale) — the `saleDate` passed to `removeSoldShares`
 *      so lots are REMOVED in the same qualifying/disqualifying order the tax
 *      was computed against.
 *   3. AccountGrowth (RSU sale) — the `saleDate` for `getEligibleShares` /
 *      `removeSoldShares` so `minimumHoldingDays` eligibility lines up with tax.
 *
 * If these three literals ever diverge, the lots removed stop matching the lots
 * taxed and future-year lot state silently corrupts. Sharing one helper makes
 * the coordination impossible to break by editing one site alone.
 *
 * Uses a local-time `new Date(year, monthIndex, day)` constructor (month is
 * 0-based, so 5 = June) — NEVER an ISO/UTC string — per the repo's
 * local-not-UTC date-only convention.
 */
export function midYearSaleDate(year: number): Date {
    return new Date(year, 5, 15);
}
