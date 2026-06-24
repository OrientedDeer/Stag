import { describe, it, expect } from 'vitest';
import { getSimulationInputHash } from '../../services/simulationHash';
import {
  AnyAccount,
  InvestedAccount,
  SavedAccount,
  ESPPAccount,
  RSUAccount,
} from '../../components/Objects/Accounts/models';
import { AnyIncome, WorkIncome } from '../../components/Objects/Income/models';
import { AnyExpense } from '../../components/Objects/Expense/models';
import { AssumptionsState } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';

// Minimal assumptions/tax state — the hash only reads a fixed set of top-level
// keys off each, and these tests vary ONLY account / income fields, so any
// stable object that carries those keys is fine. We hold them constant across
// each before/after pair, isolating the field under test.
const assumptions = {
  demographics: { currentAge: 40, lifeExpectancy: 90 },
  macro: { inflationRate: 3, inflationAdjusted: false },
  income: { salaryGrowth: 3 },
  expenses: {},
  investments: { returnRates: { ror: 7 } },
  priorities: {},
  withdrawalStrategy: 'fixed-real',
  milestones: [],
} as unknown as AssumptionsState;

const taxState = {
  filingStatus: 'single',
  stateResidency: 'CA',
  deductionMethod: 'standard',
} as unknown as TaxState;

function hash(accounts: AnyAccount[], incomes: AnyIncome[]): string {
  return getSimulationInputHash(accounts, incomes, [] as AnyExpense[], assumptions, taxState);
}

// Build an InvestedAccount with overridable result-affecting fields. All other
// constructor args are held at fixed defaults so each test perturbs exactly one.
function makeInvested(overrides: Partial<{
  customROR: number | undefined;
  expenseRatio: number;
  costBasis: number;
  employerBalance: number;
  conversionHistory: { year: number; amount: number }[];
}> = {}): InvestedAccount {
  return new InvestedAccount(
    'inv-1',
    'My 401k',
    100000,
    overrides.employerBalance ?? 0,        // employerBalance
    0,                                      // tenureYears
    overrides.expenseRatio ?? 0.1,          // expenseRatio
    'Traditional 401k',                     // taxType
    true,                                   // isContributionEligible
    0.2,                                    // vestedPerYear
    overrides.costBasis ?? 100000,          // costBasis
    overrides.customROR,                    // customROR (undefined => use global)
    overrides.conversionHistory ?? [],      // conversionHistory
  );
}

function makeWorkIncome(overrides: Partial<{
  contributionGrowthStrategy: WorkIncome['contributionGrowthStrategy'];
  taxType: WorkIncome['taxType'];
}> = {}): WorkIncome {
  return new WorkIncome(
    'work-1',
    'Salary',
    120000,
    'Bi-Weekly',
    'Yes',
    1000,                                      // preTax401k
    0,                                         // insurance
    0,                                         // roth401k
    0,                                         // employerMatch
    'match-acct',                              // matchAccountId
    overrides.taxType ?? null,                 // taxType
    overrides.contributionGrowthStrategy ?? 'FIXED', // contributionGrowthStrategy
  );
}

describe('getSimulationInputHash — result-affecting fields must invalidate staleness', () => {
  describe('Issue 1: non-RSU account fields', () => {
    it('changes when customROR is set on an InvestedAccount (blank -> 10%)', () => {
      // customROR overrides the global return rate in InvestedAccount.increment().
      const before = hash([makeInvested({ customROR: undefined })], []);
      const after = hash([makeInvested({ customROR: 10 })], []);
      expect(after).not.toBe(before);
    });

    it('changes when expenseRatio changes on an InvestedAccount', () => {
      // expenseRatio is subtracted from the return rate every year.
      const before = hash([makeInvested({ expenseRatio: 0.1 })], []);
      const after = hash([makeInvested({ expenseRatio: 0.5 })], []);
      expect(after).not.toBe(before);
    });

    it('changes when costBasis changes on an InvestedAccount', () => {
      // costBasis drives the basis/gains split on every withdrawal.
      const before = hash([makeInvested({ costBasis: 100000 })], []);
      const after = hash([makeInvested({ costBasis: 40000 })], []);
      expect(after).not.toBe(before);
    });

    it('changes when employerBalance changes on an InvestedAccount', () => {
      // employerBalance feeds vestedAmount / nonVestedAmount, gating RMDs and
      // employer-fund accessibility on withdrawal.
      const before = hash([makeInvested({ employerBalance: 0 })], []);
      const after = hash([makeInvested({ employerBalance: 25000 })], []);
      expect(after).not.toBe(before);
    });

    it('changes when conversionHistory changes on an InvestedAccount', () => {
      // conversionHistory carries the Roth 5-year-rule clock used in withdrawal ordering.
      const before = hash([makeInvested({ conversionHistory: [] })], []);
      const after = hash([makeInvested({ conversionHistory: [{ year: 2024, amount: 5000 }] })], []);
      expect(after).not.toBe(before);
    });

    it('changes when apr changes on a SavedAccount', () => {
      // apr is the per-account growth rate in SavedAccount.increment().
      const before = hash([new SavedAccount('s1', 'Savings', 50000, 1)], []);
      const after = hash([new SavedAccount('s1', 'Savings', 50000, 4)], []);
      expect(after).not.toBe(before);
    });

    it('changes when customROR changes on an ESPPAccount', () => {
      // ESPP growth uses customROR when set, mirroring the RSU/Invested path.
      const before = hash([new ESPPAccount('e1', 'ESPP', 30000, [], null, undefined)], []);
      const after = hash([new ESPPAccount('e1', 'ESPP', 30000, [], null, 12)], []);
      expect(after).not.toBe(before);
    });

    it('changes when customROR changes on an RSUAccount', () => {
      // RSU growth uses customROR when set (RSUAccount.increment() reads it for
      // the year-over-year return rate), mirroring the ESPP/Invested path.
      const before = hash([new RSUAccount('r1', 'RSU', 40000, [], null, undefined)], []);
      const after = hash([new RSUAccount('r1', 'RSU', 40000, [], null, 12)], []);
      expect(after).not.toBe(before);
    });
  });

  describe('Issue 2: WorkIncome contributionGrowthStrategy / taxType', () => {
    it('changes when contributionGrowthStrategy toggles (GROW_WITH_SALARY -> TRACK_ANNUAL_MAX)', () => {
      // The engine branches on this field, changing every future contribution.
      const before = hash([], [makeWorkIncome({ contributionGrowthStrategy: 'GROW_WITH_SALARY' })]);
      const after = hash([], [makeWorkIncome({ contributionGrowthStrategy: 'TRACK_ANNUAL_MAX' })]);
      expect(after).not.toBe(before);
    });

    it('changes when contributionGrowthStrategy toggles (FIXED -> GROW_WITH_SALARY)', () => {
      const before = hash([], [makeWorkIncome({ contributionGrowthStrategy: 'FIXED' })]);
      const after = hash([], [makeWorkIncome({ contributionGrowthStrategy: 'GROW_WITH_SALARY' })]);
      expect(after).not.toBe(before);
    });

    it('changes when WorkIncome taxType changes', () => {
      // taxType routes the 401k/contribution tax treatment in the engine.
      const before = hash([], [makeWorkIncome({ taxType: null })]);
      const after = hash([], [makeWorkIncome({ taxType: 'Traditional 401k' })]);
      expect(after).not.toBe(before);
    });
  });
});
