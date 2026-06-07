import { AnyAccount, InvestedAccount } from "../../components/Objects/Accounts/models";
import { AnyIncome, PassiveIncome } from "../../components/Objects/Income/models";
import { AssumptionsState, getBirthYear } from "../../components/Objects/Assumptions/AssumptionsContext";
import { TaxState } from "../../components/Objects/Taxes/TaxContext";
import * as TaxService from "../../components/Objects/Taxes/TaxService";
import { calculateRMD, isAccountSubjectToRMD, isRMDRequired, RMDCalculation } from "../../data/RMDData";
import { SimulationYear, WithdrawalState } from "./types";

export interface RMDResult {
    rmdDetails: SimulationYear['rmdDetails'];
    rmdIncomes: PassiveIncome[];
    fedTaxIncrease: number;
    stateTaxIncrease: number;
    logs: string[];
}

/**
 * Process Required Minimum Distributions for Traditional accounts.
 * RMDs must be taken starting at age 72-75 depending on birth year.
 * Amount is based on prior year's ending balance divided by life expectancy factor.
 */
export function processRMDs(
    year: number,
    accounts: AnyAccount[],
    allIncomes: AnyIncome[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    previousSimulation: SimulationYear[],
    currentAge: number,
    totalGrossIncome: number,
    preTaxDeductions: number,
    withdrawalState: WithdrawalState,
    logs: string[]
): RMDResult {
    const birthYearForRMD = getBirthYear(assumptions.milestones);
    const rmdRequired = isRMDRequired(currentAge, birthYearForRMD);

    if (!rmdRequired) {
        return {
            rmdDetails: undefined,
            rmdIncomes: [],
            fedTaxIncrease: 0,
            stateTaxIncrease: 0,
            logs
        };
    }

    const rmdCalculations: RMDCalculation[] = [];
    let totalRMDRequired = 0;
    let totalRMDWithdrawn = 0;
    let rmdFedTax = 0;
    let rmdStateTax = 0;
    const rmdIncomes: PassiveIncome[] = [];

    for (const account of accounts) {
        if (!(account instanceof InvestedAccount)) continue;
        if (!isAccountSubjectToRMD(account.taxType)) continue;

        // Get prior year's ending balance for RMD calculation
        const priorYearSim = previousSimulation[previousSimulation.length - 1];
        let priorYearBalance = account.amount;

        if (priorYearSim) {
            const priorAccount = priorYearSim.accounts.find(a => a.id === account.id);
            if (priorAccount) {
                priorYearBalance = priorAccount.amount;
            }
        }

        const rmdAmount = calculateRMD(priorYearBalance, currentAge);
        if (rmdAmount <= 0) continue;

        rmdCalculations.push({
            accountName: account.name,
            accountId: account.id,
            priorYearBalance: priorYearBalance,
            distributionPeriod: priorYearBalance / rmdAmount,
            rmdAmount: rmdAmount
        });

        totalRMDRequired += rmdAmount;

        const availableBalance = account.vestedAmount;
        const actualWithdrawal = Math.min(rmdAmount, availableBalance);

        if (actualWithdrawal > 0) {
            // Create RMD income object - makes RMD visible to Roth conversion
            const rmdIncome = new PassiveIncome(
                `rmd-${account.id}-${year}`,
                `RMD from ${account.name}`,
                actualWithdrawal,
                'Annually',
                'No',
                'RMD',
                new Date(year, 0, 1),
                new Date(year, 11, 31),
                false
            );
            rmdIncomes.push(rmdIncome);

            // Calculate marginal tax on RMD withdrawal
            const fedParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
            const stateParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);

            const currentFedIncome = totalGrossIncome - preTaxDeductions;

            // State income needs to exclude SS for states that don't tax it
            const totalSSBenefits = TaxService.getSocialSecurityBenefits(allIncomes, year);
            let currentStateIncome = totalGrossIncome - preTaxDeductions;
            if (totalSSBenefits > 0) {
                const ssTreatment = stateParams?.socialSecurityTreatment ?? 'exempt';
                if (ssTreatment === 'taxable') {
                    const agiExcludingSS = totalGrossIncome - totalSSBenefits - preTaxDeductions;
                    // TODO: Verify all income types are included (LTCG, STCG, dividends, etc.)
                    const taxableSSBenefits = TaxService.getTaxableSocialSecurityBenefits(totalSSBenefits, agiExcludingSS, 0, taxState.filingStatus);
                    currentStateIncome = totalGrossIncome - totalSSBenefits + taxableSSBenefits - preTaxDeductions;
                } else {
                    // 'exempt' or 'income-based' - exclude SS benefits entirely (income-based TODO: implement phaseout)
                    currentStateIncome = totalGrossIncome - totalSSBenefits - preTaxDeductions;
                }
            }

            const stdDedFed = fedParams?.standardDeduction || 12950;
            const stdDedState = stateParams?.standardDeduction || 0;
            const currentFedDeduction = taxState.deductionMethod === 'Standard' ? stdDedFed : 0;
            const currentStateDeduction = taxState.deductionMethod === 'Standard' ? stdDedState : 0;

            const fedApplied = { ...fedParams!, standardDeduction: currentFedDeduction };
            const stateApplied = { ...stateParams!, standardDeduction: currentStateDeduction };

            const fedBase = TaxService.calculateTax(currentFedIncome, 0, fedApplied);
            const fedNew = TaxService.calculateTax(currentFedIncome + actualWithdrawal, 0, fedApplied);
            const stateBase = TaxService.calculateTax(currentStateIncome, 0, stateApplied);
            const stateNew = TaxService.calculateTax(currentStateIncome + actualWithdrawal, 0, stateApplied);

            const thisRmdFedTax = fedNew - fedBase;
            const thisRmdStateTax = stateNew - stateBase;
            rmdFedTax += thisRmdFedTax;
            rmdStateTax += thisRmdStateTax;

            // Update totalGrossIncome so it includes RMD for cash flow calculations
            totalGrossIncome += actualWithdrawal;
            withdrawalState.totalGrossIncome = totalGrossIncome;

            // Apply withdrawal to account
            withdrawalState.userInflows[account.id] = (withdrawalState.userInflows[account.id] || 0) - actualWithdrawal;
            totalRMDWithdrawn += actualWithdrawal;

            // Track in withdrawal details
            withdrawalState.totalWithdrawals += actualWithdrawal;
            withdrawalState.withdrawalDetail[account.name] = (withdrawalState.withdrawalDetail[account.name] || 0) + actualWithdrawal;

            logs.push(`📋 RMD from ${account.name}: $${actualWithdrawal.toLocaleString(undefined, { maximumFractionDigits: 0 })} (Tax: $${(thisRmdFedTax + thisRmdStateTax).toLocaleString(undefined, { maximumFractionDigits: 0 })})`);
        }
    }

    // Calculate shortfall and penalty
    const shortfall = Math.max(0, totalRMDRequired - totalRMDWithdrawn);
    const penalty = shortfall * 0.25;

    if (shortfall > 0) {
        logs.push(`[WARN] RMD shortfall: $${shortfall.toLocaleString(undefined, { maximumFractionDigits: 0 })} - Penalty: $${penalty.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    }

    const rmdDetails: SimulationYear['rmdDetails'] = {
        totalRMD: totalRMDRequired,
        totalWithdrawn: totalRMDWithdrawn,
        accountBreakdown: rmdCalculations,
        shortfall: shortfall,
        penalty: penalty
    };

    return {
        rmdDetails,
        rmdIncomes,
        fedTaxIncrease: rmdFedTax + penalty,
        stateTaxIncrease: rmdStateTax,
        logs
    };
}
