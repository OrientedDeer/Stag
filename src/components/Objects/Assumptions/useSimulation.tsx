import { useContext, useMemo } from 'react';
import { AccountContext } from '../Accounts/AccountContext';
import { IncomeContext } from '../Income/IncomeContext';
import { ExpenseContext } from '../Expense/ExpenseContext';
import { AssumptionsContext } from './AssumptionsContext';
import { TaxContext } from '../../Objects/Taxes/TaxContext';
import { simulateOneYear, SimulationYear } from './SimulationEngine';
import * as TaxService from '../../Objects/Taxes/TaxService';
import { WorkIncome } from '../Income/models';

export const useSimulation = (yearsToRun: number = 30) => {
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: assumptions } = useContext(AssumptionsContext);
    const { state: taxState } = useContext(TaxContext);

    return useMemo(() => {
        const startYear = new Date().getUTCFullYear();
        const timeline: SimulationYear[] = [];

        // --- STEP 1: CREATE YEAR 0 (Baseline) ---
        // Calculate current baseline metrics using existing TaxService logic
        const currentGross = TaxService.getGrossIncome(incomes, startYear);
        const currentPreTax = TaxService.getPreTaxExemptions(incomes, startYear);
        const currentPostTax = TaxService.getPostTaxExemptions(incomes, startYear);
        const currentInsurance = incomes.reduce((sum, inc) => 
            inc instanceof WorkIncome ? sum + inc.getProratedAnnual(inc.insurance, startYear) : sum, 0
        );

        const currentFed = TaxService.calculateFederalTax(taxState, incomes, expenses, startYear);
        const currentState = TaxService.calculateStateTax(taxState, incomes, expenses, startYear);
        const currentFica = TaxService.calculateFicaTax(taxState, incomes, startYear);
        const currentTotalTax = currentFed + currentState + currentFica;

        const currentLivingExpenses = expenses.reduce((sum, exp) => sum + exp.getAnnualAmount(), 0);

        // For Year 0, discretionary is what's left over from your current input data
        const currentDiscretionary = currentGross - currentPreTax - currentPostTax - currentTotalTax - currentLivingExpenses;

        const yearZero: SimulationYear = {
            year: startYear,
            incomes: [...incomes],
            expenses: [...expenses],
            accounts: [...accounts],
            cashflow: {
                totalIncome: currentGross,
                totalExpense: currentLivingExpenses + currentTotalTax + currentPreTax + currentPostTax,
                discretionary: currentDiscretionary,
                // In Year 0, we treat the input as "Static", so invested is effectively 0 or the sum of payroll deductions
                investedUser: currentPreTax + currentPostTax - currentInsurance, 
                investedMatch: incomes.reduce((sum, inc) => inc instanceof WorkIncome ? sum + inc.employerMatch : sum, 0),
                totalInvested: (currentPreTax + currentPostTax - currentInsurance) + 
                               incomes.reduce((sum, inc) => inc instanceof WorkIncome ? sum + inc.employerMatch : sum, 0)
            },
            taxDetails: {
                fed: currentFed,
                state: currentState,
                fica: currentFica,
                preTax: currentPreTax - currentInsurance,
                insurance: currentInsurance,
                postTax: currentPostTax
            },
            logs: ["Baseline Year 0 initialized from current context data."]
        };

        timeline.push(yearZero);

        // --- STEP 2: RUN FUTURE SIMULATION ---
        let currentIncomes = yearZero.incomes;
        let currentExpenses = yearZero.expenses;
        let currentAccounts = yearZero.accounts;

        for (let i = 1; i <= yearsToRun; i++) {
            const simulationYear = startYear + i;

            const result = simulateOneYear(
                simulationYear,
                currentIncomes,
                currentExpenses,
                currentAccounts,
                assumptions,
                taxState
            );

            timeline.push(result);

            currentIncomes = result.incomes;
            currentExpenses = result.expenses;
            currentAccounts = result.accounts;
        }

        return timeline;

    }, [accounts, incomes, expenses, assumptions, taxState, yearsToRun]);
};