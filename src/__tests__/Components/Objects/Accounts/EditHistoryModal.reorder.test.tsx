import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useContext, useEffect, useRef } from 'react';

import {
  AccountContext,
  AccountDispatchContext,
  type AmountHistoryEntry,
} from '../../../../components/Objects/Accounts/AccountContext';
import { AccountProvider } from '../../../../components/Objects/Accounts/AccountProvider';
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

/** The trailing "Add Manual Entry" date input. */
function addFormDateInput(): HTMLInputElement {
  const all = Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
  return all[all.length - 1];
}

/** Drives the real add flow: set the add-form date, submit the form. */
function addEntry(date: string) {
  act(() => {
    fireEvent.change(addFormDateInput(), { target: { value: date } });
  });
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  });
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

describe('EditHistoryModal — a newly added entry lands at its date position immediately (#182)', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('inserts a mid-dated new entry between the existing rows on screen (not at the bottom)', async () => {
    render(
      <AccountProvider>
        <Seeder entries={[
          { date: '2024-01-01', num: 100 },
          { date: '2026-03-01', num: 300 },
        ]} />
        <EditHistoryModal accountId={ACCOUNT_ID} isOpen onClose={() => {}} />
      </AccountProvider>
    );

    await screen.findByDisplayValue('2024-01-01');

    // Add an entry dated between the two existing rows. It must render in date
    // order right away — index 1 — not appended at the bottom.
    addEntry('2025-06-01');

    expect(historyDateInputs().map(i => i.value)).toEqual([
      '2024-01-01',
      '2025-06-01',
      '2026-03-01',
    ]);
  });

  it('inserts an earlier-dated new entry at the top, and a later one at the bottom', async () => {
    render(
      <AccountProvider>
        <Seeder entries={[
          { date: '2024-01-01', num: 100 },
          { date: '2026-03-01', num: 300 },
        ]} />
        <EditHistoryModal accountId={ACCOUNT_ID} isOpen onClose={() => {}} />
      </AccountProvider>
    );

    await screen.findByDisplayValue('2024-01-01');

    addEntry('2020-01-01'); // earliest -> front
    addEntry('2030-01-01'); // latest -> back

    expect(historyDateInputs().map(i => i.value)).toEqual([
      '2020-01-01',
      '2024-01-01',
      '2026-03-01',
      '2030-01-01',
    ]);
  });

  it('inserting a row above a mid-edit input does not rebind that input to a different entry', async () => {
    let latest: AmountHistoryEntry[] = [];
    const sink = (h: AmountHistoryEntry[]) => { latest = h; };

    render(
      <AccountProvider>
        <Seeder entries={[
          { date: '2024-01-01', num: 100 },
          { date: '2026-03-01', num: 300 },
        ]} />
        <Probe sink={sink} />
        <EditHistoryModal accountId={ACCOUNT_ID} isOpen onClose={() => {}} />
      </AccountProvider>
    );

    // Capture the actual DOM node for the $300 / 2026 row and start editing it.
    const row300 = await screen.findByDisplayValue('2026-03-01') as HTMLInputElement;
    act(() => {
      fireEvent.change(row300, { target: { value: '2026-05-01' } });
    });

    // Now add an EARLIER-dated entry. With the sorted insert it slots at the top,
    // pushing the $300 row down a slot in the DOM. React reorders by key, so the
    // same DOM node must still represent the $300 entry.
    addEntry('2020-01-01');

    // Continue typing on the SAME captured node. If insertion rebound it to a
    // different entry, this keystroke would rewrite the wrong row.
    act(() => {
      fireEvent.change(row300, { target: { value: '2026-08-01' } });
    });

    const byNum = Object.fromEntries(latest.map(e => [e.num, e.date]));
    expect(byNum[300]).toBe('2026-08-01'); // the row we kept editing
    expect(byNum[100]).toBe('2024-01-01'); // untouched
    expect(byNum[0]).toBe('2020-01-01');   // the newly added entry
    expect(latest).toHaveLength(3);
  });
});
