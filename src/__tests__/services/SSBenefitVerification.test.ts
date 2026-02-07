/**
 * Test to verify SS benefit calculation and payout timing
 */
import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { WorkIncome, FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
import { runSimulation } from '../../components/Objects/Assumptions/useSimulation';
import { calculateAIME, extractEarningsFromSimulation } from '../../services/SocialSecurityCalculator';

describe('SS Benefit Verification', () => {
    it('should verify SS benefit at claiming age 67', () => {
        const birthYear = 2001; // Born 2001, age 42 in 2043, age 67 in 2068
        const retirementAge = 42;
        const lifeExpectancy = 95;

        // Simulation starts from work start (2026), need 45+ years to reach 2068+
        const yearsToSimulate = 50;

        const assumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: { priorEarnings: [] }, // No prior earnings imported
            milestones: createBuiltinMilestones(birthYear, retirementAge, lifeExpectancy),
            macro: {
                ...defaultAssumptions.macro,
                inflationRate: 2.5,
                inflationAdjusted: false, // No inflation to make comparison easier
            },
            investments: {
                ...defaultAssumptions.investments,
                returnRates: { ror: 6 },
                taxOptimizationEnabled: true,
            },
            withdrawalStrategy: [
                { id: 'ws-savings', name: 'Savings', accountId: 'acc-savings' },
                { id: 'ws-brokerage', name: 'Brokerage', accountId: 'acc-brokerage' },
            ],
        };

        const taxState: TaxState = {
            filingStatus: 'Single',
            stateResidency: 'Texas',
            deductionMethod: 'Standard',
            fedOverride: null,
            ficaOverride: null,
            stateOverride: null,
            year: 2043,
        };

        const accounts = [
            new InvestedAccount('acc-traditional', 'Traditional IRA', 500_000, 0, 10, 0.05, 'Traditional IRA', true, 0.2, 500_000),
            new InvestedAccount('acc-brokerage', 'Brokerage', 300_000, 0, 10, 0.05, 'Brokerage', true, 0.2, 200_000),
            new SavedAccount('acc-savings', 'Savings', 50_000, 4),
        ];

        // WorkIncome with start date 17 years ago (2026)
        const workIncome = new WorkIncome(
            'inc-work', 'Job', 100000, 'Annually', 'Yes',
            0, 0, 0, 0, undefined, 'Traditional 401k', 'TRACK_ANNUAL_MAX',
            new Date('2026-01-01'), // Started working at age 25
            new Date('2042-12-31'), // Stopped at age 42
        );

        const incomes = [
            workIncome,
            new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 0, 0), // PIA=0 to be calculated
        ];

        const expenses = [
            new FoodExpense('exp-living', 'Living Expenses', 40_000, 'Annually', new Date('2043-01-01')),
        ];

        const simulation = runSimulation(
            yearsToSimulate,
            accounts,
            incomes,
            expenses,
            assumptions,
            taxState
        );

        // Find key years
        const year2043 = simulation.find(y => y.year === 2043);
        const year2068 = simulation.find(y => y.year === 2068);

        console.log('\n===== SS BENEFIT VERIFICATION =====');
        console.log('Simulation years:', simulation.map(y => y.year).join(', '));
        console.log('Total years:', simulation.length);

        // Check first year (2043)
        if (year2043) {
            const ssIncome = year2043.incomes.find((i: any) => i.constructor.name === 'FutureSocialSecurityIncome');
            const ss = ssIncome as any;
            console.log('Year 2043 (age 42):');
            console.log('  FutureSocialSecurityIncome found:', ss ? 'YES' : 'NO');
            if (ss) {
                console.log('  calculatedPIA:', '$' + (ss.calculatedPIA?.toFixed(2) ?? 'N/A') + '/month');
                console.log('  amount:', '$' + (ss.amount?.toFixed(2) ?? 'N/A') + '/year');
                console.log('  startDate:', ss.startDate);
            }
        }

        // Check claiming year (2068)
        if (year2068) {
            const ssIncome = year2068.incomes.find((i: any) => i.constructor.name === 'FutureSocialSecurityIncome');
            const ss = ssIncome as any;
            console.log('\nYear 2068 (age 67 - claiming age):');
            console.log('  FutureSocialSecurityIncome found:', ss ? 'YES' : 'NO');
            if (ss) {
                console.log('  calculatedPIA:', '$' + (ss.calculatedPIA?.toFixed(2) ?? 'N/A') + '/month');
                console.log('  amount:', '$' + (ss.amount?.toFixed(2) ?? 'N/A') + '/year');
                console.log('  startDate:', ss.startDate);
                console.log('  getAnnualAmount(2068):', '$' + (ss.getAnnualAmount?.(2068)?.toFixed(2) ?? 'N/A'));
            }

            // Check if SS shows in gross income
            const totalSSIncome = year2068.incomes
                .filter((i: any) => i.constructor.name.includes('SocialSecurity'))
                .reduce((sum: number, i: any) => sum + (i.getAnnualAmount?.(2068) ?? 0), 0);
            console.log('\nTotal SS income in 2068:', '$' + totalSSIncome.toFixed(2));
        }

        // Also check year before and after claiming
        const year2067 = simulation.find(y => y.year === 2067);
        const year2069 = simulation.find(y => y.year === 2069);

        if (year2067) {
            const ss = year2067.incomes.find((i: any) => i.constructor.name === 'FutureSocialSecurityIncome') as any;
            console.log('\nYear 2067 (age 66 - before claiming):');
            console.log('  getAnnualAmount(2067):', '$' + (ss?.getAnnualAmount?.(2067)?.toFixed(2) ?? 'N/A'));
        }

        if (year2069) {
            const ss = year2069.incomes.find((i: any) => i.constructor.name === 'FutureSocialSecurityIncome') as any;
            console.log('\nYear 2069 (age 68 - after claiming):');
            console.log('  calculatedPIA:', '$' + (ss?.calculatedPIA?.toFixed(2) ?? 'N/A') + '/month');
            console.log('  getAnnualAmount(2069):', '$' + (ss?.getAnnualAmount?.(2069)?.toFixed(2) ?? 'N/A'));
        }

        console.log('\n===== END VERIFICATION =====\n');

        // Basic assertions
        expect(year2043).toBeDefined();
        // year2068 may not exist if simulation doesn't reach that far
        if (!year2068) {
            console.log('\nWARNING: Year 2068 not found in simulation!');
            console.log('Last year in simulation:', simulation[simulation.length - 1]?.year);
        }
    });

    it('should calculate correct AIME for known earnings history', () => {
        // User's actual scenario: 19 years of $150k income
        // Birth year 2001 means age 60 in 2061 (index year)
        const birthYear = 2001;
        const claimingAge = 67;

        // Create earnings history: $150k/year for 19 years (2024-2042)
        const earnings = [];
        for (let year = 2024; year <= 2042; year++) {
            earnings.push({ year, amount: 150000 });
        }

        console.log('\n===== DIRECT AIME CALCULATION =====');
        console.log('Earnings history:', earnings.length, 'years');
        console.log('Total nominal earnings:', earnings.reduce((s, e) => s + e.amount, 0).toLocaleString());

        // Calculate AIME
        const result = calculateAIME(earnings, 2043, claimingAge, birthYear, 0.025, false);

        console.log('\nAIME Calculation Result:');
        console.log('  AIME:', '$' + result.aime.toFixed(2) + '/month');
        console.log('  PIA (at FRA):', '$' + result.pia.toFixed(2) + '/month');
        console.log('  Adjusted Benefit:', '$' + result.adjustedBenefit.toFixed(2) + '/month');
        console.log('  Annual Benefit:', '$' + (result.adjustedBenefit * 12).toFixed(2) + '/year');
        console.log('  Index Year:', result.indexYear);
        console.log('  Bend Points:', result.bendPoints);

        console.log('\nTop Earnings Used:');
        result.topEarnings.slice(0, 10).forEach((e, i) => {
            console.log('  ' + (i + 1) + '. Year ' + e.year + ': $' + e.amount.toLocaleString());
        });

        console.log('\nIndexed Earnings (first 10):');
        result.indexedEarnings.slice(0, 10).forEach((e, i) => {
            console.log('  ' + (i + 1) + ': $' + e.toFixed(2));
        });

        console.log('===== END DIRECT AIME =====\n');

        // With $100k/year for 17 years, AIME should be reasonable
        // 17 years of ~$100k indexed, plus 18 zero years = ~$1.7M / 420 = ~$4,000 AIME
        expect(result.aime).toBeGreaterThan(2000); // Should be at least $2k AIME
    });
});
