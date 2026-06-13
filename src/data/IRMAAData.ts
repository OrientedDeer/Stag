/**
 * IRMAAData.ts
 *
 * Income-Related Monthly Adjustment Amount (IRMAA) — the income-tested surcharge
 * Medicare beneficiaries pay on top of the standard Part B and Part D premiums.
 *
 * Key facts modeled here:
 *  - IRMAA applies only to filers on Medicare (age 65+).
 *  - It is a CLIFF surcharge: crossing a MAGI tier boundary by $1 jumps the whole
 *    year to the next tier's surcharge (no phase-in).
 *  - Premiums for a given year use MAGI from TWO YEARS PRIOR (e.g. 2026 premiums
 *    are set by 2024 MAGI). The lookback is handled by the simulation engine,
 *    which stores each year's MAGI on the SimulationYear and reads year N-2.
 *  - The surcharge is per beneficiary. We model only the SURCHARGE DELTA above the
 *    standard premium — the app does not model the base Medicare premium at all
 *    (only the FICA Medicare payroll tax), so layering base premiums here would
 *    double-count healthcare the user already budgets as an expense.
 *
 * MAGI for IRMAA ≈ AGI + tax-exempt interest, where AGI includes the TAXABLE
 * portion of Social Security (not gross SS). Tax-exempt interest isn't tracked
 * separately in the app yet, so MAGI ≈ AGI is the accepted first cut.
 *
 * Source: CMS 2026 Medicare Part B/D IRMAA schedule (per-beneficiary monthly
 * surcharges above the $202.90 standard Part B premium):
 *   tier:        1        2        3        4        5
 *   Part B:   $81.20  $202.90  $324.60  $446.30  $487.00
 *   Part D:   $14.50   $37.50   $60.40   $83.30   $91.00
 */

import { FilingStatus } from "./TaxData";
import { AssumptionsState } from "../components/Objects/Assumptions/AssumptionsContext";

/** Age at which Medicare (and therefore IRMAA) eligibility begins. */
export const MEDICARE_ELIGIBILITY_AGE = 65;

/** The IRMAA lookback: year N premiums are set by year N-2 MAGI. */
export const IRMAA_LOOKBACK_YEARS = 2;

interface IRMAASchedule {
    /**
     * Per-beneficiary MONTHLY surcharge by tier index (0 = standard premium, no
     * surcharge). Index aligns with the `tier` field of each threshold entry.
     */
    surcharges: { partB: number; partD: number }[];
    /**
     * MAGI floor (inclusive) for each tier, by filing status. A MAGI at or above a
     * floor (and below the next entry's floor) lands in that entry's tier.
     *
     * Married Filing Separately has its own truncated schedule: it has no tiers
     * 1-3 — below the first floor it is standard, then it jumps straight to the
     * tier-4 surcharge, then the tier-5 surcharge.
     */
    thresholds: Record<FilingStatus, { floor: number; tier: number }[]>;
}

const IRMAA_DATA: Record<number, IRMAASchedule> = {
    2026: {
        surcharges: [
            { partB: 0, partD: 0 },        // tier 0 — standard premium, no surcharge
            { partB: 81.20, partD: 14.50 }, // tier 1
            { partB: 202.90, partD: 37.50 }, // tier 2
            { partB: 324.60, partD: 60.40 }, // tier 3
            { partB: 446.30, partD: 83.30 }, // tier 4
            { partB: 487.00, partD: 91.00 }, // tier 5
        ],
        thresholds: {
            'Single': [
                { floor: 0, tier: 0 },
                { floor: 109_000, tier: 1 },
                { floor: 137_000, tier: 2 },
                { floor: 171_000, tier: 3 },
                { floor: 205_000, tier: 4 },
                { floor: 500_000, tier: 5 },
            ],
            'Married Filing Jointly': [
                { floor: 0, tier: 0 },
                { floor: 218_000, tier: 1 },
                { floor: 274_000, tier: 2 },
                { floor: 342_000, tier: 3 },
                { floor: 410_000, tier: 4 },
                { floor: 750_000, tier: 5 },
            ],
            'Married Filing Separately': [
                { floor: 0, tier: 0 },
                { floor: 109_000, tier: 4 },
                { floor: 391_000, tier: 5 },
            ],
        },
    },
};

const KNOWN_YEARS = Object.keys(IRMAA_DATA).map(Number).sort((a, b) => b - a);

/** Most recent table year at or before `year` (forward-only, like tax brackets). */
function resolveBaseYear(year: number): number {
    return KNOWN_YEARS.find((y) => y <= year) ?? KNOWN_YEARS[KNOWN_YEARS.length - 1];
}

/**
 * Forward-only inflation multiplier, mirroring getTaxParameters: years beyond the
 * latest table are indexed up by the macro inflation rate; years within/before the
 * table snap to the table verbatim (no deflation). Both the MAGI thresholds and the
 * dollar surcharge amounts are indexed, so a beneficiary whose MAGI grows with
 * inflation keeps a roughly constant tier in real terms.
 */
function inflationMultiplier(year: number, baseYear: number, assumptions: AssumptionsState): number {
    if (!assumptions.macro.inflationAdjusted || year <= baseYear) return 1;
    let rate = assumptions.macro.inflationRate / 100;
    if (!Number.isFinite(rate)) rate = 0;
    return Math.pow(1 + rate, year - baseYear);
}

/**
 * Resolve which IRMAA tier a given MAGI falls into for a year + filing status.
 * Returns the tier index into the year's `surcharges` array.
 */
function resolveTierIndex(
    magi: number,
    filingStatus: FilingStatus,
    schedule: IRMAASchedule,
    multiplier: number,
): number {
    const thresholds = schedule.thresholds[filingStatus] ?? schedule.thresholds['Single'];
    let tier = 0;
    for (const entry of thresholds) {
        if (magi >= entry.floor * multiplier) {
            tier = entry.tier;
        }
    }
    return tier;
}

/**
 * The annual household IRMAA surcharge for a given MAGI, filing status, and year.
 *
 * - Returns 0 for MAGI in the standard tier (no surcharge) or non-positive MAGI.
 * - Married Filing Jointly bills the per-beneficiary surcharge x2: the app has no
 *   separate spouse age, so — consistent with the rest of the tax code (e.g.
 *   stateTax senior deductions) — both spouses are assumed on Medicare together.
 *
 * Callers are responsible for the age gate (only bill when on Medicare) and the
 * 2-year lookback (pass the MAGI from year N-2 when computing year N's surcharge).
 */
export function getIRMAAAnnualSurcharge(
    magi: number,
    filingStatus: FilingStatus,
    year: number,
    assumptions: AssumptionsState,
): number {
    if (!(magi > 0)) return 0;

    const baseYear = resolveBaseYear(year);
    const schedule = IRMAA_DATA[baseYear];
    const multiplier = inflationMultiplier(year, baseYear, assumptions);

    const tierIndex = resolveTierIndex(magi, filingStatus, schedule, multiplier);
    const surcharge = schedule.surcharges[tierIndex];
    if (!surcharge || (surcharge.partB === 0 && surcharge.partD === 0)) return 0;

    const monthlyPerBeneficiary = (surcharge.partB + surcharge.partD) * multiplier;
    const beneficiaries = filingStatus === 'Married Filing Jointly' ? 2 : 1;
    return monthlyPerBeneficiary * 12 * beneficiaries;
}

/**
 * The smallest IRMAA tier floor strictly above `magi` for a year + filing status,
 * or null when `magi` is already in (or above) the top tier. Used by the conversion
 * search to locate the next surcharge cliff that a conversion might trip.
 */
export function getNextIRMAAThreshold(
    magi: number,
    filingStatus: FilingStatus,
    year: number,
    assumptions: AssumptionsState,
): number | null {
    const baseYear = resolveBaseYear(year);
    const schedule = IRMAA_DATA[baseYear];
    const multiplier = inflationMultiplier(year, baseYear, assumptions);
    const thresholds = schedule.thresholds[filingStatus] ?? schedule.thresholds['Single'];

    let next: number | null = null;
    for (const entry of thresholds) {
        const floor = entry.floor * multiplier;
        if (floor > magi && (next === null || floor < next)) {
            next = floor;
        }
    }
    return next;
}

/**
 * Resolve the MAGI that drives a given year's IRMAA, honoring the 2-year lookback.
 *
 * - The common case (every year at least two into the simulation): year N-2 is
 *   present in `previousSimulation`, so its stored MAGI is the true basis.
 * - First 1-2 Medicare years for someone who starts the tool already at/near 65:
 *   year N-2 predates the simulation, so we proxy from the EARLIEST simulated
 *   year's MAGI (the user-chosen seeding) rather than granting a 2-year free pass.
 * - Very first simulated year (no prior data at all): self-proxy from this year's
 *   own income-side MAGI passed in by the caller.
 */
export function resolveIrmaaLookbackMAGI(
    previousSimulation: { year: number; magi?: number }[] | undefined,
    year: number,
    selfProxyMAGI: number,
): number {
    const targetYear = year - IRMAA_LOOKBACK_YEARS;
    const exact = previousSimulation?.find((s) => s.year === targetYear);
    if (exact && exact.magi !== undefined) return exact.magi;

    if (previousSimulation && previousSimulation.length > 0) {
        const earliest = previousSimulation.reduce(
            (min, s) => (s.year < min.year ? s : min),
            previousSimulation[0],
        );
        return earliest.magi ?? selfProxyMAGI;
    }
    return selfProxyMAGI;
}
