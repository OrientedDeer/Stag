import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useContext, useEffect, useRef } from 'react';

import {
  AccountProvider,
  AccountContext,
  AccountDispatchContext,
  AmountHistoryEntry,
} from '../../../../components/Objects/Accounts/AccountContext';
import { EditHistoryModal } from '../../../../components/Objects/Accounts/EditHistoryModal';

// Minimal localStorage mock so usePersistedReducer can initialise.
const localStorageMock = (() => {
  let store: { [key: string]: string } = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = String(value); }),
    clear: vi.fn(() => { store = {}; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const ACCOUNT_ID = 'acc-1';

/** Seeds amountHistory[ACCOUNT_ID] once, without any sorting side effect. */
function Seeder({ entries }: { entries: AmountHistoryEntry[] }) {
  const { dispatch } = useContext(AccountDispatchContext);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    dispatch({ type: 'SET_BULK_DATA', payload: { accounts: [], amountHistory: { [ACCOUNT_ID]: entries } } });
  }, [dispatch, entries]);
  return null;
}

/** Publishes the live store history so the test can assert on it. */
function Probe({ sink }: { sink: (h: AmountHistoryEntry[]) => void }) {
  const { amountHistory } = useContext(AccountContext);
  sink(amountHistory[ACCOUNT_ID] || []);
  return null;
}

function historyDateInputs(): HTMLInputElement[] {
  // All date inputs except the trailing "Add Manual Entry" one.
  const all = Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
  return all.slice(0, all.length - 1);
}

describe('EditHistoryModal — mid-edit re-sort must not corrupt a different entry (#182)', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('two consecutive date edits on the same on-screen row rewrite that row, not its neighbour', async () => {
    let latest: AmountHistoryEntry[] = [];
    const sink = (h: AmountHistoryEntry[]) => { latest = h; };

    render(
      <AccountProvider>
        <Seeder entries={[
          { date: '2024-01-01', num: 100 },
          { date: '2025-06-01', num: 200 },
          { date: '2026-03-01', num: 300 },
        ]} />
        <Probe sink={sink} />
        <EditHistoryModal accountId={ACCOUNT_ID} isOpen onClose={() => {}} />
      </AccountProvider>
    );

    // Wait for the seeded rows to render.
    await screen.findByDisplayValue('2025-06-01');

    // The user is editing the MIDDLE row ($200, 2025-06-01) toward 2026-09-01,
    // keeping the cursor in the same on-screen input the whole time.
    // First keystroke commits an intermediate value that re-sorts the entry PAST
    // the $300 row.
    act(() => {
      fireEvent.change(historyDateInputs()[1], { target: { value: '2026-06-01' } });
    });

    // Second keystroke on the SAME on-screen input finishes the date. If the
    // input rebound to a different entry after the re-sort, this rewrites the
    // wrong balance-history row.
    act(() => {
      fireEvent.change(historyDateInputs()[1], { target: { value: '2026-09-01' } });
    });

    const byNum = Object.fromEntries(latest.map(e => [e.num, e.date]));
    // The $200 entry the user was editing must be the one that reached 2026-09-01.
    expect(byNum[200]).toBe('2026-09-01');
    // The $300 entry must be untouched.
    expect(byNum[300]).toBe('2026-03-01');
    // The $100 entry is untouched.
    expect(byNum[100]).toBe('2024-01-01');
    expect(latest).toHaveLength(3);
  });

  it('keeps the edited row in place on screen while the store still re-sorts for consumers', async () => {
    let latest: AmountHistoryEntry[] = [];
    const sink = (h: AmountHistoryEntry[]) => { latest = h; };

    render(
      <AccountProvider>
        <Seeder entries={[
          { date: '2024-01-01', num: 100 },
          { date: '2025-06-01', num: 200 },
          { date: '2026-03-01', num: 300 },
        ]} />
        <Probe sink={sink} />
        <EditHistoryModal accountId={ACCOUNT_ID} isOpen onClose={() => {}} />
      </AccountProvider>
    );

    await screen.findByDisplayValue('2025-06-01');

    // Edit the middle row's date to the earliest of all — this would sort it to
    // the FRONT of the store. The on-screen row must NOT jump, so the user's
    // cursor keeps its place and the next keystroke stays on the same entry.
    act(() => {
      fireEvent.change(historyDateInputs()[1], { target: { value: '2020-01-01' } });
    });

    // Invariant 1: the modal keeps the edited row where it was (index 1); only
    // its value changed. Rows do not reshuffle mid-edit.
    expect(historyDateInputs().map(i => i.value)).toEqual([
      '2024-01-01',
      '2020-01-01',
      '2026-03-01',
    ]);

    // Invariant 2: the store is still date-sorted so reverse().find() consumers
    // (Networth, projectionHistory) read the latest balance correctly.
    expect(latest.map(e => e.date)).toEqual([
      '2020-01-01',
      '2024-01-01',
      '2026-03-01',
    ]);
  });
});
