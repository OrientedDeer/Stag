// src/components/Simulation/SimulationEngine.ts
import { AnyAccount, DebtAccount, InvestedAccount, PropertyAccount, SavedAccount } from "../Accounts/models";
import { AnyExpense, LoanExpense, MortgageExpense } from "../Expense/models";
import { AnyIncome, WorkIncome } from "../Income/models";
import { AssumptionsState } from "../Assumptions/AssumptionsContext";
import { TaxState } from "../Taxes/TaxContext";
import * as TaxService from "../Taxes/TaxService";

// Define the shape of a single year's result
export interface SimulationYear {
    year: number;
    incomes: AnyIncome[];
    expenses: AnyExpense[];
    accounts: AnyAccount[];
    cashflow: {
        totalIncome: number;
        totalExpense: number; // Taxes + Living Expenses + Payroll Deductions
        discretionary: number; // Unspent cash
        investedUser: number;  // User contributions + Saved Cash
        investedMatch: number; // Employer Match
        totalInvested: number; // Sum
    };
    taxDetails: {
        fed: number;
        state: number;
        fica: number;
        preTax: number;
        insurance: number;
        postTax: number;
    };
    logs: string[];
}

/**
 * Runs the simulation for a single timestep (1 year).
 * Takes "Year N" data and returns "Year N+1" data.
 */
export function simulateOneYear(
    year: number,
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    accounts: AnyAccount[],
    assumptions: AssumptionsState,
    taxState: TaxState
): SimulationYear {
    const logs: string[] = [];
    // log(`--- Simulating Year ${year} ---`);

    // 1. GROW (The Physics of Money)
    const nextIncomes = incomes.map(inc => inc.increment(assumptions));
    const nextExpenses = expenses.map(exp => exp.increment(assumptions));

    // 2. TAXES & DEDUCTIONS (The Government)
    const totalGrossIncome = TaxService.getGrossIncome(nextIncomes, year);
    const preTaxDeductions = TaxService.getPreTaxExemptions(nextIncomes, year);
    const postTaxDeductions = TaxService.getPostTaxExemptions(nextIncomes, year);
    
    // Calculate Insurance (logic extracted from Testing.tsx)
    const totalInsuranceCost = nextIncomes.reduce((sum, inc) => {
        if (inc instanceof WorkIncome) {
            return sum + inc.getProratedAnnual(inc.insurance, year);
        }
        return sum;
    }, 0);

    const fedTax = TaxService.calculateFederalTax(taxState, nextIncomes, nextExpenses, year, assumptions);
    const stateTax = TaxService.calculateStateTax(taxState, nextIncomes, nextExpenses, year, assumptions);
    const ficaTax = TaxService.calculateFicaTax(taxState, nextIncomes, year, assumptions);
    const totalTax = fedTax + stateTax + ficaTax;

    // 3. LIVING EXPENSES (The Bills)
    const totalLivingExpenses = nextExpenses.reduce((sum, exp) => sum + exp.getAnnualAmount(), 0);

    // 4. CASHFLOW (The Wallet)
    // Formula: Gross - PreTax(401k/HSA) - Insurance - PostTax(Roth) - Taxes - Bills
    let discretionaryCash = totalGrossIncome - preTaxDeductions - totalInsuranceCost - postTaxDeductions - totalTax - totalLivingExpenses;

    // 5. INFLOWS & BUCKETS (The Allocation)
    const accountInflows: Record<string, number> = {}; 
    let totalEmployerMatch = 0;

    // 5a. Payroll & Match
    nextIncomes.forEach(inc => {
        if (inc instanceof WorkIncome && inc.matchAccountId) {
            const current = accountInflows[inc.matchAccountId] || 0;
            const selfContribution = inc.preTax401k + inc.roth401k;
            const employerMatch = inc.employerMatch;
            
            totalEmployerMatch += employerMatch;
            accountInflows[inc.matchAccountId] = current + selfContribution + employerMatch;
        }
    });

    // 5b. Priority Waterfall
    assumptions.priorities.forEach((priority) => {
        if (discretionaryCash <= 0 || !priority.accountId) return;

        let amountToContribute = 0;

        if (priority.capType === 'FIXED') {
            amountToContribute = Math.min(priority.capValue || 0, discretionaryCash);
        } 
        else if (priority.capType === 'REMAINDER') {
            amountToContribute = discretionaryCash;
        }
        else if (priority.capType === 'MAX') {
            amountToContribute = Math.min(priority.capValue || 0, discretionaryCash);
        }
        else if (priority.capType === 'MULTIPLE_OF_EXPENSES') {
            const monthlyExpenses = totalLivingExpenses / 12;
            const target = monthlyExpenses * (priority.capValue || 0);
            
            const targetAccount = accounts.find(acc => acc.id === priority.accountId);
            const currentBalance = targetAccount ? targetAccount.amount : 0;

            let growthRate = 0;
            if (targetAccount instanceof SavedAccount || targetAccount instanceof DebtAccount) {
                growthRate = targetAccount.apr;
            } else if (targetAccount instanceof InvestedAccount) {
                growthRate = assumptions.investments.returnRates.ror;
            }

            const expectedGrowth = currentBalance * (growthRate / 100);
            const needed = target - (currentBalance + expectedGrowth);
            
            amountToContribute = Math.max(0, Math.min(needed, discretionaryCash));
        }

        if (amountToContribute > 0) {
            discretionaryCash -= amountToContribute;
            accountInflows[priority.accountId] = (accountInflows[priority.accountId] || 0) + amountToContribute;
        }
    });

    // 6. LINKED DATA (Mortgages/Loans)
    const linkedData = new Map<string, { balance: number; value?: number }>();
    nextExpenses.forEach(exp => {
        if (exp instanceof MortgageExpense && exp.linkedAccountId) {
            linkedData.set(exp.linkedAccountId, { balance: exp.loan_balance, value: exp.valuation });
        } else if (exp instanceof LoanExpense && exp.linkedAccountId) {
            linkedData.set(exp.linkedAccountId, { balance: exp.amount });
        }
    });

    // 7. GROW ACCOUNTS (The compounding)
    const nextAccounts = accounts.map(acc => {
        const inflow = accountInflows[acc.id] || 0;
        const linkedState = linkedData.get(acc.id);

        if (acc instanceof PropertyAccount) {
            let finalLoanBalance = linkedState?.balance;
            if (finalLoanBalance !== undefined && inflow > 0) {
                finalLoanBalance = Math.max(0, finalLoanBalance - inflow);
            }
            return acc.increment(assumptions, { newLoanBalance: finalLoanBalance, newValue: linkedState?.value });
        }
        
        if (acc instanceof DebtAccount) {
            let finalBalance = linkedState?.balance ?? (acc.amount * (1 + acc.apr / 100));
            if (inflow > 0) finalBalance = Math.max(0, finalBalance - inflow);
            return acc.increment(assumptions, finalBalance);
        }

        if (acc instanceof InvestedAccount || acc instanceof SavedAccount) {
            return acc.increment(assumptions, inflow);
        }

        // @ts-ignore
        return acc.grow ? acc.increment(assumptions) : acc; 
    });

    // 8. SUMMARY STATS
    // NOTE: userSaved definition above assumes preTaxDeductions ARE savings (like 401k).
    // If you want to include 401k in "User Saved", we shouldn't subtract preTaxDeductions.
    // Adjusted Formula:
    // UserSaved = (Gross - Taxes - Insurance - Bills - UnspentCash) 
    // This implicitly includes the 401k/HSA/Roth parts because we didn't subtract them from Gross in this specific line.
    
    // Let's use a cleaner calculation for User Saved to be safe:
    // User Saved = (PreTax 401k/HSA) + (PostTax Roth) + (Priority Waterfall Contributions)
    // But calculating Priority Contributions is hard to sum up here without re-looping.
    // Let's stick to the "What's Missing" approach but be careful:
    const trueUserSaved = totalGrossIncome - totalTax - totalInsuranceCost - totalLivingExpenses - discretionaryCash;

    return {
        year,
        incomes: nextIncomes,
        expenses: nextExpenses,
        accounts: nextAccounts,
        cashflow: {
            totalIncome: totalGrossIncome,
            totalExpense: totalLivingExpenses + totalTax + preTaxDeductions + postTaxDeductions + totalInsuranceCost, // Total Outflows
            discretionary: discretionaryCash,
            investedUser: trueUserSaved,
            investedMatch: totalEmployerMatch,
            totalInvested: trueUserSaved + totalEmployerMatch
        },
        taxDetails: {
            fed: fedTax,
            state: stateTax,
            fica: ficaTax,
            preTax: preTaxDeductions,
            insurance: totalInsuranceCost,
            postTax: postTaxDeductions
        },
        logs
    };
}