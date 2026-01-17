import { simulateOneYear, SimulationYear } from './SimulationEngine';
import * as TaxService from '../../Objects/Taxes/TaxService';
import { WorkIncome } from '../Income/models';
import { AnyAccount } from '../Accounts/models';
import { AnyIncome } from '../Income/models';
import { AnyExpense } from '../Expense/models';
import { AssumptionsState } from './AssumptionsContext';
import { TaxState } from '../Taxes/TaxContext';

export const runSimulation = (
    yearsToRun: number = 30,
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    yearlyReturns?: number[]
): SimulationYear[] => {
        
    // Calculate start year and current age from birth year
    // If priorYearMode is enabled, start simulation from last year (for verified data entry)
    const currentYear = new Date().getFullYear();
    const startYear = assumptions.demographics.priorYearMode
        ? currentYear - 1
        : currentYear;
    const startAge = startYear - assumptions.demographics.birthYear;

    // --- NEW: LIFE EXPECTANCY CAP ---
    // Calculate how many years the user actually has left
    const yearsUntilDeath = Math.max(0, assumptions.demographics.lifeExpectancy - startAge);

    // Run for the requested time, OR until death—whichever comes first.
    const effectiveYearsToRun = Math.min(yearsToRun, yearsUntilDeath);

    const timeline: SimulationYear[] = [];

    // --- STEP 1: CREATE YEAR 0 (Baseline) ---
    // Note: Interest income is NOT included in Year 0 to allow users to match
    // their actual tax situation. Interest is generated starting in Year 1.

    // Calculate current baseline metrics using existing TaxService logic
    // Pass startAge to getPreTaxExemptions/getPostTaxExemptions for auto-max 401k feature
    const currentGross = TaxService.getGrossIncome(incomes, startYear);
    const currentPreTax = TaxService.getPreTaxExemptions(incomes, startYear, startAge);
    const currentPostTax = TaxService.getPostTaxExemptions(incomes, startYear, startAge);
    const currentInsurance = incomes.reduce((sum, inc) =>
        inc instanceof WorkIncome ? sum + inc.getProratedAnnual(inc.insurance, startYear) : sum, 0
    );

    const currentFed = TaxService.calculateFederalTax(taxState, incomes, expenses, startYear, assumptions);
    const currentState = TaxService.calculateStateTax(taxState, incomes, expenses, startYear, assumptions);
    const currentFica = TaxService.calculateFicaTax(taxState, incomes, startYear, assumptions);
    const currentTotalTax = currentFed + currentState + currentFica;

    const currentLivingExpenses = expenses.reduce((sum, exp) => sum + exp.getAnnualAmount(startYear), 0);

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
                            incomes.reduce((sum, inc) => inc instanceof WorkIncome ? sum + inc.employerMatch : sum, 0),
            bucketAllocations: 0,
            bucketDetail: {}, // Initialize empty for Year 0
            withdrawals: 0,
            withdrawalDetail: {}
        },
        taxDetails: {
            fed: currentFed,
            state: currentState,
            fica: currentFica,
            preTax: currentPreTax - currentInsurance,
            insurance: currentInsurance,
            postTax: currentPostTax,
            capitalGains: 0
        },
        logs: ["Baseline Year 0 initialized from current context data."]
    };

    timeline.push(yearZero);

    // --- STEP 2: RUN FUTURE SIMULATION ---
    let currentIncomes = yearZero.incomes;
    let currentExpenses = yearZero.expenses;
    let currentAccounts = yearZero.accounts;

    // CHANGED: Use effectiveYearsToRun instead of yearsToRun
    for (let i = 1; i <= effectiveYearsToRun; i++) {
        const simulationYear = startYear + i;

        // Get return override for this year (if Monte Carlo mode)
        // yearlyReturns[0] is for year 1, yearlyReturns[1] is for year 2, etc.
        const returnOverride = yearlyReturns ? yearlyReturns[i - 1] : undefined;

        const result = simulateOneYear(
            simulationYear,
            currentIncomes,
            currentExpenses,
            currentAccounts,
            assumptions,
            taxState,
            timeline,  // Pass previous simulation history for SS calculation
            returnOverride
        );

        timeline.push(result);

        currentIncomes = result.incomes;
        currentExpenses = result.expenses;
        currentAccounts = result.accounts;
    }

    return timeline;
};