import { TaxState } from "../TaxContext";
import { AssumptionsState } from "../../Assumptions/AssumptionsContext";
import { getTaxParameters } from "./parameters";
import { calculateTax } from "./bracketTax";

/** Binary search parameters for gross withdrawal solver */
const WITHDRAWAL_SOLVER_MAX_ITERATIONS = 50;
const WITHDRAWAL_SOLVER_TOLERANCE = 0.005;
const WITHDRAWAL_SOLVER_FALLBACK_TAX_RATE = 0.30;

/**
 * Calculates Gross Withdrawal needed to net 'netNeeded'.
 * Accepts INCOME (Gross - PreTax) and DEDUCTION amounts separately
 * to correctly handle the 0% tax zone (unused standard deduction).
 */
export function calculateGrossWithdrawal(
    netNeeded: number,
    currentFedIncome: number,      // Gross - PreTax401k/Ins (AGI-ish)
    currentFedDeduction: number,   // Standard Deduction or Itemized Total
    currentStateIncome: number,
    currentStateDeduction: number,
    taxState: TaxState,
    year: number,
    assumptions?: AssumptionsState,
    penaltyRate: number = 0,       // Early withdrawal penalty rate (e.g., 0.10 for 10%)
): { grossWithdrawn: number; totalTax: number; penalty: number } {

    // 1. Get Parameters
    const fedParams = getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
    const stateParams = getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);

    if (!fedParams || !stateParams) {
        const effectiveNetRate = (1 - WITHDRAWAL_SOLVER_FALLBACK_TAX_RATE) - penaltyRate;
        const fallbackGross = netNeeded / effectiveNetRate;
        const fallbackPenalty = fallbackGross * penaltyRate;
        return {
            grossWithdrawn: fallbackGross,
            totalTax: fallbackGross - netNeeded - fallbackPenalty,
            penalty: fallbackPenalty,
        };
    }

    // 2. Forward calculator: synthetic params use the EXACT deduction passed in
    // (respects the simulation's view of "Itemized vs Standard").
    const calculateNetFromGross = (grossGuess: number): number => {
        // A. State tax
        const stateParamsApplied = { ...stateParams, standardDeduction: currentStateDeduction };
        // preTaxDeductions=0 because 'currentStateIncome' already has them subtracted
        const stateTaxBase = calculateTax(currentStateIncome, 0, stateParamsApplied);
        const stateTaxNew = calculateTax(currentStateIncome + grossGuess, 0, stateParamsApplied);
        const marginalStateTax = stateTaxNew - stateTaxBase;

        // B. SALT deductibility
        // The basic $10k SALT cap is enforced in calculateFederalTaxFromIncomes().
        // For this gross-withdrawal solver we intentionally ignore marginal SALT
        // deductibility — tracking remaining SALT headroom rarely changes results.

        // C. Federal tax
        const fedParamsApplied = { ...fedParams, standardDeduction: currentFedDeduction };
        const fedTaxBase = calculateTax(currentFedIncome, 0, fedParamsApplied);
        const fedTaxNew = calculateTax(currentFedIncome + grossGuess, 0, fedParamsApplied);
        const marginalFedTax = fedTaxNew - fedTaxBase;

        // D. Early withdrawal penalty (on gross)
        const penaltyAmount = grossGuess * penaltyRate;

        return grossGuess - marginalStateTax - marginalFedTax - penaltyAmount;
    };

    // 3. Binary search
    let low = netNeeded;
    let high = netNeeded * 4;
    let grossSolution = high;

    for (let i = 0; i < WITHDRAWAL_SOLVER_MAX_ITERATIONS; i++) {
        const mid = (low + high) / 2;
        const netResult = calculateNetFromGross(mid);

        if (Math.abs(netResult - netNeeded) <= WITHDRAWAL_SOLVER_TOLERANCE) {
            grossSolution = mid;
            break;
        }

        if (netResult < netNeeded) {
            low = mid;
        } else {
            high = mid;
            grossSolution = mid;
        }
    }

    const finalPenalty = grossSolution * penaltyRate;
    return {
        grossWithdrawn: grossSolution,
        totalTax: grossSolution - netNeeded - finalPenalty,
        penalty: finalPenalty,
    };
}
