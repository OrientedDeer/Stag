import {
    AnyIncome,
    WorkIncome,
    CurrentSocialSecurityIncome,
    FutureSocialSecurityIncome,
} from "../../Income/models";

export function getGrossIncome(incomes: AnyIncome[], year: number): number {
    return incomes.reduce((acc, inc) => {
        let currentIncome = inc.amount;
        if (inc instanceof WorkIncome && inc.taxType === "Roth 401k") {
            currentIncome += inc.employerMatch;
        }
        return acc + inc.getProratedAnnual(currentIncome, year);
    }, 0);
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
            const preTax401k = useStoredValue
                ? inc.preTax401k
                : (age !== undefined ? inc.getEffective401k(year, age).preTax : inc.preTax401k);
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
            const roth401k = useStoredValue
                ? inc.roth401k
                : (age !== undefined ? inc.getEffective401k(year, age).roth : inc.roth401k);
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
            inc instanceof CurrentSocialSecurityIncome ||
            inc instanceof FutureSocialSecurityIncome,
        )
        .reduce((acc, inc) => {
            return acc + inc.getProratedAnnual(inc.amount, year);
        }, 0);
}
