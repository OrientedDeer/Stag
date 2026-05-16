import {
    AnyIncome,
    WorkIncome,
    SocialSecurityIncome,
    CurrentSocialSecurityIncome,
    FutureSocialSecurityIncome,
    FERSPensionIncome,
    CSRSPensionIncome,
    PassiveIncome,
    WindfallIncome,
    INCOME_COLORS_BACKGROUND,
    IncomeFrequency,
} from './models';
import { formatCompactCurrency } from '../../../tabs/Future/tabs/FutureUtils';
import { get401kLimit, getHSALimit } from '../../../data/ContributionLimits';
import { getFrequencyAbbrev } from '../../../utils/formatters';

export interface ContributionWarning {
    type: string;
    message: string;
    annual: number;
    limit: number;
}

export function getIncomeDescriptor(income: AnyIncome): string {
    if (income instanceof WorkIncome) return 'WORK';
    if (income instanceof SocialSecurityIncome) return 'SS';
    if (income instanceof CurrentSocialSecurityIncome) return 'SS';
    if (income instanceof FutureSocialSecurityIncome) return 'SS';
    if (income instanceof FERSPensionIncome) return 'PENSION';
    if (income instanceof CSRSPensionIncome) return 'PENSION';
    if (income instanceof PassiveIncome) return 'PASSIVE';
    if (income instanceof WindfallIncome) return 'WINDFALL';
    return 'INCOME';
}

export function getIncomeIconBg(income: AnyIncome): string {
    if (income instanceof WorkIncome) return INCOME_COLORS_BACKGROUND['Work'];
    if (income instanceof SocialSecurityIncome) return INCOME_COLORS_BACKGROUND['SocialSecurity'];
    if (income instanceof CurrentSocialSecurityIncome) return INCOME_COLORS_BACKGROUND['SocialSecurity'];
    if (income instanceof FutureSocialSecurityIncome) return INCOME_COLORS_BACKGROUND['SocialSecurity'];
    if (income instanceof FERSPensionIncome) return INCOME_COLORS_BACKGROUND['Pension'];
    if (income instanceof CSRSPensionIncome) return INCOME_COLORS_BACKGROUND['Pension'];
    if (income instanceof PassiveIncome) return INCOME_COLORS_BACKGROUND['Passive'];
    if (income instanceof WindfallIncome) return INCOME_COLORS_BACKGROUND['Windfall'];
    return 'bg-gray-500';
}

/**
 * Header value shown on the collapsed card. Pension types show the
 * simulation-computed annual benefit; FutureSS shows the PIA once known.
 */
export function getDisplayAmount(income: AnyIncome, forceExact: boolean): string {
    if (income instanceof FutureSocialSecurityIncome) {
        return income.calculatedPIA > 0
            ? formatCompactCurrency(income.calculatedPIA, { forceExact })
            : 'Auto-calculated';
    }
    if (income instanceof FERSPensionIncome || income instanceof CSRSPensionIncome) {
        return income.calculatedBenefit > 0
            ? formatCompactCurrency(income.calculatedBenefit, { forceExact })
            : 'Auto-calculated';
    }
    return formatCompactCurrency(income.amount, { forceExact });
}

export function getFrequencyDisplay(income: AnyIncome): string {
    if (income instanceof FutureSocialSecurityIncome) {
        return income.calculatedPIA > 0 ? '/mo' : '';
    }
    if (income instanceof FERSPensionIncome || income instanceof CSRSPensionIncome) {
        return income.calculatedBenefit > 0 ? '/yr' : '';
    }
    return `/${getFrequencyAbbrev(income.frequency)}`;
}

const FREQ_TO_ANNUAL: Record<IncomeFrequency, number> = {
    Weekly: 52,
    'Bi-Weekly': 26,
    'Semi-Monthly': 24,
    Monthly: 12,
    Annually: 1,
};

/**
 * Returns the list of 401k / HSA contribution warnings if the user is over the
 * current-year IRS limits, or null if everything is within bounds. Only relevant
 * for WorkIncome; pure function so it's testable.
 */
export function computeContributionWarnings(
    income: AnyIncome,
    birthYear: number,
    currentYear: number = new Date().getFullYear()
): ContributionWarning[] | null {
    if (!(income instanceof WorkIncome)) return null;

    const age = currentYear - birthYear;
    const multiplier = FREQ_TO_ANNUAL[income.frequency] ?? 12;
    const annual401k = (income.preTax401k + income.roth401k) * multiplier;
    const annualHSA = income.hsaContribution * multiplier;

    const limit401k = get401kLimit(currentYear, age);
    const limitHSA = getHSALimit(currentYear, age, 'individual');

    const warnings: ContributionWarning[] = [];

    if (annual401k > limit401k) {
        warnings.push({
            type: '401k',
            message: `401k contributions exceed ${currentYear} limit`,
            annual: annual401k,
            limit: limit401k,
        });
    }

    if (annualHSA > limitHSA) {
        warnings.push({
            type: 'HSA',
            message: `HSA contributions exceed ${currentYear} limit`,
            annual: annualHSA,
            limit: limitHSA,
        });
    }

    return warnings.length > 0 ? warnings : null;
}
