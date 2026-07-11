/**
 * fp-review F10: conversion conservation of money across multiple Traditional
 * accounts.
 *
 * The planned conversionAmount is clamped to the TOTAL Traditional balance
 * (YearSolver), but execution used to deduct the whole amount from the FIRST
 * Traditional account only. InvestedAccount.increment floors an
 * over-withdrawal at zero while the Roth received the full net — so with
 * Trad A $10k + Trad B $500k and an $80k plan, ~$70k materialized from
 * nowhere. executeYearPlan now drains across Traditional accounts in list
 * order and credits the Roth with exactly what was deducted.
 */
import { describe, it, expect } from 'vitest';

import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import { InvestedAccount, SavedAccount, type AnyAccount } from '../../../components/Objects/Accounts/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { type SimulationYear } from '../../../services/simulation/types';

const YEAR = new Date().getFullYear();

const taxState: TaxState = {
    filingStatus: 'Single',
    stateResidency: 'Texas',
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: YEAR,
};

// Zero-growth world so the conservation identity is exact: every net-worth
// change must be explained by expenses + taxes (no returns, no interest).
const assumptions: AssumptionsState = {
    ...defaultAssumptions,
    milestones: createBuiltinMilestones(YEAR - 60, 55, 90),
    macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
    investments: {
        ...defaultAssumptions.investments,
        returnRates: { ror: 0 },
        withdrawalStrategy: 'None',
        taxOptimizationEnabled: true,
        rothConversionStrategy: 'dp-precomputed',
        acaAware: false, // isolate F10 from the F1 ACA cash charge
    },
    // Cash first so spending never touches the Traditional accounts — the
    // per-account deltas below must be pure conversion flows.
    withdrawalStrategy: [
        { id: 'w-cash', name: 'Cash', accountId: 'cash' },
        { id: 'w-brk', name: 'Brokerage', accountId: 'brk' },
        { id: 'w-ta', name: 'Trad A', accountId: 'trad-a' },
        { id: 'w-tb', name: 'Trad B', accountId: 'trad-b' },
        { id: 'w-roth', name: 'Roth', accountId: 'roth' },
    ],
};

const PLAN = 80_000;
// The same plan every year — the test reads the FIRST year that executes it.
const dpPlan = new Map<number, number>([[YEAR, PLAN], [YEAR + 1, PLAN], [YEAR + 2, PLAN]]);

function makeAccounts(splitTraditional: boolean): AnyAccount[] {
    const trads = splitTraditional
        ? [
            new InvestedAccount('trad-a', 'Trad A', 10_000, 0, 10, 0, 'Traditional IRA'),
            new InvestedAccount('trad-b', 'Trad B', 500_000, 0, 10, 0, 'Traditional 401k'),
        ]
        : [new InvestedAccount('trad-a', 'Trad A', 510_000, 0, 10, 0, 'Traditional IRA')];
    return [
        ...trads,
        new InvestedAccount('roth', 'Roth IRA', 10_000, 0, 10, 0, 'Roth IRA', true, 0.2, 10_000),
        // Brokerage at full basis: its coverage keeps the DP spending
        // reservation from rerouting the deficit through Traditional.
        new InvestedAccount('brk', 'Brokerage', 200_000, 0, 10, 0, 'Brokerage', true, 0.2, 200_000),
        new SavedAccount('cash', 'Cash', 300_000, 0),
    ];
}

function run(splitTraditional: boolean): SimulationYear[] {
    return runSimulation(
        4,
        makeAccounts(splitTraditional),
        [],
        [new OtherExpense('living', 'Living', 30_000, 'Annually', new Date(YEAR - 5, 0, 1))],
        assumptions,
        taxState,
        undefined,
        { dpConversionPlan: dpPlan },
    ).filter(y => !y.isEndOfYearProjection);
}

const netWorth = (y: SimulationYear) => y.accounts.reduce((s, a) => s + a.amount, 0);
const balance = (y: SimulationYear, id: string) => y.accounts.find(a => a.id === id)?.amount ?? 0;
const taxesOf = (y: SimulationYear) =>
    y.taxDetails.fed + y.taxDetails.state + y.taxDetails.fica +
    y.taxDetails.capitalGains + (y.taxDetails.withdrawalOrdinaryTax || 0) +
    (y.taxDetails.niit ?? 0) + (y.taxDetails.irmaa ?? 0) + (y.taxDetails.aca ?? 0);

describe('F10: multi-Traditional conversion conserves money', () => {
    const timeline = run(true);
    // First year that actually executed a conversion (year 0 is the unsolved
    // starting snapshot).
    const idx = timeline.findIndex(y => (y.rothConversion?.amount ?? 0) > 0);
    const convYear = timeline[idx];
    const prevYear = timeline[idx - 1];

    it('executes the full plan by draining Traditional accounts in list order', () => {
        expect(idx).toBeGreaterThan(0);
        expect(convYear.rothConversion!.amount).toBeCloseTo(PLAN, 6);
        // Trad A ($10k) is exhausted first, Trad B covers the remaining $70k.
        expect(convYear.rothConversion!.fromAccountIds).toEqual({
            'trad-a': expect.closeTo(10_000, 6),
            'trad-b': expect.closeTo(70_000, 6),
        });
        expect(balance(convYear, 'trad-a')).toBeCloseTo(0, 6);
        expect(balance(prevYear, 'trad-b') - balance(convYear, 'trad-b')).toBeCloseTo(70_000, 6);
        // The Roth receives exactly what left the Traditional accounts.
        expect(balance(convYear, 'roth') - balance(prevYear, 'roth')).toBeCloseTo(PLAN, 6);
    });

    it('conserves money: net-worth change equals -(expenses + taxes), no phantom creation', () => {
        // Zero growth, zero income: the only real outflows are living expenses
        // and taxes. Pre-fix, the first-account-only deduction floored at Trad
        // A's $10k while the Roth received the full $80k → the delta below was
        // ~+$70k too high.
        const delta = netWorth(convYear) - netWorth(prevYear);
        const expected = -(convYear.cashflow.livingExpenses + taxesOf(convYear));
        expect(delta).toBeCloseTo(expected, 0);
    });

    it('every subsequent year conserves money too', () => {
        for (let i = idx; i < timeline.length; i++) {
            const delta = netWorth(timeline[i]) - netWorth(timeline[i - 1]);
            const expected = -(timeline[i].cashflow.livingExpenses + taxesOf(timeline[i]));
            expect(delta).toBeCloseTo(expected, 0);
        }
    });

    it('single-Traditional behavior is unchanged (regression guard)', () => {
        const single = run(false);
        const i = single.findIndex(y => (y.rothConversion?.amount ?? 0) > 0);
        expect(i).toBeGreaterThan(0);
        const y = single[i];
        expect(y.rothConversion!.amount).toBeCloseTo(PLAN, 6);
        expect(y.rothConversion!.fromAccountIds).toEqual({ 'trad-a': expect.closeTo(PLAN, 6) });
        expect(balance(single[i - 1], 'trad-a') - balance(y, 'trad-a')).toBeCloseTo(PLAN, 6);
        expect(balance(y, 'roth') - balance(single[i - 1], 'roth')).toBeCloseTo(PLAN, 6);
    });
});
