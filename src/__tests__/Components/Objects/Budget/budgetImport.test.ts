import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { reconstituteBudgetState, reconstituteBudgetMonths } from '../../../../components/Objects/Budget/BudgetContext';
import { jsonDateReplacer } from '../../../../utils/formatters';
import { generateId } from '../../../../utils/id';

// Finding #10: generateId('MONTH') = `MONTH-${Date.now()}-${rand(1000)}` collided
// when several months were minted in one synchronous tick (Date.now() is ms-coarse,
// rand has only 1000 buckets). The minter must be collision-free within a tick.
describe('generateId collision-free within a tick (Finding #10)', () => {
  it('produces 1000 unique ids in a tight synchronous loop', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateId('MONTH'));
    }
    expect(ids.size).toBe(1000);
  });
});

// Finding #9: the global backup import (useFileManager.handleGlobalImport) used to
// dispatch SET_BULK_DATA with the raw JSON.parse'd budget, leaving transactions'
// date/statementDate and months' createdAt/updatedAt as STRINGS under Date-typed
// fields (bypassing hydrateBudgetState). reconstituteBudgetState rehydrates them.
describe('reconstituteBudgetState (Finding #9)', () => {
  it('rehydrates month + transaction date fields from strings to Date', () => {
    // Shape that JSON.parse of an exported budget produces: dates are strings.
    // A real backup serializes transaction dates via jsonDateReplacer as local
    // date-only 'YYYY-MM-DD'; createdAt/updatedAt/lastUsed carry an instant.
    const parsed = {
      months: [
        {
          id: 'M1',
          month: 1,
          year: 2026,
          spending: {},
          accountBalances: {},
          contributions: {},
          reconciled: false,
          createdAt: '2026-01-15T10:00:00.000Z',
          updatedAt: '2026-01-20T12:00:00.000Z',
          transactions: [
            {
              id: 't1',
              date: '2026-01-05',
              statementDate: '2026-01-10',
              description: 'WHOLE FOODS',
              amount: -42,
            },
          ],
        },
      ],
      importSettings: {
        dateColumn: 'Date',
        amountColumn: 'Amount',
        descriptionColumn: 'Description',
        categoryMappings: [],
        savedCSVFormats: [
          { id: 'f1', name: 'Chase', lastUsed: '2026-01-01T00:00:00.000Z', createdAt: '2025-12-01T00:00:00.000Z' },
        ],
        autoCreateRules: false,
      },
    };

    const result = reconstituteBudgetState(parsed);

    const month = result.months![0];
    const txn = month.transactions[0];

    expect(txn.date instanceof Date).toBe(true);
    expect(txn.statementDate instanceof Date).toBe(true);
    expect(month.createdAt instanceof Date).toBe(true);
    expect(month.updatedAt instanceof Date).toBe(true);

    // Transaction dates are date-only values: the reader parses them as the LOCAL
    // calendar day, not a UTC-midnight instant. Asserting the UTC instant here
    // would re-encode the old `new Date('YYYY-MM-DD')` bug that walked west-of-UTC
    // dates back a day per export/import cycle and defeated dedupe (#182).
    expect((txn.date as Date).getFullYear()).toBe(2026);
    expect((txn.date as Date).getMonth()).toBe(0); // January (0-based)
    expect((txn.date as Date).getDate()).toBe(5);
    expect((txn.statementDate as Date).getDate()).toBe(10);

    // Saved CSV format dates are rehydrated too.
    const fmt = result.importSettings!.savedCSVFormats[0];
    expect(fmt.lastUsed instanceof Date).toBe(true);
    expect(fmt.createdAt instanceof Date).toBe(true);
  });

  // #182: an export serializes transaction dates via jsonDateReplacer as local
  // 'YYYY-MM-DD'; the OLD reader parsed them with `new Date('YYYY-MM-DD')` (UTC
  // midnight), so a west-of-UTC import read the prior day. Re-serializing then
  // walks the date one day earlier on every export/import cycle, and
  // detectDuplicates' toDateString comparison stops matching overlapping
  // statements. This must be an exact round-trip identity in every timezone.
  describe('date-only round-trip stays put in a west-of-UTC timezone', () => {
    let originalTZ: string | undefined;
    beforeAll(() => {
      originalTZ = process.env.TZ;
      process.env.TZ = 'America/Los_Angeles'; // UTC-8/-7, west of UTC
    });
    afterAll(() => {
      if (originalTZ === undefined) delete process.env.TZ;
      else process.env.TZ = originalTZ;
    });

    it('round-trips a transaction date through serialize -> reconstitute with no day shift', () => {
      // Control: confirm the TZ pin took effect and we are genuinely west of UTC,
      // otherwise `new Date('YYYY-MM-DD')` (UTC midnight) would not shift and the
      // assertion below could not distinguish the bug from the fix.
      expect(new Date(2026, 0, 5).getTimezoneOffset()).toBeGreaterThan(0);

      // Build the month the way the app does: a local-midnight date-only Date.
      const months = [
        {
          id: 'M1', month: 6, year: 2026,
          spending: {}, accountBalances: {}, contributions: {}, reconciled: false,
          createdAt: new Date(), updatedAt: new Date(),
          transactions: [
            { id: 't1', date: new Date(2026, 5, 3), description: 'Coffee', amount: -4.5 }, // June 3
            { id: 't2', date: new Date(2026, 6, 1), description: 'Rent', amount: -2000 },  // July 1 (month boundary)
          ],
        },
      ];

      // Serialize exactly as a backup does (jsonDateReplacer -> local 'YYYY-MM-DD'),
      // then reconstitute through the REAL production reader.
      const serialized = JSON.parse(JSON.stringify({ months }, jsonDateReplacer));
      const [reMonth] = reconstituteBudgetMonths(serialized.months);
      const byId = Object.fromEntries(reMonth.transactions.map(t => [t.id, t.date as Date]));

      expect(byId['t1'].getFullYear()).toBe(2026);
      expect(byId['t1'].getMonth()).toBe(5); // June — must not slip to June 2
      expect(byId['t1'].getDate()).toBe(3);
      // The month boundary is the strictest case: July 1 must not fall back to June 30.
      expect(byId['t2'].getMonth()).toBe(6); // July
      expect(byId['t2'].getDate()).toBe(1);

      // And a second cycle is a fixed point (no per-cycle ratchet).
      const serialized2 = JSON.parse(JSON.stringify({ months: [reMonth] }, jsonDateReplacer));
      const [reMonth2] = reconstituteBudgetMonths(serialized2.months);
      const t1b = reMonth2.transactions.find(t => t.id === 't1')!.date as Date;
      expect(t1b.getMonth()).toBe(5);
      expect(t1b.getDate()).toBe(3);
    });
  });

  it('tolerates a transaction with no statementDate (leaves it undefined)', () => {
    const parsed = {
      months: [
        {
          id: 'M1', month: 2, year: 2026,
          spending: {}, accountBalances: {}, contributions: {}, reconciled: false,
          transactions: [{ id: 't1', date: '2026-02-01T00:00:00.000Z', description: 'X', amount: -1 }],
        },
      ],
    };
    const result = reconstituteBudgetState(parsed);
    const txn = result.months![0].transactions[0];
    expect(txn.date instanceof Date).toBe(true);
    expect(txn.statementDate).toBeUndefined();
  });
});
