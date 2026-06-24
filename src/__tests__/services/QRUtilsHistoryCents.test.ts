import { describe, it, expect } from 'vitest';
import {
  compactHistory,
  expandHistory,
} from '../../components/Objects/Accounts/QRTransfer/qrUtils';

/**
 * Regression: QR balance-history compaction must preserve cents.
 *
 * Previously compactHistory packed `Math.round(entry.num)`, silently dropping
 * the fractional dollars from each amountHistory snapshot. The JSON backup
 * keeps cents, so a QR round-trip diverged from the live balance / JSON backup
 * after restore. These tests assert the compact -> expand round-trip is lossless.
 */
describe('qrUtils compactHistory/expandHistory cents preservation', () => {
  it('preserves cents through a compact -> expand round-trip', () => {
    const accounts = [{ id: 'acct-abc' }];
    const original = {
      'acct-abc': [
        { date: '2024-01-15', num: 10000.49 },
        { date: '2024-02-15', num: 10500.01 },
      ],
    };

    const compacted = compactHistory(original, accounts);
    const expanded = expandHistory(compacted, accounts);

    expect(expanded).toEqual(original);
  });

  it('does not round the snapshot stored in the compact form', () => {
    const accounts = [{ id: 'acct-abc' }];
    const original = {
      'acct-abc': [{ date: '2024-01-15', num: 10000.49 }],
    };

    const compacted = compactHistory(original, accounts);

    // The packed amount must still carry the cents, not a whole-dollar value.
    expect(compacted['0'][0][1]).toBe(10000.49);
  });

  it('still round-trips whole-dollar snapshots unchanged (backward compat)', () => {
    const accounts = [{ id: 'acct-abc' }, { id: 'acct-xyz' }];
    const original = {
      'acct-abc': [
        { date: '2024-01-15', num: 10000 },
        { date: '2024-02-15', num: 10500 },
      ],
      'acct-xyz': [{ date: '2024-01-15', num: 5000 }],
    };

    const compacted = compactHistory(original, accounts);
    const expanded = expandHistory(compacted, accounts);

    expect(expanded).toEqual(original);
  });

  it('decodes a legacy whole-dollar compact payload without scaling', () => {
    // A backup created before this fix encoded the snapshot as an integer
    // number of dollars. Expansion must return that exact dollar amount.
    const accounts = [{ id: 'acct-abc' }];
    const legacyCompact = { '0': [[14, 10000] as [number, number]] };

    const expanded = expandHistory(legacyCompact, accounts);

    expect(expanded['acct-abc'][0].num).toBe(10000);
  });
});
