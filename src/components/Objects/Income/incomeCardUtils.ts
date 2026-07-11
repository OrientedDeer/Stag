import {
    type AnyIncome,
    WorkIncome,
    FutureSocialSecurityIncome,
    FERSPensionIncome,
    CSRSPensionIncome,
    PassiveIncome,
    WindfallIncome,
    INCOME_COLORS_BACKGROUND,
    type IncomeFrequency,
    type AutoMax401kOption,
    isSocialSecurity,
} from './models';
import { hasWindowEnded } from '../modelUtils';
import { isActiveRSUGrant } from './rsuGrant';
import { formatCompactCurrency } from '../../../tabs/Future/tabs/FutureUtils';
import { get401kLimit, getHSALimit } from '../../../data/ContributionLimits';
import { getFrequencyAbbrev } from '../../../utils/formatters';
import type { RSUAccount, ESPPAccount, InvestedAccount } from '../Accounts/models';
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
        // Match the expanded card's preference order (sim-resolved first, then the
        // live field) so the collapsed header and the card never disagree (#133).
        const benefit = simResolvedPensionBenefit ?? (income.calculatedBenefit > 0 ? income.calculatedBenefit : 0);
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
 * Timing hint for the collapsed card header. A future-dated income renders the
 * same "$X/yr" as a live one — and is silently absent from the Income Breakdown
 * above — so flag it with "starts YYYY"; an income whose fixed end date has
 * passed gets "ended YYYY". Returns null for an active source. Milestone-gated
 * starts (no fixed startDate) are skipped — not cheaply resolvable. Month
 * granularity matches isWindowActiveInCurrentMonth/hasWindowEnded.
 */
export function getIncomeTimingHint(income: AnyIncome): string | null {
    const today = new Date();
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    if (income.startDate) {
        const s = income.startDate;
        if (new Date(s.getFullYear(), s.getMonth(), 1) > currentMonthStart) {
            return `starts ${s.getFullYear()}`;
        }
    }
    if (income.end_date && hasWindowEnded({ startDate: income.startDate, endDate: income.end_date })) {
        return `ended ${income.end_date.getFullYear()}`;
    }
    return null;
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
    return getRSUPriceValidationMessageFor(income, rsuAccounts);
}

/**
 * Structural shape of the RSU config the price validation reads. Both the
 * `WorkIncome` model (card side) and the `IncomeFormState` (Add Income modal)
 * satisfy it, so the shared value-based RSUFields component runs the same
 * validation regardless of which editor drives it.
 */
export interface RSUValidationConfig {
    rsuVestingSchedule: 'NONE' | 'cliff-1yr' | 'graded-3yr' | 'graded-4yr';
    rsuGrantShares: number;
    startDate?: Date;
    // A milestone-started grant (no fixed startDate) still has an anchor: the
    // engine vests it on Jan 1 of the milestone year (resolveRSUAnchorDate, #131).
    // So a grant with a startMilestoneId is NOT a "no-anchor" case. Optional, so
    // the modal's form shape (which has no milestone field) satisfies it as
    // undefined and the card's WorkIncome (startMilestoneId?: string) supplies it.
    startMilestoneId?: string;
    rsuAccountId: string | null;
}

/**
 * Shared, shape-agnostic core of the RSU price validation. Operates on the
 * structural `RSUValidationConfig` so the card's `WorkIncome` instance and the
 * modal's `IncomeFormState` form object converge on ONE implementation. See
 * `getRSUPriceValidationMessage` for the full rationale; this carries the logic.
 * Pure so it's testable.
 *
 * Single-sourced with the results-surface predicate: it delegates to the SAME
 * {@link classifyNonVestingRSU} core and only surfaces the `'no-price'` cause as a
 * banner here. The no-anchor / no-account causes have their own dedicated copy in
 * the RSU section (the account dropdown / `rsuGrantNeedsAccount` banner), so the
 * card and FutureTab can never describe one grant differently (#132 finding [6]).
 */
export function getRSUPriceValidationMessageFor(
    config: RSUValidationConfig,
    rsuAccounts: RSUAccount[]
): string | null {
    // The shared classifier returns 'no-price' only when there IS a real grant
    // with a valid anchor and an existing linked account whose price is unset/≤0 —
    // exactly the condition this price banner should fire on.
    if (classifyNonVestingRSU(config, rsuAccounts) !== 'no-price') return null;

    const linked = rsuAccounts.find((acc) => acc.id === config.rsuAccountId);
    // `linked` is guaranteed by the 'no-price' classification (it only returns
    // 'no-price' for an existing account), but narrow for the type-checker.
    if (!linked) return null;

    return `Set a Current Share Price on the "${linked.name}" RSU account — `
        + 'an RSU grant with a vesting schedule needs a price to value each vest, '
        + 'otherwise the projection shows $0.';
}

/**
 * Whether an RSU grant is configured (ACTIVE — a vesting schedule AND shares > 0,
 * per the engine's single-source-of-truth `isActiveRSUGrant`) but has no EXISTING
 * linked account. Catches both an unset id AND a DANGLING id (the linked RSU
 * account was deleted, leaving a truthy-but-orphaned id) — in either case
 * processRSUVesting can't resolve an account and the grant silently never vests.
 *
 * One gate for the card-level warning and the in-section RSUFields banners so they
 * can't diverge (#141 review): a 0-share grant won't vest regardless, so it must
 * NOT alarm; a dangling id MUST.
 */
export function rsuGrantNeedsAccount(
    config: { rsuVestingSchedule: RSUValidationConfig['rsuVestingSchedule']; rsuGrantShares: number; rsuAccountId: string | null },
    rsuAccounts: RSUAccount[],
): boolean {
    return isActiveRSUGrant(config) && !rsuAccounts.some(acc => acc.id === config.rsuAccountId);
}

/**
 * Why a configured RSU grant recognizes $0 at vest. Mirrors the engine's STATIC
 * skip conditions in `processRSUVesting` (src/services/simulation/RSUVesting.ts)
 * that a results-level reader can detect without running the simulation:
 *
 * - `'no-anchor'` → the grant has NEITHER a fixed `startDate` NOR a
 *   `startMilestoneId`, so `resolveRSUAnchorDate` returns undefined and the engine
 *   skips with `if (!anchorDate) return`. A grant with a `startMilestoneId` DOES
 *   vest (anchored on Jan 1 of the milestone year, #131), so it is NOT flagged —
 *   whether that milestone fires inside the horizon is sim-dependent and must not
 *   be guessed by a static predicate.
 * - `'no-account'` → no linked RSU account: an unset `rsuAccountId`, OR a dangling
 *   id that resolves to no existing RSUAccount. Either way `processRSUVesting`
 *   can't resolve an account (`if (!inc.rsuAccountId) return` / the `!rsuAccount`
 *   skip) and the grant silently never vests. (The CARD already shows this via its
 *   own #141 badge / `rsuGrantNeedsAccount`; FutureTab needs it too so the $0
 *   doesn't land silently in the headline — finding [5].)
 * - `'no-price'` → the linked RSUAccount has no positive `currentSharePrice`, so
 *   `projectFMVAtVest` returns 0 and the engine SKIPS vest recognition
 *   (`if (fmvAtVest <= 0) return`, with a per-year `[WARN]`).
 */
export type NonVestingRSUReason = 'no-anchor' | 'no-account' | 'no-price';

/**
 * Structural shape the non-vesting classifier reads. `WorkIncome` and the modal's
 * `RSUValidationConfig` both satisfy it; kept structural so it stays testable
 * without minting a full model instance. `end_date` is read only by the
 * income-level reader's ended-job suppression.
 */
export interface NonVestingRSUConfig {
    rsuVestingSchedule: RSUValidationConfig['rsuVestingSchedule'];
    rsuGrantShares: number;
    rsuAccountId: string | null;
    startDate?: Date;
    startMilestoneId?: string;
    end_date?: Date;
}

/**
 * Shared CORE that classifies why a configured RSU grant won't vest, matching the
 * engine's static skip conditions in order: anchor → account → price. Returns null
 * for a grant that vests fine (or isn't a real grant). This is the SINGLE source
 * both the card's price validation (`getRSUPriceValidationMessageFor`) and the
 * FutureTab results warning (`getNonVestingRSUReason`) consume, so the two surfaces
 * can never classify the same grant differently (#132 finding [6]).
 *
 * Does NOT apply the ended-job suppression — that's forward-looking, results-only
 * policy layered on by {@link getNonVestingRSUReason}; the card's price validation
 * must still fire on an in-section grant regardless of its window.
 */
export function classifyNonVestingRSU(
    config: NonVestingRSUConfig,
    rsuAccounts: RSUAccount[],
): NonVestingRSUReason | null {
    // Only flag a real, configured grant — never a 0-share / NONE income.
    if (!isActiveRSUGrant(config)) return null;

    // No anchor at all → engine recognizes no vest (resolveRSUAnchorDate is
    // undefined). A startMilestoneId IS an anchor, so only flag when BOTH are unset.
    if (!config.startDate && !config.startMilestoneId) return 'no-anchor';

    // No EXISTING linked account: unset id OR a dangling id (account deleted).
    // Mirrors processRSUVesting's `!inc.rsuAccountId` / `!rsuAccount` skips.
    if (!config.rsuAccountId) return 'no-account';
    const linked = rsuAccounts.find(acc => acc.id === config.rsuAccountId);
    if (!linked) return 'no-account';

    // No positive current share price → engine skips with fmvAtVest <= 0.
    if (!linked.currentSharePrice || linked.currentSharePrice <= 0) return 'no-price';

    return null;
}

/**
 * Why a work income's CONFIGURED RSU grant won't vest (recognizes $0), or `null`
 * when it vests fine / isn't a real grant. The results-surface entry point for the
 * #132 projection warning: it layers a forward-looking ENDED-JOB suppression on top
 * of the shared {@link classifyNonVestingRSU} core, so the FutureTab banner stays
 * single-sourced with the card's price validation:
 *
 * 1. A job that has definitively ENDED → null. Its grant can no longer vest, so a
 *    $0 can't reach a forward-looking headline — mirrors the card's `!incomeEnded`
 *    suppression (#141).
 * 2. Otherwise → the shared classifier's reason: `'no-anchor'`, `'no-account'`, or
 *    `'no-price'` (or null when the grant vests fine).
 *
 * Pure so it's testable. Reads structurally (no instanceof) so the caller filters
 * to WorkIncome first.
 */
export function getNonVestingRSUReason(
    config: NonVestingRSUConfig,
    rsuAccounts: RSUAccount[],
): NonVestingRSUReason | null {
    // A finished job's grant can't vest going forward → no misleading $0. Mirrors
    // hasIncomeEnded() (hasWindowEnded over the income's start/end window); called
    // structurally so this predicate stays shape-based. Gate it on a real grant
    // first so a non-grant income never short-circuits here.
    if (isActiveRSUGrant(config)
        && hasWindowEnded({ startDate: config.startDate, endDate: config.end_date })) {
        return null;
    }
    return classifyNonVestingRSU(config, rsuAccounts);
}

/**
 * The income-level entry point used by the results surface (#132): returns the
 * non-vesting reason for a `WorkIncome`, or null for any other income type (only a
 * WorkIncome carries an RSU grant). Delegates to the shape-agnostic
 * {@link getNonVestingRSUReason} so the predicate stays single-sourced.
 */
export function getIncomeNonVestingRSUReason(
    income: AnyIncome,
    rsuAccounts: RSUAccount[],
): NonVestingRSUReason | null {
    if (!(income instanceof WorkIncome)) return null;
    return getNonVestingRSUReason(income, rsuAccounts);
}

/**
 * ESPP analogue of {@link rsuGrantNeedsAccount}: an ESPP contribution is configured
 * AND non-zero (a PERCENTAGE/FIXED type with amount > 0 — mirroring the RSU side's
 * shares > 0 gate so a half-configured 0% contribution doesn't false-alarm) but no
 * EXISTING ESPP account is linked (unset OR dangling id).
 */
export function esppGrantNeedsAccount(
    config: { esppContributionType: 'NONE' | 'PERCENTAGE' | 'FIXED'; esppContributionAmount: number; esppAccountId: string | null },
    esppAccounts: ESPPAccount[],
): boolean {
    return config.esppContributionType !== 'NONE'
        && config.esppContributionAmount > 0
        && !esppAccounts.some(acc => acc.id === config.esppAccountId);
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
