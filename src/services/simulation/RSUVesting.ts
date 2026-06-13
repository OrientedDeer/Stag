import { AnyAccount, RSUAccount, RSULot } from "../../components/Objects/Accounts/models";
import { AnyIncome, WorkIncome, PassiveIncome, getIncomeActiveMultiplier } from "../../components/Objects/Income/models";

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
    logs: string[];
}

/**
 * Compute the projected fair-market value per share at a vest year.
 *
 * Seeds from the linked RSU account's currentSharePrice and compounds it by the
 * income's rsuExpectedStockGrowth from the grant year to the vest year. This FMV
 * is both the ordinary income per share at vest AND the lot's per-share cost
 * basis. Falls back to a $100 reference price when no current price is set, so
 * vesting still produces a meaningful (relative) projection.
 */
function projectFMVAtVest(
    currentSharePrice: number | undefined,
    expectedStockGrowthPct: number,
    grantYear: number,
    vestYear: number,
): number {
    const basePrice = currentSharePrice && currentSharePrice > 0 ? currentSharePrice : 100;
    const yearsElapsed = Math.max(0, vestYear - grantYear);
    return basePrice * Math.pow(1 + expectedStockGrowthPct / 100, yearsElapsed);
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
    logs: string[],
): RSUVestingResult {
    const vestIncomes: PassiveIncome[] = [];
    const rsuLots: Record<string, RSULot[]> = {};
    let totalWithholding = 0;

    incomes.forEach(inc => {
        if (!(inc instanceof WorkIncome)) return;
        if (inc.rsuVestingSchedule === 'NONE' || inc.rsuGrantShares <= 0) return;
        if (!inc.rsuAccountId) return;
        if (!inc.startDate) return;

        const grossShares = inc.getAnnualRSUVestShares(year);
        if (grossShares <= 0) return;

        const rsuAccount = accounts.find(
            acc => acc.id === inc.rsuAccountId && acc instanceof RSUAccount
        ) as RSUAccount | undefined;
        if (!rsuAccount) {
            logs.push(`[WARN] RSU account ${inc.rsuAccountId} not found for ${inc.name}`);
            return;
        }

        const grantYear = new Date(inc.startDate).getFullYear();
        const fmvAtVest = projectFMVAtVest(
            rsuAccount.currentSharePrice,
            inc.rsuExpectedStockGrowth,
            grantYear,
            year,
        );

        const grossIncome = grossShares * fmvAtVest;

        // Sell-to-cover: the company sells `withholdingRate` of the shares to
        // cover tax. The user nets the remainder; each lot is built from net
        // shares. Net-settlement is mathematically identical.
        const withholdingRate = Math.max(0, Math.min(inc.rsuWithholdingRate, 100)) / 100;
        const withholding = grossIncome * withholdingRate;
        const netShares = grossShares * (1 - withholdingRate);

        totalWithholding += withholding;

        // Recognize the FULL gross vest value as ordinary (earned) income. A
        // separate PassiveIncome per account keeps the income breakdown legible.
        // Local Jan-1..Dec-31 window → clean full-year multiplier in any timezone.
        vestIncomes.push(new PassiveIncome(
            `rsu-vest-${rsuAccount.id}-${inc.id}-${year}`,
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

        // Build the net-share lot. fmvAtVest is both the ordinary income per
        // share AND the cost basis per share for future capital gains.
        const lot: RSULot = {
            id: `RSU-LOT-${year}-${inc.id}`,
            grantDate: new Date(inc.startDate),
            vestDate: new Date(year, 0, 1),
            fmvAtVest,
            shares: netShares,
            costBasis: fmvAtVest * netShares,
        };

        if (!rsuLots[rsuAccount.id]) rsuLots[rsuAccount.id] = [];
        rsuLots[rsuAccount.id].push(lot);

        logs.push(
            `[FLOW] RSU: ${inc.name} vested ${grossShares.toFixed(2)} shares @ $${fmvAtVest.toFixed(2)} ` +
            `(gross $${Math.round(grossIncome).toLocaleString()}, withheld $${Math.round(withholding).toLocaleString()} ` +
            `at ${(withholdingRate * 100).toFixed(0)}%, net ${netShares.toFixed(2)} shares)`
        );
    });

    return { vestIncomes, rsuLots, totalWithholding, logs };
}

/** Sum the active-prorated vest income for the year (used for sanity/tests). */
export function getTotalRSUVestIncome(vestIncomes: PassiveIncome[], year: number): number {
    return vestIncomes.reduce((sum, inc) => {
        const mult = getIncomeActiveMultiplier(inc, year);
        return sum + inc.amount * mult;
    }, 0);
}
