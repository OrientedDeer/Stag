/**
 * #198 — Projected years must honor ITEMIZED (mortgage interest, SALT) and
 * expense-level "Yes" above-the-line deductions, the way year-0
 * (`calculateFederalTaxFromIncomes`) already does.
 *
 * Before this fix the three engine tax-deduction chokepoints (YearSolver
 * retirement + working paths, buildDPYearContexts) applied the STANDARD path
 * only — so an itemizing mortgage-holder saw the deduction on the Taxes tab
 * (year 0) but in NO projected year: a year0→year1 tax cliff and biased Roth
 * headroom.
 *
 * The fix generalizes the helper to getEffectiveDeduction(..., itemizedTotal,
 * deductionMethod) = max(standardPath, itemizedPath) for 'Auto', and precomputes
 * the per-year itemized total + "Yes" above-line total ONCE in SimulationEngine
 * from the ENTERING-balance expense list (NOT the post-increment list, which would
 * return next year's mortgage interest — the §2c off-by-one).
 *
 * All engine assertions here are built from REAL runSimulation output, never a
 * fabricated `SimulationYear.expenses` shape.
 */
import { describe, it, expect } from 'vitest';

import * as TaxService from '../../../components/Objects/Taxes/TaxService';
import { getEffectiveDeduction } from '../../../components/Objects/Taxes/taxService/federalTax';
import { getItemizedDeductions } from '../../../components/Objects/Taxes/taxService/deductions';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount, PropertyAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { MortgageExpense, FoodExpense, CharityExpense } from '../../../components/Objects/Expense/models';
import { SimulationYear } from '../../../services/simulation/types';

// =============================================================================
// getEffectiveDeduction — unit
// =============================================================================

const UNIT_YEAR = 2025;

function fedParamsFor(filing: TaxState['filingStatus'], assumptions?: AssumptionsState) {
    const p = TaxService.getTaxParameters(UNIT_YEAR, filing, 'federal', undefined, assumptions);
    if (!p) throw new Error('no federal params');
    return p;
}

describe('getEffectiveDeduction (#198 unit)', () => {
    it("'Standard' ignores the itemized total entirely", () => {
        const p = fedParamsFor('Single');
        expect(getEffectiveDeduction(p, 'Single', 40, UNIT_YEAR, 50_000, 999_999, 'Standard'))
            .toBe(p.standardDeduction);
    });

    it("'Itemized' returns the itemized total (no regular 65+ add-on) for a working-age filer", () => {
        const p = fedParamsFor('Single');
        expect(getEffectiveDeduction(p, 'Single', 40, UNIT_YEAR, 50_000, 30_000, 'Itemized'))
            .toBe(30_000);
    });

    it("'Auto' picks the larger of standard and itemized", () => {
        const p = fedParamsFor('Single');
        // Itemized $30k beats the ~$15.75k standard.
        expect(getEffectiveDeduction(p, 'Single', 40, UNIT_YEAR, 50_000, 30_000, 'Auto'))
            .toBe(30_000);
        // Itemized $5k loses to the standard deduction.
        expect(getEffectiveDeduction(p, 'Single', 40, UNIT_YEAR, 50_000, 5_000, 'Auto'))
            .toBe(p.standardDeduction);
    });

    it('a 65+ ITEMIZER keeps the OBBBA bonus on the itemized path but LOSES the regular add-on', () => {
        const p = fedParamsFor('Single');
        // 2025 Single senior, low MAGI: regular $2,000 (standard-only) + bonus $6,000 (both paths).
        const itemized = 30_000;
        // Itemized path = itemizedTotal + bonus, NO regular add-on.
        expect(getEffectiveDeduction(p, 'Single', 66, UNIT_YEAR, 40_000, itemized, 'Itemized'))
            .toBe(itemized + 6_000);
        // Standard path (for reference) = std + regular + bonus.
        expect(getEffectiveDeduction(p, 'Single', 66, UNIT_YEAR, 40_000, itemized, 'Standard'))
            .toBe(p.standardDeduction + 2_000 + 6_000);
    });

    it('a 65+ AUTO itemizer compares itemized+bonus against std+regular+bonus', () => {
        const p = fedParamsFor('Single');
        const standardPath = p.standardDeduction + 2_000 + 6_000; // ~$23,750
        // Itemized just below the standard PATH still flips to standard under Auto
        // (the regular add-on is only on the standard side, so a bare itemized total
        // must clear std+regular to win).
        const itemizedLow = p.standardDeduction + 1_000; // + bonus 6k = std+7k < std+8k
        expect(getEffectiveDeduction(p, 'Single', 66, UNIT_YEAR, 40_000, itemizedLow, 'Auto'))
            .toBe(standardPath);
        // A large itemized total wins even after losing the regular add-on.
        const itemizedHigh = p.standardDeduction + 20_000;
        expect(getEffectiveDeduction(p, 'Single', 66, UNIT_YEAR, 40_000, itemizedHigh, 'Auto'))
            .toBe(itemizedHigh + 6_000);
    });
});

// =============================================================================
// Engine — real runSimulation with an itemizing mortgage-holder
// =============================================================================

const START_YEAR = new Date().getFullYear();
const BIRTH_YEAR = START_YEAR - 45; // working-age (no senior add-ons to confound)

function baseTaxState(method: 'Itemized' | 'Auto' | 'Standard', stateResidency = 'Texas'): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency, // Texas ⇒ no state tax ⇒ SALT = 0 ⇒ itemized total is pure mortgage interest
        deductionMethod: method,
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: START_YEAR,
    };
}

const baseAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    demographics: {},
    milestones: createBuiltinMilestones(BIRTH_YEAR, 65, 90),
    income: { ...defaultAssumptions.income, salaryGrowth: 0 },
    macro: {
        ...defaultAssumptions.macro,
        inflationRate: 0,
        inflationAdjusted: false,
        taxBracketShiftPct: 0,
        taxBracketShiftStartYear: 0,
    },
    investments: { ...defaultAssumptions.investments, returnRates: { ror: 5 }, autoRothConversions: false },
    withdrawalStrategy: [],
};

function freshAccounts() {
    return [
        new PropertyAccount('acc-property', 'Home', 400_000, 'Financed', 300_000, 300_000, 'exp-mortgage'),
        new InvestedAccount('acc-savings', 'Savings', 50_000, 0, 10, 0.05, 'Brokerage', true, 1.0, 50_000),
    ];
}
function freshMortgage() {
    // $300k @ 6% / 30yr ⇒ ~$17,900 first-year interest, declining as it amortizes.
    return new MortgageExpense(
        'exp-mortgage', 'Mortgage', 'Monthly', 400_000, 300_000, 300_000, 6.0, 30,
        1.5, 0, 1.0, 200, 0.5, 0.5, 200, 'Itemized', 0, 'acc-property',
        new Date(START_YEAR, 0, 1), 0, 0,
    );
}
const work = new WorkIncome('inc-work', 'Job', 150_000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED');
function freshLiving() {
    return new FoodExpense('exp-living', 'Living', 20_000, 'Annually', new Date(START_YEAR, 0, 1));
}

function runItemized(method: 'Itemized' | 'Auto' | 'Standard', years = 12, stateResidency = 'Texas') {
    return runSimulation(
        years,
        freshAccounts(),
        [work],
        [freshMortgage(), freshLiving()],
        baseAssumptions,
        baseTaxState(method, stateResidency),
    );
}

/** The rows that ran through the projection engine (year 0 + the synthetic EOY row
 *  are built in useSimulation and carry no itemizedDeductionTotal). */
function projectedRows(sim: SimulationYear[]): SimulationYear[] {
    return sim.filter(r => r.itemizedDeductionTotal !== undefined);
}

describe('#198 engine — itemized mortgage deduction in projected years', () => {
    it('stores the itemized total = THIS year\'s (entering-balance) mortgage interest, not next year\'s (off-by-one guard)', () => {
        const sim = runItemized('Itemized');
        const projected = projectedRows(sim);
        expect(projected.length).toBeGreaterThan(3);

        for (const row of projected) {
            const idx = sim.indexOf(row);
            // The stored `expenses` list is POST-increment (advanced balance) — it
            // holds the mortgage entering NEXT year. The ENTERING-balance list for
            // this row is the PRIOR row's stored expenses.
            const enteringExpenses = sim[idx - 1].expenses;
            const enteringInterest = getItemizedDeductions(enteringExpenses, row.year);
            const advancedInterest = getItemizedDeductions(row.expenses, row.year);

            // Texas ⇒ SALT 0 ⇒ itemized total is exactly this year's mortgage interest.
            expect(row.itemizedDeductionTotal!).toBeCloseTo(enteringInterest, 2);
            // The off-by-one trap: computing off the advanced balance would return a
            // DIFFERENT (smaller, next-year) number. Pin that it does NOT match.
            expect(Math.abs(row.itemizedDeductionTotal! - advancedInterest)).toBeGreaterThan(50);
        }
    });

    it('tracks the DECLINING mortgage interest year over year', () => {
        const projected = projectedRows(runItemized('Itemized'));
        for (let i = 1; i < projected.length; i++) {
            expect(projected[i].itemizedDeductionTotal!)
                .toBeLessThan(projected[i - 1].itemizedDeductionTotal!);
        }
    });

    it('bills LESS federal tax than the standard path while the mortgage interest exceeds the standard deduction (year0→year1 continuity, no cliff)', () => {
        const itemized = runItemized('Itemized');
        const standard = runItemized('Standard');

        // Compare the SAME projected years across the two runs. Everything except the
        // deduction method is identical, so pre-#198 (standard-only projections) these
        // were byte-for-byte equal — the strict inequality below IS the fix.
        const itmProjected = projectedRows(itemized);
        expect(itmProjected.length).toBeGreaterThan(3);

        let sawSavings = false;
        for (const itmRow of itmProjected) {
            const idx = itemized.indexOf(itmRow);
            const stdRow = standard[idx];
            // While itemized interest > standard deduction, itemizing bills less tax.
            if (itmRow.itemizedDeductionTotal! > 16_500) {
                expect(itmRow.taxDetails.fed).toBeLessThan(stdRow.taxDetails.fed - 100);
                sawSavings = true;
            }
        }
        expect(sawSavings).toBe(true);

        // Continuity: the FIRST projected year's federal tax reconstructs from the
        // stored itemized deduction at the year's salary (proves the engine actually
        // billed the itemized figure, not the standard one).
        const first = itmProjected[0];
        const raw = TaxService.getTaxParameters(first.year, 'Single', 'federal', undefined, baseAssumptions);
        if (!raw) throw new Error('no fed params');
        const reFedItemized = TaxService.calculateTotalFederalTax(
            150_000, 0, 0, 0, 0, 'Single',
            { ...raw, standardDeduction: first.itemizedDeductionTotal! },
        ).totalTax;
        expect(first.taxDetails.fed).toBeCloseTo(reFedItemized, 0);
    });
});

describe('#198 engine — Auto flip back to standard as the loan amortizes', () => {
    it('bills min(itemized, standard) every projected year, flipping to standard when interest drops below the standard deduction', () => {
        const YEARS = 14; // long enough for ~$17.9k interest to amortize below the ~$15.75k standard deduction
        const itemized = runItemized('Itemized', YEARS);
        const standard = runItemized('Standard', YEARS);
        const auto = runItemized('Auto', YEARS);

        const autoProjected = projectedRows(auto);
        expect(autoProjected.length).toBeGreaterThan(5);

        let sawItemizedWin = false; // early years: itemized cheaper
        let flipYear: number | undefined;
        for (const autoRow of autoProjected) {
            const idx = auto.indexOf(autoRow);
            const itmFed = itemized[idx].taxDetails.fed;
            const stdFed = standard[idx].taxDetails.fed;

            // Auto always bills the cheaper of the two paths.
            expect(autoRow.taxDetails.fed).toBeCloseTo(Math.min(itmFed, stdFed), 0);

            if (itmFed < stdFed - 1) sawItemizedWin = true;
            // First year the standard path wins (itemized total fell below standard).
            if (flipYear === undefined && stdFed <= itmFed + 1 && sawItemizedWin) {
                flipYear = autoRow.year;
            }
        }

        // The owner's core ask: itemized early, then a well-defined flip to standard.
        expect(sawItemizedWin).toBe(true);
        expect(flipYear).toBeDefined();

        // After the flip, Auto tracks the standard path exactly.
        const afterFlip = autoProjected.filter(r => r.year >= (flipYear as number));
        for (const autoRow of afterFlip) {
            const idx = auto.indexOf(autoRow);
            expect(autoRow.taxDetails.fed).toBeCloseTo(standard[idx].taxDetails.fed, 0);
        }
    });
});

describe('#198 stage 2 — SALT reflects the PRIOR year\'s realized state tax (lookback)', () => {
    it('folds min(prior-year realized state tax, SALT cap) into each projected year\'s itemized total, lagging this year\'s state tax as income rises', () => {
        // DC (has income tax) + rising salary ⇒ realized state tax grows each year, so
        // the PRIOR year's value is strictly below THIS year's — the signal that SALT
        // uses a lookback (stage 2), not this year's pre-withdrawal baseline (stage 1).
        const growthAssumptions: AssumptionsState = {
            ...baseAssumptions,
            income: { ...baseAssumptions.income, salaryGrowth: 4 },
        };
        const sim = runSimulation(
            7,
            freshAccounts(),
            [new WorkIncome('inc-work', 'Job', 120_000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED')],
            [freshMortgage(), freshLiving()],
            growthAssumptions,
            baseTaxState('Auto', 'DC'),
        );
        const projected = projectedRows(sim);
        expect(projected.length).toBeGreaterThan(3);

        let sawLag = false;
        // Skip index 0: its loop-time prior was the pre-loop partial-year EOY row, not
        // a projected row. From the second real projected year on, the immediately
        // prior REAL year is projected[j-1].
        for (let j = 1; j < projected.length; j++) {
            const row = projected[j];
            const idx = sim.indexOf(row);
            const mortgageInterest = getItemizedDeductions(sim[idx - 1].expenses, row.year);
            const saltComponent = row.itemizedDeductionTotal! - mortgageInterest;

            const cap = TaxService.getSALTCap(row.year, 'Single');
            const priorRealizedState = projected[j - 1].taxDetails.state;
            expect(saltComponent).toBeCloseTo(Math.min(priorRealizedState, cap), 1);

            // Stage-2-specific: with rising income the SALT is the LAGGED prior value,
            // strictly below this year's realized state tax (a pre-withdrawal
            // same-year baseline — stage 1 — would ≈ this year's, not the prior's).
            if (priorRealizedState < cap && row.taxDetails.state > priorRealizedState + 50) {
                expect(saltComponent).toBeLessThan(row.taxDetails.state - 40);
                sawLag = true;
            }
        }
        expect(sawLag).toBe(true);
    });
});

describe('#198 engine — expense-level "Yes" above-the-line deduction', () => {
    it('reduces every projected year\'s federal tax by ~ deduction × marginal rate', () => {
        // Standard method + Texas isolates the "Yes" above-line effect from itemizing.
        const charityYes = new CharityExpense(
            'exp-charity', 'Donations', 12_000, 'Annually', 'Yes', 12_000, new Date(START_YEAR, 0, 1),
        );
        const charityNo = new CharityExpense(
            'exp-charity', 'Donations', 12_000, 'Annually', 'No', 12_000, new Date(START_YEAR, 0, 1),
        );

        const withYes = runSimulation(
            8, freshAccounts(), [work], [freshMortgage(), freshLiving(), charityYes],
            baseAssumptions, baseTaxState('Standard'),
        );
        const withNo = runSimulation(
            8, freshAccounts(), [work], [freshMortgage(), freshLiving(), charityNo],
            baseAssumptions, baseTaxState('Standard'),
        );

        const yesProjected = projectedRows(withYes);
        expect(yesProjected.length).toBeGreaterThan(2);

        for (const yesRow of yesProjected) {
            const idx = withYes.indexOf(yesRow);
            const noRow = withNo[idx];
            expect(yesRow.expenseAboveLineDeductions!).toBeCloseTo(12_000, 0);
            // $12k off a ~24% marginal bracket ⇒ ~$2.9k less federal tax; require a
            // material, positive reduction (pre-#198 the "Yes" deduction never reached
            // any projected year, so these would be equal).
            expect(noRow.taxDetails.fed - yesRow.taxDetails.fed).toBeGreaterThan(2_000);
        }
    });
});
