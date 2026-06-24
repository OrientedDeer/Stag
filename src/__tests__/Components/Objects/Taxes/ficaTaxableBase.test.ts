/**
 * Focused tests for getFicaTaxableBase — the single source of truth for the
 * FICA-taxable wage base (earned wages net of FICA exemptions, floored at 0).
 *
 * The same expression used to be inlined in three places (calculateFicaTax and
 * two TaxOptimizationService call sites). It was extracted so a new exempt
 * income type can't drift the Testing-tab marginal-rate readout away from the
 * FICA the engine actually charges. These tests pin the base's three behaviors:
 * only earned income counts, FICA exemptions (insurance/HSA) are subtracted, and
 * the result floors at 0.
 */

import { describe, it, expect } from 'vitest';
import { getFicaTaxableBase } from '../../../../components/Objects/Taxes/taxService/ficaTax';
import { WorkIncome, PassiveIncome } from '../../../../components/Objects/Income/models';

const YEAR = 2025;
const start = new Date('2025-01-01');
const end = new Date('2025-12-31');

/** $amount of earned wages with $insurance (and optionally $hsa) FICA-exempt. */
function wages(amount: number, insurance = 0, hsa = 0): WorkIncome {
  const w = new WorkIncome(
    'w1', 'Job', amount, 'Annually',
    'Yes', // earned_income
    0, insurance, 0, 0, // preTax401k, insurance, roth401k, employerMatch
    '', null, 'FIXED',
    start, end,
    hsa, // hsaContribution
  );
  return w;
}

describe('getFicaTaxableBase', () => {
  it('is the earned wage when there are no FICA exemptions', () => {
    expect(getFicaTaxableBase([wages(100000)], YEAR)).toBe(100000);
  });

  it('subtracts FICA exemptions (insurance + HSA)', () => {
    // $100k wages - $8k insurance - $4k HSA = $88k FICA-taxable base.
    expect(getFicaTaxableBase([wages(100000, 8000, 4000)], YEAR)).toBe(88000);
  });

  it('counts only EARNED income, not total gross', () => {
    // $100k wages (earned) + $120k passive (earned_income: 'No') → base is $100k.
    const passive = new PassiveIncome(
      'p1', 'Rental', 120000, 'Annually',
      'No', 'Rental', start, end,
    );
    expect(getFicaTaxableBase([wages(100000), passive], YEAR)).toBe(100000);
  });

  it('floors at 0 when exemptions exceed earned wages', () => {
    expect(getFicaTaxableBase([wages(5000, 8000)], YEAR)).toBe(0);
  });

  it('is 0 with no income', () => {
    expect(getFicaTaxableBase([], YEAR)).toBe(0);
  });
});
