import {
    AnyIncome,
    WorkIncome,
    FutureSocialSecurityIncome,
    FERSPensionIncome,
    CSRSPensionIncome,
    PassiveIncome,
    WindfallIncome,
    INCOME_COLORS_BACKGROUND,
    IncomeFrequency,
    AutoMax401kOption,
    isSocialSecurity,
} from './models';
import { isActiveRSUGrant } from './rsuGrant';
import { formatCompactCurrency } from '../../../tabs/Future/tabs/FutureUtils';
import { get401kLimit, getHSALimit } from '../../../data/ContributionLimits';
import { getFrequencyAbbrev } from '../../../utils/formatters';
import type { RSUAccount, InvestedAccount } from '../Accounts/models';
import type { SimulationYear } from '../../../services/simulation/types';

export interface ContributionWarning {
    type: string;
    message: string;
    annual: number;
    limit: number;
}

export function getIncomeDescriptor(income: AnyIncome): string {
    if (income instanceof WorkIncome) return 'WORK';
    // All three SS sub-classes share one descriptor; the canonical className-aware
    // predicate also tags reconstituted (prototype-stripped) SS income correctly.
    if (isSocialSecurity(income)) return 'SS';
    if (income instanceof FERSPensionIncome) return 'PENSION';
    if (income instanceof CSRSPensionIncome) return 'PENSION';
    if (income instanceof PassiveIncome) return 'PASSIVE';
    if (income instanceof WindfallIncome) return 'WINDFALL';
    return 'INCOME';
}

export function getIncomeIconBg(income: AnyIncome): string {
    if (income instanceof WorkIncome) return INCOME_COLORS_BACKGROUND['Work'];
    // All three SS sub-classes share one icon color; className-aware so reconstituted
    // SS income gets the SS color too rather than falling through to the muted default.
    if (isSocialSecurity(income)) return INCOME_COLORS_BACKGROUND['SocialSecurity'];
    if (income instanceof FERSPensionIncome) return INCOME_COLORS_BACKGROUND['Pension'];
    if (income instanceof CSRSPensionIncome) return INCOME_COLORS_BACKGROUND['Pension'];
    if (income instanceof PassiveIncome) return INCOME_COLORS_BACKGROUND['Passive'];
    if (income instanceof WindfallIncome) return INCOME_COLORS_BACKGROUND['Windfall'];
    return 'bg-surface-muted';
}

/**
 * Header value shown on the collapsed card. Pension types show the
 * simulation-computed annual benefit; FutureSS shows the PIA once known.
 *
 * `simResolvedPensionBenefit` lets the collapsed header agree with the expanded
 * FERS/CSRS card for the Auto High-3 case: the engine resolves that benefit on a
 * separate projected instance and never writes it onto the editable income, so
 * the live `calculatedBenefit` stays 0. Pass the sim-resolved annual benefit (see
 * `getSimResolvedPension`) or `undefined`/`0` to keep the live-field behavior.
 */
export function getDisplayAmount(
    income: AnyIncome,
    forceExact: boolean,
    simResolvedPensionBenefit?: number
): string {
    if (income instanceof FutureSocialSecurityIncome) {
        return income.calculatedPIA > 0
            ? formatCompactCurrency(income.calculatedPIA, { forceExact })
            : 'Auto-calculated';
    }
    if (income instanceof FERSPensionIncome || income instanceof CSRSPensionIncome) {
        // Prefer the live field (manual-High-3 sets it); else the sim-resolved
        // benefit (auto-High-3 case, never on the live object).
        const benefit = income.calculatedBenefit > 0
            ? income.calculatedBenefit
            : (simResolvedPensionBenefit ?? 0);
        return benefit > 0
            ? formatCompactCurrency(benefit, { forceExact })
            : 'Auto-calculated';
    }
    return formatCompactCurrency(income.amount, { forceExact });
}

export function getFrequencyDisplay(income: AnyIncome, simResolvedPensionBenefit?: number): string {
    if (income instanceof FutureSocialSecurityIncome) {
        return income.calculatedPIA > 0 ? '/mo' : '';
    }
    if (income instanceof FERSPensionIncome || income instanceof CSRSPensionIncome) {
        const hasBenefit = income.calculatedBenefit > 0 || (simResolvedPensionBenefit ?? 0) > 0;
        return hasBenefit ? '/yr' : '';
    }
    return `/${getFrequencyAbbrev(income.frequency)}`;
}

/**
 * The simulation-resolved annual benefit + High-3 for a FERS/CSRS pension whose
 * High-3 is auto-calculated. The engine never writes these back onto the editable
 * IncomeContext object — it computes them on a fresh projected pension instance in
 * IncomeProjection (the activation year sets `calculatedBenefit` and the resolved
 * `high3Salary`). So the live card can't show the figure on its own; this reads it
 * back out of the cached SimulationContext timeline instead of persisting derived
 * data onto the editable income.
 *
 * Scans the timeline for the FIRST year whose income with `incomeId` carries a
 * positive `calculatedBenefit`, and returns that benefit plus its resolved High-3.
 * Reads the fields structurally (not via instanceof) so it's robust to reconstituted
 * className-only sim objects. Returns null when there's no simulation yet (empty
 * timeline) or the pension never activates within the horizon — the caller then
 * falls back to "Auto Calculated".
 */
export function getSimResolvedPension(
    incomeId: string,
    simulation: SimulationYear[] | undefined | null
): { benefit: number; high3: number } | null {
    if (!simulation || simulation.length === 0) return null;
    for (const simYear of simulation) {
        const match = simYear.incomes?.find((inc) => inc.id === incomeId) as
            | { calculatedBenefit?: number; high3Salary?: number }
            | undefined;
        if (match && typeof match.calculatedBenefit === 'number' && match.calculatedBenefit > 0) {
            return {
                benefit: match.calculatedBenefit,
                high3: typeof match.high3Salary === 'number' ? match.high3Salary : 0,
            };
        }
    }
    return null;
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

/**
 * Required-field validation for the RSU section. An RSU grant with a vesting
 * schedule needs a current share price on its linked account — without one the
 * engine can't value the vest and silently projects $0 (it only logs a [WARN]).
 * Requiring the price at the input layer stops the blank-price state from
 * producing a misleading $0 projection.
 *
 * Returns a user-facing required-field message, or null when the config is
 * valid (no vesting schedule, no fixed start date, or a linked account that
 * carries a price). Pure so it's testable. `0` counts as unset, matching the
 * account card's `currentSharePrice ?? derived` convention. A grant with no
 * startDate (milestone-started) returns null: the engine recognizes no vest
 * without one, so the $0 is the start date, not the price.
 */
export function getRSUPriceValidationMessage(
    income: AnyIncome,
    rsuAccounts: RSUAccount[]
): string | null {
    if (!(income instanceof WorkIncome)) return null;
    // Only validate once vesting is actually configured.
    if (!isActiveRSUGrant(income)) return null;

    // A milestone-started grant has no fixed startDate, and the engine recognizes
    // NO vest without one (RSUVesting: `if (!inc.startDate) return`), so a $0
    // projection there is the missing start date, not the missing price — adding a
    // price wouldn't help. Don't misdiagnose it with a "price required" banner.
    if (!income.startDate) return null;

    // No linked account is a separate condition the RSU section already flags.
    if (!income.rsuAccountId) return null;

    const linked = rsuAccounts.find((acc) => acc.id === income.rsuAccountId);
    if (!linked) return null;

    if (!linked.currentSharePrice || linked.currentSharePrice <= 0) {
        return `Set a Current Share Price on the "${linked.name}" RSU account — `
            + 'an RSU grant with a vesting schedule needs a price to value each vest, '
            + 'otherwise the projection shows $0.';
    }

    return null;
}

/**
 * Structural shape of the 401k-deferral config the validation reads. Both the
 * `WorkIncome` model (card side) and the `IncomeFormState` (Add Income modal)
 * satisfy it, so one implementation serves both editors without duplicating the
 * logic per shape.
 */
export interface DeferralConfig {
    autoMax401k: AutoMax401kOption;
    preTax401k: number;
    roth401k: number;
    matchAccountId: string;
}

/** Minimal account shape the destination lookup needs — just the id. */
interface DeferralDestinationAccount {
    id: string;
}

/**
 * True when a work income is configured to defer salary into a 401k this year —
 * either an explicit custom pre-tax/Roth amount, or an auto-max mode. Excludes
 * the 'disabled' mode and a 'custom' mode with $0 in both buckets (no deferral).
 * The employer match is intentionally NOT a deferral: it's the user's own money
 * leaving their paycheck that needs a home.
 *
 * Structural so both the `WorkIncome` instance (card) and the `IncomeFormState`
 * form object (modal) can call it instead of re-deriving `hasDeferral` inline.
 */
export function hasConfiguredDeferral(income: DeferralConfig): boolean {
    if (income.autoMax401k === 'disabled') return false;
    if (income.autoMax401k === 'traditional' || income.autoMax401k === 'roth') return true;
    // custom mode: only a positive amount in either bucket is a real deferral.
    return income.preTax401k > 0 || income.roth401k > 0;
}

/**
 * Shared, shape-agnostic core of the deferral-destination validation. Operates on
 * the structural `DeferralConfig` so the card's `WorkIncome` instance and the
 * modal's `IncomeFormState` form object converge on ONE implementation — including
 * the dangling-id check (an id that's set but resolves to no current account).
 *
 * A work income that defers salary (pre-tax or Roth 401k) needs a destination
 * account so the money actually lands somewhere. The tax engine reduces taxable
 * income for the deferral regardless of `matchAccountId` (`getPreTaxExemptions`),
 * but `AccountGrowth` gates the actual deposit on `matchAccountId` — so a deferral
 * with an empty OR dangling destination gets the tax break but is NEVER deposited,
 * silently leaking out of net worth (issue #123).
 *
 * Returns a user-facing required-field message, or null when the config is valid:
 * no deferral configured, or a deferral with a destination that resolves to a real
 * contribution-eligible account. Pure so it's testable.
 */
export function getDeferralDestinationMessageFor(
    config: DeferralConfig,
    contributionAccounts: DeferralDestinationAccount[]
): string | null {
    // Only validate once a deferral is actually configured.
    if (!hasConfiguredDeferral(config)) return null;

    // An empty destination means the deduction applies but nothing is deposited.
    if (!config.matchAccountId) {
        return contributionAccounts.length > 0
            ? 'Choose a Destination Account for your 401k contributions — the '
                + 'deferral lowers your taxes but is never deposited without one, so it '
                + 'silently disappears from your net worth.'
            : 'Create a 401k account in the Accounts tab and select it as the '
                + 'Destination Account — your 401k deferral lowers your taxes but is '
                + 'never deposited without one, so it silently disappears from your net worth.';
    }

    // A dangling id (the account was deleted) deposits nowhere either — the engine
    // only grows accounts that still exist.
    const linked = contributionAccounts.find((acc) => acc.id === config.matchAccountId);
    if (!linked) {
        return 'The Destination Account for your 401k contributions no longer '
            + 'exists. Select a current account — otherwise the deferral lowers your '
            + 'taxes but is never deposited, silently disappearing from your net worth.';
    }

    return null;
}

/**
 * Card-side entry point: validates the 401k deferral destination for a
 * `WorkIncome` instance. Guards the income type, then delegates to the shared,
 * shape-agnostic `getDeferralDestinationMessageFor` so the modal's form-shaped
 * variant reuses the exact same logic (incl. the dangling-id check). Returns null
 * for non-WorkIncome. A dangling id (account deleted) returns a message just like
 * an empty one — the deposit silently fails either way.
 */
export function getDeferralDestinationValidationMessage(
    income: AnyIncome,
    contributionAccounts: InvestedAccount[]
): string | null {
    if (!(income instanceof WorkIncome)) return null;
    return getDeferralDestinationMessageFor(income, contributionAccounts);
}
