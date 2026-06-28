import { describe, it, expect } from 'vitest';
import {
    calculateNetWorth,
    calculateLiquidNetWorth,
    calculateTotalDebt,
    calculateAnnualExpenses,
    evaluateMilestone,
    evaluateAllMilestones,
    isActiveByMilestone,
    isActiveByMilestoneToday,
    isIncomeActiveToday,
    isMilestoneSimDependent,
    isIncomeMilestoneGateUnresolved,
    MilestoneContext,
} from '../../services/simulation/MilestoneEvaluator';
import { InvestedAccount, SavedAccount, DebtAccount, PropertyAccount, ESPPAccount, DeficitDebtAccount, AnyAccount } from '../../components/Objects/Accounts/models';
import { OtherExpense } from '../../components/Objects/Expense/models';
import { WorkIncome } from '../../components/Objects/Income/models';
import { CustomMilestone } from '../../services/simulation/types';

describe('MilestoneEvaluator', () => {
    describe('calculateNetWorth', () => {
        it('calculates net worth with simple accounts', () => {
            const accounts = [
                new InvestedAccount('401k', '401k', 500000, 0, 0, 0.1, 'Traditional 401k'),
                new SavedAccount('savings', 'Savings', 50000, 1.5),
            ];

            expect(calculateNetWorth(accounts)).toBe(550000);
        });

        it('subtracts debt accounts', () => {
            const accounts = [
                new SavedAccount('savings', 'Savings', 100000, 1.5),
                new DebtAccount('debt', 'Car Loan', 20000, '', 5),
            ];

            expect(calculateNetWorth(accounts)).toBe(80000);
        });

        it('handles property with mortgage (value − loanAmount)', () => {
            // Property account has value 500k and loan balance 300k.
            const accounts = [
                new PropertyAccount('house', 'Home', 500000, 'Financed', 300000, 300000, ''),
            ];

            // Net worth = 500k value - 300k loan = 200k
            expect(calculateNetWorth(accounts)).toBe(200000);
        });

        it('reads a mortgage liability only via its PropertyAccount, never the expense side (#124)', () => {
            // Net worth is sourced from accounts only. The mortgage liability lands in
            // net worth through the paired PropertyAccount (value − loanAmount), counted
            // exactly once; the MortgageExpense is never read. (A truly unlinked
            // expense-side loan is re-linked to a paired account by linkOrphanLoanExpenses
            // on the import + scenario-load paths — covered in that helper's tests;
            // localStorage boot-hydration is not yet wired, tracked in #136.)
            const accounts: AnyAccount[] = [
                new PropertyAccount('acc-mort', 'Home', 500000, 'Financed', 300000, 400000, 'mort'),
            ];

            // 500k value − 300k loan = 200k, counted once on the account.
            expect(calculateNetWorth(accounts)).toBe(200000);
        });

        it('includes ESPP accounts as assets', () => {
            const accounts = [
                new ESPPAccount('espp', 'ESPP Stock', 25000, []),
            ];

            expect(calculateNetWorth(accounts)).toBe(25000);
        });

        it('includes deficit debt as liability', () => {
            const accounts = [
                new SavedAccount('savings', 'Savings', 10000, 1.5),
                new DeficitDebtAccount('deficit', 'Deficit', 5000),
            ];

            expect(calculateNetWorth(accounts)).toBe(5000);
        });
    });

    describe('calculateLiquidNetWorth', () => {
        it('only includes brokerage and savings', () => {
            const accounts = [
                new InvestedAccount('401k', '401k', 500000, 0, 0, 0.1, 'Traditional 401k'),
                new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage'),
                new SavedAccount('savings', 'Savings', 50000, 1.5),
            ];

            // Only brokerage (100k) + savings (50k) = 150k
            expect(calculateLiquidNetWorth(accounts)).toBe(150000);
        });

        it('includes ESPP as liquid', () => {
            const accounts = [
                new ESPPAccount('espp', 'ESPP', 30000, []),
                new SavedAccount('savings', 'Savings', 20000, 1.5),
            ];

            expect(calculateLiquidNetWorth(accounts)).toBe(50000);
        });

        it('excludes retirement accounts', () => {
            const accounts = [
                new InvestedAccount('roth', 'Roth IRA', 200000, 0, 0, 0.1, 'Roth IRA'),
                new InvestedAccount('trad', 'Traditional IRA', 150000, 0, 0, 0.1, 'Traditional IRA'),
            ];

            expect(calculateLiquidNetWorth(accounts)).toBe(0);
        });
    });

    describe('calculateTotalDebt', () => {
        it('sums all debt sources', () => {
            const accounts = [
                new DebtAccount('car', 'Car Loan', 15000, '', 5),
                new DebtAccount('student', 'Student Loans', 25000, '', 6),
            ];

            expect(calculateTotalDebt(accounts)).toBe(40000);
        });

        it('counts a mortgage liability via its PropertyAccount, account-only (#124)', () => {
            // Total debt is account-only, mirroring net worth. The mortgage liability
            // is carried by the paired PropertyAccount.loanAmount; the expense side is
            // never read. A truly unlinked expense-side loan is re-linked to a paired
            // account by linkOrphanLoanExpenses (covered in that helper's tests).
            const accounts = [
                new PropertyAccount('house', 'Home', 400000, 'Financed', 250000, 300000, 'mort'),
            ];

            expect(calculateTotalDebt(accounts)).toBe(250000);
        });

        it('ignores property accounts with no loan and counts deficit debt', () => {
            const accounts = [
                new PropertyAccount('owned', 'Owned Home', 400000, 'Owned', 0, 0, ''),
                new DeficitDebtAccount('deficit', 'Deficit', 5000),
            ];

            // Owned property carries no loan; only the deficit debt counts.
            expect(calculateTotalDebt(accounts)).toBe(5000);
        });
    });

    describe('evaluateMilestone', () => {
        const baseContext: MilestoneContext = {
            accounts: [
                new InvestedAccount('brok', 'Brokerage', 500000, 0, 0, 0.1, 'Brokerage'),
                new SavedAccount('savings', 'Savings', 100000, 1.5),
            ],
            expenses: [],
            year: 2030,
            age: 35,
        };

        it('evaluates NET_WORTH >= condition', () => {
            const milestone: CustomMilestone = {
                id: 'fi',
                name: 'Financial Independence',
                conditions: [{ type: 'NET_WORTH', operator: '>=', value: 500000 }],
            };

            expect(evaluateMilestone(milestone, baseContext)).toBe(true);
        });

        it('evaluates NET_WORTH < condition (not met)', () => {
            const milestone: CustomMilestone = {
                id: 'fi',
                name: 'Financial Independence',
                conditions: [{ type: 'NET_WORTH', operator: '>=', value: 1000000 }],
            };

            expect(evaluateMilestone(milestone, baseContext)).toBe(false);
        });

        it('evaluates LIQUID_NET_WORTH condition', () => {
            const milestone: CustomMilestone = {
                id: 'coast',
                name: 'Coast FIRE',
                conditions: [{ type: 'LIQUID_NET_WORTH', operator: '>=', value: 600000 }],
            };

            // 500k brokerage + 100k savings = 600k liquid
            expect(evaluateMilestone(milestone, baseContext)).toBe(true);
        });

        it('evaluates TOTAL_DEBT <= condition', () => {
            const milestone: CustomMilestone = {
                id: 'debt-free',
                name: 'Debt Free',
                conditions: [{ type: 'TOTAL_DEBT', operator: '<=', value: 0 }],
            };

            expect(evaluateMilestone(milestone, baseContext)).toBe(true);
        });

        it('evaluates YEAR condition', () => {
            const milestone: CustomMilestone = {
                id: 'year-2030',
                name: 'Year 2030',
                conditions: [{ type: 'YEAR', operator: '=', value: 2030 }],
            };

            expect(evaluateMilestone(milestone, baseContext)).toBe(true);
        });

        it('evaluates AGE condition', () => {
            const milestone: CustomMilestone = {
                id: 'age-35',
                name: 'Age 35',
                conditions: [{ type: 'AGE', operator: '>=', value: 35 }],
            };

            expect(evaluateMilestone(milestone, baseContext)).toBe(true);
        });

        it('requires ALL conditions to be met (AND logic)', () => {
            const milestone: CustomMilestone = {
                id: 'combined',
                name: 'Coast FIRE at 40',
                conditions: [
                    { type: 'NET_WORTH', operator: '>=', value: 500000 },
                    { type: 'AGE', operator: '>=', value: 40 }, // Not met (age is 35)
                ],
            };

            expect(evaluateMilestone(milestone, baseContext)).toBe(false);
        });

        it('passes when all conditions are met', () => {
            const milestone: CustomMilestone = {
                id: 'combined',
                name: 'Coast FIRE at 35',
                conditions: [
                    { type: 'NET_WORTH', operator: '>=', value: 500000 },
                    { type: 'AGE', operator: '>=', value: 35 },
                ],
            };

            expect(evaluateMilestone(milestone, baseContext)).toBe(true);
        });
    });

    describe('evaluateAllMilestones', () => {
        it('identifies newly reached milestones', () => {
            const milestones: CustomMilestone[] = [
                {
                    id: 'fi',
                    name: 'FI',
                    conditions: [{ type: 'NET_WORTH', operator: '>=', value: 500000 }],
                },
                {
                    id: 'rich',
                    name: 'Rich',
                    conditions: [{ type: 'NET_WORTH', operator: '>=', value: 2000000 }],
                },
            ];

            const context: MilestoneContext = {
                accounts: [
                    new InvestedAccount('brok', 'Brokerage', 600000, 0, 0, 0.1, 'Brokerage'),
                ],
                expenses: [],
                year: 2030,
                age: 40,
            };

            const result = evaluateAllMilestones(milestones, new Set(), context);

            expect(result.newlyReached).toHaveLength(1);
            expect(result.newlyReached[0].milestoneId).toBe('fi');
            expect(result.newlyReached[0].yearReached).toBe(2030);
            expect(result.newlyReached[0].ageReached).toBe(40);
            expect(result.activeMilestones).toContain('fi');
            expect(result.activeMilestones).not.toContain('rich');
        });

        it('skips already reached milestones', () => {
            const milestones: CustomMilestone[] = [
                {
                    id: 'fi',
                    name: 'FI',
                    conditions: [{ type: 'NET_WORTH', operator: '>=', value: 500000 }],
                },
            ];

            const context: MilestoneContext = {
                accounts: [
                    new InvestedAccount('brok', 'Brokerage', 600000, 0, 0, 0.1, 'Brokerage'),
                ],
                expenses: [],
                year: 2030,
                age: 40,
            };

            const result = evaluateAllMilestones(milestones, new Set(['fi']), context);

            expect(result.newlyReached).toHaveLength(0);
            expect(result.activeMilestones).toContain('fi');
        });
    });

    describe('calculateAnnualExpenses', () => {
        it('calculates total annual expenses', () => {
            const expenses = [
                new OtherExpense('rent', 'Rent', 2000, 'Monthly', new Date('2020-01-01'), new Date('2100-01-01')),
                new OtherExpense('food', 'Food', 500, 'Monthly', new Date('2020-01-01'), new Date('2100-01-01')),
            ];

            // 2000 * 12 + 500 * 12 = 30000
            expect(calculateAnnualExpenses(expenses, 2030)).toBe(30000);
        });

        it('excludes expenses outside their date range', () => {
            const expenses = [
                new OtherExpense('rent', 'Rent', 2000, 'Monthly', new Date('2020-01-01'), new Date('2025-12-31')),
                new OtherExpense('food', 'Food', 500, 'Monthly', new Date('2020-01-01'), new Date('2100-01-01')),
            ];

            // Rent ends in 2025, so in 2030 only food counts: 500 * 12 = 6000
            expect(calculateAnnualExpenses(expenses, 2030)).toBe(6000);
        });
    });

    describe('EXPENSES valueType', () => {
        it('evaluates net worth >= multiple of expenses', () => {
            const accounts = [
                new InvestedAccount('brok', 'Brokerage', 1000000, 0, 0, 0.1, 'Brokerage'),
            ];
            const expenses = [
                new OtherExpense('living', 'Living', 40000, 'Annually', new Date('2020-01-01'), new Date('2100-01-01')),
            ];

            // Net worth: $1M >= 25 × $40k ($1M)
            const milestone: CustomMilestone = {
                id: 'fi',
                name: 'FI',
                conditions: [{
                    type: 'NET_WORTH',
                    operator: '>=',
                    value: 25,
                    valueType: 'EXPENSES'
                }],
            };

            const context: MilestoneContext = {
                accounts,
                expenses,
                year: 2030,
                age: 40,
            };

            expect(evaluateMilestone(milestone, context)).toBe(true);
        });

        it('fails when net worth is below expense multiple', () => {
            const accounts = [
                new InvestedAccount('brok', 'Brokerage', 800000, 0, 0, 0.1, 'Brokerage'),
            ];
            const expenses = [
                new OtherExpense('living', 'Living', 40000, 'Annually', new Date('2020-01-01'), new Date('2100-01-01')),
            ];

            // Net worth: $800k < 25 × $40k ($1M)
            const milestone: CustomMilestone = {
                id: 'fi',
                name: 'FI',
                conditions: [{
                    type: 'NET_WORTH',
                    operator: '>=',
                    value: 25,
                    valueType: 'EXPENSES'
                }],
            };

            const context: MilestoneContext = {
                accounts,
                expenses,
                year: 2030,
                age: 40,
            };

            expect(evaluateMilestone(milestone, context)).toBe(false);
        });
    });

    describe('MILESTONE_PLUS valueType', () => {
        it('triggers X years after another milestone', () => {
            const milestoneReachYears = new Map<string, number>();
            milestoneReachYears.set('debt-free', 2025);

            // Year >= "Debt Free" + 5
            const milestone: CustomMilestone = {
                id: 'sabbatical',
                name: 'Sabbatical',
                conditions: [{
                    type: 'YEAR',
                    operator: '>=',
                    value: 5,
                    valueType: 'MILESTONE_PLUS',
                    referenceMilestoneId: 'debt-free'
                }],
            };

            const context: MilestoneContext = {
                accounts: [],
                expenses: [],
                year: 2030, // >= 2025 + 5
                age: 40,
                milestoneReachYears,
            };

            expect(evaluateMilestone(milestone, context)).toBe(true);
        });

        it('does not trigger before X years after milestone', () => {
            const milestoneReachYears = new Map<string, number>();
            milestoneReachYears.set('debt-free', 2025);

            const milestone: CustomMilestone = {
                id: 'sabbatical',
                name: 'Sabbatical',
                conditions: [{
                    type: 'YEAR',
                    operator: '>=',
                    value: 5,
                    valueType: 'MILESTONE_PLUS',
                    referenceMilestoneId: 'debt-free'
                }],
            };

            const context: MilestoneContext = {
                accounts: [],
                expenses: [],
                year: 2028, // 2028 < 2025 + 5 (2030)
                age: 38,
                milestoneReachYears,
            };

            expect(evaluateMilestone(milestone, context)).toBe(false);
        });

        it('does not trigger if referenced milestone not reached', () => {
            const milestoneReachYears = new Map<string, number>();
            // debt-free not in the map

            const milestone: CustomMilestone = {
                id: 'sabbatical',
                name: 'Sabbatical',
                conditions: [{
                    type: 'YEAR',
                    operator: '>=',
                    value: 5,
                    valueType: 'MILESTONE_PLUS',
                    referenceMilestoneId: 'debt-free'
                }],
            };

            const context: MilestoneContext = {
                accounts: [],
                expenses: [],
                year: 2030,
                age: 40,
                milestoneReachYears,
            };

            expect(evaluateMilestone(milestone, context)).toBe(false);
        });
    });

    describe('isActiveByMilestone', () => {
        it('returns true when no milestone conditions', () => {
            expect(isActiveByMilestone(undefined, undefined, new Set())).toBe(true);
        });

        it('returns false when start milestone not reached', () => {
            expect(isActiveByMilestone('coast-fire', undefined, new Set())).toBe(false);
        });

        it('returns true when start milestone is reached', () => {
            expect(isActiveByMilestone('coast-fire', undefined, new Set(['coast-fire']))).toBe(true);
        });

        it('returns false when end milestone is reached', () => {
            expect(isActiveByMilestone(undefined, 'fi', new Set(['fi']))).toBe(false);
        });

        it('returns true when end milestone not yet reached', () => {
            expect(isActiveByMilestone(undefined, 'fi', new Set())).toBe(true);
        });

        it('handles both start and end milestones', () => {
            // Start reached, end not reached = active
            expect(isActiveByMilestone('coast', 'fi', new Set(['coast']))).toBe(true);

            // Start reached, end reached = not active
            expect(isActiveByMilestone('coast', 'fi', new Set(['coast', 'fi']))).toBe(false);

            // Start not reached = not active (regardless of end)
            expect(isActiveByMilestone('coast', 'fi', new Set(['fi']))).toBe(false);
        });
    });

    describe('isIncomeActiveToday (#152: fixed-date window AND milestone gate)', () => {
        const EMPTY = new Set<string>();
        const makeIncome = () => new WorkIncome(
            'inc', 'Job', 100_000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
        );

        it('non-milestone income with no start date is active today', () => {
            expect(isIncomeActiveToday(makeIncome(), EMPTY)).toBe(true);
        });

        it('milestone-started income is INACTIVE until its start milestone has fired', () => {
            const inc = makeIncome();
            inc.startMilestoneId = 'M'; // no fixed start date → date-gate passes
            // Milestone NOT in today's set → inactive even though the date-gate passes.
            expect(isIncomeActiveToday(inc, EMPTY)).toBe(false);
            // Milestone reached → active.
            expect(isIncomeActiveToday(inc, new Set(['M']))).toBe(true);
        });

        it('a FUTURE fixed start date is inactive regardless of the milestone set', () => {
            const future = new Date(new Date().getFullYear() + 5, 0, 1);
            const inc = new WorkIncome(
                'inc-future', 'Future Job', 100_000, 'Annually', 'Yes',
                0, 0, 0, 0, '', null, 'FIXED', future,
            );
            expect(isIncomeActiveToday(inc, EMPTY)).toBe(false);
            expect(isIncomeActiveToday(inc, new Set(['anything']))).toBe(false);
        });

        it('an income whose END milestone has fired is inactive', () => {
            const inc = makeIncome();
            inc.endMilestoneId = 'retire';
            expect(isIncomeActiveToday(inc, new Set(['retire']))).toBe(false);
            expect(isIncomeActiveToday(inc, EMPTY)).toBe(true);
        });

        // #152/#154: a relative (MILESTONE_PLUS) start milestone resolves out of the
        // cached projection timeline. On a fresh session (simulation === []) the today-
        // set can't confirm it as reached even when it fired years ago, so without the
        // fallback a genuinely-active income is silently dropped. The per-income
        // `milestoneGateUnresolved` arg falls back to the fixed-date window alone.
        describe('relative-milestone gate unresolved (empty sim timeline)', () => {
            it('INCLUDES a time-active relative-milestone income when the reach-year map is empty', () => {
                // Past fixed start date → the date window passes; the MILESTONE 'fi+2'
                // is the gate, and it is absent from the today-set because no projection
                // has resolved its reach year yet.
                const past = new Date(new Date().getFullYear() - 1, 0, 1);
                const inc = new WorkIncome(
                    'inc-rel', 'Post-FI Job', 100_000, 'Annually', 'Yes',
                    0, 0, 0, 0, '', null, 'FIXED', past,
                );
                inc.startMilestoneId = 'fi+2';

                // Without the flag (normal path), the unreached milestone hides it.
                expect(isIncomeActiveToday(inc, EMPTY)).toBe(false);
                // With the gate flagged unresolvable, the date window alone keeps it active.
                expect(isIncomeActiveToday(inc, EMPTY, true)).toBe(true);
            });

            it('still respects the fixed-date window even when the gate is unresolved', () => {
                // A FUTURE fixed start date must stay inactive — the fallback is the
                // date window ALONE, not "always active".
                const future = new Date(new Date().getFullYear() + 5, 0, 1);
                const inc = new WorkIncome(
                    'inc-rel-future', 'Future Post-FI Job', 100_000, 'Annually', 'Yes',
                    0, 0, 0, 0, '', null, 'FIXED', future,
                );
                inc.startMilestoneId = 'fi+2';
                expect(isIncomeActiveToday(inc, EMPTY, true)).toBe(false);
            });

            it('does not relax the gate when it is resolvable (flag false → milestone still gates)', () => {
                const inc = makeIncome();
                inc.startMilestoneId = 'fi+2';
                // Timeline available, milestone legitimately unreached → still hidden.
                expect(isIncomeActiveToday(inc, EMPTY, false)).toBe(false);
                // And reached → active, exactly as before.
                expect(isIncomeActiveToday(inc, new Set(['fi+2']), false)).toBe(true);
            });
        });
    });

    // ===================================================================================
    // Per-income milestone-gate resolution (findings 1/2/3/10).
    //
    // The fallback that lets an unresolved RELATIVE milestone fall back to the date
    // window must be PER-INCOME (not a global flag) and must trigger ONLY when the
    // projection itself hasn't run AND the income's own milestone is sim-dependent.
    // ===================================================================================
    describe('per-income milestone-gate resolution', () => {
        const EMPTY = new Set<string>();
        const pastDate = new Date(new Date().getFullYear() - 1, 0, 1);

        // An ABSOLUTE age-based milestone (the default "Retirement" AGE>= kind): resolves
        // from current age alone, no projection needed → NOT sim-dependent.
        const absoluteMilestone: CustomMilestone = {
            id: 'retire-at-65',
            name: 'Retirement',
            conditions: [{ type: 'AGE', operator: '>=', value: 65, valueType: 'FIXED' }],
        };
        // A RELATIVE (MILESTONE_PLUS, "N years after X") milestone: needs the projection
        // timeline's reach years to resolve → sim-dependent.
        const relativeMilestone: CustomMilestone = {
            id: 'fi-plus-2',
            name: '2 Years After FI',
            conditions: [{ type: 'AGE', operator: '>=', value: 2, valueType: 'MILESTONE_PLUS', referenceMilestoneId: 'fi' }],
        };
        // A value/net-worth milestone: resolves against today's accounts in the from-scratch
        // evaluation, no timeline read → NOT sim-dependent (only MILESTONE_PLUS reads the map).
        const netWorthMilestone: CustomMilestone = {
            id: 'fi-1m',
            name: 'FI ($1M)',
            conditions: [{ type: 'NET_WORTH', operator: '>=', value: 1_000_000, valueType: 'FIXED' }],
        };

        const milestonesById = new Map<string, CustomMilestone>([
            [absoluteMilestone.id, absoluteMilestone],
            [relativeMilestone.id, relativeMilestone],
            [netWorthMilestone.id, netWorthMilestone],
        ]);

        // An income with a past fixed start date so the date window passes; the milestone
        // is the only thing gating it.
        const makeDateActiveIncome = (id: string, startMilestoneId?: string) => {
            const inc = new WorkIncome(
                id, 'Job', 100_000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED', pastDate,
            );
            if (startMilestoneId) inc.startMilestoneId = startMilestoneId;
            return inc;
        };

        describe('isMilestoneSimDependent', () => {
            it('is true only for a MILESTONE_PLUS (relative) milestone', () => {
                expect(isMilestoneSimDependent(relativeMilestone)).toBe(true);
                expect(isMilestoneSimDependent(absoluteMilestone)).toBe(false);
                expect(isMilestoneSimDependent(netWorthMilestone)).toBe(false);
            });
        });

        describe('isIncomeMilestoneGateUnresolved', () => {
            it('is false once a projection has run, regardless of milestone kind', () => {
                const inc = makeDateActiveIncome('a', relativeMilestone.id);
                expect(isIncomeMilestoneGateUnresolved(inc, milestonesById, /* projectionHasRun */ true)).toBe(false);
            });

            it('is true for a relative-milestone income when no projection has run', () => {
                const inc = makeDateActiveIncome('b', relativeMilestone.id);
                expect(isIncomeMilestoneGateUnresolved(inc, milestonesById, false)).toBe(true);
            });

            it('is FALSE for an absolute-milestone income even with no projection (finding 1)', () => {
                const inc = makeDateActiveIncome('c', absoluteMilestone.id);
                expect(isIncomeMilestoneGateUnresolved(inc, milestonesById, false)).toBe(false);
            });

            it('is false for a net-worth-milestone income (resolves from today, no timeline)', () => {
                const inc = makeDateActiveIncome('d', netWorthMilestone.id);
                expect(isIncomeMilestoneGateUnresolved(inc, milestonesById, false)).toBe(false);
            });

            it('is false for an income with no milestone gate at all', () => {
                const inc = makeDateActiveIncome('e');
                expect(isIncomeMilestoneGateUnresolved(inc, milestonesById, false)).toBe(false);
            });
        });

        // Finding 1: an ABSOLUTE-milestone income, no fixed start, NO projection cached,
        // with an unrelated relative milestone also present in the plan, must NOT show
        // active today before its milestone fires — the absolute gate still applies.
        it('finding 1: absolute-milestone income stays gated OFF with no projection (relative milestone also present)', () => {
            // No fixed start date so ONLY the milestone gates it.
            const inc = new WorkIncome(
                'abs-inc', 'Pension', 100_000, 'Annually', 'No', 0, 0, 0, 0, '', null, 'FIXED',
            );
            inc.startMilestoneId = absoluteMilestone.id;

            // No projection cached, but the income's own milestone is ABSOLUTE → resolvable.
            const unresolved = isIncomeMilestoneGateUnresolved(inc, milestonesById, /* projectionHasRun */ false);
            expect(unresolved).toBe(false);

            // Milestone not fired today → income is NOT active today.
            expect(isIncomeActiveToday(inc, EMPTY, unresolved)).toBe(false);
            // (And the Priority-tab gate agrees.)
            expect(isActiveByMilestoneToday(inc, EMPTY, unresolved)).toBe(false);
        });

        // Finding 2 (original intent holds): a RELATIVE income that already fired but has
        // NO projection cached must be treated as active.
        it('finding 2: already-fired relative income shows active with no projection cached', () => {
            const inc = makeDateActiveIncome('rel-fired', relativeMilestone.id);

            const unresolved = isIncomeMilestoneGateUnresolved(inc, milestonesById, /* projectionHasRun */ false);
            expect(unresolved).toBe(true);

            // Income tab: falls back to the (passing) fixed-date window → active.
            expect(isIncomeActiveToday(inc, EMPTY, unresolved)).toBe(true);
            // Priority tab: the relative START is sim-dependent + unresolved → assumed
            // started, no end → kept in the tax base → active.
            expect(isActiveByMilestoneToday(inc, EMPTY, unresolved, milestonesById)).toBe(true);
        });

        // Finding 3: a RELATIVE income whose base never fires — a projection HAS run, but
        // the reach map is empty for it → genuinely UNREACHED, must be gated OFF (NOT a
        // fallback-shown income). The signal keys off the projection having run, not the
        // reach-map size.
        it('finding 3: relative income whose base never fires (projection ran) is gated OFF', () => {
            const inc = makeDateActiveIncome('rel-unreached', relativeMilestone.id);

            // Projection ran → never "unresolved", even though the milestone never fired.
            const unresolved = isIncomeMilestoneGateUnresolved(inc, milestonesById, /* projectionHasRun */ true);
            expect(unresolved).toBe(false);

            // Milestone absent from today's set (it never fired) → income is NOT active.
            expect(isIncomeActiveToday(inc, EMPTY, unresolved)).toBe(false);
            expect(isActiveByMilestoneToday(inc, EMPTY, unresolved)).toBe(false);
        });

        // Finding 2 (Priority-tab path): a currently-active income gated by an
        // already-fired relative START milestone, no projection cached → counted active
        // on the Priority tab too (it consumes the SAME gate and so MUST get the fallback).
        it('finding 2 (Priority path): active relative-milestone income is counted with no projection cached', () => {
            const inc = makeDateActiveIncome('rel-priority', relativeMilestone.id);
            const unresolved = isIncomeMilestoneGateUnresolved(inc, milestonesById, /* projectionHasRun */ false);

            // isActiveByMilestoneToday is the Priority-tab gate (milestone-only, no fixed-date AND).
            // The relative START is sim-dependent + unresolved → assumed started (don't drop).
            expect(isActiveByMilestoneToday(inc, EMPTY, unresolved, milestonesById)).toBe(true);
            // Sanity: without the fallback the raw milestone gate would drop it.
            expect(isActiveByMilestone(inc.startMilestoneId, inc.endMilestoneId, EMPTY)).toBe(false);
        });

        // ===========================================================================
        // RE-REVIEW (finding 1/2): the unresolved gate must HONOR every milestone it can
        // resolve and default only the genuinely sim-bound ones. The previous code did an
        // unconditional `return true`, which SKIPPED the end-milestone check and over-counted
        // an income that had actually ENDED (the Priority tab uses this milestone gate ALONE).
        // ===========================================================================
        describe('re-review: unresolved gate honors resolvable end milestones', () => {
            // An income with a RELATIVE start (fired) and a RESOLVABLE ABSOLUTE end. The
            // start is sim-dependent so the gate is flagged unresolved for this income, but
            // the absolute end is knowable from todaySet and must be honored.
            const makeRelStartAbsEnd = (id: string) => {
                const inc = makeDateActiveIncome(id, relativeMilestone.id);
                inc.endMilestoneId = absoluteMilestone.id; // absolute → resolvable
                return inc;
            };

            // HEADLINE (case B): relative start (fired) + ABSOLUTE end that has ALREADY past,
            // NO projection cached → NOT active. The absolute end IS resolvable from the
            // today-set and must gate the income OFF. Pre-fix (`return true`) wrongly counted it.
            it('case B: relative start + already-fired absolute end → NOT active', () => {
                const inc = makeRelStartAbsEnd('rel-start-abs-end-fired');
                // Gate is unresolved (the relative START needs the sim), but the ABSOLUTE end
                // is in the today-set (it already fired).
                const todayWithEnd = new Set<string>([absoluteMilestone.id]);
                const unresolved = isIncomeMilestoneGateUnresolved(inc, milestonesById, /* projectionHasRun */ false);
                expect(unresolved).toBe(true);

                expect(isActiveByMilestoneToday(inc, todayWithEnd, unresolved, milestonesById)).toBe(false);
            });

            // REGRESSION (original intent holds): relative start (fired), NO end milestone,
            // NO projection cached → still active. We must not drop a genuinely-active
            // relative-start income while waiting for the projection.
            it('regression: relative start, no end, no projection → still active', () => {
                const inc = makeDateActiveIncome('rel-start-no-end', relativeMilestone.id);
                const unresolved = isIncomeMilestoneGateUnresolved(inc, milestonesById, /* projectionHasRun */ false);
                expect(unresolved).toBe(true);

                expect(isActiveByMilestoneToday(inc, EMPTY, unresolved, milestonesById)).toBe(true);
            });

            // A RESOLVABLE absolute end that has NOT fired (+ start satisfied) → active.
            // The absolute end is honored (knowable from todaySet) and it simply hasn't fired.
            it('resolvable absolute end that has NOT fired (start satisfied) → active', () => {
                const inc = makeRelStartAbsEnd('rel-start-abs-end-unfired');
                // Absolute end NOT in the today-set (hasn't fired).
                const unresolved = isIncomeMilestoneGateUnresolved(inc, milestonesById, /* projectionHasRun */ false);
                expect(unresolved).toBe(true);

                expect(isActiveByMilestoneToday(inc, EMPTY, unresolved, milestonesById)).toBe(true);
            });

            // Symmetric to the headline: relative start (assumed started), no end, but a
            // resolvable absolute end that HAS fired must still gate OFF even with the start
            // sim-bound — i.e. case-B is purely about the end side being honored.
            it('case B variant: a not-yet-fired relative start is assumed started, but a fired absolute end still gates OFF', () => {
                const inc = makeRelStartAbsEnd('rel-start-unfired-abs-end-fired');
                // The relative start has no reach year (no sim) → assumed started; the absolute
                // end already fired → gates OFF. Net: NOT active.
                const todayWithEnd = new Set<string>([absoluteMilestone.id]);
                const unresolved = isIncomeMilestoneGateUnresolved(inc, milestonesById, /* projectionHasRun */ false);

                expect(isActiveByMilestoneToday(inc, todayWithEnd, unresolved, milestonesById)).toBe(false);
            });
        });
    });
});
