import { type AnyAccount, RSUAccount, type RSULot } from "../../components/Objects/Accounts/models";
import { type AnyIncome, WorkIncome, PassiveIncome, getIncomeActiveMultiplier } from "../../components/Objects/Income/models";
import { isActiveRSUGrant } from "../../components/Objects/Income/rsuGrant";

export interface RSUVestingResult {
    /**
     * Synthetic income objects representing this year's RSU vest value. Modeled
     * as earned (W-2 supplemental) income so they flow through the normal income
     * path: federal/state ordinary tax, FICA, the income breakdown, and the
     * Testing "Income & Expenses" panel. One entry per linked RSU account.
     */
    vestIncomes: PassiveIncome[];
    /**
     * Net-share lots to add to each RSU account (after sell-to-cover withholding),
     * keyed by RSU account id. Applied in growAccounts (parallel to esppLots).
     */
    rsuLots: Record<string, RSULot[]>;
    /**
     * Total tax withheld at vest across all grants this year. Tracked as an
     * estimated-tax prepayment that offsets the year's tax owed.
     */
    totalWithholding: number;
    /**
     * Sell-to-cover withholding per synthetic vest income, keyed by the vest
     * income's id. The vest is recognized at GROSS but only the NET shares land
     * in the account; the Cashflow Sankey uses this to net the reinvested outflow
     * (the withheld slice flows to Taxes, not to savings) so Net Pay stays
     * balanced on a vest year (gross in = net-reinvested + withheld-as-tax).
     */
    vestWithholdingByIncomeId: Record<string, number>;
    /**
     * The source RSU account id per synthetic vest income, keyed by the vest
     * income's id. The vest income's destination account is KNOWN here at mint
     * time (`rsuAccount.id`), so the Cashflow Sankey resolves the destination by
     * EXACT id from this map instead of reverse-engineering it from the vest id
     * string — which is genuinely ambiguous because account/income ids can both
     * contain hyphens (e.g. account `rsu` vs `rsu-2` with an income whose id
     * starts with `2-`).
     */
    vestAccountIdByIncomeId: Record<string, string>;
    logs: string[];
}

/**
 * Compute the projected fair-market value per share at a vest year.
 *
 * Seeds from the linked RSU account's currentSharePrice and compounds it by the
 * income's rsuExpectedStockGrowth from the SIMULATION'S CURRENT YEAR to the vest
 * year. currentSharePrice is TODAY's price, so the compounding base is the
 * current simulation year — NOT the grant year, which would double-count the
 * growth already baked into today's price. This FMV is both the ordinary income
 * per share at vest AND the lot's per-share cost basis.
 *
 * Returns 0 when no current price is set (the UI maps a blank price to undefined
 * and does not require it). The caller SKIPS vest recognition in that case rather
 * than fabricating a $100/share reference — see the `fmvAtVest > 0` guard, which
 * mirrors the RSU SALE path's `fmvPerShare > 0` guard. A fabricated FMV would
 * recognize grossIncome = shares × $100 of taxable ordinary income from nothing,
 * inflating AGI/FICA/SS-taxability/IRMAA/ACA and seeding a bogus cost-basis lot.
 */
function projectFMVAtVest(
    currentSharePrice: number | undefined,
    expectedStockGrowthPct: number,
    currentSimYear: number,
    vestYear: number,
): number {
    if (!currentSharePrice || currentSharePrice <= 0) return 0;
    const yearsElapsed = Math.max(0, vestYear - currentSimYear);
    return currentSharePrice * Math.pow(1 + expectedStockGrowthPct / 100, yearsElapsed);
}

/**
 * Resolve the grant-date anchor a WorkIncome's RSU schedule vests against.
 *
 * - Fixed start: the income's own `startDate` (unchanged behavior).
 * - Milestone start (`startDate` undefined, `startMilestoneId` set): Jan 1 of the
 *   year that milestone fired in this path, via `resolveMilestoneYear` (#131).
 *   Built LOCAL (new Date(y, 0, 1)) per the repo's date-only convention.
 * - Neither resolvable → undefined → the caller skips vesting (no anchor to
 *   schedule against; matches the salary, which also doesn't pay pre-milestone).
 */
function resolveRSUAnchorDate(
    inc: WorkIncome,
    resolveMilestoneYear?: (milestoneId: string) => number | undefined,
): Date | undefined {
    if (inc.startDate) return inc.startDate;
    if (inc.startMilestoneId && resolveMilestoneYear) {
        const resolvedYear = resolveMilestoneYear(inc.startMilestoneId);
        if (resolvedYear !== undefined) return new Date(resolvedYear, 0, 1);
    }
    return undefined;
}

/**
 * Process RSU vesting for a single simulation year.
 *
 * For each WorkIncome with an RSU schedule linked to an RSUAccount:
 * 1. Determine shares vesting this year from the schedule (getAnnualRSUVestShares).
 * 2. Project FMV at vest = currentSharePrice compounded by expected growth.
 * 3. Recognize gross vest value (grossShares * fmvAtVest) as ordinary income.
 * 4. Apply sell-to-cover withholding: the company sells the withholding slice;
 *    the user nets the remainder. Net shares form the lot, withheld value is an
 *    estimated-tax prepayment.
 *
 * Income recognition uses the GROSS value (the whole vest is taxable wages); the
 * lot is built from NET shares (sell-to-cover is mathematically identical to
 * net-settlement). The withheld amount offsets tax owed in the engine.
 */
export function processRSUVesting(
    incomes: AnyIncome[],
    accounts: AnyAccount[],
    year: number,
    currentSimYear: number,
    logs: string[],
    // Resolve a startMilestoneId to the calendar year that milestone fired in
    // this path (undefined if it hasn't fired yet / in-horizon). Supplied by the
    // engine, which already tracks milestone reach-years. Lets a MILESTONE-started
    // grant (no fixed startDate) vest anchored to the resolved start year — see
    // issue #131. Optional so direct callers that only use fixed-startDate grants
    // need not pass it.
    resolveMilestoneYear?: (milestoneId: string) => number | undefined,
): RSUVestingResult {
    const vestIncomes: PassiveIncome[] = [];
    const rsuLots: Record<string, RSULot[]> = {};
    const vestWithholdingByIncomeId: Record<string, number> = {};
    const vestAccountIdByIncomeId: Record<string, string> = {};
    let totalWithholding = 0;

    incomes.forEach(inc => {
        if (!(inc instanceof WorkIncome)) return;
        if (!isActiveRSUGrant(inc)) return;
        if (!inc.rsuAccountId) return;

        // Anchor the vest schedule. Fixed-startDate grants anchor on startDate.
        // A milestone-started grant (no startDate) anchors on Jan 1 of the year
        // its startMilestoneId fired in this path (#131). With neither, there is
        // nothing to schedule against — skip (matches the salary, which also
        // doesn't pay until the milestone fires).
        const anchorDate = resolveRSUAnchorDate(inc, resolveMilestoneYear);
        if (!anchorDate) return;

        // Per-event vest dates so each lot is stamped with its REAL vest date
        // (grant month + tranche offset), not a flat Jan-1 bucket — long-term /
        // minimum-holding eligibility depend on the actual date.
        const vestEvents = inc.getRSUVestEventsForYear(year, anchorDate);
        const grossShares = vestEvents.reduce((sum, ev) => sum + ev.shares, 0);
        if (grossShares <= 0) return;

        const rsuAccount = accounts.find(
            acc => acc.id === inc.rsuAccountId && acc instanceof RSUAccount
        ) as RSUAccount | undefined;
        if (!rsuAccount) {
            logs.push(`[WARN] RSU account ${inc.rsuAccountId} not found for ${inc.name}`);
            return;
        }

        // All events in the same calendar year share the same projected FMV
        // (compounded to `year`), so compute it once and reuse per lot.
        const fmvAtVest = projectFMVAtVest(
            rsuAccount.currentSharePrice,
            inc.rsuExpectedStockGrowth,
            currentSimYear,
            year,
        );

        // No current share price → SKIP vest recognition rather than fabricate a
        // $100/share reference. Mirrors the SALE path's `fmvPerShare > 0` guard:
        // a made-up FMV would recognize ordinary income (and FICA) from nothing
        // and seed a bogus cost-basis lot.
        if (fmvAtVest <= 0) {
            logs.push(
                `[WARN] RSU: ${inc.name} has ${grossShares.toFixed(2)} shares vesting in ${year} ` +
                `but its linked account has no current share price set — vest recognition skipped`
            );
            return;
        }

        const grossIncome = grossShares * fmvAtVest;

        // Sell-to-cover: the company sells `withholdingRate` of the shares to
        // cover tax. The user nets the remainder; each lot is built from net
        // shares. Net-settlement is mathematically identical.
        const withholdingRate = Math.max(0, Math.min(inc.rsuWithholdingRate, 100)) / 100;
        const withholding = grossIncome * withholdingRate;
        const netSharesTotal = grossShares * (1 - withholdingRate);

        totalWithholding += withholding;

        // Recognize the FULL gross vest value as ordinary (earned) income. A
        // separate PassiveIncome per account keeps the income breakdown legible.
        // Local Jan-1..Dec-31 window → clean full-year multiplier in any timezone.
        const vestIncomeId = `rsu-vest-${rsuAccount.id}-${inc.id}-${year}`;
        vestWithholdingByIncomeId[vestIncomeId] = withholding;
        // Record the KNOWN source account id so the Sankey can resolve the vest's
        // destination by exact id rather than parsing it back out of vestIncomeId.
        vestAccountIdByIncomeId[vestIncomeId] = rsuAccount.id;
        vestIncomes.push(new PassiveIncome(
            vestIncomeId,
            `${inc.name} RSU Vest`,
            grossIncome,
            'Annually',
            'Yes',          // earned income → feeds FICA in addition to ordinary tax
            'RSU',          // distinct sourceType so projectIncomes regenerates it each year
            new Date(year, 0, 1),
            new Date(year, 11, 31),
            // Reinvested: the vest is taxable W-2 income but produces NO spendable
            // cash — the user receives shares (which land in the RSU account via the
            // net-share lot), not cash. The sell-to-cover withholding pays the tax;
            // any shortfall (if the user lowers the rate) reduces spendable cash via
            // the engine's withholding offset. This avoids overstating cash inflow by
            // the full gross vest value.
            true,
        ));

        // Build one net-share lot per vest event, stamped with the event's real
        // vest date. fmvAtVest is both the ordinary income per share AND the
        // cost basis per share for future capital gains. The withholding slice
        // is applied per-event so the net shares sum to netSharesTotal.
        if (!rsuLots[rsuAccount.id]) rsuLots[rsuAccount.id] = [];
        vestEvents.forEach((ev, idx) => {
            const netShares = ev.shares * (1 - withholdingRate);
            if (netShares <= 0) return;
            rsuLots[rsuAccount.id].push({
                id: `RSU-LOT-${year}-${inc.id}-${idx}`,
                grantDate: new Date(anchorDate),
                vestDate: ev.vestDate,
                fmvAtVest,
                shares: netShares,
                costBasis: fmvAtVest * netShares,
            });
        });

        logs.push(
            `[FLOW] RSU: ${inc.name} vested ${grossShares.toFixed(2)} shares @ $${fmvAtVest.toFixed(2)} ` +
            `(gross $${Math.round(grossIncome).toLocaleString()}, withheld $${Math.round(withholding).toLocaleString()} ` +
            `at ${(withholdingRate * 100).toFixed(0)}%, net ${netSharesTotal.toFixed(2)} shares across ${vestEvents.length} event(s))`
        );
    });

    return { vestIncomes, rsuLots, totalWithholding, vestWithholdingByIncomeId, vestAccountIdByIncomeId, logs };
}

/** Sum the active-prorated vest income for the year (used for sanity/tests). */
export function getTotalRSUVestIncome(vestIncomes: PassiveIncome[], year: number): number {
    return vestIncomes.reduce((sum, inc) => {
        const mult = getIncomeActiveMultiplier(inc, year);
        return sum + inc.amount * mult;
    }, 0);
}
