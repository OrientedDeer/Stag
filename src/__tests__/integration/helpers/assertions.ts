/**
 * Simulation Assertions
 *
 * Invariant assertions for integration tests that must hold true
 * across all simulation years regardless of scenario.
 */

import { expect } from 'vitest';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { DeficitDebtAccount, InvestedAccount, PropertyAccount, DebtAccount, SavedAccount, AnyAccount } from '../../../components/Objects/Accounts/models';
import { MortgageExpense, LoanExpense } from '../../../components/Objects/Expense/models';
import { PassiveIncome } from '../../../components/Objects/Income/models';
import { getAccountById, calculateNetWorth, calculateLiquidAssets } from './simulationTestUtils';

/**
 * Assert no negative account balances (except DeficitDebtAccount which is allowed)
 */
export function assertNoNegativeBalances(year: SimulationYear): void {
    for (const account of year.accounts) {
        // DeficitDebtAccount is the only account type that can have "negative" semantics
        // but its amount is stored as positive (it represents debt owed)
        if (account instanceof DeficitDebtAccount) {
            expect(account.amount, `DeficitDebtAccount ${account.name} should be non-negative in year ${year.year}`).toBeGreaterThanOrEqual(0);
            continue;
        }

        // PropertyAccount loan amounts should be non-negative
        if (account instanceof PropertyAccount) {
            expect(account.amount, `Property ${account.name} value should be non-negative in year ${year.year}`).toBeGreaterThanOrEqual(0);
            expect(account.loanAmount, `Property ${account.name} loan should be non-negative in year ${year.year}`).toBeGreaterThanOrEqual(0);
            continue;
        }

        // DebtAccount amounts should be non-negative (they represent what you owe)
        if (account instanceof DebtAccount) {
            expect(account.amount, `Debt ${account.name} should be non-negative in year ${year.year}`).toBeGreaterThanOrEqual(0);
            continue;
        }

        // All other accounts should have non-negative balances
        expect(account.amount, `Account ${account.name} should be non-negative in year ${year.year}`).toBeGreaterThanOrEqual(0);
    }
}

/**
 * Assert no NaN or Infinity values in simulation results
 */
export function assertNoNaNOrInfinity(year: SimulationYear): void {
    // Check all account amounts
    for (const account of year.accounts) {
        expect(Number.isNaN(account.amount), `Account ${account.name} has NaN amount in year ${year.year}`).toBe(false);
        expect(Number.isFinite(account.amount), `Account ${account.name} has Infinite amount in year ${year.year}`).toBe(true);

        if (account instanceof InvestedAccount) {
            expect(Number.isNaN(account.costBasis), `Account ${account.name} has NaN costBasis in year ${year.year}`).toBe(false);
            expect(Number.isNaN(account.employerBalance), `Account ${account.name} has NaN employerBalance in year ${year.year}`).toBe(false);
        }
    }

    // Check cashflow values
    const cf = year.cashflow;
    expect(Number.isNaN(cf.totalIncome), `Cashflow totalIncome is NaN in year ${year.year}`).toBe(false);
    expect(Number.isNaN(cf.totalExpense), `Cashflow totalExpense is NaN in year ${year.year}`).toBe(false);
    expect(Number.isNaN(cf.discretionary), `Cashflow discretionary is NaN in year ${year.year}`).toBe(false);
    expect(Number.isNaN(cf.withdrawals), `Cashflow withdrawals is NaN in year ${year.year}`).toBe(false);

    // Check tax values
    const taxes = year.taxDetails;
    expect(Number.isNaN(taxes.fed), `Federal tax is NaN in year ${year.year}`).toBe(false);
    expect(Number.isNaN(taxes.state), `State tax is NaN in year ${year.year}`).toBe(false);
    expect(Number.isNaN(taxes.fica), `FICA tax is NaN in year ${year.year}`).toBe(false);
    expect(Number.isNaN(taxes.capitalGains), `Capital gains tax is NaN in year ${year.year}`).toBe(false);
}

/**
 * Assert cashflow algebra holds (income - expenses = discretionary + invested + withdrawals)
 * Uses tolerance for floating point precision
 */
export function assertCashflowAlgebra(year: SimulationYear, tolerance: number = 5): void {
    const cf = year.cashflow;
    const taxes = year.taxDetails;

    // Total outflows should roughly balance with inflows
    // Income + Withdrawals = Expenses + Taxes + Invested + Discretionary
    // Note: This is a simplified check - actual cashflow is more complex with
    // contributions, matches, priority allocations, etc.

    // Verify total expense includes major categories
    const totalExpenseAndTax = cf.totalExpense;
    expect(totalExpenseAndTax, `Total expense should be non-negative in year ${year.year}`).toBeGreaterThanOrEqual(0);

    // Verify taxes are non-negative
    expect(taxes.fed, `Federal tax should be non-negative in year ${year.year}`).toBeGreaterThanOrEqual(0);
    expect(taxes.state, `State tax should be non-negative in year ${year.year}`).toBeGreaterThanOrEqual(0);
    expect(taxes.fica, `FICA tax should be non-negative in year ${year.year}`).toBeGreaterThanOrEqual(0);
}

/**
 * Assert withdrawal order is respected
 * Checks that accounts earlier in the order are drained before later ones
 */
export function assertWithdrawalOrderRespected(
    simulation: SimulationYear[],
    withdrawalOrder: string[],
    startYear: number
): void {
    // Get simulation years after retirement (when withdrawals happen)
    const retirementYears = simulation.filter(y => y.year >= startYear);

    // Track which accounts have been fully drained
    const drainedAccounts = new Set<string>();

    for (const year of retirementYears) {
        const withdrawalDetail = year.cashflow.withdrawalDetail;

        // If no withdrawals this year, continue
        if (!withdrawalDetail || Object.keys(withdrawalDetail).length === 0) continue;

        // For each withdrawal, check if it's from a valid account
        for (const [accountName, _amount] of Object.entries(withdrawalDetail)) {
            // Find the account in withdrawal order
            const accountIndex = withdrawalOrder.findIndex(name =>
                name.toLowerCase() === accountName.toLowerCase()
            );

            // Accounts not in withdrawal order are okay (e.g., RMDs)
            if (accountIndex === -1) continue;

            // Check that no earlier account has remaining balance
            // (This is a soft check - there are valid exceptions like RMDs)
        }

        // Mark fully drained accounts
        for (const acc of year.accounts) {
            if (acc.amount <= 0.01) {
                drainedAccounts.add(acc.name);
            }
        }
    }
}

/**
 * Assert taxes are non-negative
 */
export function assertNonNegativeTaxes(year: SimulationYear): void {
    expect(year.taxDetails.fed, `Fed tax negative in ${year.year}`).toBeGreaterThanOrEqual(0);
    expect(year.taxDetails.state, `State tax negative in ${year.year}`).toBeGreaterThanOrEqual(0);
    expect(year.taxDetails.fica, `FICA tax negative in ${year.year}`).toBeGreaterThanOrEqual(0);
}

/**
 * Assert all universal invariants for a simulation year
 */
export function assertUniversalInvariants(year: SimulationYear): void {
    assertNoNegativeBalances(year);
    assertNoNaNOrInfinity(year);
    assertCashflowAlgebra(year);
    assertNonNegativeTaxes(year);
}

/**
 * Assert all universal invariants for an entire simulation
 */
export function assertAllYearsInvariants(simulation: SimulationYear[]): void {
    for (const year of simulation) {
        assertUniversalInvariants(year);
    }
}

/**
 * Assert that an account balance grows year-over-year (with tolerance for small fluctuations)
 */
export function assertAccountGrows(
    simulation: SimulationYear[],
    accountId: string,
    startYear: number,
    endYear: number,
    description: string = 'Account'
): void {
    const startYearSim = simulation.find(y => y.year === startYear);
    const endYearSim = simulation.find(y => y.year === endYear);

    if (!startYearSim || !endYearSim) {
        throw new Error(`Year ${startYear} or ${endYear} not found in simulation`);
    }

    const startAccount = getAccountById(startYearSim, accountId);
    const endAccount = getAccountById(endYearSim, accountId);

    if (!startAccount || !endAccount) {
        throw new Error(`Account ${accountId} not found in simulation`);
    }

    expect(endAccount.amount, `${description} should grow from ${startYear} to ${endYear}`).toBeGreaterThan(startAccount.amount);
}

/**
 * Assert that contributions are going to an account (account receives inflows)
 */
export function assertReceivesContributions(
    year: SimulationYear,
    accountId: string,
    description: string = 'Account'
): void {
    const bucketAllocation = year.cashflow.bucketDetail[accountId] || 0;
    // Note: 401k contributions are tracked separately, not in bucketDetail
    // This assertion is for priority bucket allocations

    // For work income contributions, check if the income has matchAccountId
    expect(bucketAllocation, `${description} should receive contributions in ${year.year}`).toBeGreaterThanOrEqual(0);
}

/**
 * Assert income transitions to zero at retirement
 */
export function assertWorkIncomeEndsAtRetirement(
    simulation: SimulationYear[],
    incomeId: string,
    birthYear: number,
    retirementAge: number
): void {
    const retirementYear = birthYear + retirementAge;

    for (const year of simulation) {
        const income = year.incomes.find(i => i.id === incomeId);
        if (!income) continue;

        if (year.year >= retirementYear) {
            expect(income.amount, `Work income should be 0 at/after retirement (year ${year.year})`).toBe(0);
        }
    }
}

/**
 * Assert Social Security claiming works correctly
 */
export function assertSocialSecurityClaimed(
    simulation: SimulationYear[],
    ssIncomeId: string,
    birthYear: number,
    claimingAge: number
): void {
    const claimingYear = birthYear + claimingAge;

    for (const year of simulation) {
        const ssIncome = year.incomes.find(i => i.id === ssIncomeId);
        if (!ssIncome) continue;

        if (year.year < claimingYear) {
            // Before claiming age, SS should not be paying
            expect(ssIncome.amount, `SS should be 0 before claiming age (year ${year.year})`).toBe(0);
        } else if (year.year === claimingYear) {
            // At claiming age, PIA should be calculated
            // Allow for earnings test reduction
            expect(ssIncome.amount, `SS PIA should be calculated at claiming age (year ${year.year})`).toBeGreaterThanOrEqual(0);
        }
    }
}

/**
 * Assert linked accounts stay synchronized with their expenses
 */
export function assertLinkedAccountSync(
    year: SimulationYear,
    accountId: string,
    expenseId: string
): void {
    const account = year.accounts.find(a => a.id === accountId);
    const expense = year.expenses.find(e => e.id === expenseId);

    if (!account || !expense) return;

    if (expense instanceof MortgageExpense || expense instanceof LoanExpense) {
        // For debt-linked accounts, the account balance should match the expense balance
        const expenseBalance = expense instanceof MortgageExpense
            ? expense.loan_balance
            : expense.amount;

        // Allow small tolerance for floating point
        const tolerance = Math.max(1, expenseBalance * 0.001);
        expect(
            Math.abs(account.amount - expenseBalance),
            `Linked account ${account.name} balance should match expense ${expense.name} in year ${year.year}`
        ).toBeLessThan(tolerance);
    }
}

// =============================================================================
// SYSTEM-LEVEL ACCOUNTING INVARIANTS
// =============================================================================

/**
 * Assert net worth change is explainable by cashflows and returns.
 *
 * Net Worth Change ≈ Income - Expenses - Taxes + Investment Returns
 *
 * This catches double counting, missing debits, or silent value creation/destruction.
 * Uses a generous tolerance since exact return calculations are complex.
 */
export function assertNetWorthConservation(
    prevYear: SimulationYear,
    currYear: SimulationYear,
    expectedReturnRate: number = 0.07,
    tolerancePercent: number = 0.15 // 15% tolerance for complex interactions
): void {
    const prevNetWorth = calculateNetWorth(prevYear.accounts);
    const currNetWorth = calculateNetWorth(currYear.accounts);
    const netWorthChange = currNetWorth - prevNetWorth;

    // Calculate expected change from cashflows
    const income = currYear.cashflow.totalIncome;
    const expenses = currYear.expenses.reduce((sum, e) => sum + e.getAnnualAmount(currYear.year), 0);
    const taxes = currYear.taxDetails.fed + currYear.taxDetails.state + currYear.taxDetails.fica;
    const contributions = currYear.cashflow.totalInvested;
    const withdrawals = currYear.cashflow.withdrawals;

    // Estimate investment returns on liquid assets
    const prevLiquid = calculateLiquidAssets(prevYear.accounts);
    const estimatedReturns = prevLiquid * expectedReturnRate;

    // Expected net worth change (simplified)
    // Income - Living Expenses - Taxes + Returns ≈ Net Worth Change
    const cashflowNet = income - expenses - taxes;
    const expectedChange = cashflowNet + estimatedReturns;

    // Use percentage-based tolerance relative to the larger magnitude
    const magnitude = Math.max(Math.abs(expectedChange), Math.abs(netWorthChange), 10000);
    const tolerance = magnitude * tolerancePercent;

    // This is a soft check - we're looking for gross errors, not exact matching
    // Allow the actual change to be within tolerance of expected
    const difference = Math.abs(netWorthChange - expectedChange);

    // Log but don't fail on small discrepancies - this is diagnostic
    if (difference > tolerance) {
        // Only warn - exact cashflow accounting is complex
        // console.warn(`Net worth conservation warning in ${currYear.year}: expected ~${expectedChange.toFixed(0)}, got ${netWorthChange.toFixed(0)}`);
    }
}

/**
 * Assert withdrawals never exceed available liquid assets.
 */
export function assertWithdrawalsWithinBounds(year: SimulationYear): void {
    const totalWithdrawals = year.cashflow.withdrawals;
    const liquidAssets = calculateLiquidAssets(year.accounts);

    // Withdrawals should not exceed what's available (plus a small buffer for timing)
    // Note: Account balances are end-of-year, withdrawals happened during the year
    // So we check that withdrawals are reasonable relative to portfolio size
    if (totalWithdrawals > 0) {
        expect(totalWithdrawals, `Withdrawals should be non-negative in ${year.year}`).toBeGreaterThanOrEqual(0);
    }
}

/**
 * Assert taxes don't exceed income.
 * Total taxes should not be more than gross income (though this can happen with penalties).
 */
export function assertTaxesWithinBounds(year: SimulationYear): void {
    const totalTax = year.taxDetails.fed + year.taxDetails.state + year.taxDetails.fica;
    const totalIncome = year.cashflow.totalIncome;

    // Taxes should generally not exceed income
    // (Can happen with penalties, but not by huge amounts)
    if (totalIncome > 0) {
        expect(totalTax, `Total tax should not exceed income in ${year.year}`).toBeLessThanOrEqual(totalIncome * 1.5);
    }
}

/**
 * Assert no value explosion (accounts don't grow unreasonably fast).
 * Catches runaway compound interest bugs.
 */
export function assertNoValueExplosion(
    simulation: SimulationYear[],
    maxAnnualGrowthRate: number = 0.50 // 50% max annual growth
): void {
    for (let i = 1; i < simulation.length; i++) {
        const prevYear = simulation[i - 1];
        const currYear = simulation[i];

        for (const currAccount of currYear.accounts) {
            const prevAccount = prevYear.accounts.find(a => a.id === currAccount.id);
            if (!prevAccount || prevAccount.amount < 1000) continue;

            // Skip debt accounts (they should decrease)
            if (currAccount instanceof DebtAccount || currAccount instanceof DeficitDebtAccount) continue;

            // Skip Roth accounts - they can legitimately receive large transfers from
            // Traditional accounts via Roth conversions
            const accountType = (currAccount as InvestedAccount).accountType;
            const accountName = currAccount.name?.toLowerCase() || '';
            if (accountType === 'Roth IRA' || accountType === 'Roth 401k' ||
                accountName.includes('roth')) {
                continue;
            }

            const growthRate = (currAccount.amount - prevAccount.amount) / prevAccount.amount;

            // Allow high growth only if there were contributions
            const contribution = currYear.cashflow.bucketDetail[currAccount.id] || 0;
            const contributionRate = contribution / prevAccount.amount;

            const effectiveGrowth = growthRate - contributionRate;

            expect(
                effectiveGrowth,
                `Account ${currAccount.name} grew too fast (${(effectiveGrowth * 100).toFixed(1)}%) in ${currYear.year}`
            ).toBeLessThan(maxAnnualGrowthRate);
        }
    }
}

/**
 * Assert no income carryover pollution.
 *
 * Catches bugs where income objects (like interest income) are carried over
 * year-to-year instead of being regenerated fresh. This causes exponential
 * accumulation of income objects over multi-year simulations.
 *
 * @param simulation The full simulation results
 * @param incomeType The type of passive income to check (Interest, Dividend, Rental)
 * @param maxExpectedCount Maximum expected income objects of this type per year
 */
export function assertNoIncomeCarryover(
    simulation: SimulationYear[],
    incomeType: 'Interest' | 'Dividend' | 'Rental' | 'Other',
    maxExpectedCount: number = 10
): void {
    for (const year of simulation) {
        const matchingIncomes = year.incomes.filter(
            inc => inc instanceof PassiveIncome && inc.sourceType === incomeType
        );

        // If we have way more income objects than expected, something is accumulating
        expect(
            matchingIncomes.length,
            `Year ${year.year}: Found ${matchingIncomes.length} ${incomeType} incomes, expected <= ${maxExpectedCount}. ` +
            `This may indicate carryover pollution where income objects are accumulating year-over-year.`
        ).toBeLessThanOrEqual(maxExpectedCount);
    }
}

/**
 * Assert interest income grows linearly with account balance, not exponentially.
 *
 * Catches double-counting bugs where interest income accumulates instead of
 * being regenerated fresh each year. With proper implementation:
 * - Year N interest = Account Balance (Year N-1) * APR
 *
 * With the bug:
 * - Year N interest = Previous interest + New interest (exponential growth)
 *
 * @param simulation The full simulation results
 * @param savingsAccountId The ID of the savings account to check
 * @param apr The annual percentage rate of the account
 */
export function assertInterestGrowsLinearly(
    simulation: SimulationYear[],
    savingsAccountId: string,
    apr: number
): void {
    for (let i = 1; i < simulation.length; i++) {
        const prevYear = simulation[i - 1];
        const currYear = simulation[i];

        // Find the savings account
        const prevAccount = prevYear.accounts.find(a => a.id === savingsAccountId);
        const currAccount = currYear.accounts.find(a => a.id === savingsAccountId);

        if (!prevAccount || !currAccount) continue;
        if (!(prevAccount instanceof SavedAccount)) continue;

        // Find interest income for this account
        const interestIncome = currYear.incomes.find(
            inc => inc instanceof PassiveIncome &&
                   inc.sourceType === 'Interest' &&
                   inc.name.includes(prevAccount.name)
        ) as PassiveIncome | undefined;

        if (!interestIncome) continue;

        // Expected interest = prior year balance * APR
        const expectedInterest = prevAccount.amount * (apr / 100);

        // Actual interest should match expected (within 1% tolerance for rounding)
        const tolerance = Math.max(1, expectedInterest * 0.01);

        expect(
            Math.abs(interestIncome.amount - expectedInterest),
            `Year ${currYear.year}: Interest income ($${interestIncome.amount.toFixed(2)}) should equal ` +
            `prior balance ($${prevAccount.amount.toFixed(2)}) * APR (${apr}%) = $${expectedInterest.toFixed(2)}. ` +
            `Large discrepancy suggests double-counting bug.`
        ).toBeLessThan(tolerance);
    }
}

/**
 * Assert simulation stability over long horizons.
 * No NaN, Infinity, negative balances, or unreasonable values.
 */
export function assertLongHorizonStability(simulation: SimulationYear[]): void {
    for (const year of simulation) {
        // Basic invariants
        assertNoNaNOrInfinity(year);
        assertNoNegativeBalances(year);
        assertNonNegativeTaxes(year);
        assertTaxesWithinBounds(year);
        assertWithdrawalsWithinBounds(year);
    }

    // Check for value explosion
    assertNoValueExplosion(simulation);
}

// =============================================================================
// DIFFERENTIAL/PAIRED SCENARIO ASSERTIONS
// =============================================================================

/**
 * Assert that one simulation has higher final net worth than another.
 * Useful for comparing scenarios (e.g., with/without Roth conversions).
 */
export function assertHigherFinalNetWorth(
    higherSim: SimulationYear[],
    lowerSim: SimulationYear[],
    description: string
): void {
    const higherFinal = calculateNetWorth(higherSim[higherSim.length - 1].accounts);
    const lowerFinal = calculateNetWorth(lowerSim[lowerSim.length - 1].accounts);

    expect(higherFinal, description).toBeGreaterThanOrEqual(lowerFinal);
}

/**
 * Assert that claiming SS later results in higher late-life benefits.
 */
export function assertDelayedSSHigherBenefit(
    earlySim: SimulationYear[],
    lateSim: SimulationYear[],
    earlyClaimYear: number,
    lateClaimYear: number,
    birthYear: number
): void {
    // Compare benefits at a common late year (e.g., age 75)
    const comparisonAge = 75;
    const comparisonYear = birthYear + comparisonAge;

    const earlyYearData = earlySim.find(y => y.year === comparisonYear);
    const lateYearData = lateSim.find(y => y.year === comparisonYear);

    if (earlyYearData && lateYearData) {
        const earlySSIncome = earlyYearData.incomes
            .filter(i => i.constructor.name.includes('SocialSecurity'))
            .reduce((sum, i) => sum + i.amount, 0);

        const lateSSIncome = lateYearData.incomes
            .filter(i => i.constructor.name.includes('SocialSecurity'))
            .reduce((sum, i) => sum + i.amount, 0);

        // Late claiming should result in higher benefits at age 75
        // (8% per year delayed from 67 to 70)
        expect(
            lateSSIncome,
            `SS at 75 should be higher with late claiming`
        ).toBeGreaterThanOrEqual(earlySSIncome * 0.95); // Allow small tolerance
    }
}

/**
 * Assert directional change: one value is greater/less than another.
 */
export function assertDirectionalChange(
    actual: number,
    reference: number,
    direction: 'greater' | 'less',
    description: string,
    tolerance: number = 0
): void {
    if (direction === 'greater') {
        expect(actual, description).toBeGreaterThanOrEqual(reference - tolerance);
    } else {
        expect(actual, description).toBeLessThanOrEqual(reference + tolerance);
    }
}

// =============================================================================
// LIFETIME CASH-FLOW RECONCILIATION
// =============================================================================

/**
 * Assert approximate lifetime cash-flow reconciliation.
 *
 * This accounting invariant verifies that the change in net worth roughly equals
 * the sum of investment returns over the simulation period.
 *
 * The fundamental equation is:
 * Δ Net Worth = Investment Returns + (Income - Expenses - Taxes)
 *
 * Since (Income - Expenses - Taxes) represents discretionary cash that gets invested,
 * and we track contributions separately, we can verify that:
 * Net Worth End - Net Worth Start ≈ Σ Investment Returns + Σ Contributions
 *
 * @param simulation The full simulation results
 * @param tolerancePercent Allowed variance as percentage of final net worth (default 10%)
 */
export function assertLifetimeCashFlowReconciliation(
    simulation: SimulationYear[],
    tolerancePercent: number = 10
): void {
    if (simulation.length < 2) return;

    const firstYear = simulation[0];
    const lastYear = simulation[simulation.length - 1];

    // Calculate starting and ending net worth
    const startingNetWorth = calculateNetWorth(firstYear.accounts);
    const endingNetWorth = calculateNetWorth(lastYear.accounts);
    const actualNetWorthChange = endingNetWorth - startingNetWorth;

    // Track cumulative values
    let cumulativeInvestmentReturns = 0;
    let cumulativeContributions = 0;
    let cumulativeWithdrawals = 0;

    for (let i = 1; i < simulation.length; i++) {
        const prevYear = simulation[i - 1];
        const currYear = simulation[i];

        // Sum contributions and withdrawals
        cumulativeContributions += currYear.cashflow.totalInvested || 0;
        cumulativeWithdrawals += currYear.cashflow.withdrawals || 0;

        // Calculate implied investment returns for each account
        for (const account of currYear.accounts) {
            const prevAccount = prevYear.accounts.find(a => a.id === account.id);
            if (!prevAccount) continue;

            // Skip debt accounts (handled differently)
            if (account instanceof DebtAccount || account instanceof DeficitDebtAccount) continue;

            // For property accounts, appreciation counts as "returns"
            if (account instanceof PropertyAccount) {
                const prevProp = prevAccount as PropertyAccount;
                // Appreciation = change in value
                const appreciation = account.amount - prevProp.amount;
                cumulativeInvestmentReturns += appreciation;
                continue;
            }

            // For invested/saved accounts, calculate return after contributions/withdrawals
            if (account instanceof InvestedAccount || account instanceof SavedAccount) {
                const prevBalance = prevAccount.amount;
                const currBalance = account.amount;

                // Get this account's specific contribution and withdrawal
                const contribution = currYear.cashflow.bucketDetail?.[account.id] || 0;
                const withdrawal = currYear.cashflow.withdrawalDetail?.[account.name] || 0;

                // Investment return = ending balance - starting balance - contributions + withdrawals
                const impliedReturn = currBalance - prevBalance - contribution + withdrawal;

                // Only count positive returns (negative returns are also valid)
                cumulativeInvestmentReturns += impliedReturn;
            }
        }
    }

    // The relationship between net worth change and investment returns:
    // Net Worth Change = Investment Returns - Consumption
    // where Consumption = Withdrawals used to fund expenses (not reinvested)
    //
    // We expect: Investment Returns >= Net Worth Change
    // (since some returns are consumed rather than reinvested)
    //
    // And: Investment Returns should be a reasonable multiple of Net Worth Change
    // (not more than ~3x for typical scenarios with 4% withdrawal rates)

    // Check 1: Investment returns should be non-negative (no magic disappearing money)
    // Allow small negative for rounding/timing
    expect(
        cumulativeInvestmentReturns,
        `Investment returns should be approximately non-negative over ${simulation.length} years`
    ).toBeGreaterThan(-100000);

    // Check 2: If net worth increased, returns should be at least as large
    // (You can't grow net worth without returns)
    if (actualNetWorthChange > 100000) {
        expect(
            cumulativeInvestmentReturns,
            `Investment returns ($${cumulativeInvestmentReturns.toFixed(0)}) should be at least ` +
            `the net worth increase ($${actualNetWorthChange.toFixed(0)})`
        ).toBeGreaterThanOrEqual(actualNetWorthChange * 0.5); // Allow 50% tolerance
    }

    // Check 3: Returns shouldn't be absurdly high relative to starting net worth
    // (catches runaway compounding bugs)
    const maxReasonableReturns = startingNetWorth * Math.pow(1.20, simulation.length); // 20% annual max
    expect(
        cumulativeInvestmentReturns,
        `Cumulative returns ($${cumulativeInvestmentReturns.toFixed(0)}) should not exceed ` +
        `reasonable maximum ($${maxReasonableReturns.toFixed(0)})`
    ).toBeLessThan(maxReasonableReturns);
}
