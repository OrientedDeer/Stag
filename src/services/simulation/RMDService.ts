import { AnyAccount, InvestedAccount } from "../../components/Objects/Accounts/models";
import { PassiveIncome } from "../../components/Objects/Income/models";
import { AssumptionsState, getBirthYear } from "../../components/Objects/Assumptions/AssumptionsContext";
import { calculateRMD, isAccountSubjectToRMD, isRMDRequired, RMDCalculation } from "../../data/RMDData";
import { SimulationYear, WithdrawalState } from "./types";

export interface RMDResult {
    rmdDetails: SimulationYear['rmdDetails'];
    rmdIncomes: PassiveIncome[];
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
    assumptions: AssumptionsState,
    previousSimulation: SimulationYear[],
    currentAge: number,
    totalGrossIncome: number,
    withdrawalState: WithdrawalState,
    logs: string[]
): RMDResult {
    const birthYearForRMD = getBirthYear(assumptions.milestones);
    const rmdRequired = isRMDRequired(currentAge, birthYearForRMD);

    if (!rmdRequired) {
        return {
            rmdDetails: undefined,
            rmdIncomes: [],
            logs
        };
    }

    const rmdCalculations: RMDCalculation[] = [];
    let totalRMDRequired = 0;
    let totalRMDWithdrawn = 0;
    const rmdIncomes: PassiveIncome[] = [];

    for (const account of accounts) {
        if (!(account instanceof InvestedAccount)) continue;
        if (!isAccountSubjectToRMD(account.taxType)) continue;

        // Get prior year's ending balance for RMD calculation.
        // Bug #12: base the RMD requirement on the VESTED prior-year balance so
        // the requirement and the withdrawal cap (availableBalance below) share
        // the same basis. Using full balance here while capping withdrawals at
        // vested fabricates a phantom shortfall + 25% penalty for unvested
        // employer money the owner cannot legally distribute. The IRS bases RMDs
        // on the account balance, but unvested employer funds are not yet the
        // owner's assets, so vested balance is the conservative, consistent basis.
        const priorYearSim = previousSimulation[previousSimulation.length - 1];
        let priorYearBalance = account.vestedAmount;

        if (priorYearSim) {
            const priorAccount = priorYearSim.accounts.find(a => a.id === account.id);
            if (priorAccount instanceof InvestedAccount) {
                priorYearBalance = priorAccount.vestedAmount;
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

            // Update totalGrossIncome so it includes RMD for cash flow calculations
            totalGrossIncome += actualWithdrawal;
            withdrawalState.totalGrossIncome = totalGrossIncome;

            // Apply withdrawal to account
            withdrawalState.userInflows[account.id] = (withdrawalState.userInflows[account.id] || 0) - actualWithdrawal;
            totalRMDWithdrawn += actualWithdrawal;

            // Track in withdrawal details
            withdrawalState.totalWithdrawals += actualWithdrawal;
            withdrawalState.withdrawalDetail[account.name] = (withdrawalState.withdrawalDetail[account.name] || 0) + actualWithdrawal;

            logs.push(`📋 RMD from ${account.name}: $${actualWithdrawal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
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
        logs
    };
}
