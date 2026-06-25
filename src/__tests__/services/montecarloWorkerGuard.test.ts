/**
 * Regression tests for the Monte Carlo worker's reconstitution guard
 * (src/services/montecarlo.worker.ts) and the `className` stamping it depends on
 * (BaseAccount / BaseExpense constructors).
 *
 * Background: live class instances are posted to the MC worker, where structured
 * clone strips their methods. The worker rebuilds them via reconstituteAccount /
 * reconstituteExpense, which switch on a `className` discriminator. If that
 * discriminator is lost, every instance is dropped and MC runs on an empty
 * portfolio / zero spending → an impossible ~100% "success". The worker guards
 * against this by throwing (handing off to the main-thread fallback) when a
 * non-empty input list reconstitutes to zero instances.
 *
 * The worker itself isn't unit-testable in isolation (it owns `self.onmessage` /
 * `postMessage` and async-imports the engine), so these tests exercise the two
 * load-bearing facts the guard relies on, using the SAME reconstitute functions
 * the worker calls:
 *   1. A structured clone of a live instance still reconstitutes — i.e. the
 *      constructor-stamped `className` survives the clone (the fix this protects).
 *   2. A clone whose `className` is missing/garbled reconstitutes to null — i.e.
 *      the exact wipeout the guard's `length > 0 && rebuilt === 0` check catches.
 */
import { describe, it, expect } from 'vitest';
import {
    SavedAccount,
    DebtAccount,
    reconstituteAccount,
} from '../../components/Objects/Accounts/models';
import {
    FoodExpense,
    MortgageExpense,
    reconstituteExpense,
} from '../../components/Objects/Expense/models';
import { notNull } from '../../utils/notNull';

// Mirror the worker's reconstitution step: structured-clone the live instances
// (strips methods, keeps own enumerable fields incl. the stamped className), then
// rebuild + drop nulls exactly as montecarlo.worker.ts does.
const rebuildAccounts = (instances: unknown[]) =>
    instances.map((a) => structuredClone(a)).map(reconstituteAccount).filter(notNull);
const rebuildExpenses = (instances: unknown[]) =>
    instances.map((e) => structuredClone(e)).map(reconstituteExpense).filter(notNull);

describe('MC worker reconstitution guard — className survives structured clone', () => {
    it('accounts: a cloned live SavedAccount/DebtAccount round-trips (className stamped on construction)', () => {
        const accounts = [
            new SavedAccount('a1', 'Cash', 10_000, 4),
            new DebtAccount('a2', 'Card', 5_000, '', 19.99, false),
        ];
        // The constructor stamps className via `this.constructor.name`; assert it's
        // present BEFORE the clone (the fix) and that it equals the discriminator.
        expect(accounts[0].className).toBe('SavedAccount');
        expect(accounts[1].className).toBe('DebtAccount');

        const rebuilt = rebuildAccounts(accounts);
        expect(rebuilt).toHaveLength(2);
        expect(rebuilt[0]).toBeInstanceOf(SavedAccount);
        expect(rebuilt[1]).toBeInstanceOf(DebtAccount);
        // Guard condition is FALSE here (rebuilt > 0): worker proceeds normally.
        expect(rebuilt.length).toBeGreaterThan(0);
    });

    it('expenses: a cloned live FoodExpense/MortgageExpense round-trips', () => {
        const food = new FoodExpense('e1', 'Groceries', 600, 'Monthly');
        const mortgage = new MortgageExpense(
            'e2', 'Home', 'Monthly', 500_000, 300_000, 400_000, 4, 360,
            6_000, 0, 200, 150, 1_800, 0, 0, 'No', 0, '', new Date(), 2_400, 0,
        );
        expect(food.className).toBe('FoodExpense');
        expect(mortgage.className).toBe('MortgageExpense');

        const rebuilt = rebuildExpenses([food, mortgage]);
        expect(rebuilt).toHaveLength(2);
        expect(rebuilt[0]).toBeInstanceOf(FoodExpense);
        expect(rebuilt[1]).toBeInstanceOf(MortgageExpense);
    });
});

describe('MC worker reconstitution guard — wipeout is the case the guard catches', () => {
    it('accounts: a clone with a missing/garbled className reconstitutes to null', () => {
        const acct = new SavedAccount('a1', 'Cash', 10_000, 4);
        const clone = structuredClone(acct) as unknown as Record<string, unknown>;

        // Missing discriminator (the original bug: className only set at serialize time).
        delete clone.className;
        expect(reconstituteAccount(clone)).toBeNull();

        // Minified-style garbled discriminator (what constructor.name WOULD produce
        // if `esbuild.keepNames` were off) also fails to match any `case`.
        const garbled = { ...structuredClone(acct), className: 'S' };
        expect(reconstituteAccount(garbled)).toBeNull();
    });

    it('the guard predicate fires only on a full wipeout (length > 0 && rebuilt === 0)', () => {
        // Reproduce the worker's exact guard expression against three inputs:
        //   • a healthy account list (no fire),
        //   • a wiped account list (fire — the bug),
        //   • an empty input list (no fire — nothing was supplied to lose).
        const wipe = (reqLen: number, rebuiltLen: number) => reqLen > 0 && rebuiltLen === 0;

        const healthy = rebuildAccounts([new SavedAccount('a1', 'Cash', 10_000, 4)]);
        expect(wipe(1, healthy.length)).toBe(false);

        const wiped = [{ id: 'x', name: 'X', amount: 1 }] // no className → reconstitutes to null
            .map(reconstituteAccount)
            .filter(notNull);
        expect(wipe(1, wiped.length)).toBe(true);

        expect(wipe(0, 0)).toBe(false);
    });

    it('expenses: dropping every expense (the symmetric bug from finding [4]) is detectable the same way', () => {
        // Before the fix, the worker only guarded accounts; an all-expense wipeout
        // ran MC with ZERO spending → impossibly optimistic success. Show the wipeout
        // is observable so the extended expense guard has something concrete to catch.
        const food = new FoodExpense('e1', 'Groceries', 600, 'Monthly');
        const stripped = structuredClone(food) as unknown as Record<string, unknown>;
        delete stripped.className;

        const rebuilt = [stripped].map(reconstituteExpense).filter(notNull);
        expect(rebuilt).toHaveLength(0);
        const wipe = (reqLen: number, rebuiltLen: number) => reqLen > 0 && rebuiltLen === 0;
        expect(wipe(1, rebuilt.length)).toBe(true);
    });
});
