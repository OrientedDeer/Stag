import {
    type AnyIncome,
    WorkIncome,
    isSocialSecurity,
} from "../../Income/models";

export function getGrossIncome(incomes: AnyIncome[], year: number): number {
    return incomes.reduce((acc, inc) => {
        // Guard the prototype method (mirrors getSocialSecurityBenefits): this
        // iterates ALL incomes with no instanceof filter, so a method-less
        // className-only object (raw mock-fixture / worker literal with no restored
        // prototype) could reach here. ?.() ?? 0 makes such an object contribute 0
        // instead of throwing; method-bearing real instances are unaffected.
        let total = inc.getProratedAnnual?.(inc.amount, year) ?? 0;
        if (inc instanceof WorkIncome && inc.taxType === "Roth 401k") {
            // getEffectiveAnnualEmployerMatch returns an already-annual value (and
            // handles both 'fixed' and 'percent' match types), so it's added outside
            // getProratedAnnual — mirroring getPostTaxEmployerMatch.
            total += inc.getEffectiveAnnualEmployerMatch(year);
        }
        return acc + total;
    }, 0);
}

/**
 * Resolve the effective per-period 401k contribution field for a work income.
 *
 * When `useStoredValue` is true (simulation, after increment() has run) the stored
 * preTax401k/roth401k is read directly. Otherwise, when an age is provided, the value
 * is resolved through getEffective401k() (UI preview / auto-max). Falls back to the
 * stored value when no age is available.
 */
function resolveEffective401k(
    inc: WorkIncome,
    year: number,
    age: number | undefined,
    useStoredValue: boolean,
    kind: "preTax" | "roth",
): number {
    if (useStoredValue || age === undefined) {
        return kind === "preTax" ? inc.preTax401k : inc.roth401k;
    }
    return inc.getEffective401k(year, age)[kind];
}

/**
 * Get pre-tax exemptions (401k, insurance, HSA) from work incomes.
 * @param useStoredValue - If true, reads stored preTax401k directly instead of calling getEffective401k().
 *                         Use true in simulation (after increment() has run), false for UI preview.
 */
export function getPreTaxExemptions(
    incomes: AnyIncome[],
    year: number,
    age?: number,
    useStoredValue: boolean = false,
): number {
    return incomes
        // `instanceof WorkIncome` already excludes method-less className-only
        // objects (no restored prototype ⇒ fails instanceof), so getProratedAnnual
        // is guaranteed present here — no ?.() guard needed (unlike the
        // instanceof-less siblings getGrossIncome / getEarnedIncome).
        .filter((inc) => inc instanceof WorkIncome)
        .reduce((acc, inc) => {
            const preTax401k = resolveEffective401k(inc, year, age, useStoredValue, "preTax");
            return (
                acc +
                inc.getProratedAnnual(preTax401k, year) +
                inc.getProratedAnnual(inc.insurance, year) +
                inc.getProratedAnnual(inc.hsaContribution, year)
            );
        }, 0);
}

export function getPostTaxEmployerMatch(incomes: AnyIncome[], year: number): number {
    return incomes.reduce((acc, inc) => {
        if (inc instanceof WorkIncome && inc.taxType === "Roth 401k") {
            return acc + inc.getEffectiveAnnualEmployerMatch(year);
        }
        return acc;
    }, 0);
}

/**
 * Get post-tax exemptions (Roth 401k) from work incomes.
 * @param useStoredValue - If true, reads stored roth401k directly instead of calling getEffective401k().
 *                         Use true in simulation (after increment() has run), false for UI preview.
 */
export function getPostTaxExemptions(
    incomes: AnyIncome[],
    year: number,
    age?: number,
    useStoredValue: boolean = false,
): number {
    return incomes
        // instanceof filter excludes method-less className-only objects, so
        // getProratedAnnual is guaranteed present — no ?.() guard needed.
        .filter((inc) => inc instanceof WorkIncome)
        .reduce((acc, inc) => {
            const roth401k = resolveEffective401k(inc, year, age, useStoredValue, "roth");
            return acc + inc.getProratedAnnual(roth401k, year);
        }, 0);
}

export function getFicaExemptions(incomes: AnyIncome[], year: number): number {
    return incomes
        // instanceof filter excludes method-less className-only objects, so
        // getProratedAnnual is guaranteed present — no ?.() guard needed.
        .filter((inc) => inc instanceof WorkIncome)
        .reduce((acc, inc) => {
            return (
                acc +
                inc.getProratedAnnual(inc.insurance, year) +
                inc.getProratedAnnual(inc.hsaContribution, year)
            );
        }, 0);
}

/**
 * Social Security coverage predicate for FICA. A WorkIncome flagged CSRS pays NO
 * Social Security tax — CSRS employees are outside Social Security (they pay a
 * higher pension contribution + Medicare instead). Every other income is
 * SS-covered (FERS DOES have SS coverage, so it is unaffected). Reads the
 * `pensionSystem` DATA field rather than `instanceof`, so reconstituted /
 * className-only objects (cached/worker-marshalled sim years) are handled — a
 * non-WorkIncome simply has no `pensionSystem` and stays SS-covered.
 */
export function isSSCoveredForFica(inc: AnyIncome): boolean {
    return (inc as Partial<WorkIncome>).pensionSystem !== "CSRS";
}

export function getEarnedIncome(incomes: AnyIncome[], year: number): number {
    return incomes
        // Filtered by a DATA field (earned_income), not instanceof, so a method-less
        // className-only object could pass the filter — guard the prototype method
        // (mirrors getSocialSecurityBenefits / getGrossIncome) so it contributes 0
        // instead of throwing.
        .filter((inc) => inc.earned_income === "Yes")
        .reduce((acc, inc) => {
            return acc + (inc.getProratedAnnual?.(inc.amount, year) ?? 0);
        }, 0);
}

/**
 * Get total Social Security benefits received in the year.
 */
export function getSocialSecurityBenefits(incomes: AnyIncome[], year: number): number {
    return incomes
        // Canonical className-aware predicate: reconstituted (prototype-stripped) SS
        // income — e.g. a cached/worker-marshalled sim year — must be recognized as a
        // benefit. federalTax/stateTax compute nonSSGross = grossIncome − this value,
        // so a missed SS benefit would be taxed at 100% instead of the IRS <=85% rule.
        .filter((inc) => isSocialSecurity(inc))
        .reduce((acc, inc) => {
            // Guard the prototype method: the className-aware predicate also matches
            // method-less className-only objects (raw mock-fixture / worker literals
            // with no restored prototype). Mirror the sibling pension extraction in
            // useSimulation (getAnnualAmount?.() ?? 0) so those contribute 0 instead
            // of throwing. Method-bearing objects are unaffected (real SS amount).
            return acc + (inc.getProratedAnnual?.(inc.amount, year) ?? 0);
        }, 0);
}
