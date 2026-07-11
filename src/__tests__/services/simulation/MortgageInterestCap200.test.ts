/**
 * #200 — Mortgage-interest itemized deduction must honor the TCJA $750,000
 * acquisition-debt cap. Deductible home-mortgage interest is prorated by
 * min(1, 750_000 / average loan balance) — the IRS Pub 936 average-balance
 * method, approximated as (entering + exiting)/2 for the year. The cap is
 * SHARED across all itemized mortgages (combined acquisition debt), which is
 * where #200 meets #201.
 *
 * Single-user simplification: a flat $750k, no pre-2018 $1M grandfathering.
 *
 * Expected values here are derived INDEPENDENTLY from each mortgage's
 * `calculateAnnualAmortization` schedule (a separate, pre-existing method) and
 * the statutory $750k figure — never from the deduction implementation.
 */
import { describe, it, expect } from 'vitest';

import { getItemizedDeductions } from '../../../components/Objects/Taxes/taxService/deductions';
import { MortgageExpense, CharityExpense } from '../../../components/Objects/Expense/models';

const YEAR = new Date().getFullYear();

// The statutory TCJA acquisition-debt limit — a tax-law constant, not the impl.
const TCJA_LIMIT = 750_000;

function mortgage(id: string, loan: number, apr = 6.5, term = 30): MortgageExpense {
    return new MortgageExpense(
        id, 'Mortgage', 'Monthly',
        loan * 1.2, // valuation
        loan,       // loan_balance
        loan,       // starting_loan_balance
        apr, term,
        1.0, 0, 1.0, 0, 0.5, 0.5, 0, // property_taxes … hoa_fee
        'Itemized', 0, `acc-${id}`,
        new Date(YEAR, 0, 1), 0, 0,
    );
}

/** Independent average-balance proration for one mortgage, from its schedule. */
function proratedInterest(m: MortgageExpense): { full: number; capped: number; avg: number } {
    const { totalInterest, totalPrincipal } = m.calculateAnnualAmortization(YEAR);
    const entering = m.loan_balance;
    const exiting = entering - totalPrincipal;
    const avg = (entering + exiting) / 2;
    const capped = totalInterest * Math.min(1, TCJA_LIMIT / avg);
    return { full: totalInterest, capped, avg };
}

describe('#200 — TCJA $750k acquisition-debt cap on itemized mortgage interest', () => {
    it('prorates a $900k jumbo mortgage down to interest on the first $750k', () => {
        const m = mortgage('m1', 900_000);
        const { full, capped, avg } = proratedInterest(m);

        // Sanity anchors from the issue: ~$58.2k full year-1 interest, ~$48.5k capped.
        expect(full).toBeGreaterThan(57_000);
        expect(avg).toBeGreaterThan(TCJA_LIMIT); // over the cap ⇒ proration bites
        expect(capped).toBeLessThan(full);
        expect(capped).toBeGreaterThan(47_000);
        expect(capped).toBeLessThan(50_000);

        // This is the RED assertion pre-fix: the pipeline returns the FULL interest.
        expect(getItemizedDeductions([m], YEAR)).toBeCloseTo(capped, 2);
    });

    it('leaves a $500k mortgage (≤ $750k) fully deductible — byte-identical', () => {
        const m = mortgage('m1', 500_000);
        const { totalInterest } = m.calculateAnnualAmortization(YEAR);
        // Exact equality: below the cap, nothing changes vs the pre-#200 behavior.
        expect(getItemizedDeductions([m], YEAR)).toBe(totalInterest);
    });

    it('shares one $750k cap across two itemized mortgages (combined acquisition debt)', () => {
        const m1 = mortgage('m1', 500_000);
        const m2 = mortgage('m2', 400_000);
        const a1 = m1.calculateAnnualAmortization(YEAR);
        const a2 = m2.calculateAnnualAmortization(YEAR);

        const combinedInterest = a1.totalInterest + a2.totalInterest;
        const combinedAvg =
            (m1.loan_balance - a1.totalPrincipal / 2) +
            (m2.loan_balance - a2.totalPrincipal / 2);
        const expected = combinedInterest * (TCJA_LIMIT / combinedAvg);

        expect(combinedAvg).toBeGreaterThan(TCJA_LIMIT);
        // Each mortgage alone ($500k, $400k) is under the cap, but combined $900k
        // acquisition debt is over it — the shared cap must still prorate.
        expect(getItemizedDeductions([m1, m2], YEAR)).toBeCloseTo(expected, 2);
    });

    it('leaves two mortgages summing ≤ $750k fully deductible — byte-identical', () => {
        const m1 = mortgage('m1', 300_000);
        const m2 = mortgage('m2', 300_000);
        const total =
            m1.calculateAnnualAmortization(YEAR).totalInterest +
            m2.calculateAnnualAmortization(YEAR).totalInterest;
        expect(getItemizedDeductions([m1, m2], YEAR)).toBe(total);
    });

    it('prorates only the mortgage interest, never other itemized expenses', () => {
        const m = mortgage('m1', 900_000);
        const charity = new CharityExpense(
            'c1', 'Donations', 20_000, 'Annually', 'Itemized', 20_000, new Date(YEAR, 0, 1),
        );
        const { capped } = proratedInterest(m);
        const charityAlone = getItemizedDeductions([charity], YEAR); // full $20k, uncapped

        expect(charityAlone).toBeCloseTo(20_000, 2);
        expect(getItemizedDeductions([m, charity], YEAR)).toBeCloseTo(capped + charityAlone, 2);
    });
});
