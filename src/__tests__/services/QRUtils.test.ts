import { describe, it, expect } from 'vitest';
import {
  dateToDays,
  daysToDate,
  shortenKeys,
  expandKeys,
  stripDefaults,
  restoreDefaults,
  flattenAssumptions,
  expandAssumptions,
  compactAssumptions,
  expandCompactAssumptions,
  compactHistory,
  expandHistory,
  createCompactBackup,
  expandCompactBackup,
  compressData,
  decompressData,
  exceedsQRLimit,
} from '../../components/Objects/Accounts/QRTransfer/qrUtils';
import { parseDate } from '../../components/Objects/modelUtils';
import { defaultAssumptions } from '../../components/Objects/Assumptions/AssumptionsContext';
import { reconstituteAccount, RSUAccount } from '../../components/Objects/Accounts/models';
import { reconstituteIncome, WorkIncome } from '../../components/Objects/Income/models';

/**
 * Batch 21: QR Utils - Date & Key Transformations
 * Batch 22: QR Utils - Defaults Stripping/Restoration
 */
describe('qrUtils', () => {
  // ============================================
  // Batch 21: Date & Key Transformations
  // ============================================

  describe('dateToDays', () => {
    it('should return 0 for epoch date 2020-01-01', () => {
      expect(dateToDays('2020-01-01')).toBe(0);
    });

    it('should return 1 for 2020-01-02', () => {
      expect(dateToDays('2020-01-02')).toBe(1);
    });

    it('should return 31 for 2020-02-01 (31 days in January)', () => {
      expect(dateToDays('2020-02-01')).toBe(31);
    });

    it('should return 366 for 2021-01-01 (2020 is leap year)', () => {
      expect(dateToDays('2021-01-01')).toBe(366);
    });

    it('should return 731 for 2022-01-01 (366 + 365)', () => {
      expect(dateToDays('2022-01-01')).toBe(731);
    });

    it('should handle mid-year date 2020-07-15', () => {
      // Jan(31) + Feb(29) + Mar(31) + Apr(30) + May(31) + Jun(30) + 14 days = 196
      expect(dateToDays('2020-07-15')).toBe(196);
    });
  });

  describe('daysToDate', () => {
    it('should return 2020-01-01 for 0 days', () => {
      expect(daysToDate(0)).toBe('2020-01-01');
    });

    it('should return 2020-01-02 for 1 day', () => {
      expect(daysToDate(1)).toBe('2020-01-02');
    });

    it('should return 2020-02-01 for 31 days', () => {
      expect(daysToDate(31)).toBe('2020-02-01');
    });

    it('should return 2021-01-01 for 366 days', () => {
      expect(daysToDate(366)).toBe('2021-01-01');
    });

    it('should return 2022-01-01 for 731 days', () => {
      expect(daysToDate(731)).toBe('2022-01-01');
    });

    it('should return 2020-07-15 for 196 days', () => {
      expect(daysToDate(196)).toBe('2020-07-15');
    });
  });

  describe('dateToDays and daysToDate roundtrip', () => {
    it('should roundtrip 2020-01-01', () => {
      expect(daysToDate(dateToDays('2020-01-01'))).toBe('2020-01-01');
    });

    it('should roundtrip 2024-06-15', () => {
      expect(daysToDate(dateToDays('2024-06-15'))).toBe('2024-06-15');
    });

    it('should roundtrip 2030-12-31', () => {
      expect(daysToDate(dateToDays('2030-12-31'))).toBe('2030-12-31');
    });
  });

  describe('shortenKeys', () => {
    it('should shorten {name: "Test", amount: 100} to {n: "Test", a: 100}', () => {
      const input = { name: 'Test', amount: 100 };
      const result = shortenKeys(input);
      expect(result).toEqual({ n: 'Test', a: 100 });
    });

    it('should shorten {id: "abc", className: "Account"} to {d: "abc", c: "Account"}', () => {
      const input = { id: 'abc', className: 'Account' };
      const result = shortenKeys(input);
      expect(result).toEqual({ d: 'abc', c: 'Account' });
    });

    it('should shorten {startDate: "2024-01-01", endDate: "2024-12-31"}', () => {
      const input = { startDate: '2024-01-01', endDate: '2024-12-31' };
      const result = shortenKeys(input);
      expect(result).toEqual({ s: '2024-01-01', E: '2024-12-31' });
    });

    it('should handle nested objects', () => {
      const input = { name: 'Outer', nested: { name: 'Inner', amount: 50 } };
      const result = shortenKeys(input);
      expect(result).toEqual({ n: 'Outer', nested: { n: 'Inner', a: 50 } });
    });

    it('should handle arrays of objects', () => {
      const input = [{ name: 'First', amount: 100 }, { name: 'Second', amount: 200 }];
      const result = shortenKeys(input);
      expect(result).toEqual([{ n: 'First', a: 100 }, { n: 'Second', a: 200 }]);
    });

    it('should convert Date objects to local YYYY-MM-DD strings', () => {
      // A date-only value picked at local midnight must serialize to its local
      // calendar date, not a UTC instant — otherwise UTC+ users round-trip a day
      // early (issue #73).
      const input = { startDate: new Date(2024, 5, 15) };
      const result = shortenKeys(input);
      expect(result).toEqual({ s: '2024-06-15' });
    });

    it('should pass through unmapped keys unchanged', () => {
      const input = { customField: 'value', name: 'Test' };
      const result = shortenKeys(input);
      expect(result).toEqual({ customField: 'value', n: 'Test' });
    });

    it('should pass through primitives unchanged', () => {
      expect(shortenKeys('string')).toBe('string');
      expect(shortenKeys(123)).toBe(123);
      expect(shortenKeys(true)).toBe(true);
      expect(shortenKeys(null)).toBe(null);
    });
  });

  // Issue #73: a date-only field (created at local midnight) must survive a
  // shorten -> expand -> parseDate round-trip with its calendar date intact,
  // regardless of the host timezone. This test only catches the bug when run
  // in a UTC+ timezone; run with e.g. `TZ=Asia/Tokyo` to exercise it.
  describe('date-only round-trip (issue #73)', () => {
    const roundTrip = (localDate: Date): Date | undefined => {
      const shortened = shortenKeys({ startDate: localDate }) as Record<string, unknown>;
      const expanded = expandKeys(shortened) as Record<string, unknown>;
      return parseDate(expanded.startDate);
    };

    it('preserves the local calendar date through shorten/expand', () => {
      const original = new Date(2024, 5, 15); // local 2024-06-15 midnight
      const result = roundTrip(original);
      expect(result).toBeDefined();
      expect(result!.getFullYear()).toBe(2024);
      expect(result!.getMonth()).toBe(5);
      expect(result!.getDate()).toBe(15);
    });

    it('does not shift a year boundary date (Jan 1) backward', () => {
      const original = new Date(2030, 0, 1); // local 2030-01-01 midnight
      const result = roundTrip(original);
      expect(result).toBeDefined();
      expect(result!.getFullYear()).toBe(2030);
      expect(result!.getMonth()).toBe(0);
      expect(result!.getDate()).toBe(1);
    });
  });

  describe('expandKeys', () => {
    it('should expand {n: "Test", a: 100} to {name: "Test", amount: 100}', () => {
      const input = { n: 'Test', a: 100 };
      const result = expandKeys(input);
      expect(result).toEqual({ name: 'Test', amount: 100 });
    });

    it('should expand {d: "abc", c: "Account"} to {id: "abc", className: "Account"}', () => {
      const input = { d: 'abc', c: 'Account' };
      const result = expandKeys(input);
      expect(result).toEqual({ id: 'abc', className: 'Account' });
    });

    it('should expand {s: "2024-01-01", E: "2024-12-31"}', () => {
      const input = { s: '2024-01-01', E: '2024-12-31' };
      const result = expandKeys(input);
      expect(result).toEqual({ startDate: '2024-01-01', endDate: '2024-12-31' });
    });

    it('should handle nested objects', () => {
      const input = { n: 'Outer', nested: { n: 'Inner', a: 50 } };
      const result = expandKeys(input);
      expect(result).toEqual({ name: 'Outer', nested: { name: 'Inner', amount: 50 } });
    });

    it('should handle arrays of objects', () => {
      const input = [{ n: 'First', a: 100 }, { n: 'Second', a: 200 }];
      const result = expandKeys(input);
      expect(result).toEqual([{ name: 'First', amount: 100 }, { name: 'Second', amount: 200 }]);
    });

    it('should pass through unmapped keys unchanged', () => {
      const input = { customField: 'value', n: 'Test' };
      const result = expandKeys(input);
      expect(result).toEqual({ customField: 'value', name: 'Test' });
    });

    it('should pass through primitives unchanged', () => {
      expect(expandKeys('string')).toBe('string');
      expect(expandKeys(123)).toBe(123);
      expect(expandKeys(true)).toBe(true);
      expect(expandKeys(null)).toBe(null);
    });
  });

  describe('shortenKeys and expandKeys roundtrip', () => {
    it('should roundtrip simple object', () => {
      const original = { name: 'Test', amount: 100, id: 'abc123' };
      const shortened = shortenKeys(original);
      const expanded = expandKeys(shortened);
      expect(expanded).toEqual(original);
    });

    it('should roundtrip complex nested object', () => {
      const original = {
        name: 'Account',
        amount: 5000,
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        nested: {
          frequency: 'Monthly',
          annualGrowthRate: 0.03,
        },
      };
      const shortened = shortenKeys(original);
      const expanded = expandKeys(shortened);
      expect(expanded).toEqual(original);
    });
  });

  // ============================================
  // RSU (issue #29) serialization round-trips
  // ============================================
  describe('RSU serialization round-trip', () => {
    it('round-trips an RSUAccount with a lot through shorten/expand/reconstitute', () => {
      const original = new RSUAccount(
        'rsu-1', 'Company RSU', 12000,
        [{
          id: 'RSU-LOT-2026-work-1',
          grantDate: new Date(2025, 0, 1),
          vestDate: new Date(2026, 0, 1),
          fmvAtVest: 110,
          shares: 63,
          costBasis: 110 * 63,
        }],
        'work-1',
        8.5,
        'CO',
        120,
        'long_term_first',
        30,
      );

      // Plain-object form (as stored in a backup), then shorten → expand → reconstitute.
      const plain = JSON.parse(JSON.stringify({ ...original, className: 'RSUAccount' }));
      const shortened = shortenKeys(plain);
      const expanded = expandKeys(shortened);
      const restored = reconstituteAccount(expanded) as RSUAccount;

      expect(restored).toBeInstanceOf(RSUAccount);
      expect(restored.id).toBe('rsu-1');
      expect(restored.amount).toBe(12000);
      expect(restored.linkedIncomeId).toBe('work-1');
      expect(restored.customROR).toBe(8.5);
      expect(restored.stockTicker).toBe('CO');
      expect(restored.currentSharePrice).toBe(120);
      expect(restored.withdrawalPreference).toBe('long_term_first');
      expect(restored.minimumHoldingDays).toBe(30);
      expect(restored.lots.length).toBe(1);
      const lot = restored.lots[0];
      expect(lot.fmvAtVest).toBe(110);
      expect(lot.shares).toBe(63);
      expect(lot.costBasis).toBeCloseTo(110 * 63, 2);
      expect(lot.vestDate.getFullYear()).toBe(2026);
      expect(lot.grantDate.getFullYear()).toBe(2025);
    });

    it('round-trips WorkIncome RSU fields through shorten/expand/reconstitute', () => {
      const income = new WorkIncome(
        'work-1', 'Engineer', 200000, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED', new Date(2025, 0, 1), undefined,
      );
      income.rsuVestingSchedule = 'graded-4yr';
      income.rsuGrantShares = 1600;
      income.rsuVestFrequency = 'quarterly';
      income.rsuExpectedStockGrowth = 9;
      income.rsuAccountId = 'rsu-1';
      income.rsuWithholdingRate = 32;

      const plain = JSON.parse(JSON.stringify({ ...income, className: 'WorkIncome' }));
      const shortened = shortenKeys(plain);
      const expanded = expandKeys(shortened);
      const restored = reconstituteIncome(expanded) as WorkIncome;

      expect(restored).toBeInstanceOf(WorkIncome);
      expect(restored.rsuVestingSchedule).toBe('graded-4yr');
      expect(restored.rsuGrantShares).toBe(1600);
      expect(restored.rsuVestFrequency).toBe('quarterly');
      expect(restored.rsuExpectedStockGrowth).toBe(9);
      expect(restored.rsuAccountId).toBe('rsu-1');
      expect(restored.rsuWithholdingRate).toBe(32);
    });
  });

  // ============================================
  // Batch 22: Defaults Stripping/Restoration
  // ============================================

  describe('stripDefaults', () => {
    describe('account type', () => {
      it('should strip employerBalance: 0 (default)', () => {
        const input = { id: 'acc1', name: 'Test', employerBalance: 0 };
        const result = stripDefaults(input, 'account');
        expect(result).toEqual({ id: 'acc1', name: 'Test' });
        expect('employerBalance' in result).toBe(false);
      });

      it('should keep employerBalance: 1000 (non-default)', () => {
        const input = { id: 'acc1', name: 'Test', employerBalance: 1000 };
        const result = stripDefaults(input, 'account');
        expect(result).toEqual({ id: 'acc1', name: 'Test', employerBalance: 1000 });
      });

      it('should strip tenureYears: 0 (default)', () => {
        const input = { id: 'acc1', tenureYears: 0 };
        const result = stripDefaults(input, 'account');
        expect(result).toEqual({ id: 'acc1' });
      });

      it('should keep tenureYears: 5 (non-default)', () => {
        const input = { id: 'acc1', tenureYears: 5 };
        const result = stripDefaults(input, 'account');
        expect(result).toEqual({ id: 'acc1', tenureYears: 5 });
      });

      it('should strip costBasis: 0 (default)', () => {
        const input = { id: 'acc1', costBasis: 0 };
        const result = stripDefaults(input, 'account');
        expect(result).toEqual({ id: 'acc1' });
      });

      it('should strip null values', () => {
        const input = { id: 'acc1', name: 'Test', linkedAccountId: null };
        const result = stripDefaults(input, 'account');
        expect(result).toEqual({ id: 'acc1', name: 'Test' });
        expect('linkedAccountId' in result).toBe(false);
      });

      it('should strip empty conversionHistory array (matches empty default)', () => {
        // PR #58: corrected — empty default arrays are now compared structurally
        // and stripped (restoreDefaults re-adds them), instead of bloating the payload.
        const input = { id: 'acc1', conversionHistory: [] };
        const result = stripDefaults(input, 'account');
        expect(result).toEqual({ id: 'acc1' });
        expect('conversionHistory' in result).toBe(false);
        // Round-trips: restoreDefaults re-adds the empty array.
        expect(restoreDefaults(result, 'account').conversionHistory).toEqual([]);
      });

      it('should strip empty lots array (matches empty default)', () => {
        // PR #58: empty ESPP `lots: []` default also strips structurally.
        const input = { id: 'acc1', lots: [] };
        const result = stripDefaults(input, 'account');
        expect('lots' in result).toBe(false);
      });

      it('should keep non-empty conversionHistory array', () => {
        const history = [{ year: 2024, amount: 5000 }];
        const input = { id: 'acc1', conversionHistory: history };
        const result = stripDefaults(input, 'account');
        expect(result).toEqual({ id: 'acc1', conversionHistory: history });
      });
    });

    describe('income type', () => {
      it('should strip annualGrowthRate: 0.03 (default)', () => {
        const input = { id: 'inc1', name: 'Salary', annualGrowthRate: 0.03 };
        const result = stripDefaults(input, 'income');
        expect(result).toEqual({ id: 'inc1', name: 'Salary' });
        expect('annualGrowthRate' in result).toBe(false);
      });

      it('should keep annualGrowthRate: 0.05 (non-default)', () => {
        const input = { id: 'inc1', name: 'Salary', annualGrowthRate: 0.05 };
        const result = stripDefaults(input, 'income');
        expect(result).toEqual({ id: 'inc1', name: 'Salary', annualGrowthRate: 0.05 });
      });

      it('should strip hsaContribution: 0 (default)', () => {
        const input = { id: 'inc1', hsaContribution: 0 };
        const result = stripDefaults(input, 'income');
        expect(result).toEqual({ id: 'inc1' });
      });

      it('should keep hsaContribution: 3850 (non-default)', () => {
        const input = { id: 'inc1', hsaContribution: 3850 };
        const result = stripDefaults(input, 'income');
        expect(result).toEqual({ id: 'inc1', hsaContribution: 3850 });
      });

      it('should strip autoMax401k: false (default)', () => {
        const input = { id: 'inc1', autoMax401k: false };
        const result = stripDefaults(input, 'income');
        expect(result).toEqual({ id: 'inc1' });
      });

      it('should keep autoMax401k: true (non-default)', () => {
        const input = { id: 'inc1', autoMax401k: true };
        const result = stripDefaults(input, 'income');
        expect(result).toEqual({ id: 'inc1', autoMax401k: true });
      });

      it('should strip null matchAccountId', () => {
        const input = { id: 'inc1', matchAccountId: null };
        const result = stripDefaults(input, 'income');
        expect(result).toEqual({ id: 'inc1' });
      });
    });

    describe('expense type', () => {
      it('should strip annualGrowthRate: 0.03 (default)', () => {
        const input = { id: 'exp1', annualGrowthRate: 0.03 };
        const result = stripDefaults(input, 'expense');
        expect(result).toEqual({ id: 'exp1' });
      });

      it('should keep annualGrowthRate: 0.05 (non-default)', () => {
        const input = { id: 'exp1', annualGrowthRate: 0.05 };
        const result = stripDefaults(input, 'expense');
        expect(result).toEqual({ id: 'exp1', annualGrowthRate: 0.05 });
      });

      it('should strip is_tax_deductible: false (default)', () => {
        const input = { id: 'exp1', is_tax_deductible: false };
        const result = stripDefaults(input, 'expense');
        expect(result).toEqual({ id: 'exp1' });
      });

      it('should keep is_tax_deductible: true (non-default)', () => {
        const input = { id: 'exp1', is_tax_deductible: true };
        const result = stripDefaults(input, 'expense');
        expect(result).toEqual({ id: 'exp1', is_tax_deductible: true });
      });
    });

    describe('unknown type', () => {
      it('should only strip null values for unknown type', () => {
        const input = { id: 'x1', employerBalance: 0, name: null };
        const result = stripDefaults(input, 'unknown');
        // Unknown type has no defaults, so only null is stripped
        expect(result).toEqual({ id: 'x1', employerBalance: 0 });
      });
    });
  });

  describe('restoreDefaults', () => {
    describe('account type', () => {
      it('should add missing employerBalance: 0', () => {
        const input = { id: 'acc1', name: 'Test' };
        const result = restoreDefaults(input, 'account');
        expect(result.employerBalance).toBe(0);
      });

      it('should add missing tenureYears: 0', () => {
        const input = { id: 'acc1' };
        const result = restoreDefaults(input, 'account');
        expect(result.tenureYears).toBe(0);
      });

      it('should add missing vestedPerYear: 0', () => {
        const input = { id: 'acc1' };
        const result = restoreDefaults(input, 'account');
        expect(result.vestedPerYear).toBe(0);
      });

      it('should add missing costBasis: 0', () => {
        const input = { id: 'acc1' };
        const result = restoreDefaults(input, 'account');
        expect(result.costBasis).toBe(0);
      });

      it('should add missing conversionHistory: []', () => {
        const input = { id: 'acc1' };
        const result = restoreDefaults(input, 'account');
        expect(result.conversionHistory).toEqual([]);
      });

      it('should preserve existing non-default value', () => {
        const input = { id: 'acc1', employerBalance: 5000 };
        const result = restoreDefaults(input, 'account');
        expect(result.employerBalance).toBe(5000);
      });

      it('should add all account defaults', () => {
        const input = { id: 'acc1', name: 'Test' };
        const result = restoreDefaults(input, 'account');
        expect(result).toEqual({
          employerBalance: 0,
          tenureYears: 0,
          vestedPerYear: 0,
          costBasis: 0,
          conversionHistory: [],
          nonVestedAmount: 0,
          expenseRatio: 0,
          lots: [],
          linkedIncomeId: null,
          withdrawalPreference: 'fifo',
          minimumHoldingDays: 0,
          id: 'acc1',
          name: 'Test',
        });
      });
    });

    describe('income type', () => {
      it('should add missing annualGrowthRate: 0.03', () => {
        const input = { id: 'inc1', name: 'Salary' };
        const result = restoreDefaults(input, 'income');
        expect(result.annualGrowthRate).toBe(0.03);
      });

      it('should add missing hsaContribution: 0', () => {
        const input = { id: 'inc1' };
        const result = restoreDefaults(input, 'income');
        expect(result.hsaContribution).toBe(0);
      });

      it('should add missing autoMax401k: false', () => {
        const input = { id: 'inc1' };
        const result = restoreDefaults(input, 'income');
        expect(result.autoMax401k).toBe(false);
      });

      it('should add missing matchAccountId: null', () => {
        const input = { id: 'inc1' };
        const result = restoreDefaults(input, 'income');
        expect(result.matchAccountId).toBe(null);
      });

      it('should preserve existing non-default value', () => {
        const input = { id: 'inc1', annualGrowthRate: 0.05 };
        const result = restoreDefaults(input, 'income');
        expect(result.annualGrowthRate).toBe(0.05);
      });
    });

    describe('expense type', () => {
      it('should add missing annualGrowthRate: 0.03', () => {
        const input = { id: 'exp1' };
        const result = restoreDefaults(input, 'expense');
        expect(result.annualGrowthRate).toBe(0.03);
      });

      it('should add missing is_tax_deductible: false', () => {
        const input = { id: 'exp1' };
        const result = restoreDefaults(input, 'expense');
        expect(result.is_tax_deductible).toBe(false);
      });

      it('should add missing tax_deductible: false', () => {
        const input = { id: 'exp1' };
        const result = restoreDefaults(input, 'expense');
        expect(result.tax_deductible).toBe(false);
      });

      it('should preserve existing non-default value', () => {
        const input = { id: 'exp1', is_tax_deductible: true };
        const result = restoreDefaults(input, 'expense');
        expect(result.is_tax_deductible).toBe(true);
      });
    });

    describe('unknown type', () => {
      it('should return object unchanged for unknown type', () => {
        const input = { id: 'x1', custom: 'value' };
        const result = restoreDefaults(input, 'unknown');
        expect(result).toEqual({ id: 'x1', custom: 'value' });
      });
    });
  });

  describe('stripDefaults and restoreDefaults roundtrip', () => {
    it('should roundtrip account with defaults', () => {
      const original = {
        id: 'acc1',
        name: 'Test Account',
        amount: 5000,
        employerBalance: 0,
        tenureYears: 0,
        vestedPerYear: 0,
        costBasis: 0,
        conversionHistory: [],
        nonVestedAmount: 0,
        expenseRatio: 0,
        lots: [],
        linkedIncomeId: null,
        withdrawalPreference: 'fifo',
        minimumHoldingDays: 0,
      };
      const stripped = stripDefaults(original, 'account');
      const restored = restoreDefaults(stripped, 'account');
      expect(restored).toEqual(original);
    });

    it('should roundtrip income with non-default values', () => {
      const original = {
        id: 'inc1',
        name: 'Salary',
        amount: 100000,
        annualGrowthRate: 0.05,
        hsaContribution: 3850,
        autoMax401k: true,
        matchAccountId: 'acc1',
        esppContributionType: 'NONE',
        esppContributionAmount: 0,
        esppDiscountPercent: 15,
        esppHasLookback: true,
        esppOfferingPeriodMonths: 6,
        esppAccountId: null,
        esppExpectedStockGrowth: 7,
        rsuVestingSchedule: 'NONE',
        rsuGrantShares: 0,
        rsuVestFrequency: 'quarterly',
        rsuExpectedStockGrowth: 7,
        rsuAccountId: null,
        rsuWithholdingRate: 37,
        pensionSystem: 'NONE',
      };
      const stripped = stripDefaults(original, 'income');
      const restored = restoreDefaults(stripped, 'income');
      expect(restored).toEqual(original);
    });
  });

  // ============================================
  // Batch 23: QR Utils - Assumptions Flatten/Expand
  // ============================================

  describe('flattenAssumptions', () => {
    it('should flatten nested structure to single level', () => {
      const input = {
        macro: { inflationRate: 0.03 },
        investments: { returnRates: { ror: 0.07 } },
        demographics: { birthYear: 1990 },
      };

      const result = flattenAssumptions(input);

      // Verify all nested values are flattened to top level
      expect(result.inflationRate).toBe(0.03);
      expect(result.ror).toBe(0.07);
      expect(result.birthYear).toBe(1990);
    });

    it('should flatten all macro fields', () => {
      const input = {
        macro: {
          inflationRate: 2.6,
          healthcareInflation: 3.9,
          inflationAdjusted: true,
        },
      };

      const result = flattenAssumptions(input);

      expect(result.inflationRate).toBe(2.6);
      expect(result.healthcareInflation).toBe(3.9);
      expect(result.inflationAdjusted).toBe(true);
    });

    it('should flatten all income fields', () => {
      const input = {
        income: {
          salaryGrowth: 1.5,
          qualifiesForSocialSecurity: false,
          socialSecurityFundingPercent: 80,
        },
      };

      const result = flattenAssumptions(input);

      expect(result.salaryGrowth).toBe(1.5);
      expect(result.qualifiesForSocialSecurity).toBe(false);
      expect(result.socialSecurityFundingPercent).toBe(80);
    });

    it('should flatten all expenses fields', () => {
      const input = {
        expenses: {
          lifestyleCreep: 50,
          housingAppreciation: 2.0,
          rentInflation: 1.5,
        },
      };

      const result = flattenAssumptions(input);

      expect(result.lifestyleCreep).toBe(50);
      expect(result.housingAppreciation).toBe(2.0);
      expect(result.rentInflation).toBe(1.5);
    });

    it('should flatten investments including nested returnRates.ror', () => {
      const input = {
        investments: {
          returnRates: { ror: 6.5 },
          withdrawalStrategy: 'Guardrails',
          withdrawalRate: 3.5,
          gkUpperGuardrail: 1.3,
          gkLowerGuardrail: 0.7,
          gkAdjustmentPercent: 15,
          autoRothConversions: true,
        },
      };

      const result = flattenAssumptions(input);

      expect(result.ror).toBe(6.5);
      expect(result.withdrawalStrategy).toBe('Guardrails');
      expect(result.withdrawalRate).toBe(3.5);
      expect(result.gkUpperGuardrail).toBe(1.3);
      expect(result.gkLowerGuardrail).toBe(0.7);
      expect(result.gkAdjustmentPercent).toBe(15);
      expect(result.autoRothConversions).toBe(true);
    });

    it('should flatten demographics fields', () => {
      const input = {
        demographics: {
          birthYear: 1985,
          retirementAge: 60,
          lifeExpectancy: 95,
          priorYearMode: true,
        },
      };

      const result = flattenAssumptions(input);

      expect(result.birthYear).toBe(1985);
      expect(result.retirementAge).toBe(60);
      expect(result.lifeExpectancy).toBe(95);
      expect(result.priorYearMode).toBe(true);
    });

    it('should flatten display fields', () => {
      const input = {
        display: {
          useCompactCurrency: false,
          showExperimentalFeatures: true,
          hsaEligible: false,
        },
      };

      const result = flattenAssumptions(input);

      expect(result.useCompactCurrency).toBe(false);
      expect(result.showExperimentalFeatures).toBe(true);
      expect(result.hsaEligible).toBe(false);
    });

    it('should preserve non-empty priorities array', () => {
      const input = {
        priorities: [
          { type: 'debt', accountId: 'acc1' },
          { type: 'savings', accountId: 'acc2' },
        ],
      };

      const result = flattenAssumptions(input);

      expect(result.priorities).toEqual([
        { type: 'debt', accountId: 'acc1' },
        { type: 'savings', accountId: 'acc2' },
      ]);
    });

    // PR #58: corrected — the top-level Burn-Order array is `withdrawalStrategy`
    // (there is no `withdrawalOrder` key), flattened under the synthetic `burnOrder` key.
    it('should preserve non-empty withdrawalStrategy (burn-order) array under burnOrder', () => {
      const input = {
        withdrawalStrategy: [
          { accountId: 'acc1' },
          { accountId: 'acc2' },
        ],
      };

      const result = flattenAssumptions(input);

      expect(result.burnOrder).toEqual([
        { accountId: 'acc1' },
        { accountId: 'acc2' },
      ]);
    });

    it('should exclude empty arrays', () => {
      const input = {
        priorities: [],
        withdrawalStrategy: [],
      };

      const result = flattenAssumptions(input);

      expect('priorities' in result).toBe(false);
      // PR #58: corrected — burn-order flattens to `burnOrder`, not `withdrawalOrder`
      expect('burnOrder' in result).toBe(false);
    });
  });

  describe('expandAssumptions', () => {
    it('should expand flattened to proper nested structure', () => {
      const input = {
        inflationRate: 0.03,
        ror: 0.07,
        birthYear: 1990,
      };

      const result = expandAssumptions(input);

      expect(result.macro).toBeDefined();
      expect((result.macro as Record<string, unknown>).inflationRate).toBe(0.03);
      expect(result.investments).toBeDefined();
      expect((result.investments as Record<string, unknown>).returnRates).toBeDefined();
      expect(((result.investments as Record<string, unknown>).returnRates as Record<string, unknown>).ror).toBe(0.07);
      expect(result.demographics).toBeDefined();
      expect((result.demographics as Record<string, unknown>).birthYear).toBe(1990);
    });

    it('should apply defaults for missing macro fields', () => {
      const input = {};

      const result = expandAssumptions(input);
      const macro = result.macro as Record<string, unknown>;

      expect(macro.inflationRate).toBe(2.6);
      expect(macro.healthcareInflation).toBe(3.9);
      expect(macro.inflationAdjusted).toBe(true);
    });

    it('should apply defaults for missing income fields', () => {
      const input = {};

      const result = expandAssumptions(input);
      const income = result.income as Record<string, unknown>;

      expect(income.salaryGrowth).toBe(1.0);
      expect(income.qualifiesForSocialSecurity).toBe(true);
      expect(income.socialSecurityFundingPercent).toBe(100);
    });

    it('should apply defaults for missing expenses fields', () => {
      const input = {};

      const result = expandAssumptions(input);
      const expenses = result.expenses as Record<string, unknown>;

      expect(expenses.lifestyleCreep).toBe(75.0);
      expect(expenses.housingAppreciation).toBe(1.4);
      expect(expenses.rentInflation).toBe(1.2);
    });

    it('should apply defaults for missing investments fields', () => {
      const input = {};

      const result = expandAssumptions(input);
      const investments = result.investments as Record<string, unknown>;
      const returnRates = investments.returnRates as Record<string, unknown>;

      expect(returnRates.ror).toBe(5.9);
      expect(investments.withdrawalStrategy).toBe('Fixed Real');
      expect(investments.withdrawalRate).toBe(4.0);
      expect(investments.gkUpperGuardrail).toBe(1.2);
      expect(investments.gkLowerGuardrail).toBe(0.8);
      expect(investments.gkAdjustmentPercent).toBe(10);
      expect(investments.autoRothConversions).toBe(false);
    });

    it('should apply defaults for missing demographics fields except birthYear', () => {
      const input = { birthYear: 1985 };

      const result = expandAssumptions(input);
      const demographics = result.demographics as Record<string, unknown>;

      expect(demographics.birthYear).toBe(1985);
      expect(demographics.retirementAge).toBe(65);
      expect(demographics.lifeExpectancy).toBe(90);
      expect(demographics.priorYearMode).toBe(false);
    });

    it('should leave birthYear undefined if not provided', () => {
      const input = {};

      const result = expandAssumptions(input);
      const demographics = result.demographics as Record<string, unknown>;

      expect(demographics.birthYear).toBeUndefined();
    });

    it('should apply defaults for missing display fields', () => {
      const input = {};

      const result = expandAssumptions(input);
      const display = result.display as Record<string, unknown>;

      expect(display.useCompactCurrency).toBe(true);
      expect(display.showExperimentalFeatures).toBe(false);
      expect(display.hsaEligible).toBe(true);
    });

    // PR #58: corrected — top-level array is `withdrawalStrategy` (burn order),
    // restored from the flattened `burnOrder` key; `milestones` also defaults to [].
    it('should default priorities and withdrawalStrategy to empty arrays', () => {
      const input = {};

      const result = expandAssumptions(input);

      expect(result.priorities).toEqual([]);
      expect(result.withdrawalStrategy).toEqual([]);
      expect(result.milestones).toEqual([]);
      // No phantom withdrawalOrder key is emitted
      expect('withdrawalOrder' in result).toBe(false);
    });

    it('should preserve provided priorities and withdrawalStrategy (burn order)', () => {
      const input = {
        priorities: [{ type: 'debt', accountId: 'acc1' }],
        burnOrder: [{ accountId: 'acc2' }],
      };

      const result = expandAssumptions(input);

      expect(result.priorities).toEqual([{ type: 'debt', accountId: 'acc1' }]);
      expect(result.withdrawalStrategy).toEqual([{ accountId: 'acc2' }]);
    });

    it('should preserve non-default values when provided', () => {
      const input = {
        inflationRate: 4.0,
        ror: 8.0,
        retirementAge: 55,
        withdrawalStrategy: 'VPW',
      };

      const result = expandAssumptions(input);
      const macro = result.macro as Record<string, unknown>;
      const investments = result.investments as Record<string, unknown>;
      const demographics = result.demographics as Record<string, unknown>;
      const returnRates = investments.returnRates as Record<string, unknown>;

      expect(macro.inflationRate).toBe(4.0);
      expect(returnRates.ror).toBe(8.0);
      expect(demographics.retirementAge).toBe(55);
      expect(investments.withdrawalStrategy).toBe('VPW');
    });
  });

  describe('flattenAssumptions and expandAssumptions roundtrip', () => {
    it('should roundtrip assumptions with all fields', () => {
      const original = {
        macro: {
          inflationRate: 2.6,
          healthcareInflation: 3.9,
          inflationAdjusted: true,
        },
        income: {
          salaryGrowth: 1.0,
          qualifiesForSocialSecurity: true,
          socialSecurityFundingPercent: 100,
        },
        expenses: {
          lifestyleCreep: 75.0,
          housingAppreciation: 1.4,
          rentInflation: 1.2,
        },
        // PR #58: corrected — include the newer investments flags so the expanded
        // output (which now restores them from defaults) deep-equals the original.
        investments: {
          returnRates: { ror: 5.9 },
          withdrawalStrategy: 'Fixed Real',
          withdrawalRate: 4.0,
          gkUpperGuardrail: 1.2,
          gkLowerGuardrail: 0.8,
          gkAdjustmentPercent: 10,
          autoRothConversions: false,
          rothConversionStrategy: 'rate-match',
          rothConversionMinRateGap: 0.05,
          rothConversionDPBackloadDelta: 0.015,
          rothConversionUserSituation: 'self-liquidate',
          taxOptimizationEnabled: false,
          acaAware: true,
          acaAnnualSubsidyLoss: 12000,
        },
        demographics: {
          birthYear: 1985,
          retirementAge: 65,
          lifeExpectancy: 90,
          priorYearMode: false,
        },
        display: {
          useCompactCurrency: true,
          showExperimentalFeatures: false,
          hsaEligible: true,
        },
        priorities: [],
        // PR #58: corrected — real shape uses top-level `withdrawalStrategy` (burn
        // order) array + `milestones`, not the obsolete `withdrawalOrder` key.
        withdrawalStrategy: [],
        milestones: [],
      };

      const flattened = flattenAssumptions(original);
      const expanded = expandAssumptions(flattened);

      expect(expanded).toEqual(original);
    });

    it('should roundtrip assumptions with non-default values', () => {
      const original = {
        macro: {
          inflationRate: 4.0,
          healthcareInflation: 5.5,
          inflationAdjusted: false,
        },
        income: {
          salaryGrowth: 2.0,
          qualifiesForSocialSecurity: false,
          socialSecurityFundingPercent: 75,
        },
        expenses: {
          lifestyleCreep: 50.0,
          housingAppreciation: 2.0,
          rentInflation: 1.5,
        },
        // PR #58: corrected — include the newer investments flags.
        investments: {
          returnRates: { ror: 7.0 },
          withdrawalStrategy: 'Guardrails',
          withdrawalRate: 3.5,
          gkUpperGuardrail: 1.3,
          gkLowerGuardrail: 0.7,
          gkAdjustmentPercent: 15,
          autoRothConversions: true,
          rothConversionStrategy: 'rate-match',
          rothConversionMinRateGap: 0.05,
          rothConversionDPBackloadDelta: 0.015,
          rothConversionUserSituation: 'self-liquidate',
          taxOptimizationEnabled: false,
          acaAware: true,
          acaAnnualSubsidyLoss: 12000,
        },
        demographics: {
          birthYear: 1990,
          retirementAge: 55,
          lifeExpectancy: 95,
          priorYearMode: true,
        },
        display: {
          useCompactCurrency: false,
          showExperimentalFeatures: true,
          hsaEligible: false,
        },
        priorities: [{ type: 'debt', accountId: 'acc1' }],
        // PR #58: corrected — burn-order array is `withdrawalStrategy`; add `milestones`.
        withdrawalStrategy: [{ accountId: 'acc2' }],
        milestones: [],
      };

      const flattened = flattenAssumptions(original);
      const expanded = expandAssumptions(flattened);

      expect(expanded).toEqual(original);
    });
  });

  describe('compactAssumptions', () => {
    it('should flatten, strip defaults, and shorten keys', () => {
      // Full assumptions with mostly defaults
      const input = {
        macro: {
          inflationRate: 2.6, // default
          healthcareInflation: 3.9, // default
          inflationAdjusted: true, // default
        },
        demographics: {
          birthYear: 1985, // NOT default - should be preserved
          retirementAge: 65, // default
          lifeExpectancy: 90, // default
        },
        investments: {
          returnRates: { ror: 5.9 }, // default
          withdrawalStrategy: 'Fixed Real', // default
        },
        priorities: [],
        withdrawalOrder: [],
      };

      const result = compactAssumptions(input);

      // Should only contain birthYear (non-default) with shortened key
      expect(result.by).toBe(1985); // birthYear → by
      // Default values should be stripped
      expect('ir' in result).toBe(false); // inflationRate default stripped
      expect('rr' in result).toBe(false); // ror default stripped
    });

    it('should preserve non-default values with shortened keys', () => {
      const input = {
        macro: {
          inflationRate: 4.0, // NOT default
          healthcareInflation: 5.5, // NOT default
          inflationAdjusted: false, // NOT default
        },
        demographics: {
          birthYear: 1990,
          retirementAge: 55, // NOT default
        },
        investments: {
          returnRates: { ror: 7.0 }, // NOT default
          withdrawalStrategy: 'Guardrails', // NOT default
        },
      };

      const result = compactAssumptions(input);

      expect(result.ir).toBe(4.0); // inflationRate
      expect(result.hi).toBe(5.5); // healthcareInflation
      expect(result.ia).toBe(false); // inflationAdjusted
      expect(result.by).toBe(1990); // birthYear
      expect(result.ra).toBe(55); // retirementAge
      expect(result.rr).toBe(7.0); // ror
      expect(result.ws).toBe('Guardrails'); // withdrawalStrategy
    });

    it('should shorten keys in priorities array items', () => {
      const input = {
        priorities: [
          { type: 'debt', accountId: 'acc1', capType: 'fixed', capValue: 500 },
        ],
      };

      const result = compactAssumptions(input);
      const priorities = result.priorities as Array<Record<string, unknown>>;

      expect(priorities).toBeDefined();
      expect(priorities[0].t).toBe('debt'); // type
      expect(priorities[0].ai).toBe('acc1'); // accountId
      expect(priorities[0].ct).toBe('fixed'); // capType
      expect(priorities[0].cv).toBe(500); // capValue
    });

    // PR #58: corrected — empty burn-order is the top-level `withdrawalStrategy`
    // array, which flattens to `burnOrder` and must be excluded when empty.
    it('should exclude empty priorities and withdrawalStrategy (burn-order) arrays', () => {
      const input = {
        macro: { inflationRate: 2.6 },
        priorities: [],
        withdrawalStrategy: [],
        milestones: [],
      };

      const result = compactAssumptions(input);

      expect('priorities' in result).toBe(false);
      expect('bo' in result).toBe(false); // burnOrder short key absent
      expect('ms' in result).toBe(false); // milestones short key absent
    });
  });

  describe('expandCompactAssumptions', () => {
    it('should expand short keys and restore nested structure with defaults', () => {
      const compact = {
        by: 1985, // birthYear
        ir: 4.0, // inflationRate (non-default)
        rr: 7.0, // ror (non-default)
      };

      const result = expandCompactAssumptions(compact);

      // Check non-default values are preserved
      const macro = result.macro as Record<string, unknown>;
      const investments = result.investments as Record<string, unknown>;
      const demographics = result.demographics as Record<string, unknown>;
      const returnRates = investments.returnRates as Record<string, unknown>;

      expect(macro.inflationRate).toBe(4.0);
      expect(returnRates.ror).toBe(7.0);
      expect(demographics.birthYear).toBe(1985);

      // Check defaults are restored
      expect(macro.healthcareInflation).toBe(3.9);
      expect(macro.inflationAdjusted).toBe(true);
      expect(demographics.retirementAge).toBe(65);
      expect(demographics.lifeExpectancy).toBe(90);
    });

    it('should expand all short keys correctly', () => {
      const compact = {
        ir: 3.5, // inflationRate
        hi: 4.5, // healthcareInflation
        ia: false, // inflationAdjusted
        sg: 2.0, // salaryGrowth
        ss: false, // qualifiesForSocialSecurity
        sp: 80, // socialSecurityFundingPercent
        lc: 50, // lifestyleCreep
        ha: 2.5, // housingAppreciation
        ri: 1.8, // rentInflation
        rr: 6.5, // ror
        ws: 'VPW', // withdrawalStrategy
        wr: 3.5, // withdrawalRate
        gu: 1.25, // gkUpperGuardrail
        gl: 0.75, // gkLowerGuardrail
        ga: 12, // gkAdjustmentPercent
        ar: true, // autoRothConversions
        by: 1980, // birthYear
        ra: 60, // retirementAge
        le: 95, // lifeExpectancy
        pm: true, // priorYearMode
        cc: false, // useCompactCurrency
        ef: true, // showExperimentalFeatures
        he: false, // hsaEligible
      };

      const result = expandCompactAssumptions(compact);

      const macro = result.macro as Record<string, unknown>;
      expect(macro.inflationRate).toBe(3.5);
      expect(macro.healthcareInflation).toBe(4.5);
      expect(macro.inflationAdjusted).toBe(false);

      const income = result.income as Record<string, unknown>;
      expect(income.salaryGrowth).toBe(2.0);
      expect(income.qualifiesForSocialSecurity).toBe(false);
      expect(income.socialSecurityFundingPercent).toBe(80);

      const expenses = result.expenses as Record<string, unknown>;
      expect(expenses.lifestyleCreep).toBe(50);
      expect(expenses.housingAppreciation).toBe(2.5);
      expect(expenses.rentInflation).toBe(1.8);

      const investments = result.investments as Record<string, unknown>;
      const returnRates = investments.returnRates as Record<string, unknown>;
      expect(returnRates.ror).toBe(6.5);
      expect(investments.withdrawalStrategy).toBe('VPW');
      expect(investments.withdrawalRate).toBe(3.5);
      expect(investments.gkUpperGuardrail).toBe(1.25);
      expect(investments.gkLowerGuardrail).toBe(0.75);
      expect(investments.gkAdjustmentPercent).toBe(12);
      expect(investments.autoRothConversions).toBe(true);

      const demographics = result.demographics as Record<string, unknown>;
      expect(demographics.birthYear).toBe(1980);
      expect(demographics.retirementAge).toBe(60);
      expect(demographics.lifeExpectancy).toBe(95);
      expect(demographics.priorYearMode).toBe(true);

      const display = result.display as Record<string, unknown>;
      expect(display.useCompactCurrency).toBe(false);
      expect(display.showExperimentalFeatures).toBe(true);
      expect(display.hsaEligible).toBe(false);
    });
  });

  describe('compactAssumptions and expandCompactAssumptions roundtrip', () => {
    it('should roundtrip assumptions preserving all non-default values', () => {
      const original = {
        macro: {
          inflationRate: 4.0,
          healthcareInflation: 5.0,
          inflationAdjusted: false,
        },
        income: {
          salaryGrowth: 2.5,
          qualifiesForSocialSecurity: false,
          socialSecurityFundingPercent: 75,
        },
        expenses: {
          lifestyleCreep: 60,
          housingAppreciation: 2.0,
          rentInflation: 1.5,
        },
        // PR #58: corrected — include the newer investments flags.
        investments: {
          returnRates: { ror: 7.5 },
          withdrawalStrategy: 'Guardrails',
          withdrawalRate: 3.5,
          gkUpperGuardrail: 1.25,
          gkLowerGuardrail: 0.75,
          gkAdjustmentPercent: 12,
          autoRothConversions: true,
          rothConversionStrategy: 'rate-match',
          rothConversionMinRateGap: 0.05,
          rothConversionDPBackloadDelta: 0.015,
          rothConversionUserSituation: 'self-liquidate',
          taxOptimizationEnabled: false,
          acaAware: true,
          acaAnnualSubsidyLoss: 12000,
        },
        demographics: {
          birthYear: 1988,
          retirementAge: 58,
          lifeExpectancy: 92,
          priorYearMode: true,
        },
        display: {
          useCompactCurrency: false,
          showExperimentalFeatures: true,
          hsaEligible: false,
        },
        priorities: [
          { type: 'debt', accountId: 'acc1' },
        ],
        // PR #58: corrected — burn-order array is the top-level `withdrawalStrategy`.
        withdrawalStrategy: [
          { accountId: 'acc2' },
        ],
        milestones: [],
      };

      const compacted = compactAssumptions(original);
      const expanded = expandCompactAssumptions(compacted);

      expect(expanded).toEqual(original);
    });

    // #167: TARGET buckets carry capType/capValue like every other bucket —
    // qrUtils passes them through untransformed, so no qrUtils change needed.
    it('should roundtrip a priorities array containing a TARGET bucket', () => {
      const original = {
        priorities: [
          { id: 'p1', name: 'House fund', type: 'SAVINGS', accountId: 'acc1', capType: 'TARGET', capValue: 25000 },
          { id: 'p2', name: 'Rainy day', type: 'SAVINGS', accountId: 'acc2', capType: 'MULTIPLE_OF_EXPENSES', capValue: 6 },
        ],
      };

      const compacted = compactAssumptions(original);
      const expanded = expandCompactAssumptions(compacted);

      expect(expanded.priorities).toEqual(original.priorities);
    });

    it('should compact to much smaller object', () => {
      // All default values
      const fullDefaults = {
        macro: {
          inflationRate: 2.6,
          healthcareInflation: 3.9,
          inflationAdjusted: true,
        },
        income: {
          salaryGrowth: 1.0,
          qualifiesForSocialSecurity: true,
          socialSecurityFundingPercent: 100,
        },
        expenses: {
          lifestyleCreep: 75.0,
          housingAppreciation: 1.4,
          rentInflation: 1.2,
        },
        investments: {
          returnRates: { ror: 5.9 },
          withdrawalStrategy: 'Fixed Real',
          withdrawalRate: 4.0,
          gkUpperGuardrail: 1.2,
          gkLowerGuardrail: 0.8,
          gkAdjustmentPercent: 10,
          autoRothConversions: false,
        },
        demographics: {
          birthYear: 1985, // This is the only non-default
          retirementAge: 65,
          lifeExpectancy: 90,
          priorYearMode: false,
        },
        display: {
          useCompactCurrency: true,
          showExperimentalFeatures: false,
          hsaEligible: true,
        },
        priorities: [],
        withdrawalOrder: [],
      };

      const compacted = compactAssumptions(fullDefaults);

      // Should only have birthYear (non-default)
      expect(Object.keys(compacted).length).toBe(1);
      expect(compacted.by).toBe(1985);
    });
  });

  // ============================================
  // #181: QR whitelist must not silently drop assumptions fields
  // ============================================

  describe('#181: macro tax-shift + showDevTools survive a QR round-trip', () => {
    it('restores taxBracketShiftPct / taxBracketShiftStartYear / showDevTools', () => {
      // A user who modeled a future tax increase (bracket shift) + turned on
      // dev tools, then transferred via QR. Pre-fix these were dropped by the
      // expandAssumptions whitelist even though the bytes were in the payload.
      const original = {
        macro: {
          inflationRate: 2.6,
          healthcareInflation: 3.9,
          inflationAdjusted: true,
          taxBracketShiftPct: 5,
          taxBracketShiftStartYear: 2030,
        },
        display: {
          useCompactCurrency: true,
          showExperimentalFeatures: false,
          hsaEligible: true,
          showDevTools: true,
        },
      };

      const expanded = expandCompactAssumptions(compactAssumptions(original)) as {
        macro: Record<string, unknown>;
        display: Record<string, unknown>;
      };

      expect(expanded.macro.taxBracketShiftPct).toBe(5);
      expect(expanded.macro.taxBracketShiftStartYear).toBe(2030);
      expect(expanded.display.showDevTools).toBe(true);
    });

    it('leaves the fields absent for a legacy (pre-field) QR payload', () => {
      // Present-only restore: an old QR code that never carried these fields must
      // arrive without them so migrateAssumptions can backfill the defaults.
      const legacy = {
        macro: { inflationRate: 2.6, healthcareInflation: 3.9, inflationAdjusted: true },
        display: { useCompactCurrency: true, showExperimentalFeatures: false, hsaEligible: true },
      };

      const expanded = expandCompactAssumptions(compactAssumptions(legacy)) as {
        macro: Record<string, unknown>;
        display: Record<string, unknown>;
      };

      expect('taxBracketShiftPct' in expanded.macro).toBe(false);
      expect('taxBracketShiftStartYear' in expanded.macro).toBe(false);
      expect('showDevTools' in expanded.display).toBe(false);
    });
  });

  // Generated guard: walk the REAL defaultAssumptions and prove every primitive
  // leaf survives compactAssumptions -> expandCompactAssumptions. Any future
  // AssumptionsState field the QR whitelist forgets to restore — the exact class
  // of bug as #181 — turns this test red instead of silently shipping a plan that
  // reverts on import.
  describe('#181: every AssumptionsState primitive leaf survives a QR round-trip', () => {
    // Leaves that legitimately do NOT round-trip through the QR pipeline. Keep
    // this list SHORT and justified — each entry must be a conscious design
    // decision, never a way to silence a real field drop.
    //   (empty today: every persisted primitive leaf round-trips. The runtime-only
    //    macro.taxCalibration is never present in defaults, so the walk never
    //    reaches it and it needs no entry.)
    const NON_ROUNDTRIP_LEAVES = new Set<string>([]);

    const isPlainObject = (v: unknown): v is Record<string, unknown> =>
      typeof v === 'object' && v !== null && !Array.isArray(v);

    // Dotted paths to every primitive leaf. Arrays (priorities, the burn-order
    // withdrawalStrategy, milestones) have their own round-trip tests and are
    // skipped here.
    const collectLeafPaths = (obj: Record<string, unknown>, prefix = ''): string[] => {
      const paths: string[] = [];
      for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (isPlainObject(value)) {
          paths.push(...collectLeafPaths(value, path));
        } else if (!Array.isArray(value)) {
          paths.push(path);
        }
      }
      return paths;
    };

    const getAt = (obj: unknown, path: string): unknown =>
      path.split('.').reduce<unknown>(
        (acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]),
        obj
      );

    const setAt = (obj: Record<string, unknown>, path: string, value: unknown): void => {
      const keys = path.split('.');
      let cursor = obj;
      for (let i = 0; i < keys.length - 1; i++) {
        cursor = cursor[keys[i]] as Record<string, unknown>;
      }
      cursor[keys[keys.length - 1]] = value;
    };

    // A distinctive value guaranteed to differ from the default, so that a
    // dropped field (restored to its default / omitted) fails the assertion.
    const distinct = (v: unknown): unknown => {
      if (typeof v === 'number') return v + 137.5;
      if (typeof v === 'boolean') return !v;
      if (typeof v === 'string') return `${v}_ROUNDTRIP`;
      return v;
    };

    const leafPaths = collectLeafPaths(defaultAssumptions as unknown as Record<string, unknown>);

    it('walks a non-trivial set of leaves (guards against an empty walk)', () => {
      expect(leafPaths.length).toBeGreaterThan(15);
    });

    for (const path of leafPaths) {
      const runner = NON_ROUNDTRIP_LEAVES.has(path) ? it.skip : it;
      runner(`preserves ${path}`, () => {
        const original = structuredClone(defaultAssumptions) as unknown as Record<string, unknown>;
        const marker = distinct(getAt(original, path));
        setAt(original, path, marker);

        const expanded = expandCompactAssumptions(compactAssumptions(original));

        expect(getAt(expanded, path)).toEqual(marker);
      });
    }
  });

  // ============================================
  // Batch 24: QR Utils - History Compact/Expand
  // ============================================

  describe('compactHistory', () => {
    it('should convert account-ID-keyed to index-keyed format', () => {
      const accounts = [{ id: 'acct-abc' }, { id: 'acct-xyz' }];
      const history = {
        'acct-abc': [
          { date: '2024-01-15', num: 10000 },
          { date: '2024-02-15', num: 10500 },
        ],
        'acct-xyz': [
          { date: '2024-01-15', num: 5000 },
        ],
      };

      const result = compactHistory(history, accounts);

      // acct-abc is at index 0
      expect(result['0']).toBeDefined();
      expect(result['0'].length).toBe(2);

      // acct-xyz is at index 1
      expect(result['1']).toBeDefined();
      expect(result['1'].length).toBe(1);
    });

    it('should convert date strings to days since epoch', () => {
      const accounts = [{ id: 'acct-abc' }];
      const history = {
        'acct-abc': [
          { date: '2024-01-15', num: 10000 },
        ],
      };

      const result = compactHistory(history, accounts);

      // 2024-01-15 is some days since 2020-01-01
      const expectedDays = dateToDays('2024-01-15');
      expect(result['0'][0][0]).toBe(expectedDays);
      expect(result['0'][0][1]).toBe(10000);
    });

    it('should preserve cents in num values (no rounding)', () => {
      // Regression for the QR cents-loss fix: compactHistory used to Math.round
      // the snapshot amount, so a balance carrying cents diverged from the live
      // account.amount (which is never rounded) after a QR round-trip. The value
      // is now stored verbatim.
      const accounts = [{ id: 'acct-abc' }];
      const history = {
        'acct-abc': [
          { date: '2024-01-15', num: 10000.75 },
        ],
      };

      const result = compactHistory(history, accounts);

      expect(result['0'][0][1]).toBe(10000.75); // Cents preserved
    });

    it('should preserve correct index order matching accounts array', () => {
      const accounts = [
        { id: 'first' },
        { id: 'second' },
        { id: 'third' },
      ];
      const history = {
        third: [{ date: '2024-01-15', num: 3000 }],
        first: [{ date: '2024-01-15', num: 1000 }],
        second: [{ date: '2024-01-15', num: 2000 }],
      };

      const result = compactHistory(history, accounts);

      expect(result['0'][0][1]).toBe(1000); // first
      expect(result['1'][0][1]).toBe(2000); // second
      expect(result['2'][0][1]).toBe(3000); // third
    });

    it('should skip account IDs not in accounts array', () => {
      const accounts = [{ id: 'acct-abc' }];
      const history = {
        'acct-abc': [{ date: '2024-01-15', num: 10000 }],
        'unknown-account': [{ date: '2024-01-15', num: 5000 }],
      };

      const result = compactHistory(history, accounts);

      expect(Object.keys(result)).toEqual(['0']);
      expect(result['0'][0][1]).toBe(10000);
    });

    it('should handle empty history', () => {
      const accounts = [{ id: 'acct-abc' }];
      const history = {};

      const result = compactHistory(history, accounts);

      expect(result).toEqual({});
    });

    it('should handle empty accounts array', () => {
      const accounts: Array<{ id: string }> = [];
      const history = {
        'acct-abc': [{ date: '2024-01-15', num: 10000 }],
      };

      const result = compactHistory(history, accounts);

      expect(result).toEqual({});
    });
  });

  describe('expandHistory', () => {
    it('should convert index-keyed back to account-ID-keyed format', () => {
      const accounts = [{ id: 'acct-abc' }, { id: 'acct-xyz' }];
      const compact = {
        '0': [[dateToDays('2024-01-15'), 10000], [dateToDays('2024-02-15'), 10500]] as Array<[number, number]>,
        '1': [[dateToDays('2024-01-15'), 5000]] as Array<[number, number]>,
      };

      const result = expandHistory(compact, accounts);

      expect(result['acct-abc']).toBeDefined();
      expect(result['acct-abc'].length).toBe(2);
      expect(result['acct-xyz']).toBeDefined();
      expect(result['acct-xyz'].length).toBe(1);
    });

    it('should convert days since epoch back to date strings', () => {
      const accounts = [{ id: 'acct-abc' }];
      const days = dateToDays('2024-01-15');
      const compact = {
        '0': [[days, 10000]] as Array<[number, number]>,
      };

      const result = expandHistory(compact, accounts);

      expect(result['acct-abc'][0].date).toBe('2024-01-15');
      expect(result['acct-abc'][0].num).toBe(10000);
    });

    it('should skip indices beyond accounts array length', () => {
      const accounts = [{ id: 'acct-abc' }];
      const compact = {
        '0': [[dateToDays('2024-01-15'), 10000]] as Array<[number, number]>,
        '5': [[dateToDays('2024-01-15'), 99999]] as Array<[number, number]>, // Invalid index
      };

      const result = expandHistory(compact, accounts);

      expect(Object.keys(result)).toEqual(['acct-abc']);
    });

    it('should handle empty compact history', () => {
      const accounts = [{ id: 'acct-abc' }];
      const compact = {};

      const result = expandHistory(compact, accounts);

      expect(result).toEqual({});
    });
  });

  describe('compactHistory and expandHistory roundtrip', () => {
    it('should roundtrip history preserving all data', () => {
      const accounts = [{ id: 'acct-abc' }, { id: 'acct-xyz' }];
      const original = {
        'acct-abc': [
          { date: '2024-01-15', num: 10000 },
          { date: '2024-02-15', num: 10500 },
        ],
        'acct-xyz': [
          { date: '2024-01-15', num: 5000 },
        ],
      };

      const compacted = compactHistory(original, accounts);
      const expanded = expandHistory(compacted, accounts);

      expect(expanded).toEqual(original);
    });

    it('should roundtrip with multiple entries per account', () => {
      const accounts = [{ id: 'checking' }, { id: 'savings' }, { id: '401k' }];
      const original = {
        checking: [
          { date: '2024-01-01', num: 5000 },
          { date: '2024-02-01', num: 5500 },
          { date: '2024-03-01', num: 6000 },
        ],
        savings: [
          { date: '2024-01-01', num: 10000 },
          { date: '2024-03-01', num: 12000 },
        ],
        '401k': [
          { date: '2024-01-01', num: 50000 },
          { date: '2024-02-01', num: 51500 },
          { date: '2024-03-01', num: 52800 },
        ],
      };

      const compacted = compactHistory(original, accounts);
      const expanded = expandHistory(compacted, accounts);

      expect(expanded).toEqual(original);
    });

    it('should roundtrip with epoch date', () => {
      const accounts = [{ id: 'test' }];
      const original = {
        test: [
          { date: '2020-01-01', num: 1000 }, // Epoch
          { date: '2020-01-02', num: 1001 }, // Day 1
        ],
      };

      const compacted = compactHistory(original, accounts);
      const expanded = expandHistory(compacted, accounts);

      expect(expanded).toEqual(original);
    });
  });

  // ============================================
  // Batch 25: QR Utils - Full Backup Compact/Expand
  // ============================================

  describe('createCompactBackup', () => {
    it('should compress full backup with shortened keys and no defaults', () => {
      const full = {
        version: 1,
        accounts: [
          {
            id: 'acc1',
            name: 'Checking',
            amount: 5000,
            employerBalance: 0, // default - should be stripped
            tenureYears: 0, // default
            vestedPerYear: 0, // default
            costBasis: 0, // default
          },
        ],
        incomes: [
          {
            id: 'inc1',
            name: 'Salary',
            amount: 100000,
            annualGrowthRate: 0.03, // default
            hsaContribution: 0, // default
          },
        ],
        expenses: [
          {
            id: 'exp1',
            name: 'Rent',
            amount: 24000,
            annualGrowthRate: 0.03, // default
          },
        ],
        taxSettings: {
          filingStatus: 'married_filing_jointly',
          stateResidency: 'VA',
        },
        assumptions: {
          macro: { inflationRate: 2.6 }, // default
          demographics: { birthYear: 1985 }, // NOT default
        },
        amountHistory: {},
      };

      const result = createCompactBackup(full);

      // Verify version is compacted
      expect(result.v).toBe(1);

      // Verify accounts have shortened keys (result.a)
      expect(result.a).toBeDefined();
      const acc = result.a[0];
      expect(acc.d).toBe('acc1'); // id → d
      expect(acc.n).toBe('Checking'); // name → n
      expect(acc.a).toBe(5000); // amount → a
      // Defaults should be stripped
      expect('b' in acc).toBe(false); // employerBalance stripped (employerBalance → b)
      expect('y' in acc).toBe(false); // tenureYears stripped (tenureYears → y)

      // Verify incomes have shortened keys (result.i)
      const inc = result.i[0];
      expect(inc.d).toBe('inc1'); // id → d
      expect(inc.n).toBe('Salary');
      expect(inc.a).toBe(100000);
      // Defaults should be stripped
      expect('w' in inc).toBe(false); // annualGrowthRate stripped (annualGrowthRate → w)

      // Verify expenses have shortened keys (result.e)
      const exp = result.e[0];
      expect(exp.d).toBe('exp1'); // id → d
      expect(exp.n).toBe('Rent');
      expect(exp.a).toBe(24000);

      // Verify assumptions are compacted (result.m)
      expect(result.m).toBeDefined();
      expect(result.m.by).toBe(1985); // birthYear
      // Default inflationRate should be stripped
      expect('ir' in result.m).toBe(false);
    });

    it('should produce significantly smaller output than input', () => {
      const full = {
        version: 1,
        accounts: [
          {
            id: 'acc1',
            name: 'Test',
            amount: 5000,
            employerBalance: 0,
            tenureYears: 0,
            vestedPerYear: 0,
            costBasis: 0,
            conversionHistory: [],
            nonVestedAmount: 0,
            expenseRatio: 0,
            lots: [],
            linkedIncomeId: null,
            withdrawalPreference: 'fifo',
            minimumHoldingDays: 0,
          },
        ],
        incomes: [],
        expenses: [],
        taxSettings: {},
        assumptions: {
          macro: { inflationRate: 2.6 },
          demographics: { birthYear: 1985 },
        },
        amountHistory: {},
      };

      const compact = createCompactBackup(full);

      const originalSize = JSON.stringify(full).length;
      const compactSize = JSON.stringify(compact).length;

      // Compact should be significantly smaller
      expect(compactSize).toBeLessThan(originalSize);
    });

    it('should compact history with index keys', () => {
      const full = {
        version: 1,
        accounts: [{ id: 'acc1', name: 'Test', amount: 5000 }],
        incomes: [],
        expenses: [],
        taxSettings: {},
        assumptions: { demographics: { birthYear: 1985 } },
        amountHistory: {
          acc1: [
            { date: '2024-01-15', num: 5000 },
            { date: '2024-02-15', num: 5500 },
          ],
        },
      };

      const result = createCompactBackup(full);

      // History should use index '0' instead of 'acc1' (result.h)
      expect(result.h).toBeDefined();
      expect(result.h['0']).toBeDefined();
      expect(result.h['0'].length).toBe(2);
      // Dates converted to days
      expect(typeof result.h['0'][0][0]).toBe('number');
      expect(result.h['0'][0][1]).toBe(5000);
    });
  });

  describe('expandCompactBackup', () => {
    it('should expand shortened keys and restore defaults', () => {
      const compact = {
        v: 1,
        a: [
          { d: 'acc1', n: 'Checking', a: 5000 }, // id → d
        ],
        i: [
          { d: 'inc1', n: 'Salary', a: 100000 }, // id → d
        ],
        e: [
          { d: 'exp1', n: 'Rent', a: 24000 }, // id → d
        ],
        t: { F: 'married_filing_jointly', S: 'VA' }, // filingStatus → F, stateResidency → S
        m: { by: 1985 },
        h: {},
      };

      const result = expandCompactBackup(compact);

      // Verify version is expanded
      expect(result.version).toBe(1);

      // Verify accounts have expanded keys and defaults
      const acc = result.accounts[0];
      expect(acc.id).toBe('acc1');
      expect(acc.name).toBe('Checking');
      expect(acc.amount).toBe(5000);
      expect(acc.employerBalance).toBe(0); // default restored
      expect(acc.tenureYears).toBe(0); // default restored

      // Verify incomes have expanded keys and defaults
      const inc = result.incomes[0];
      expect(inc.id).toBe('inc1');
      expect(inc.name).toBe('Salary');
      expect(inc.amount).toBe(100000);
      expect(inc.annualGrowthRate).toBe(0.03); // default restored

      // Verify expenses have expanded keys and defaults
      const exp = result.expenses[0];
      expect(exp.id).toBe('exp1');
      expect(exp.name).toBe('Rent');
      expect(exp.amount).toBe(24000);
      expect(exp.annualGrowthRate).toBe(0.03); // default restored
    });

    it('should expand assumptions to nested structure with defaults', () => {
      const compact = {
        v: 1,
        a: [] as Array<Record<string, unknown>>,
        i: [] as Array<Record<string, unknown>>,
        e: [] as Array<Record<string, unknown>>,
        t: {},
        m: { by: 1985, ir: 4.0, rr: 7.0 },
        h: {} as Record<string, Array<[number, number]>>,
      };

      const result = expandCompactBackup(compact);

      const assumptions = result.assumptions as Record<string, unknown>;
      const macro = assumptions.macro as Record<string, unknown>;
      const investments = assumptions.investments as Record<string, unknown>;
      const returnRates = investments.returnRates as Record<string, unknown>;
      const demographics = assumptions.demographics as Record<string, unknown>;

      expect(macro.inflationRate).toBe(4.0); // non-default preserved
      expect(macro.healthcareInflation).toBe(3.9); // default restored
      expect(returnRates.ror).toBe(7.0); // non-default preserved
      expect(demographics.birthYear).toBe(1985);
      expect(demographics.retirementAge).toBe(65); // default restored
    });

    it('should expand history from index to account ID keys', () => {
      const compact = {
        v: 1,
        a: [
          { d: 'acc1', n: 'Test', a: 5000 }, // id → d
          { d: 'acc2', n: 'Test2', a: 10000 }, // id → d
        ],
        i: [] as Array<Record<string, unknown>>,
        e: [] as Array<Record<string, unknown>>,
        t: {},
        m: { by: 1985 },
        h: {
          '0': [[dateToDays('2024-01-15'), 5000]] as Array<[number, number]>,
          '1': [[dateToDays('2024-01-15'), 10000]] as Array<[number, number]>,
        },
      };

      const result = expandCompactBackup(compact);

      expect(result.amountHistory['acc1']).toBeDefined();
      expect(result.amountHistory['acc1'][0].date).toBe('2024-01-15');
      expect(result.amountHistory['acc1'][0].num).toBe(5000);
      expect(result.amountHistory['acc2']).toBeDefined();
      expect(result.amountHistory['acc2'][0].date).toBe('2024-01-15');
      expect(result.amountHistory['acc2'][0].num).toBe(10000);
    });
  });

  describe('createCompactBackup and expandCompactBackup roundtrip', () => {
    it('should roundtrip full backup preserving all data', () => {
      const original = {
        version: 1,
        accounts: [
          {
            id: 'acc1',
            name: 'Checking',
            amount: 5000,
            employerBalance: 0,
            tenureYears: 0,
            vestedPerYear: 0,
            costBasis: 0,
            conversionHistory: [],
            nonVestedAmount: 0,
            expenseRatio: 0,
            lots: [],
            linkedIncomeId: null,
            withdrawalPreference: 'fifo',
            minimumHoldingDays: 0,
          },
        ],
        incomes: [
          {
            id: 'inc1',
            name: 'Salary',
            amount: 100000,
            annualGrowthRate: 0.03,
            hsaContribution: 0,
            autoMax401k: false,
            matchAccountId: null,
            esppContributionType: 'NONE',
            esppContributionAmount: 0,
            esppDiscountPercent: 15,
            esppHasLookback: true,
            esppOfferingPeriodMonths: 6,
            esppAccountId: null,
            esppExpectedStockGrowth: 7,
            rsuVestingSchedule: 'NONE',
            rsuGrantShares: 0,
            rsuVestFrequency: 'quarterly',
            rsuExpectedStockGrowth: 7,
            rsuAccountId: null,
            rsuWithholdingRate: 37,
            pensionSystem: 'NONE',
          },
        ],
        expenses: [
          {
            id: 'exp1',
            name: 'Rent',
            amount: 24000,
            annualGrowthRate: 0.03,
            is_tax_deductible: false,
            tax_deductible: false,
            annualMode: 'lump',
          },
        ],
        taxSettings: {
          filingStatus: 'married_filing_jointly',
          stateResidency: 'VA',
          deductionMethod: 'Auto',
          fedOverride: null,
          ficaOverride: null,
          stateOverride: null,
        },
        assumptions: {
          macro: {
            inflationRate: 2.6,
            healthcareInflation: 3.9,
            inflationAdjusted: true,
          },
          income: {
            salaryGrowth: 1.0,
            qualifiesForSocialSecurity: true,
            socialSecurityFundingPercent: 100,
          },
          expenses: {
            lifestyleCreep: 75.0,
            housingAppreciation: 1.4,
            rentInflation: 1.2,
          },
          // PR #58: corrected — include the newer investments flags.
          investments: {
            returnRates: { ror: 5.9 },
            withdrawalStrategy: 'Fixed Real',
            withdrawalRate: 4.0,
            gkUpperGuardrail: 1.2,
            gkLowerGuardrail: 0.8,
            gkAdjustmentPercent: 10,
            autoRothConversions: false,
            rothConversionStrategy: 'rate-match',
            rothConversionMinRateGap: 0.05,
            rothConversionDPBackloadDelta: 0.015,
            rothConversionUserSituation: 'self-liquidate',
            taxOptimizationEnabled: false,
            acaAware: true,
            acaAnnualSubsidyLoss: 12000,
          },
          demographics: {
            birthYear: 1985,
            retirementAge: 65,
            lifeExpectancy: 90,
            priorYearMode: false,
          },
          display: {
            useCompactCurrency: true,
            showExperimentalFeatures: false,
            hsaEligible: true,
          },
          priorities: [],
          // PR #58: corrected — real shape uses top-level `withdrawalStrategy` array + `milestones`.
          withdrawalStrategy: [],
          milestones: [],
        },
        amountHistory: {
          acc1: [
            { date: '2024-01-15', num: 5000 },
            { date: '2024-02-15', num: 5500 },
          ],
        },
      };

      const compacted = createCompactBackup(original);
      const expanded = expandCompactBackup(compacted);

      expect(expanded).toEqual(original);
    });

    it('should roundtrip backup with non-default values', () => {
      const original = {
        version: 1,
        accounts: [
          {
            id: 'acc1',
            name: 'Test Account',
            amount: 10000,
            employerBalance: 5000, // non-default
            tenureYears: 3, // non-default
            vestedPerYear: 25, // non-default
            costBasis: 8000, // non-default
            conversionHistory: [],
            nonVestedAmount: 0,
            expenseRatio: 0,
            lots: [],
            linkedIncomeId: null,
            withdrawalPreference: 'fifo',
            minimumHoldingDays: 0,
          },
        ],
        incomes: [
          {
            id: 'inc1',
            name: 'Job',
            amount: 120000,
            annualGrowthRate: 0.05, // non-default
            hsaContribution: 3850, // non-default
            autoMax401k: true, // non-default
            matchAccountId: 'acc1', // non-default
            esppContributionType: 'NONE',
            esppContributionAmount: 0,
            esppDiscountPercent: 15,
            esppHasLookback: true,
            esppOfferingPeriodMonths: 6,
            esppAccountId: null,
            esppExpectedStockGrowth: 7,
            rsuVestingSchedule: 'NONE',
            rsuGrantShares: 0,
            rsuVestFrequency: 'quarterly',
            rsuExpectedStockGrowth: 7,
            rsuAccountId: null,
            rsuWithholdingRate: 37,
            pensionSystem: 'NONE',
          },
        ],
        expenses: [
          {
            id: 'exp1',
            name: 'Mortgage',
            amount: 36000,
            annualGrowthRate: 0.03,
            is_tax_deductible: true, // non-default
            tax_deductible: false,
            annualMode: 'lump',
          },
        ],
        taxSettings: {
          filingStatus: 'single',
          stateResidency: 'CA',
          deductionMethod: 'Auto',
          fedOverride: null,
          ficaOverride: null,
          stateOverride: null,
        },
        assumptions: {
          macro: {
            inflationRate: 4.0, // non-default
            healthcareInflation: 3.9,
            inflationAdjusted: true,
          },
          income: {
            salaryGrowth: 1.0,
            qualifiesForSocialSecurity: true,
            socialSecurityFundingPercent: 100,
          },
          expenses: {
            lifestyleCreep: 75.0,
            housingAppreciation: 1.4,
            rentInflation: 1.2,
          },
          // PR #58: corrected — include the newer investments flags.
          investments: {
            returnRates: { ror: 7.0 }, // non-default
            withdrawalStrategy: 'Guardrails', // non-default
            withdrawalRate: 3.5, // non-default
            gkUpperGuardrail: 1.2,
            gkLowerGuardrail: 0.8,
            gkAdjustmentPercent: 10,
            autoRothConversions: false,
            rothConversionStrategy: 'rate-match',
            rothConversionMinRateGap: 0.05,
            rothConversionDPBackloadDelta: 0.015,
            rothConversionUserSituation: 'self-liquidate',
            taxOptimizationEnabled: false,
            acaAware: true,
            acaAnnualSubsidyLoss: 12000,
          },
          demographics: {
            birthYear: 1990,
            retirementAge: 55, // non-default
            lifeExpectancy: 95, // non-default
            priorYearMode: false,
          },
          display: {
            useCompactCurrency: true,
            showExperimentalFeatures: false,
            hsaEligible: true,
          },
          priorities: [],
          // PR #58: corrected — real shape uses top-level `withdrawalStrategy` array + `milestones`.
          withdrawalStrategy: [],
          milestones: [],
        },
        amountHistory: {},
      };

      const compacted = createCompactBackup(original);
      const expanded = expandCompactBackup(compacted);

      expect(expanded).toEqual(original);
    });
  });

  // ============================================
  // Batch 26: QR Utils - Compression Functions
  // ============================================

  describe('compressData', () => {
    it('should compress object to base64 string', () => {
      const data = { test: 'value', number: 12345 };

      const result = compressData(data);

      expect(typeof result).toBe('string');
      // Base64 characters only
      expect(result).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('should not RangeError on a large, low-redundancy payload (PR #58)', () => {
      // String.fromCharCode(...bytes) used to spread the whole deflated array as
      // arguments and overflow the call stack for large inputs. Use random-ish,
      // poorly-compressible data so the deflated byte array stays large (>64 KB).
      const big = {
        items: Array.from({ length: 20000 }, (_, i) => ({
          id: `id-${i}-${(i * 2654435761 % 1e9).toString(36)}`,
          v: Math.sin(i) * 1e6,
        })),
      };
      let compressed = '';
      expect(() => { compressed = compressData(big); }).not.toThrow();
      // And it still round-trips.
      expect(decompressData(compressed)).toEqual(big);
    });

    it('should produce smaller output for repetitive data', () => {
      const repetitiveData = {
        items: Array.from({ length: 100 }, (_, i) => ({
          id: `item-${i}`,
          name: 'Test Item',
          value: 1000,
        })),
      };

      const originalJson = JSON.stringify(repetitiveData);
      const compressed = compressData(repetitiveData);

      // Compression should be effective on repetitive data
      expect(compressed.length).toBeLessThan(originalJson.length);
    });

    it('should handle empty object', () => {
      const result = compressData({});

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle nested objects', () => {
      const nested = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      };

      const result = compressData(nested);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle arrays', () => {
      const data = { items: [1, 2, 3, 4, 5] };

      const result = compressData(data);

      expect(typeof result).toBe('string');
    });
  });

  describe('decompressData', () => {
    it('should decompress base64 string back to original object', () => {
      const original = { test: 'value', number: 12345 };
      const compressed = compressData(original);

      const result = decompressData(compressed);

      expect(result).toEqual(original);
    });

    it('should decompress nested objects', () => {
      const original = {
        level1: {
          level2: {
            value: 'deep',
            array: [1, 2, 3],
          },
        },
      };
      const compressed = compressData(original);

      const result = decompressData(compressed);

      expect(result).toEqual(original);
    });

    it('should decompress arrays', () => {
      const original = { items: ['a', 'b', 'c'] };
      const compressed = compressData(original);

      const result = decompressData(compressed);

      expect(result).toEqual(original);
    });

    it('should decompress empty object', () => {
      const original = {};
      const compressed = compressData(original);

      const result = decompressData(compressed);

      expect(result).toEqual(original);
    });
  });

  describe('compressData and decompressData roundtrip', () => {
    it('should roundtrip simple object', () => {
      const original = { id: 'test', value: 42 };

      const compressed = compressData(original);
      const decompressed = decompressData(compressed);

      expect(decompressed).toEqual(original);
    });

    it('should roundtrip complex backup structure', () => {
      const original = {
        accounts: [
          { i: 'acc1', n: 'Checking', a: 5000 },
          { i: 'acc2', n: 'Savings', a: 20000 },
        ],
        incomes: [{ i: 'inc1', n: 'Salary', a: 100000 }],
        expenses: [{ i: 'exp1', n: 'Rent', a: 24000 }],
        tax: { fs: 'single', sr: 'NY' },
        assumptions: { by: 1985, ra: 60 },
        history: {
          '0': [[1475, 5000], [1506, 5500]],
          '1': [[1475, 20000]],
        },
      };

      const compressed = compressData(original);
      const decompressed = decompressData(compressed);

      expect(decompressed).toEqual(original);
    });

    it('should roundtrip with special characters', () => {
      const original = {
        name: 'Test & "Special" <Characters>',
        unicode: '日本語テスト',
      };

      const compressed = compressData(original);
      const decompressed = decompressData(compressed);

      expect(decompressed).toEqual(original);
    });

    it('should roundtrip with boolean and null values', () => {
      const original = {
        active: true,
        disabled: false,
        empty: null,
        zero: 0,
      };

      const compressed = compressData(original);
      const decompressed = decompressData(compressed);

      expect(decompressed).toEqual(original);
    });
  });

  describe('exceedsQRLimit', () => {
    it('should return false for string under 2200 bytes', () => {
      const shortString = 'a'.repeat(2000);

      const result = exceedsQRLimit(shortString);

      expect(result).toBe(false);
    });

    it('should return false for string exactly 2200 bytes', () => {
      const exactString = 'a'.repeat(2200);

      const result = exceedsQRLimit(exactString);

      expect(result).toBe(false);
    });

    it('should return true for string over 2200 bytes', () => {
      const longString = 'a'.repeat(2201);

      const result = exceedsQRLimit(longString);

      expect(result).toBe(true);
    });

    it('should return false for empty string', () => {
      const result = exceedsQRLimit('');

      expect(result).toBe(false);
    });

    it('should correctly evaluate typical compressed backup', () => {
      // Simulate a small backup
      const smallBackup = compressData({
        accounts: [{ i: 'acc1', n: 'Test', a: 5000 }],
        assumptions: { by: 1985 },
      });

      // Small backups should not exceed limit
      expect(exceedsQRLimit(smallBackup)).toBe(false);
    });

    it('should return true for large compressed data', () => {
      // Create large data that will exceed limit even compressed
      const largeData = {
        accounts: Array.from({ length: 100 }, (_, i) => ({
          id: `account-${i}-${Math.random().toString(36)}`,
          name: `Account Name ${i} with some extra text to make it larger`,
          amount: Math.floor(Math.random() * 1000000),
          description: 'This is a long description that adds more bytes to the payload',
        })),
      };
      const compressed = compressData(largeData);

      // Large data should exceed the limit
      expect(exceedsQRLimit(compressed)).toBe(true);
    });
  });

  // ============================================
  // PR #58: QR-backup data-loss regression tests
  // ============================================
  describe('PR #58 regressions', () => {
    // FINDING #2: `pp` short-key collision between purchasePrice (ESPP lot)
    // and projectedPIA (Social Security). An ESPP lot's purchasePrice must
    // survive a QR round-trip and must NOT be renamed to projectedPIA.
    it('should preserve ESPP lot purchasePrice through a full backup round-trip', () => {
      const original = {
        version: 1,
        accounts: [
          {
            id: 'espp1',
            className: 'ESPPAccount',
            name: 'Company ESPP',
            amount: 0,
            lots: [
              {
                grantDate: '2023-01-01',
                purchaseDate: '2023-06-30',
                fmvAtGrant: 100,
                fmvAtPurchase: 120,
                purchasePrice: 85, // <-- must survive, must NOT become projectedPIA
                shares: 50,
                totalCost: 4250,
                discountAmount: 750,
              },
            ],
          },
        ],
        incomes: [],
        expenses: [],
        taxSettings: {
          filingStatus: 'Single',
          stateResidency: 'DC',
          deductionMethod: 'Auto',
          fedOverride: null,
          ficaOverride: null,
          stateOverride: null,
        },
        assumptions: {
          macro: { inflationRate: 2.6, healthcareInflation: 3.9, inflationAdjusted: true },
          income: { salaryGrowth: 1.0, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
          expenses: { lifestyleCreep: 75.0, housingAppreciation: 1.4, rentInflation: 1.2 },
          investments: {
            returnRates: { ror: 5.9 },
            withdrawalStrategy: 'Fixed Real',
            withdrawalRate: 4.0,
            gkUpperGuardrail: 1.2,
            gkLowerGuardrail: 0.8,
            gkAdjustmentPercent: 10,
            autoRothConversions: false,
            rothConversionStrategy: 'rate-match',
            rothConversionMinRateGap: 0.05,
            rothConversionDPBackloadDelta: 0.015,
            rothConversionUserSituation: 'self-liquidate',
            taxOptimizationEnabled: false,
            acaAware: true,
            acaAnnualSubsidyLoss: 12000,
          },
          demographics: { priorYearMode: false },
          display: { useCompactCurrency: true, showExperimentalFeatures: false, hsaEligible: true },
          priorities: [],
          withdrawalStrategy: [],
          milestones: [],
        },
        amountHistory: {},
      };

      const compacted = createCompactBackup(original);
      const expanded = expandCompactBackup(compacted);

      const lot = (expanded.accounts[0] as Record<string, unknown>).lots as Array<Record<string, unknown>>;
      expect(lot[0].purchasePrice).toBe(85);
      expect('projectedPIA' in lot[0]).toBe(false);
    });

    it('should keep projectedPIA round-tripping on a Social Security income (no collision)', () => {
      const income = {
        className: 'SocialSecurityIncome',
        id: 'ss1',
        name: 'Social Security',
        claimingAge: 67,
        calculatedPIA: 2500,
        calculationYear: 2026,
        projectedPIA: 3100, // distinct from purchasePrice now
      };

      const shortened = shortenKeys(income) as Record<string, unknown>;
      const expanded = expandKeys(shortened) as Record<string, unknown>;

      expect(expanded.projectedPIA).toBe(3100);
      expect('purchasePrice' in expanded).toBe(false);
    });

    // FINDINGS #1, #4, #6: milestones, top-level withdrawalStrategy burn order,
    // demographics.priorEarnings, and the newer investments flags must all
    // survive the compact assumptions round-trip.
    it('should round-trip milestones, burn-order, priorEarnings, and investment flags', () => {
      const original = {
        macro: { inflationRate: 4.0, healthcareInflation: 5.0, inflationAdjusted: false },
        income: { salaryGrowth: 2.5, qualifiesForSocialSecurity: false, socialSecurityFundingPercent: 75 },
        expenses: { lifestyleCreep: 60, housingAppreciation: 2.0, rentInflation: 1.5 },
        investments: {
          returnRates: { ror: 7.5 },
          withdrawalStrategy: 'Guardrails',
          withdrawalRate: 3.5,
          gkUpperGuardrail: 1.25,
          gkLowerGuardrail: 0.75,
          gkAdjustmentPercent: 12,
          autoRothConversions: true,
          rothConversionStrategy: 'dp-precomputed', // non-default
          rothConversionMinRateGap: 0.08, // non-default
          rothConversionDPBackloadDelta: 0.02, // non-default
          taxOptimizationEnabled: true, // non-default
          acaAware: false, // non-default
          acaAnnualSubsidyLoss: 12000,
        },
        demographics: {
          priorYearMode: true,
          priorEarnings: [
            { year: 2010, earnings: 50000 },
            { year: 2011, earnings: 55000 },
          ],
        },
        display: { useCompactCurrency: false, showExperimentalFeatures: true, hsaEligible: false },
        priorities: [{ type: 'debt', accountId: 'acc1' }],
        withdrawalStrategy: [
          { id: 'w1', name: 'Brokerage', accountId: 'acc1' },
          { id: 'w2', name: 'Roth', accountId: 'acc2', maxAmount: 10000 },
        ],
        milestones: [
          {
            id: 'BUILTIN_BIRTH',
            name: 'Birth',
            conditions: [{ type: 'YEAR', operator: '=', value: 1980 }],
            color: 'var(--c-accent-soft)',
          },
          {
            id: 'BUILTIN_RETIRE',
            name: 'Retire',
            conditions: [{ type: 'AGE', operator: '>=', value: 58 }],
            color: 'var(--c-positive-soft)',
          },
          {
            id: 'BUILTIN_END_OF_PLAN',
            name: 'End of Plan',
            conditions: [{ type: 'AGE', operator: '>=', value: 92 }],
            color: 'var(--c-content-subtle)',
          },
        ],
      };

      const compacted = compactAssumptions(original);
      const expanded = expandCompactAssumptions(compacted);

      // Top-level burn-order array survives (and is NOT the investments string)
      expect(expanded.withdrawalStrategy).toEqual(original.withdrawalStrategy);
      expect((expanded.investments as Record<string, unknown>).withdrawalStrategy).toBe('Guardrails');
      // Milestones survive
      expect(expanded.milestones).toEqual(original.milestones);
      // priorEarnings survive
      expect((expanded.demographics as Record<string, unknown>).priorEarnings).toEqual(
        original.demographics.priorEarnings
      );
      // Investment flags survive
      const inv = expanded.investments as Record<string, unknown>;
      expect(inv.rothConversionStrategy).toBe('dp-precomputed');
      expect(inv.rothConversionMinRateGap).toBe(0.08);
      expect(inv.rothConversionDPBackloadDelta).toBe(0.02);
      expect(inv.taxOptimizationEnabled).toBe(true);
      expect(inv.acaAware).toBe(false);

      // No phantom withdrawalOrder key
      expect('withdrawalOrder' in expanded).toBe(false);
    });

    it('should round-trip the new fields when embedded in a full backup', () => {
      const original = {
        version: 1,
        accounts: [],
        incomes: [],
        expenses: [],
        taxSettings: {
          filingStatus: 'Single',
          stateResidency: 'DC',
          deductionMethod: 'Auto',
          fedOverride: null,
          ficaOverride: null,
          stateOverride: null,
        },
        assumptions: {
          macro: { inflationRate: 2.6, healthcareInflation: 3.9, inflationAdjusted: true },
          income: { salaryGrowth: 1.0, qualifiesForSocialSecurity: true, socialSecurityFundingPercent: 100 },
          expenses: { lifestyleCreep: 75.0, housingAppreciation: 1.4, rentInflation: 1.2 },
          investments: {
            returnRates: { ror: 5.9 },
            withdrawalStrategy: 'Fixed Real',
            withdrawalRate: 4.0,
            gkUpperGuardrail: 1.2,
            gkLowerGuardrail: 0.8,
            gkAdjustmentPercent: 10,
            autoRothConversions: false,
            rothConversionStrategy: 'rate-match',
            rothConversionMinRateGap: 0.05,
            rothConversionDPBackloadDelta: 0.015,
            taxOptimizationEnabled: true, // non-default
            acaAware: false, // non-default
            acaAnnualSubsidyLoss: 12000,
          },
          demographics: {
            priorYearMode: false,
            priorEarnings: [{ year: 2015, earnings: 80000 }],
          },
          display: { useCompactCurrency: true, showExperimentalFeatures: false, hsaEligible: true },
          priorities: [],
          withdrawalStrategy: [{ id: 'w1', name: 'Brokerage', accountId: 'acc1' }],
          milestones: [
            {
              id: 'BUILTIN_BIRTH',
              name: 'Birth',
              conditions: [{ type: 'YEAR', operator: '=', value: 1992 }],
              color: 'var(--c-accent-soft)',
            },
          ],
        },
        amountHistory: {},
      };

      const compacted = createCompactBackup(original);
      const expanded = expandCompactBackup(compacted);
      const a = expanded.assumptions as Record<string, unknown>;

      expect(a.milestones).toEqual(original.assumptions.milestones);
      expect(a.withdrawalStrategy).toEqual(original.assumptions.withdrawalStrategy);
      expect((a.demographics as Record<string, unknown>).priorEarnings).toEqual(
        original.assumptions.demographics.priorEarnings
      );
      expect((a.investments as Record<string, unknown>).taxOptimizationEnabled).toBe(true);
      expect((a.investments as Record<string, unknown>).acaAware).toBe(false);
    });
  });

  // ============================================
  // PR #59: legacy `pp` decode regressions
  // ============================================
  describe('PR #59 regressions: legacy pp short-key decode', () => {
    // FINDING #1: before campaign 7 the KEY_MAP encoded BOTH `purchasePrice`
    // and `projectedPIA` as 'pp' (and the last-writer-wins reverse map decoded
    // 'pp' -> projectedPIA). `projectedPIA` now encodes as 'Pi', so a naive
    // reverse map sends legacy 'pp' on a Social Security income to
    // `purchasePrice` -- silently dropping projectedPIA on import of old QR
    // payloads. Legacy 'pp' must decode context-aware.
    it('should decode legacy pp on a Social Security income to projectedPIA (full backup path)', () => {
      // Exactly what the OLD encoder produced for a FutureSocialSecurityIncome:
      // projectedPIA was shortened to 'pp'.
      const legacyCompact = {
        v: 1,
        a: [],
        h: {},
        i: [
          {
            d: 'ss1',
            n: 'Social Security', // name
            a: 30000, // amount
            c: 'FutureSocialSecurityIncome',
            C: 67, // claimingAge
            P: 2500, // calculatedPIA
            W: 2026, // calculationYear
            pp: 3100, // LEGACY: projectedPIA encoded as 'pp' by the old KEY_MAP
          },
        ],
        e: [],
        t: {},
        m: { by: 1985 },
      };

      const expanded = expandCompactBackup(legacyCompact as Parameters<typeof expandCompactBackup>[0]);
      const income = expanded.incomes[0] as Record<string, unknown>;

      expect(income.projectedPIA).toBe(3100);
      expect('purchasePrice' in income).toBe(false);
      // The other SS fields decode as before
      expect(income.claimingAge).toBe(67);
      expect(income.calculatedPIA).toBe(2500);
      expect(income.calculationYear).toBe(2026);
    });

    it('should decode legacy pp on an ESPP lot (no className) to purchasePrice', () => {
      // ESPP lots never carried a className; their 'pp' has always meant
      // purchasePrice and must keep decoding that way.
      const legacyLot = {
        gd: '2023-01-01',
        pd: '2023-06-30',
        fg: 100,
        fp: 120,
        pp: 85, // purchasePrice in both old and new encodings
        sh: 50,
        tc: 4250,
        da: 750,
      };

      const expanded = expandKeys(legacyLot) as Record<string, unknown>;

      expect(expanded.purchasePrice).toBe(85);
      expect('projectedPIA' in expanded).toBe(false);
    });

    it('should decode legacy pp on an ESPP account lot through the full backup path', () => {
      const legacyCompact = {
        v: 1,
        a: [
          {
            d: 'espp1',
            n: 'Company ESPP',
            a: 6000,
            c: 'ESPPAccount',
            lt: [
              { gd: '2023-01-01', pd: '2023-06-30', fg: 100, fp: 120, pp: 85, sh: 50, tc: 4250, da: 750 },
            ],
          },
        ],
        h: {},
        i: [],
        e: [],
        t: {},
        m: { by: 1985 },
      };

      const expanded = expandCompactBackup(legacyCompact as Parameters<typeof expandCompactBackup>[0]);
      const lots = (expanded.accounts[0] as Record<string, unknown>).lots as Array<Record<string, unknown>>;

      expect(lots[0].purchasePrice).toBe(85);
      expect('projectedPIA' in lots[0]).toBe(false);
    });

    it('should still decode the new Pi short key to projectedPIA', () => {
      const newCompact = {
        c: 'FutureSocialSecurityIncome',
        C: 67,
        Pi: 3100, // NEW encoding of projectedPIA
      };

      const expanded = expandKeys(newCompact) as Record<string, unknown>;

      expect(expanded.projectedPIA).toBe(3100);
      expect('purchasePrice' in expanded).toBe(false);
    });
  });
});
