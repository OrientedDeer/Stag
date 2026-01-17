/**
 * Simulation Test Utilities
 *
 * Helper functions for integration tests that validate the simulation engine
 * across realistic multi-decade scenarios.
 */

import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { AnyAccount, InvestedAccount, SavedAccount, PropertyAccount, DebtAccount, DeficitDebtAccount } from '../../../components/Objects/Accounts/models';
import { AnyExpense } from '../../../components/Objects/Expense/models';
import { AnyIncome, WorkIncome, FutureSocialSecurityIncome } from '../../../components/Objects/Income/models';

/**
 * Calculate age for a given simulation year
 */
export function getAge(year: number, birthYear: number): number {
    return year - birthYear;
}

/**
 * Calculate total net worth from all accounts
 * Property equity = value - loanAmount
 * Debt is negative
 */
export function calculateNetWorth(accounts: AnyAccount[]): number {
    let netWorth = 0;

    for (const acc of accounts) {
        if (acc instanceof PropertyAccount) {
            // Property equity: value - remaining loan
            netWorth += acc.amount - acc.loanAmount;
        } else if (acc instanceof DebtAccount || acc instanceof DeficitDebtAccount) {
            // Debt is negative
            netWorth -= acc.amount;
        } else if (acc instanceof InvestedAccount || acc instanceof SavedAccount) {
            netWorth += acc.amount;
        }
    }

    return netWorth;
}

/**
 * Calculate total liquid assets (Cash + Invested, excluding property and debt)
 */
export function calculateLiquidAssets(accounts: AnyAccount[]): number {
    return accounts
        .filter(acc => acc instanceof InvestedAccount || acc instanceof SavedAccount)
        .reduce((sum, acc) => sum + acc.amount, 0);
}

/**
 * Get total discretionary expenses for a year
 */
export function getTotalDiscretionary(expenses: AnyExpense[], year: number): number {
    return expenses
        .filter(exp => exp.isDiscretionary)
        .reduce((sum, exp) => sum + exp.getAnnualAmount(year), 0);
}

/**
 * Get total non-discretionary expenses for a year
 */
export function getTotalNonDiscretionary(expenses: AnyExpense[], year: number): number {
    return expenses
        .filter(exp => !exp.isDiscretionary)
        .reduce((sum, exp) => sum + exp.getAnnualAmount(year), 0);
}

/**
 * Get a simulation year by age
 */
export function getYearByAge(
    simulation: SimulationYear[],
    age: number,
    birthYear: number
): SimulationYear | undefined {
    const targetYear = birthYear + age;
    return simulation.find(y => y.year === targetYear);
}

/**
 * Get simulation year by calendar year
 */
export function getYearByCalendarYear(
    simulation: SimulationYear[],
    calendarYear: number
): SimulationYear | undefined {
    return simulation.find(y => y.year === calendarYear);
}

/**
 * Get account by ID from a simulation year
 */
export function getAccountById(year: SimulationYear, accountId: string): AnyAccount | undefined {
    return year.accounts.find(acc => acc.id === accountId);
}

/**
 * Get account by name from a simulation year
 */
export function getAccountByName(year: SimulationYear, accountName: string): AnyAccount | undefined {
    return year.accounts.find(acc => acc.name === accountName);
}

/**
 * Get income by ID from a simulation year
 */
export function getIncomeById(year: SimulationYear, incomeId: string): AnyIncome | undefined {
    return year.incomes.find(inc => inc.id === incomeId);
}

/**
 * Get work income from a simulation year
 */
export function getWorkIncome(year: SimulationYear): WorkIncome | undefined {
    return year.incomes.find(inc => inc instanceof WorkIncome) as WorkIncome | undefined;
}

/**
 * Get Social Security income from a simulation year
 */
export function getSocialSecurityIncome(year: SimulationYear): FutureSocialSecurityIncome | undefined {
    return year.incomes.find(inc => inc instanceof FutureSocialSecurityIncome) as FutureSocialSecurityIncome | undefined;
}

/**
 * Get total income for a year (all sources)
 */
export function getTotalIncome(year: SimulationYear): number {
    return year.cashflow.totalIncome;
}

/**
 * Get total withdrawals for a year
 */
export function getTotalWithdrawals(year: SimulationYear): number {
    return year.cashflow.withdrawals;
}

/**
 * Get total invested account balance
 */
export function getTotalInvestedBalance(accounts: AnyAccount[]): number {
    return accounts
        .filter(acc => acc instanceof InvestedAccount)
        .reduce((sum, acc) => sum + acc.amount, 0);
}

/**
 * Get accounts by tax type
 */
export function getAccountsByTaxType(accounts: AnyAccount[], taxType: string): InvestedAccount[] {
    return accounts.filter(
        acc => acc instanceof InvestedAccount && acc.taxType === taxType
    ) as InvestedAccount[];
}

/**
 * Check if simulation year is in retirement (age >= retirementAge)
 */
export function isRetirementYear(
    year: SimulationYear,
    birthYear: number,
    retirementAge: number
): boolean {
    const age = getAge(year.year, birthYear);
    return age >= retirementAge;
}

/**
 * Get the retirement year from simulation
 */
export function getRetirementYear(
    simulation: SimulationYear[],
    birthYear: number,
    retirementAge: number
): SimulationYear | undefined {
    return getYearByAge(simulation, retirementAge, birthYear);
}

/**
 * Calculate effective tax rate for a year
 */
export function getEffectiveTaxRate(year: SimulationYear): number {
    const totalTax = year.taxDetails.fed + year.taxDetails.state + year.taxDetails.fica;
    const totalIncome = year.cashflow.totalIncome;
    return totalIncome > 0 ? totalTax / totalIncome : 0;
}

/**
 * Check if a log message exists in a simulation year
 */
export function hasLogMessage(year: SimulationYear, substring: string): boolean {
    return year.logs.some(log => log.toLowerCase().includes(substring.toLowerCase()));
}

/**
 * Get years where a specific condition is met
 */
export function getYearsWhere(
    simulation: SimulationYear[],
    predicate: (year: SimulationYear) => boolean
): SimulationYear[] {
    return simulation.filter(predicate);
}

/**
 * Check if account balances are monotonically increasing (each year >= previous)
 */
export function isMonotonicallyIncreasing(
    simulation: SimulationYear[],
    accountId: string
): boolean {
    let prevBalance = -Infinity;

    for (const year of simulation) {
        const account = getAccountById(year, accountId);
        if (!account) continue;

        if (account.amount < prevBalance) {
            return false;
        }
        prevBalance = account.amount;
    }

    return true;
}

/**
 * Check if account balances are monotonically decreasing (each year <= previous)
 */
export function isMonotonicallyDecreasing(
    simulation: SimulationYear[],
    accountId: string
): boolean {
    let prevBalance = Infinity;

    for (const year of simulation) {
        const account = getAccountById(year, accountId);
        if (!account) continue;

        if (account.amount > prevBalance) {
            return false;
        }
        prevBalance = account.amount;
    }

    return true;
}
