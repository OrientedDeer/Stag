import { describe, it, expect } from 'vitest';
import { reconstituteBudgetState } from '../../../../components/Objects/Budget/BudgetContext';
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
  it('rehydrates month + transaction date fields from ISO strings to Date', () => {
    // Shape that JSON.parse of an exported budget produces: dates are strings.
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
              date: '2026-01-05T00:00:00.000Z',
              statementDate: '2026-01-10T00:00:00.000Z',
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

    // Instant round-trips exactly (no UTC date-only shifting introduced).
    expect((txn.date as Date).toISOString()).toBe('2026-01-05T00:00:00.000Z');

    // Saved CSV format dates are rehydrated too.
    const fmt = result.importSettings!.savedCSVFormats[0];
    expect(fmt.lastUsed instanceof Date).toBe(true);
    expect(fmt.createdAt instanceof Date).toBe(true);
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
