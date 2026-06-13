import { formatCompactCurrency } from '../../../tabs/Future/tabs/FutureUtils';
import type { AutoMax401kOption, ESPPContributionType, PensionSystem } from './models';

/**
 * Paystub-style one-line summaries for collapsed work-income sections.
 *
 * Inputs are structural so both the `WorkIncome` model (card side) and the
 * `IncomeFormState` (Add Income modal) satisfy them. The card-side
 * `card/WorkIncomeFields.tsx` currently carries its own private copies of
 * these helpers; if it's ever revisited it can import from here instead.
 */

const fmt = (n: number) => formatCompactCurrency(n, { forceExact: true });

export interface Summary401kInput {
    autoMax401k: AutoMax401kOption;
    preTax401k: number;
    roth401k: number;
    employerMatchType?: 'fixed' | 'percent';
    employerMatch: number;
    employerMatchPercent?: number;
}

/** Paystub-style one-liner for the collapsed 401k & Match section. */
export function get401kSummary(income: Summary401kInput): string {
    let contrib: string;
    switch (income.autoMax401k) {
        case 'disabled': return 'None';
        case 'traditional': contrib = 'Max Pre-Tax'; break;
        case 'roth': contrib = 'Max Roth'; break;
        default: {
            const parts: string[] = [];
            if (income.preTax401k > 0) parts.push(`${fmt(income.preTax401k)} pre-tax`);
            if (income.roth401k > 0) parts.push(`${fmt(income.roth401k)} Roth`);
            contrib = parts.length > 0 ? parts.join(' + ') : 'Custom ($0)';
        }
    }
    const match = income.employerMatchType === 'percent'
        ? ((income.employerMatchPercent ?? 0) > 0 ? `${income.employerMatchPercent}% match` : null)
        : (income.employerMatch > 0 ? `${fmt(income.employerMatch)} match` : null);
    return match ? `${contrib} · ${match}` : contrib;
}

export interface BenefitsSummaryInput {
    insurance: number;
    hsaContribution: number;
}

export function getBenefitsSummary(income: BenefitsSummaryInput): string {
    const parts: string[] = [];
    if (income.insurance > 0) parts.push(`${fmt(income.insurance)} insurance`);
    if (income.hsaContribution > 0) parts.push(`${fmt(income.hsaContribution)} HSA`);
    return parts.length > 0 ? parts.join(' · ') : 'None';
}

export interface ESPPSummaryInput {
    esppContributionType: ESPPContributionType;
    esppContributionAmount: number;
}

export function getESPPSummary(income: ESPPSummaryInput): string {
    if (income.esppContributionType === 'NONE') return 'None';
    return income.esppContributionType === 'PERCENTAGE'
        ? `${income.esppContributionAmount}% of salary`
        : `${fmt(income.esppContributionAmount)}/yr`;
}

export function getPensionSummary(pensionSystem: PensionSystem): string {
    return pensionSystem === 'NONE' ? 'None' : pensionSystem;
}
