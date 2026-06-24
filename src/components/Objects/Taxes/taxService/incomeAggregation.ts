import {
    AnyIncome,
    WorkIncome,
    SocialSecurityIncome,
    CurrentSocialSecurityIncome,
    FutureSocialSecurityIncome,
} from "../../Income/models";

export function getGrossIncome(incomes: AnyIncome[], year: number): number {
    return incomes.reduce((acc, inc) => {
        let total = inc.getProratedAnnual(inc.amount, year);
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
        .filter((inc) => inc instanceof WorkIncome)
        .reduce((acc, inc) => {
            const roth401k = resolveEffective401k(inc, year, age, useStoredValue, "roth");
            return acc + inc.getProratedAnnual(roth401k, year);
        }, 0);
}

export function getFicaExemptions(incomes: AnyIncome[], year: number): number {
    return incomes
        .filter((inc) => inc instanceof WorkIncome)
        .reduce((acc, inc) => {
            return (
                acc +
                inc.getProratedAnnual(inc.insurance, year) +
                inc.getProratedAnnual(inc.hsaContribution, year)
            );
        }, 0);
}

export function getEarnedIncome(incomes: AnyIncome[], year: number): number {
    return incomes
        .filter((inc) => inc.earned_income === "Yes")
        .reduce((acc, inc) => {
            return acc + inc.getProratedAnnual(inc.amount, year);
        }, 0);
}

/**
 * Get total Social Security benefits received in the year.
 */
export function getSocialSecurityBenefits(incomes: AnyIncome[], year: number): number {
    return incomes
        .filter((inc) =>
            inc instanceof SocialSecurityIncome ||
            inc instanceof CurrentSocialSecurityIncome ||
            inc instanceof FutureSocialSecurityIncome,
        )
        .reduce((acc, inc) => {
            return acc + inc.getProratedAnnual(inc.amount, year);
        }, 0);
}
