/**
 * The federal 65+ deductions (IRC §63(f) additional standard deduction + OBBBA
 * §151(d)(5) senior bonus) must also shelter Traditional IRA/401k withdrawals.
 *
 * #191 folded them into the solver's `fedParams`, but that only reaches the
 * base-income tax. Withdrawal tax is priced by planWithdrawals, which fetched its
 * own RAW parameters — so a retiree living off a Traditional IRA (base income
 * below the deduction) had the senior add-ons silently discarded: the unused
 * deduction space on the base side was wasted, and the withdrawal was taxed as if
 * the filer were under 65.
 */
import { describe, it, expect } from 'vitest';

import * as TaxService from '../../../components/Objects/Taxes/TaxService';
import { solveRetirementYear, type YearSolverInput } from '../../../services/simulation/YearSolver';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';

const YEAR = 2025;
const AGE = 66;
const LIVING = 40_000;

function buildInput(): YearSolverInput {
    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(YEAR - AGE, 65, 95),
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: false,
            returnRates: { ror: 5 },
        },
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Traditional IRA', accountId: 'trad-1' },
        ],
    };
    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'Texas',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: YEAR,
    };
    const living = new OtherExpense('living-1', 'Living Expenses', LIVING, 'Annually', new Date(2020, 0, 1));
    const trad = new InvestedAccount(
        'trad-1', 'Traditional IRA', 1_000_000, 0, 10, 0, 'Traditional IRA', true, 0.2, 1_000_000,
    );

    return {
        year: YEAR,
        currentAge: AGE,
        isRetired: true,
        incomes: [],
        expenses: [living],
        totalLivingExpenses: LIVING,
        rmdAmount: 0,
        accounts: [trad],
        withdrawalOrder: [{ accountId: 'trad-1' }],
        taxState,
        assumptions,
        taxOptimizationEnabled: false,
        acaAware: false,
    };
}

describe('senior deduction shelters Traditional withdrawals', () => {
    it('taxes a 66-year-old\'s IRA withdrawal with the 65+ standard deduction', () => {
        const input = buildInput();
        const plan = solveRetirementYear(input);

        const gross = plan.withdrawals
            .filter(w => w.source === 'traditional_ira')
            .reduce((s, w) => s + w.gross, 0);
        expect(gross).toBeGreaterThan(LIVING);

        const raw = TaxService.getTaxParameters(YEAR, 'Single', 'federal', undefined, input.assumptions);
        if (!raw) throw new Error('no federal params');
        // 2025 Single 65+: $15,750 + $2,000 regular + $6,000 OBBBA bonus (MAGI < $75k).
        const withSenior = TaxService.calculateTotalFederalTax(
            gross, 0, 0, 0, 0, 'Single',
            { ...raw, standardDeduction: raw.standardDeduction + 2000 + 6000 },
        ).totalTax;
        const withRaw = TaxService.calculateTotalFederalTax(gross, 0, 0, 0, 0, 'Single', raw).totalTax;
        expect(withRaw - withSenior).toBeGreaterThan(900);

        // Texas: no state tax, no FICA in retirement → every tax dollar is federal.
        expect(plan.tax.total).toBeCloseTo(withSenior, 0);
        // The withdrawal must be sized for the lower tax, not the raw-deduction tax.
        expect(gross).toBeCloseTo(LIVING + withSenior, 0);
    });
});
