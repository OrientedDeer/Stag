import { AnyAccount, InvestedAccount } from "../../components/Objects/Accounts/models";
import { PassiveIncome } from "../../components/Objects/Income/models";
import { AssumptionsState, getBirthYear } from "../../components/Objects/Assumptions/AssumptionsContext";
import { calculateRMD, isAccountSubjectToRMD, isRMDRequired, RMDCalculation } from "../../data/RMDData";
import { SimulationYear, WithdrawalState } from "./types";

export interface RMDResult {
    rmdDetails: SimulationYear['rmdDetails'];
    rmdIncomes: PassiveIncome[];
    /**
     * Amount actually drained from each RMD-subject account this year, keyed by
     * account id (prior-year vested balance ÷ life-expectancy factor, capped at the
     * account's vested balance). This is the SINGLE SOURCE for the year-solver's
     * per-account RMD reservation: the discretionary/deficit withdrawal planner reads
     * the raw (undrained) snapshot balances, so it must reserve exactly what the RMD
     * already took per account or it double-spends those dollars. Empty when no RMD
     * is required.
     */
    perAccountWithdrawn: Map<string, number>;
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
            perAccountWithdrawn: new Map(),
            logs
        };
    }

    const rmdCalculations: RMDCalculation[] = [];
    let totalRMDRequired = 0;
    let totalRMDWithdrawn = 0;
    const rmdIncomes: PassiveIncome[] = [];
    const perAccountWithdrawn = new Map<string, number>();

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

            // Drain the account. This is the ONLY money movement — growAccounts applies
            // userInflows to the balance (AccountGrowth.ts), so the Traditional account
            // drops by exactly the RMD regardless of how it's later reported.
            withdrawalState.userInflows[account.id] = (withdrawalState.userInflows[account.id] || 0) - actualWithdrawal;
            totalRMDWithdrawn += actualWithdrawal;
            // Record the per-account drain so the year solver can reserve exactly this
            // amount from the account's raw snapshot (see RMDResult.perAccountWithdrawn).
            perAccountWithdrawn.set(account.id, (perAccountWithdrawn.get(account.id) ?? 0) + actualWithdrawal);

            // NOTE: the RMD is intentionally NOT added to withdrawalState.totalWithdrawals
            // or withdrawalDetail. It is surfaced as spendable INCOME (a PassiveIncome with
            // sourceType 'RMD', classified into `spendable` by IncomeClassifier), so adding
            // it to the withdrawal tallies too would double-count the same dollars in the
            // Sankey cash accounting (inflated `investedUser`/`totalInvested`). RMD = income
            // that funds expenses, with any surplus reinvested.
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
        perAccountWithdrawn,
        logs
    };
}
