// src/components/Simulation/SimulationEngine.ts
import { AnyAccount, DebtAccount, InvestedAccount, PropertyAccount, SavedAccount } from "../../Objects/Accounts/models";
import { AnyExpense, LoanExpense, MortgageExpense } from "../Expense/models";
import { AnyIncome, WorkIncome } from "../../Objects/Income/models";
import { AssumptionsState } from "./AssumptionsContext";
import { TaxState } from "../../Objects/Taxes/TaxContext";
import * as TaxService from "../../Objects/Taxes/TaxService";

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
        bucketAllocations: number; // Priority Bucket contributions
        bucketDetail: Record<string, number>; // Breakdown
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

    // 1. GROW (The Physics of Money)
    const nextIncomes = incomes.map(inc => inc.increment(assumptions));
    const nextExpenses = expenses.map(exp => exp.increment(assumptions));

    // 2. TAXES & DEDUCTIONS (The Government)
    let totalGrossIncome = TaxService.getGrossIncome(nextIncomes, year);
    const preTaxDeductions = TaxService.getPreTaxExemptions(nextIncomes, year);
    const postTaxDeductions = TaxService.getPostTaxExemptions(nextIncomes, year);
    
    // Calculate Insurance
    const totalInsuranceCost = nextIncomes.reduce((sum, inc) => {
        if (inc instanceof WorkIncome) {
            return sum + inc.getProratedAnnual(inc.insurance, year);
        }
        return sum;
    }, 0);

    // Initial Tax Calculation (Before any withdrawals)
    let fedTax = TaxService.calculateFederalTax(taxState, nextIncomes, nextExpenses, year, assumptions);
    let stateTax = TaxService.calculateStateTax(taxState, nextIncomes, nextExpenses, year, assumptions);
    const ficaTax = TaxService.calculateFicaTax(taxState, nextIncomes, year, assumptions);
    let totalTax = fedTax + stateTax + ficaTax;

    // 3. LIVING EXPENSES (The Bills)
    const totalLivingExpenses = nextExpenses.reduce((sum, exp) => {
        if (exp instanceof MortgageExpense) {
            return sum + exp.calculateAnnualAmortization(year).totalPayment;
        }
        if (exp instanceof LoanExpense) {
            return sum + exp.calculateAnnualAmortization(year).totalPayment;
        }
        return sum + exp.getAnnualAmount(year);
    }, 0);

    // 4. CASHFLOW (The Wallet)
    // Formula: Gross - PreTax(401k/HSA/Insurance) - PostTax(Roth) - Taxes - Bills
    let discretionaryCash = totalGrossIncome - preTaxDeductions - postTaxDeductions - totalTax - totalLivingExpenses;
    let withdrawalPenalties = 0;
    // ------------------------------------------------------------------
    // NEW: WITHDRAWAL LOGIC (Deficit Manager)
    // ------------------------------------------------------------------

    // CHANGED: Split inflows into User vs Employer to support vesting tracking
    const userInflows: Record<string, number> = {};
    const employerInflows: Record<string, number> = {};
    let withdrawalTaxes = 0;

    if (discretionaryCash < 0) {
        let deficit = Math.abs(discretionaryCash);

        // Loop through Withdrawal Strategy
        const strategy = assumptions.withdrawalStrategy || [];

        for (const bucket of strategy) {
            if (deficit <= 0.01) break;

            const account = accounts.find(acc => acc.id === bucket.accountId);
            if (!account) continue;

            let availableBalance = account.amount;
            if (account instanceof InvestedAccount) {
                availableBalance = account.vestedAmount; // Use the getter from models.tsx
            }
            if (availableBalance <= 0) continue;

            let withdrawAmount = 0;
            let taxHit = 0;

            // SCENARIO 1: Tax-Free
            const isTaxFree = (account instanceof SavedAccount) || 
                              (account instanceof InvestedAccount && (account.taxType === 'Roth 401k' || account.taxType === 'Roth IRA' || account.taxType === 'HSA'));
            const currentAge = assumptions.demographics.startAge + (year - assumptions.demographics.startYear);
            const isEarly = currentAge < 59.5; 
            // Note: 55 rule and SEPP are complex exceptions, stick to 59.5 for now.

            if (isTaxFree) {
                withdrawAmount = Math.min(deficit, availableBalance);
                deficit -= withdrawAmount;
            }
            
            
            // SCENARIO 2: Pre-Tax (Traditional 401k/IRA)
            else if (account instanceof InvestedAccount && (account.taxType === 'Traditional 401k' || account.taxType === 'Traditional IRA')) {
                let targetNet = deficit;
                if (isEarly) {
                    // Approximate: If we lose 10% off the top, we need roughly 1/0.9 as much base.
                    targetNet = deficit / 0.9; 
                }
                // 1. Calculate Baselines
                const fedParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
                const stateParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);

                const currentFedIncome = totalGrossIncome - preTaxDeductions;
                const currentStateIncome = totalGrossIncome - preTaxDeductions; 

                const stdDedFed = fedParams?.standardDeduction || 12950;
                const stdDedState = stateParams?.standardDeduction || 0;
                
                const currentFedDeduction = taxState.deductionMethod === 'Standard' ? stdDedFed : 0;
                const currentStateDeduction = taxState.deductionMethod === 'Standard' ? stdDedState : 0; 

                // 2. Call Solver
                const result = TaxService.calculateGrossWithdrawal(
                    Math.min(targetNet, availableBalance),
                    currentFedIncome,       
                    currentFedDeduction,    
                    currentStateIncome,     
                    currentStateDeduction,
                    taxState,
                    year,
                    assumptions
                );

                let actualPenalty = 0;
                if (isEarly) {
                    actualPenalty = result.grossWithdrawn * 0.10;
                    withdrawalPenalties += actualPenalty; // Track it
                }

                // Overdraft Check
                if (result.grossWithdrawn > availableBalance) {
                     withdrawAmount = availableBalance;
                     
                     // Manual tax calc for the partial amount
                     const fedApplied = { ...fedParams!, standardDeduction: currentFedDeduction };
                     const stateApplied = { ...stateParams!, standardDeduction: currentStateDeduction };
                     
                     // Fed Impact
                     const fedBase = TaxService.calculateTax(currentFedIncome, 0, fedApplied);
                     const fedNew = TaxService.calculateTax(currentFedIncome + withdrawAmount, 0, fedApplied);
                     
                     // State Impact
                     const stateBase = TaxService.calculateTax(currentStateIncome, 0, stateApplied);
                     const stateNew = TaxService.calculateTax(currentStateIncome + withdrawAmount, 0, stateApplied);

                     taxHit = (fedNew - fedBase) + (stateNew - stateBase);

                     if (isEarly) {
                        actualPenalty = withdrawAmount * 0.10;
                        withdrawalPenalties += actualPenalty; // Track it
                     }
                     
                     deficit -= (withdrawAmount - taxHit - actualPenalty);
                } else {
                    withdrawAmount = result.grossWithdrawn;
                    taxHit = result.totalTax;
                    
                    // Did we cover it?
                    // Cash Received = Gross - Tax - Penalty
                    const cashReceived = withdrawAmount - taxHit - actualPenalty;
                    deficit -= cashReceived; 
                    // Note: deficit might be slightly non-zero due to the /0.9 approximation, 
                    // but it will be very close.
                }

                // 3. Update Baselines
                totalGrossIncome += withdrawAmount; 
                withdrawalTaxes += taxHit;
            }

            // Apply Withdrawal to USER inflows (assuming we drain user vested funds first)
            // Negative value = Withdrawal
            userInflows[account.id] = (userInflows[account.id] || 0) - withdrawAmount;
        }

        // Final Adjustments
        totalTax += withdrawalTaxes;

        // FLOATING POINT CLEANUP
        // If the remaining deficit is less than half a penny, treat it as zero.
        // This prevents "-$0.00" errors in the UI or logic.
        if (Math.abs(deficit) < 0.005) {
            console.log(`Deficit of $${deficit.toFixed(4)} treated as zero due to floating point precision.`);
            deficit = 0;
        }

        discretionaryCash = -deficit;
    }

    // ------------------------------------------------------------------
    // END WITHDRAWAL LOGIC
    // ------------------------------------------------------------------

    // 5. INFLOWS & BUCKETS (The Allocation of Surplus)
    const bucketDetail: Record<string, number> = {};
    let totalEmployerMatch = 0;
    let totalBucketAllocations = 0;

    // 5a. Payroll & Match
    nextIncomes.forEach(inc => {
        if (inc instanceof WorkIncome && inc.matchAccountId) {
            const currentSelf = userInflows[inc.matchAccountId] || 0;
            const currentMatch = employerInflows[inc.matchAccountId] || 0;

            const selfContribution = inc.preTax401k + inc.roth401k;
            const employerMatch = inc.employerMatch;
            
            totalEmployerMatch += employerMatch;
            
            // CHANGED: Separate the streams so InvestedAccount can track vesting
            userInflows[inc.matchAccountId] = currentSelf + selfContribution;
            employerInflows[inc.matchAccountId] = currentMatch + employerMatch;
        }
    });

    // 5b. Priority Waterfall (Surplus Only)
    assumptions.priorities.forEach((priority) => {
        // Only allocate if we actually have cash left
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
            // Priorities are user-driven, so they go to userInflows
            userInflows[priority.accountId] = (userInflows[priority.accountId] || 0) + amountToContribute;
            bucketDetail[priority.accountId] = (bucketDetail[priority.accountId] || 0) + amountToContribute;
            totalBucketAllocations += amountToContribute;
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
        const userIn = userInflows[acc.id] || 0;
        const employerIn = employerInflows[acc.id] || 0;
        const totalIn = userIn + employerIn;

        const linkedState = linkedData.get(acc.id);

        if (acc instanceof PropertyAccount) {
            let finalLoanBalance = linkedState?.balance;
            if (finalLoanBalance !== undefined && totalIn > 0) {
                finalLoanBalance = Math.max(0, finalLoanBalance - totalIn);
            }
            return acc.increment(assumptions, { newLoanBalance: finalLoanBalance, newValue: linkedState?.value });
        }
        
        if (acc instanceof DebtAccount) {
            let finalBalance = linkedState?.balance ?? (acc.amount * (1 + acc.apr / 100));
            // Inflow for debt means PAYMENT (reducing balance)
            if (totalIn > 0) finalBalance = Math.max(0, finalBalance - totalIn);
            return acc.increment(assumptions, finalBalance);
        }

        if (acc instanceof InvestedAccount) {
            // CHANGED: Pass user/employer streams separately to handle vesting
            return acc.increment(assumptions, userIn, employerIn);
        }

        if (acc instanceof SavedAccount) {
            return acc.increment(assumptions, totalIn);
        }

        // @ts-ignore
        return acc.grow ? acc.increment(assumptions) : acc; 
    });

    // 8. SUMMARY STATS
    const trueUserSaved = totalGrossIncome - totalTax - totalInsuranceCost - totalLivingExpenses - discretionaryCash;

    return {
        year,
        incomes: nextIncomes,
        expenses: nextExpenses,
        accounts: nextAccounts,
        cashflow: {
            totalIncome: totalGrossIncome, 
            totalExpense: totalLivingExpenses + totalTax + preTaxDeductions + postTaxDeductions, 
            discretionary: discretionaryCash, 
            investedUser: trueUserSaved,
            investedMatch: totalEmployerMatch,
            totalInvested: trueUserSaved + totalEmployerMatch,
            bucketAllocations: totalBucketAllocations,
            bucketDetail: bucketDetail
        },
        taxDetails: {
            fed: fedTax + withdrawalTaxes + withdrawalPenalties, 
            state: stateTax,
            fica: ficaTax,
            preTax: preTaxDeductions - totalInsuranceCost, 
            insurance: totalInsuranceCost,
            postTax: postTaxDeductions
        },
        logs
    };
}