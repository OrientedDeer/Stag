import { describe, it, expect } from 'vitest';
import { computeOverviewBuckets } from '../../../tabs/Future/tabs/OverviewTab';
import { calculateNetWorth } from '../../../tabs/Future/tabs/FutureUtils';
import {
    InvestedAccount,
    SavedAccount,
    PropertyAccount,
    DebtAccount,
    ESPPAccount,
    RSUAccount,
    AnyAccount,
} from '../../../components/Objects/Accounts/models';

/**
 * Regression: the Overview net-worth chart/tooltip summed assets only via
 * instanceof InvestedAccount/SavedAccount/PropertyAccount. ESPPAccount and
 * RSUAccount extend BaseAccount directly, so their balances were silently
 * dropped — understating net worth and disagreeing with the Assets sub-tab,
 * getAccountTotals, and calculateNetWorth on the same page.
 */
describe('OverviewTab net worth includes ESPP and RSU balances', () => {
    const buildPortfolio = (): AnyAccount[] => [
        new InvestedAccount('inv', 'Brokerage', 400_000),
        new SavedAccount('sav', 'Cash', 50_000),
        // Owned outright: loanAmount 0, so the house is a pure asset (no liability).
        new PropertyAccount('prop', 'House', 300_000, 'Owned', 0, 0, ''),
        new ESPPAccount('espp', 'Company ESPP', 75_000),
        new RSUAccount('rsu', 'Company RSU', 200_000),
        new DebtAccount('debt', 'Credit Card', 10_000, ''),
    ];

    it('folds ESPP and RSU into the asset buckets', () => {
        const accounts = buildPortfolio();
        const buckets = computeOverviewBuckets(accounts, []);

        // ESPP + RSU = 275k must appear somewhere in the asset buckets.
        const totalAssets = buckets.Invested + buckets.Saved + buckets.Property;
        // Brokerage 400k + Cash 50k + House 300k + ESPP 75k + RSU 200k = 1,025,000
        expect(totalAssets).toBe(1_025_000);
    });

    it('matches calculateNetWorth (assets minus liabilities)', () => {
        const accounts = buildPortfolio();
        const buckets = computeOverviewBuckets(accounts, []);

        // Debt is stored as a negative value in the buckets.
        const chartNetWorth =
            buckets.Invested + buckets.Saved + buckets.Property + buckets.Debt;

        expect(chartNetWorth).toBe(calculateNetWorth(accounts));
    });
});
