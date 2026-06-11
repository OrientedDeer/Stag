import { describe, it, expect } from 'vitest';
import {
    getPreTaxExemptions,
    getPostTaxExemptions,
} from '../../components/Objects/Taxes/taxService/incomeAggregation';
import {
    getItemizedDeductions,
    getYesDeductions,
} from '../../components/Objects/Taxes/taxService/deductions';
import { LoanExpense, MortgageExpense } from '../../components/Objects/Expense/models';
import { WorkIncome } from '../../components/Objects/Income/models';

/**
 * Characterization tests for PR #55 review fixes #10 and #13.
 *
 * These are behavior-preserving refactors:
 *  - #10: dedupe the 401k-field resolution in getPreTaxExemptions / getPostTaxExemptions.
 *  - #13: type-safe `tax_deductible` narrowing in getItemizedDeductions / getYesDeductions.
 *
 * The numbers below were captured against the ORIGINAL (pre-refactor) code and must
 * remain identical after the refactor. Do NOT loosen these assertions.
 */
describe('PR55 review fixes — incomeAggregation characterization', () => {
    // Bi-Weekly => 26 pay periods/year. Per-period contribution fields are
    // re-annualized via getProratedAnnual, so a long-active income (year far
    // inside the start..end window) yields a full-year multiplier of 1.
    const YEAR = 2030;

    function makeWorkIncome(opts: { autoMax401k?: 'custom' | 'traditional' | 'roth' | 'disabled' } = {}) {
        // ctor: (id, name, amount, frequency, earned_income,
        //        preTax401k, insurance, roth401k, employerMatch, matchAccountId,
        //        taxType, contributionGrowthStrategy, startDate, end_date,
        //        hsaContribution, autoMax401k, ...)
        return new WorkIncome(
            'w1',
            'Job',
            3000,            // amount per period
            'Bi-Weekly',
            'Yes',
            800,             // preTax401k per period
            150,             // insurance per period
            400,             // roth401k per period
            300,             // employerMatch per period
            'acc1',
            'Traditional 401k',
            'FIXED',
            new Date('2010-01-01'),
            new Date('2060-01-01'),
            120,             // hsaContribution per period
            opts.autoMax401k ?? 'custom',
        );
    }

    describe('getPreTaxExemptions', () => {
        it('useStoredValue=true returns the stored preTax401k + insurance + HSA (prorated)', () => {
            const inc = makeWorkIncome();
            const result = getPreTaxExemptions([inc], YEAR, undefined, true);
            // 26 * (800 + 150 + 120) = 26 * 1070 = 27820
            expect(result).toBe(27820);
        });

        it('age-based getEffective401k path (custom) matches stored value', () => {
            const inc = makeWorkIncome({ autoMax401k: 'custom' });
            const result = getPreTaxExemptions([inc], YEAR, 45, false);
            // custom autoMax => getEffective401k returns stored preTax401k (800/period)
            // 26 * (800 + 150 + 120) = 27820
            expect(result).toBe(27820);
        });

        it('age-based getEffective401k path (traditional auto-max) uses IRS-limit-derived preTax', () => {
            const inc = makeWorkIncome({ autoMax401k: 'traditional' });
            const stored = getPreTaxExemptions([inc], YEAR, undefined, true);
            const effective = getPreTaxExemptions([inc], YEAR, 45, false);
            // traditional auto-max overrides the stored preTax401k with the
            // per-period IRS limit, so the effective figure differs from stored.
            expect(effective).not.toBe(stored);
            // insurance + HSA portion is unchanged either way: 26 * (150 + 120) = 7020
            const traditionalPreTaxAnnual = effective - 26 * (150 + 120);
            expect(traditionalPreTaxAnnual).toBeGreaterThan(0);
            // and stored - 7020 == 26 * 800 == 20800
            expect(stored - 26 * (150 + 120)).toBe(20800);
        });
    });

    describe('getPostTaxExemptions', () => {
        it('useStoredValue=true returns the stored roth401k (prorated)', () => {
            const inc = makeWorkIncome();
            const result = getPostTaxExemptions([inc], YEAR, undefined, true);
            // 26 * 400 = 10400
            expect(result).toBe(10400);
        });

        it('age-based getEffective401k path (custom) matches stored value', () => {
            const inc = makeWorkIncome({ autoMax401k: 'custom' });
            const result = getPostTaxExemptions([inc], YEAR, 45, false);
            expect(result).toBe(10400);
        });

        it('age-based getEffective401k path (roth auto-max) uses IRS-limit-derived roth', () => {
            const inc = makeWorkIncome({ autoMax401k: 'roth' });
            const stored = getPostTaxExemptions([inc], YEAR, undefined, true);
            const effective = getPostTaxExemptions([inc], YEAR, 45, false);
            expect(effective).not.toBe(stored);
            expect(effective).toBeGreaterThan(0);
        });
    });
});

describe('PR55 review fixes — deductions characterization', () => {
    const YEAR = 2024;

    it('getItemizedDeductions: mortgage uses amortization interest', () => {
        const mortgage = new MortgageExpense(
            'm1', 'Home', 'Monthly', 500000, 400000, 400000, 3, 30, 1.2, 0, 1, 100, 0.3, 0, 50,
            'Itemized', 0.8, 'a1', new Date('2020-01-01'),
        );
        const deductions = getItemizedDeductions([mortgage], YEAR);
        expect(deductions).toBeCloseTo(mortgage.calculateAnnualAmortization(YEAR).totalInterest, 6);
        expect(deductions).toBeGreaterThan(0);
    });

    it('getItemizedDeductions: non-mortgage itemized expense uses tax_deductible field', () => {
        // LoanExpense ctor: (id, name, amount, frequency, apr, interest_type, payment,
        //                    is_tax_deductible, tax_deductible, linkedAccountId, startDate, endDate)
        const loan = new LoanExpense(
            'l1', 'Student Loan', 20000, 'Monthly', 5, 'Compounding', 500,
            'Itemized', 2500, 'acc1', new Date('2010-01-01'), new Date('2060-01-01'),
        );
        const deductions = getItemizedDeductions([loan], YEAR);
        // tax_deductible=2500/period, Monthly => 12 periods, active multiplier 1 => 30000
        expect(deductions).toBe(loan.getProratedAnnual(2500, YEAR));
        expect(deductions).toBe(30000);
    });

    it('getItemizedDeductions: ignores non-itemized expenses', () => {
        const loan = new LoanExpense(
            'l1', 'Loan', 20000, 'Monthly', 5, 'Compounding', 500,
            'No', 2500, 'acc1', new Date('2010-01-01'), new Date('2060-01-01'),
        );
        expect(getItemizedDeductions([loan], YEAR)).toBe(0);
    });

    it('getYesDeductions: mortgage uses amortization interest', () => {
        const mortgage = new MortgageExpense(
            'm1', 'Home', 'Monthly', 500000, 400000, 400000, 3, 30, 1.2, 0, 1, 100, 0.3, 0, 50,
            'Yes', 0.8, 'a1', new Date('2020-01-01'),
        );
        const deductions = getYesDeductions([mortgage], YEAR);
        expect(deductions).toBeCloseTo(mortgage.calculateAnnualAmortization(YEAR).totalInterest, 6);
        expect(deductions).toBeGreaterThan(0);
    });

    it('getYesDeductions: non-mortgage Yes expense uses tax_deductible field', () => {
        const loan = new LoanExpense(
            'l1', 'Loan', 20000, 'Monthly', 5, 'Compounding', 500,
            'Yes', 1800, 'acc1', new Date('2010-01-01'), new Date('2060-01-01'),
        );
        const deductions = getYesDeductions([loan], YEAR);
        expect(deductions).toBe(loan.getProratedAnnual(1800, YEAR));
        expect(deductions).toBe(21600);
    });

    it('getYesDeductions: ignores non-Yes expenses', () => {
        const loan = new LoanExpense(
            'l1', 'Loan', 20000, 'Monthly', 5, 'Compounding', 500,
            'Itemized', 1800, 'acc1', new Date('2010-01-01'), new Date('2060-01-01'),
        );
        expect(getYesDeductions([loan], YEAR)).toBe(0);
    });
});
