/**
 * Unit tests for income projection.
 *
 * This function handles income growth, pension calculations,
 * Social Security benefits, earnings test, and interest income.
 */
import { describe, it, expect } from 'vitest';
import { projectIncomes } from '../../../services/simulation/IncomeProjection';
import {
    WorkIncome,
    PassiveIncome,
    FutureSocialSecurityIncome,
    FERSPensionIncome,
    CSRSPensionIncome,
    AnyIncome
} from '../../../components/Objects/Income/models';
import { SavedAccount, InvestedAccount, AnyAccount } from '../../../components/Objects/Accounts/models';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { SimulationYear } from '../../../services/simulation/types';
import { getIncomeActiveMultiplier } from '../../../components/Objects/Income/models';

// Helper to create test assumptions with custom milestones
function createTestAssumptions(overrides: Partial<{
    birthYear: number;
    retirementAge: number;
    lifeExpectancy: number;
    salaryGrowth: number;
    inflationAdjusted: boolean;
    inflationRate: number;
    socialSecurityFundingPercent: number;
}> = {}): AssumptionsState {
    const birthYear = overrides.birthYear ?? 1960;
    const retirementAge = overrides.retirementAge ?? 65;
    const lifeExpectancy = overrides.lifeExpectancy ?? 90;

    return {
        ...defaultAssumptions,
        macro: {
            ...defaultAssumptions.macro,
            inflationAdjusted: overrides.inflationAdjusted ?? false,
            inflationRate: overrides.inflationRate ?? 2.6,
        },
        income: {
            ...defaultAssumptions.income,
            salaryGrowth: overrides.salaryGrowth ?? 3.0,
            socialSecurityFundingPercent: overrides.socialSecurityFundingPercent ?? 100,
        },
        milestones: createBuiltinMilestones(birthYear, retirementAge, lifeExpectancy),
    };
}

// Helper to create WorkIncome
function createWorkIncome(
    id: string,
    name: string,
    salary: number,
    options: Partial<{
        startDate: Date;
        endDate: Date;
        preTax401k: number;
        pensionSystem: 'NONE' | 'FERS' | 'CSRS';
    }> = {}
): WorkIncome {
    return new WorkIncome(
        id, name, salary, 'Annually', 'Yes',
        options.preTax401k ?? 0, 0, 0, 0, '',
        null, 'FIXED',
        options.startDate ?? new Date('2020-01-01'),
        options.endDate,
        0, 'custom', 'NONE', 0, 15, true, 6, null, 7,
        'NONE', 0, 'quarterly', 7, null, 37, // RSU defaults
        options.pensionSystem ?? 'NONE'
    );
}

// Helper to create PassiveIncome
function createPassiveIncome(
    id: string,
    name: string,
    amount: number,
    sourceType: 'Dividend' | 'Rental' | 'Royalty' | 'Interest' | 'RMD' | 'Other',
    options: Partial<{ isReinvested: boolean; startDate: Date; endDate: Date }> = {}
): PassiveIncome {
    return new PassiveIncome(
        id, name, amount, 'Annually', 'No', sourceType,
        options.startDate, options.endDate,
        options.isReinvested ?? false
    );
}

// Helper to create a minimal SimulationYear for previousSimulation
function createSimulationYear(
    year: number,
    incomes: AnyIncome[] = [],
    accounts: AnyAccount[] = []
): SimulationYear {
    return {
        year,
        incomes,
        expenses: [],
        accounts,
        cashflow: {
            totalIncome: 0,
            totalExpense: 0,
        livingExpenses: 0,
            discretionary: 0,
            investedUser: 0,
            investedMatch: 0,
            totalInvested: 0,
            bucketAllocations: 0,
            bucketDetail: {},
            withdrawals: 0,
            withdrawalDetail: {},
        },
        taxDetails: {
            fed: 0,
            state: 0,
            fica: 0,
            preTax: 0,
            insurance: 0,
            postTax: 0,
            capitalGains: 0,
            withdrawalOrdinaryTax: 0,
            niit: 0,
        },
        logs: [],
    };
}

describe('IncomeProjection', () => {
    describe('projectIncomes', () => {
        describe('income filtering', () => {
            it('should filter out previous year Interest income', () => {
                const interestIncome = createPassiveIncome('int1', 'Savings Interest', 500, 'Interest');
                const workIncome = createWorkIncome('work1', 'Salary', 100000);
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [interestIncome, workIncome],
                    [],
                    assumptions,
                    [],
                    35,
                    false,
                    logs
                );

                // Interest income should be filtered out (regenerated fresh each year)
                const hasOldInterest = result.nextIncomes.some(
                    inc => inc instanceof PassiveIncome && inc.sourceType === 'Interest' && inc.id === 'int1'
                );
                expect(hasOldInterest).toBe(false);
            });

            it('should filter out previous year RMD income', () => {
                const rmdIncome = createPassiveIncome('rmd1', 'RMD Distribution', 10000, 'RMD');
                const workIncome = createWorkIncome('work1', 'Salary', 100000);
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [rmdIncome, workIncome],
                    [],
                    assumptions,
                    [],
                    35,
                    false,
                    logs
                );

                // RMD income should be filtered out
                const hasOldRMD = result.nextIncomes.some(
                    inc => inc instanceof PassiveIncome && inc.sourceType === 'RMD'
                );
                expect(hasOldRMD).toBe(false);
            });

            it('should preserve regular incomes', () => {
                const dividendIncome = createPassiveIncome('div1', 'Stock Dividends', 5000, 'Dividend');
                const rentalIncome = createPassiveIncome('rent1', 'Rental Property', 12000, 'Rental');
                const workIncome = createWorkIncome('work1', 'Salary', 100000);
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [dividendIncome, rentalIncome, workIncome],
                    [],
                    assumptions,
                    [],
                    35,
                    false,
                    logs
                );

                expect(result.nextIncomes).toHaveLength(3);
                expect(result.nextIncomes.some(inc => inc.id === 'div1')).toBe(true);
                expect(result.nextIncomes.some(inc => inc.id === 'rent1')).toBe(true);
                expect(result.nextIncomes.some(inc => inc.id === 'work1')).toBe(true);
            });
        });

        describe('WorkIncome handling', () => {
            it('should increment WorkIncome with salary growth', () => {
                const workIncome = createWorkIncome('work1', 'Salary', 100000);
                const assumptions = createTestAssumptions({ salaryGrowth: 3.0, inflationAdjusted: false });
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [workIncome],
                    [],
                    assumptions,
                    [],
                    35,
                    false,
                    logs
                );

                const updatedWork = result.nextIncomes.find(inc => inc.id === 'work1') as WorkIncome;
                // 3% salary growth
                expect(updatedWork.amount).toBeCloseTo(103000, 0);
            });

            it('should zero out WorkIncome at retirement', () => {
                const workIncome = createWorkIncome('work1', 'Salary', 100000);
                // birthYear=1960, retirementAge=65 → retirement year = 2025, currentAge=65
                const assumptions = createTestAssumptions({ birthYear: 1960, retirementAge: 65 });
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [workIncome],
                    [],
                    assumptions,
                    [],
                    65, // currentAge = retirementAge
                    true, // isRetired
                    logs
                );

                const updatedWork = result.nextIncomes.find(inc => inc.id === 'work1') as WorkIncome;
                expect(updatedWork.amount).toBe(0);
            });

            it('should set end date when retiring', () => {
                const workIncome = createWorkIncome('work1', 'Salary', 100000);
                // birthYear=1960, retirementAge=65 → retirement year = 2025
                const assumptions = createTestAssumptions({ birthYear: 1960, retirementAge: 65 });
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [workIncome],
                    [],
                    assumptions,
                    [],
                    65,
                    true,
                    logs
                );

                const updatedWork = result.nextIncomes.find(inc => inc.id === 'work1') as WorkIncome;
                expect(updatedWork.end_date).toBeDefined();
                // End date should be Dec 31 of the year before retirement (2024)
                expect(updatedWork.end_date?.getFullYear()).toBe(2024);
            });

            it('should preserve milestone IDs when retiring', () => {
                const workIncome = new WorkIncome(
                    'work1', 'Salary', 100000, 'Annually', 'Yes',
                    0, 0, 0, 0, '',
                    null, 'FIXED',
                    new Date('2020-01-01'),
                    undefined,
                    0, 'custom', 'NONE', 0, 15, true, 6, null, 7,
                    'NONE', 0, 'quarterly', 7, null, 37, // RSU defaults
                    'NONE',
                    'start-milestone-123',
                    'end-milestone-456'
                );
                const assumptions = createTestAssumptions({ birthYear: 1960, retirementAge: 65 });
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [workIncome],
                    [],
                    assumptions,
                    [],
                    65,
                    true,
                    logs
                );

                const updatedWork = result.nextIncomes.find(inc => inc.id === 'work1') as WorkIncome;
                expect(updatedWork.endMilestoneId).toBe('end-milestone-456');
            });

            it('should not modify WorkIncome with existing end date at retirement', () => {
                // If work income already has an end date, don't override it
                const workIncome = createWorkIncome('work1', 'Salary', 100000, {
                    endDate: new Date('2023-12-31') // Already ended
                });
                const assumptions = createTestAssumptions({ birthYear: 1960, retirementAge: 65 });
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [workIncome],
                    [],
                    assumptions,
                    [],
                    65,
                    true,
                    logs
                );

                const updatedWork = result.nextIncomes.find(inc => inc.id === 'work1') as WorkIncome;
                // Should keep original amount since it had an end date and won't be zeroed
                expect(updatedWork.amount).not.toBe(0);
            });
        });

        describe('FERS Pension calculation', () => {
            it('should auto-calculate High-3 from salary history', () => {
                const workIncome = createWorkIncome('work1', 'Fed Job', 100000, { pensionSystem: 'FERS' });
                const fersPension = new FERSPensionIncome(
                    'fers1', 'FERS Pension', 30, 0, 65, 1960, 0, 0, 0,
                    undefined, undefined,
                    true, 'work1' // autoCalculateHigh3=true, linkedIncomeId='work1'
                );

                // Create salary history: years of work with growing salary
                const previousSimulation: SimulationYear[] = [];
                for (let i = 0; i < 5; i++) {
                    const yearSalary = 90000 + i * 2500; // Growing from 90k to 100k
                    previousSimulation.push(createSimulationYear(2020 + i, [
                        createWorkIncome('work1', 'Fed Job', yearSalary)
                    ]));
                }

                const assumptions = createTestAssumptions({ birthYear: 1960, retirementAge: 65 });
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [workIncome, fersPension],
                    [],
                    assumptions,
                    previousSimulation,
                    65, // currentAge = retirementAge
                    true,
                    logs
                );

                const updatedFers = result.nextIncomes.find(inc => inc.id === 'fers1') as FERSPensionIncome;
                // High-3 should be calculated and benefit should be set
                expect(updatedFers.high3Salary).toBeGreaterThan(0);
                expect(updatedFers.calculatedBenefit).toBeGreaterThan(0);
                expect(logs.some(l => l.includes('FERS Pension started'))).toBe(true);
            });

            it('should auto-calculate High-3 even after the linked work income has ended (retired)', () => {
                // Regression: in the real engine, SimulationEngine filters the linked
                // WorkIncome out of `incomes` once isRetired is true, so by the retirement
                // year projectIncomes no longer sees it. The High-3 must still be computed
                // from previousSimulation salary history alone, otherwise the pension stays $0.
                const fersPension = new FERSPensionIncome(
                    'fers1', 'FERS Pension', 30, 0, 65, 1960, 0, 0, 0,
                    undefined, undefined,
                    true, 'work1' // autoCalculateHigh3=true, linkedIncomeId='work1'
                );

                // Salary history from the working years; the linked income is gone this year.
                const previousSimulation: SimulationYear[] = [];
                for (let i = 0; i < 5; i++) {
                    const yearSalary = 90000 + i * 2500;
                    previousSimulation.push(createSimulationYear(2020 + i, [
                        createWorkIncome('work1', 'Fed Job', yearSalary)
                    ]));
                }

                const assumptions = createTestAssumptions({ birthYear: 1960, retirementAge: 65 });
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [fersPension], // NOTE: no 'work1' here — already filtered out at retirement
                    [],
                    assumptions,
                    previousSimulation,
                    65, // currentAge = retirementAge
                    true, // isRetired
                    logs
                );

                const updatedFers = result.nextIncomes.find(inc => inc.id === 'fers1') as FERSPensionIncome;
                expect(updatedFers.high3Salary).toBeGreaterThan(0);
                expect(updatedFers.calculatedBenefit).toBeGreaterThan(0);
            });

            it('should apply FERS multiplier (1% or 1.1%)', () => {
                // 1.1% multiplier applies when retiring at 62+ with 20+ years of service
                const workIncome = createWorkIncome('work1', 'Fed Job', 100000, { pensionSystem: 'FERS' });
                const fersPension = new FERSPensionIncome(
                    'fers1', 'FERS Pension', 25, 0, 62, 1963, 0, 0, 0,
                    undefined, undefined,
                    true, 'work1'
                );

                // Provide 3 years of salary history at $100k
                const previousSimulation: SimulationYear[] = [
                    createSimulationYear(2022, [createWorkIncome('work1', 'Fed Job', 100000)]),
                    createSimulationYear(2023, [createWorkIncome('work1', 'Fed Job', 100000)]),
                    createSimulationYear(2024, [createWorkIncome('work1', 'Fed Job', 100000)]),
                ];

                const assumptions = createTestAssumptions({ birthYear: 1963, retirementAge: 62 });
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [workIncome, fersPension],
                    [],
                    assumptions,
                    previousSimulation,
                    62,
                    true,
                    logs
                );

                const updatedFers = result.nextIncomes.find(inc => inc.id === 'fers1') as FERSPensionIncome;
                // High-3 = $100k, 25 years at 1.1% = $27,500/year
                expect(updatedFers.calculatedBenefit).toBeCloseTo(27500, -2);
            });

            it('should apply early retirement reduction', () => {
                // MRA+10: retiring at minimum retirement age with 10+ years gets 5%/year reduction
                const workIncome = createWorkIncome('work1', 'Fed Job', 100000, { pensionSystem: 'FERS' });
                const fersPension = new FERSPensionIncome(
                    'fers1', 'FERS Pension', 15, 0, 57, 1968, 0, 0, 0, // MRA=57 for 1968
                    undefined, undefined,
                    true, 'work1'
                );

                const previousSimulation: SimulationYear[] = [
                    createSimulationYear(2022, [createWorkIncome('work1', 'Fed Job', 100000)]),
                    createSimulationYear(2023, [createWorkIncome('work1', 'Fed Job', 100000)]),
                    createSimulationYear(2024, [createWorkIncome('work1', 'Fed Job', 100000)]),
                ];

                const assumptions = createTestAssumptions({ birthYear: 1968, retirementAge: 57 });
                const logs: string[] = [];

                projectIncomes(
                    2025,
                    [workIncome, fersPension],
                    [],
                    assumptions,
                    previousSimulation,
                    57,
                    true,
                    logs
                );

                // Should log about reduction
                expect(logs.some(l => l.includes('reduced') || l.includes('reduction'))).toBe(true);
            });

            it('should apply COLA after start', () => {
                // After pension starts, it should grow with COLA
                const fersPension = new FERSPensionIncome(
                    'fers1', 'FERS Pension', 30, 100000, 65, 1960, 30000, 0, 0,
                    new Date('2025-01-01'), undefined,
                    false, null // Already calculated
                );

                const assumptions = createTestAssumptions({ inflationAdjusted: true, inflationRate: 3.0 });
                const logs: string[] = [];

                const result = projectIncomes(
                    2026,
                    [fersPension],
                    [],
                    assumptions,
                    [],
                    66,
                    true,
                    logs
                );

                const updatedFers = result.nextIncomes.find(inc => inc.id === 'fers1') as FERSPensionIncome;
                // FERS COLA is inflation - 1% if inflation > 2%, so 2% COLA for 3% inflation
                // $30,000 * 1.02 = $30,600
                expect(updatedFers.calculatedBenefit).toBeGreaterThan(30000);
            });
        });

        describe('CSRS Pension calculation', () => {
            it('should auto-calculate High-3 from salary history', () => {
                const workIncome = createWorkIncome('work1', 'Fed Job', 100000, { pensionSystem: 'CSRS' });
                const csrsPension = new CSRSPensionIncome(
                    'csrs1', 'CSRS Pension', 30, 0, 65, 0,
                    undefined, undefined,
                    true, 'work1'
                );

                const previousSimulation: SimulationYear[] = [
                    createSimulationYear(2022, [createWorkIncome('work1', 'Fed Job', 95000)]),
                    createSimulationYear(2023, [createWorkIncome('work1', 'Fed Job', 97500)]),
                    createSimulationYear(2024, [createWorkIncome('work1', 'Fed Job', 100000)]),
                ];

                const assumptions = createTestAssumptions({ birthYear: 1960, retirementAge: 65 });
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [workIncome, csrsPension],
                    [],
                    assumptions,
                    previousSimulation,
                    65,
                    true,
                    logs
                );

                const updatedCsrs = result.nextIncomes.find(inc => inc.id === 'csrs1') as CSRSPensionIncome;
                expect(updatedCsrs.high3Salary).toBeGreaterThan(0);
                expect(updatedCsrs.calculatedBenefit).toBeGreaterThan(0);
                expect(logs.some(l => l.includes('CSRS Pension started'))).toBe(true);
            });

            it('should auto-calculate High-3 even after the linked work income has ended (retired)', () => {
                // Regression: same filtering bug as FERS — the linked WorkIncome is removed
                // from `incomes` at retirement, so High-3 must come from previousSimulation.
                const csrsPension = new CSRSPensionIncome(
                    'csrs1', 'CSRS Pension', 30, 0, 65, 0,
                    undefined, undefined,
                    true, 'work1'
                );

                const previousSimulation: SimulationYear[] = [
                    createSimulationYear(2022, [createWorkIncome('work1', 'Fed Job', 95000)]),
                    createSimulationYear(2023, [createWorkIncome('work1', 'Fed Job', 97500)]),
                    createSimulationYear(2024, [createWorkIncome('work1', 'Fed Job', 100000)]),
                ];

                const assumptions = createTestAssumptions({ birthYear: 1960, retirementAge: 65 });
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [csrsPension], // NOTE: no 'work1' here — already filtered out at retirement
                    [],
                    assumptions,
                    previousSimulation,
                    65,
                    true,
                    logs
                );

                const updatedCsrs = result.nextIncomes.find(inc => inc.id === 'csrs1') as CSRSPensionIncome;
                expect(updatedCsrs.high3Salary).toBeGreaterThan(0);
                expect(updatedCsrs.calculatedBenefit).toBeGreaterThan(0);
            });

            it('should apply tiered CSRS multipliers', () => {
                // CSRS: 1.5% for first 5 years, 1.75% for next 5, 2% thereafter
                const workIncome = createWorkIncome('work1', 'Fed Job', 100000, { pensionSystem: 'CSRS' });
                const csrsPension = new CSRSPensionIncome(
                    'csrs1', 'CSRS Pension', 30, 0, 65, 0,
                    undefined, undefined,
                    true, 'work1'
                );

                const previousSimulation: SimulationYear[] = [
                    createSimulationYear(2022, [createWorkIncome('work1', 'Fed Job', 100000)]),
                    createSimulationYear(2023, [createWorkIncome('work1', 'Fed Job', 100000)]),
                    createSimulationYear(2024, [createWorkIncome('work1', 'Fed Job', 100000)]),
                ];

                const assumptions = createTestAssumptions({ birthYear: 1960, retirementAge: 65 });
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [workIncome, csrsPension],
                    [],
                    assumptions,
                    previousSimulation,
                    65,
                    true,
                    logs
                );

                const updatedCsrs = result.nextIncomes.find(inc => inc.id === 'csrs1') as CSRSPensionIncome;
                // 30 years with $100k High-3:
                // 5 * 1.5% = 7.5%
                // 5 * 1.75% = 8.75%
                // 20 * 2% = 40%
                // Total = 56.25% = $56,250
                expect(updatedCsrs.calculatedBenefit).toBeCloseTo(56250, -2);
            });

            it('should cap at 80% of High-3', () => {
                // 41+ years would exceed 80%, so it should be capped
                const workIncome = createWorkIncome('work1', 'Fed Job', 100000, { pensionSystem: 'CSRS' });
                const csrsPension = new CSRSPensionIncome(
                    'csrs1', 'CSRS Pension', 45, 0, 65, 0,
                    undefined, undefined,
                    true, 'work1'
                );

                const previousSimulation: SimulationYear[] = [
                    createSimulationYear(2022, [createWorkIncome('work1', 'Fed Job', 100000)]),
                    createSimulationYear(2023, [createWorkIncome('work1', 'Fed Job', 100000)]),
                    createSimulationYear(2024, [createWorkIncome('work1', 'Fed Job', 100000)]),
                ];

                const assumptions = createTestAssumptions({ birthYear: 1960, retirementAge: 65 });
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [workIncome, csrsPension],
                    [],
                    assumptions,
                    previousSimulation,
                    65,
                    true,
                    logs
                );

                const updatedCsrs = result.nextIncomes.find(inc => inc.id === 'csrs1') as CSRSPensionIncome;
                // Should be capped at 80% of $100k = $80,000
                expect(updatedCsrs.calculatedBenefit).toBeLessThanOrEqual(80000);
            });
        });

        describe('Social Security calculation', () => {
            it('should calculate benefits at claiming age', () => {
                const ssIncome = new FutureSocialSecurityIncome(
                    'ss1', 'Social Security', 67, 0, 0 // Claiming at 67, not yet calculated
                );

                // Need to provide earnings history via previousSimulation
                const previousSimulation: SimulationYear[] = [];
                for (let year = 2000; year <= 2031; year++) {
                    previousSimulation.push(createSimulationYear(year, [
                        createWorkIncome('work1', 'Job', 60000)
                    ]));
                }

                const assumptions = createTestAssumptions({
                    birthYear: 1965,
                    retirementAge: 67,
                    socialSecurityFundingPercent: 100
                });
                const logs: string[] = [];

                const result = projectIncomes(
                    2032, // Year when person turns 67
                    [ssIncome],
                    [],
                    assumptions,
                    previousSimulation,
                    67, // currentAge = claimingAge
                    true,
                    logs
                );

                const updatedSS = result.nextIncomes.find(inc => inc.id === 'ss1') as FutureSocialSecurityIncome;
                // Should have calculated a benefit
                expect(updatedSS.calculatedPIA).toBeGreaterThan(0);
                expect(logs.some(l => l.includes('Social Security PIA calculated'))).toBe(true);
            });

            it('should apply funding percentage', () => {
                const ssIncome = new FutureSocialSecurityIncome(
                    'ss1', 'Social Security', 67, 0, 0
                );

                const previousSimulation: SimulationYear[] = [];
                for (let year = 2000; year <= 2031; year++) {
                    previousSimulation.push(createSimulationYear(year, [
                        createWorkIncome('work1', 'Job', 60000)
                    ]));
                }

                // 75% funding (pessimistic about SS solvency)
                const assumptions = createTestAssumptions({
                    birthYear: 1965,
                    retirementAge: 67,
                    socialSecurityFundingPercent: 75
                });
                const logs: string[] = [];

                projectIncomes(
                    2032,
                    [ssIncome],
                    [],
                    assumptions,
                    previousSimulation,
                    67,
                    true,
                    logs
                );

                // Benefit should be reduced by 25%
                expect(logs.some(l => l.includes('75%') || l.includes('Funding'))).toBe(true);
            });

            it('should set correct end date based on life expectancy', () => {
                const ssIncome = new FutureSocialSecurityIncome(
                    'ss1', 'Social Security', 67, 0, 0
                );

                const previousSimulation: SimulationYear[] = [];
                for (let year = 2000; year <= 2031; year++) {
                    previousSimulation.push(createSimulationYear(year, [
                        createWorkIncome('work1', 'Job', 60000)
                    ]));
                }

                const assumptions = createTestAssumptions({
                    birthYear: 1965,
                    retirementAge: 67,
                    lifeExpectancy: 90
                });
                const logs: string[] = [];

                const result = projectIncomes(
                    2032,
                    [ssIncome],
                    [],
                    assumptions,
                    previousSimulation,
                    67,
                    true,
                    logs
                );

                const updatedSS = result.nextIncomes.find(inc => inc.id === 'ss1') as FutureSocialSecurityIncome;
                // End date should be Dec 31 of life expectancy year (1965 + 90 = 2055)
                expect(updatedSS.end_date?.getFullYear()).toBe(2055);
            });
        });

        describe('Earnings Test', () => {
            it('should apply earnings test before FRA', () => {
                // Person claiming SS at 62 but still working
                const ssIncome = new FutureSocialSecurityIncome(
                    'ss1', 'Social Security', 62, 2000, 2027, // $2000/month calculated
                    new Date('2027-01-01'), new Date('2050-12-31')
                );
                const workIncome = createWorkIncome('work1', 'Part-time Job', 50000);

                const assumptions = createTestAssumptions({
                    birthYear: 1965, // FRA = 67
                    retirementAge: 62
                });
                const logs: string[] = [];

                projectIncomes(
                    2028,
                    [ssIncome, workIncome],
                    [],
                    assumptions,
                    [],
                    63, // Still before FRA (67)
                    false,
                    logs
                );

                // Earnings test should have been applied (person earning $50k while collecting SS)
                expect(logs.some(l => l.includes('Earnings test') || l.includes('withheld'))).toBe(true);
            });

            it('should not apply earnings test at or after FRA', () => {
                // Person at FRA collecting SS and working
                const ssIncome = new FutureSocialSecurityIncome(
                    'ss1', 'Social Security', 67, 2500, 2032,
                    new Date('2032-01-01'), new Date('2055-12-31')
                );
                const workIncome = createWorkIncome('work1', 'Part-time Job', 50000);

                const assumptions = createTestAssumptions({
                    birthYear: 1965, // FRA = 67
                    retirementAge: 67
                });
                const logs: string[] = [];

                projectIncomes(
                    2033,
                    [ssIncome, workIncome],
                    [],
                    assumptions,
                    [],
                    68, // At or after FRA
                    false,
                    logs
                );

                // Should NOT have earnings test warning
                expect(logs.some(l => l.includes('Earnings test'))).toBe(false);
            });
        });

        describe('Interest Income', () => {
            it('should generate interest income from savings accounts', () => {
                const savingsAccount = new SavedAccount('sav1', 'HYSA', 100000, 5); // 5% APR
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [],
                    [savingsAccount],
                    assumptions,
                    [],
                    35,
                    false,
                    logs
                );

                expect(result.interestIncomes).toHaveLength(1);
                const interest = result.interestIncomes[0];
                expect(interest.amount).toBe(5000); // $100k * 5% = $5000
                expect(interest.sourceType).toBe('Interest');
            });

            it('should skip accounts with zero APR', () => {
                const checkingAccount = new SavedAccount('chk1', 'Checking', 10000, 0); // 0% APR
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [],
                    [checkingAccount],
                    assumptions,
                    [],
                    35,
                    false,
                    logs
                );

                expect(result.interestIncomes).toHaveLength(0);
            });

            it('should skip accounts with zero balance', () => {
                const emptyAccount = new SavedAccount('sav1', 'Empty HYSA', 0, 5);
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [],
                    [emptyAccount],
                    assumptions,
                    [],
                    35,
                    false,
                    logs
                );

                expect(result.interestIncomes).toHaveLength(0);
            });

            it('should mark interest as reinvested', () => {
                const savingsAccount = new SavedAccount('sav1', 'HYSA', 100000, 5);
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [],
                    [savingsAccount],
                    assumptions,
                    [],
                    35,
                    false,
                    logs
                );

                const interest = result.interestIncomes[0];
                expect(interest.isReinvested).toBe(true);
            });

            it('should construct interest dates locally so it is active the full calendar year', () => {
                // Income date-only values follow the repo-wide LOCAL convention
                // (parseDate builds new Date(y, m-1, d)), and getIncomeActiveMultiplier
                // now reads them with local accessors. Interest income is therefore
                // built with local new Date(year, 0, 1) / new Date(year, 11, 31), which
                // reads back as the same calendar year and yields a clean full-year
                // active window (multiplier 1.0) in ANY timezone.
                const year = 2025;
                const savingsAccount = new SavedAccount('sav1', 'HYSA', 100000, 5);
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = projectIncomes(
                    year,
                    [],
                    [savingsAccount],
                    assumptions,
                    [],
                    35,
                    false,
                    logs
                );

                const interest = result.interestIncomes[0];
                // Dates must read as the intended calendar year with LOCAL accessors.
                expect(interest.startDate?.getFullYear()).toBe(year);
                expect(interest.startDate?.getMonth()).toBe(0);
                expect(interest.end_date?.getFullYear()).toBe(year);
                expect(interest.end_date?.getMonth()).toBe(11);

                // The whole point: the consumer must see a clean full-year window.
                expect(getIncomeActiveMultiplier(interest, year)).toBe(1.0);
            });

            it('should include interest in allIncomes', () => {
                const workIncome = createWorkIncome('work1', 'Salary', 100000);
                const savingsAccount = new SavedAccount('sav1', 'HYSA', 50000, 4);
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [workIncome],
                    [savingsAccount],
                    assumptions,
                    [],
                    35,
                    false,
                    logs
                );

                // allIncomes should include both regular incomes and interest
                expect(result.allIncomes.length).toBe(result.nextIncomes.length + result.interestIncomes.length);
            });
        });

        describe('edge cases', () => {
            it('should handle empty income list', () => {
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [],
                    [],
                    assumptions,
                    [],
                    35,
                    false,
                    logs
                );

                expect(result.nextIncomes).toHaveLength(0);
                expect(result.interestIncomes).toHaveLength(0);
                expect(result.allIncomes).toHaveLength(0);
            });

            it('should handle missing linked income for FERS pension', () => {
                // FERS pension with linkedIncomeId that doesn't exist
                const fersPension = new FERSPensionIncome(
                    'fers1', 'FERS Pension', 30, 0, 65, 1960, 0, 0, 0,
                    undefined, undefined,
                    true, 'nonexistent-income-id'
                );

                const assumptions = createTestAssumptions({ birthYear: 1960, retirementAge: 65 });
                const logs: string[] = [];

                // Should not throw, just not calculate the pension
                const result = projectIncomes(
                    2025,
                    [fersPension],
                    [],
                    assumptions,
                    [],
                    65,
                    true,
                    logs
                );

                const updatedFers = result.nextIncomes.find(inc => inc.id === 'fers1') as FERSPensionIncome;
                // Pension should not be calculated (no High-3 available)
                expect(updatedFers.calculatedBenefit).toBe(0);
            });

            it('should handle non-savings accounts gracefully', () => {
                // Only SavedAccounts generate interest, others should be ignored
                const investedAccount = new InvestedAccount('inv1', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');
                const assumptions = createTestAssumptions();
                const logs: string[] = [];

                const result = projectIncomes(
                    2025,
                    [],
                    [investedAccount],
                    assumptions,
                    [],
                    35,
                    false,
                    logs
                );

                // No interest generated from InvestedAccount
                expect(result.interestIncomes).toHaveLength(0);
            });
        });
    });
});
