import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  serializeAccountState,
  hydrateAccountState,
} from '../../../components/Objects/Accounts/AccountContext';
import {
  serializeIncomeState,
  hydrateIncomeState,
} from '../../../components/Objects/Income/IncomeContext';
import {
  serializeExpenseState,
  hydrateExpenseState,
} from '../../../components/Objects/Expense/ExpenseContext';
import {
  serializeSimulationState,
  hydrateSimulationState,
} from '../../../components/Objects/Assumptions/SimulationContext';

import { ESPPAccount, RSUAccount, ESPPLot, RSULot } from '../../../components/Objects/Accounts/models';
import { PassiveIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';

/**
 * Regression for the #73 date-drift on the always-running localStorage persistence
 * path. The four context serializers used bare JSON.stringify, so Date-typed fields
 * serialized via the default Date.prototype.toJSON() (UTC toISOString()) and reloaded
 * one calendar day earlier for UTC-positive users (compounding on every debounced
 * save), because the hydrate path reads the date portion locally via parseDate.
 *
 * Each serializer must now round-trip a local-midnight Date WITHOUT shifting to the
 * previous calendar day, even under a UTC-positive timezone. Asia/Tokyo (UTC+9) is the
 * adversarial case: local Jan 1 midnight is the previous calendar day in UTC.
 */

const assertSameCalendarDay = (actual: Date | undefined, expected: Date): void => {
  expect(actual).toBeInstanceOf(Date);
  expect(actual!.getFullYear()).toBe(expected.getFullYear());
  expect(actual!.getMonth()).toBe(expected.getMonth());
  expect(actual!.getDate()).toBe(expected.getDate());
};

describe('localStorage serializers preserve calendar dates under UTC+ timezones (#73)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('account ESPP/RSU lot dates do not shift a day earlier', () => {
    vi.stubEnv('TZ', 'Asia/Tokyo');

    const grantDate = new Date(2025, 0, 1);     // local Jan 1, 2025
    const purchaseDate = new Date(2025, 5, 15);  // local Jun 15, 2025
    const vestDate = new Date(2030, 11, 31);     // local Dec 31, 2030

    const esppLot: ESPPLot = {
      id: 'espp-1', grantDate, purchaseDate,
      fmvAtGrant: 10, fmvAtPurchase: 12, purchasePrice: 8.5,
      shares: 100, totalCost: 850, discountAmount: 1.5,
    };
    const rsuLot: RSULot = {
      id: 'rsu-1', grantDate, vestDate,
      fmvAtVest: 50, shares: 40, costBasis: 2000,
    };

    const state = {
      accounts: [
        new ESPPAccount('a-espp', 'My ESPP', 1200, [esppLot]),
        new RSUAccount('a-rsu', 'My RSU', 2000, [rsuLot]),
      ],
      amountHistory: {},
    };

    const reloaded = hydrateAccountState(
      JSON.parse(serializeAccountState(state)),
      { accounts: [], amountHistory: {} },
    );

    const espp = reloaded.accounts.find(a => a.id === 'a-espp') as ESPPAccount;
    const rsu = reloaded.accounts.find(a => a.id === 'a-rsu') as RSUAccount;
    assertSameCalendarDay(espp.lots[0].grantDate, grantDate);
    assertSameCalendarDay(espp.lots[0].purchaseDate, purchaseDate);
    assertSameCalendarDay(rsu.lots[0].grantDate, grantDate);
    assertSameCalendarDay(rsu.lots[0].vestDate, vestDate);
  });

  it('income startDate / end_date do not shift a day earlier', () => {
    vi.stubEnv('TZ', 'Asia/Tokyo');

    const startDate = new Date(2030, 0, 1);
    const endDate = new Date(2045, 6, 1);
    const income = new PassiveIncome('i-1', 'Rental', 24000, 'Annually', 'Yes', 'Rental', startDate, endDate);

    const reloaded = hydrateIncomeState(
      JSON.parse(serializeIncomeState({ incomes: [income] })),
      { incomes: [] },
    );

    const out = reloaded.incomes[0];
    assertSameCalendarDay(out.startDate, startDate);
    assertSameCalendarDay(out.end_date, endDate);
  });

  it('expense startDate / endDate do not shift a day earlier', () => {
    vi.stubEnv('TZ', 'Asia/Tokyo');

    const startDate = new Date(2030, 0, 1);
    const endDate = new Date(2030, 0, 1); // same local midnight, the classic break point
    const expense = new FoodExpense('e-1', 'Groceries', 800, 'Monthly', startDate, endDate);

    const reloaded = hydrateExpenseState(
      JSON.parse(serializeExpenseState({ expenses: [expense] })),
      { expenses: [] },
    );

    const out = reloaded.expenses[0];
    assertSameCalendarDay(out.startDate, startDate);
    assertSameCalendarDay(out.endDate, endDate);
  });

  it('cached SimulationYear nested dates do not shift a day earlier', () => {
    vi.stubEnv('TZ', 'Asia/Tokyo');

    const grantDate = new Date(2025, 0, 1);
    const purchaseDate = new Date(2025, 5, 15);
    const incomeStart = new Date(2030, 0, 1);
    const expenseEnd = new Date(2030, 0, 1);

    const esppLot: ESPPLot = {
      id: 'espp-1', grantDate, purchaseDate,
      fmvAtGrant: 10, fmvAtPurchase: 12, purchasePrice: 8.5,
      shares: 100, totalCost: 850, discountAmount: 1.5,
    };

    const year = {
      age: 60,
      year: 2030,
      accounts: [new ESPPAccount('a-espp', 'My ESPP', 1200, [esppLot])],
      incomes: [new PassiveIncome('i-1', 'Rental', 24000, 'Annually', 'Yes', 'Rental', incomeStart)],
      expenses: [new FoodExpense('e-1', 'Groceries', 800, 'Monthly', undefined, expenseEnd)],
    } as unknown as SimulationYear;

    const reloaded = hydrateSimulationState(
      JSON.parse(serializeSimulationState({ simulation: [year], inputHash: 'h' })),
      { simulation: [], inputHash: null },
    );

    const out = reloaded.simulation[0];
    const espp = out.accounts[0] as ESPPAccount;
    assertSameCalendarDay(espp.lots[0].grantDate, grantDate);
    assertSameCalendarDay(espp.lots[0].purchaseDate, purchaseDate);
    assertSameCalendarDay(out.incomes[0].startDate, incomeStart);
    assertSameCalendarDay(out.expenses[0].endDate, expenseEnd);
  });
});
