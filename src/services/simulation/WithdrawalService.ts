import { AnyAccount, DeficitDebtAccount } from "../../components/Objects/Accounts/models";

export interface DeficitDebtResult {
    existingDeficitDebt: DeficitDebtAccount | undefined;
    discretionaryCash: number;
    logs: string[];
}

/**
 * Track deficit debt: if there's still an uncovered deficit after all withdrawals.
 */
export function processDeficitDebt(
    discretionaryCash: number,
    accounts: AnyAccount[],
    logs: string[]
): DeficitDebtResult {
    const DEFICIT_DEBT_ID = 'system-deficit-debt';
    const DEFICIT_DEBT_NAME = 'Uncovered Deficit';

    let existingDeficitDebt = accounts.find(
        acc => acc instanceof DeficitDebtAccount && acc.id === DEFICIT_DEBT_ID
    ) as DeficitDebtAccount | undefined;

    // Only create deficit debt for deficits > $0.005 (ignore small rounding errors)
    if (discretionaryCash < -0.005) {
        const uncoveredDeficit = Math.abs(discretionaryCash);

        if (existingDeficitDebt) {
            existingDeficitDebt = new DeficitDebtAccount(
                DEFICIT_DEBT_ID,
                DEFICIT_DEBT_NAME,
                existingDeficitDebt.amount + uncoveredDeficit
            );
        } else {
            existingDeficitDebt = new DeficitDebtAccount(
                DEFICIT_DEBT_ID,
                DEFICIT_DEBT_NAME,
                uncoveredDeficit
            );
        }

        logs.push(`[WARN] Uncovered deficit of $${uncoveredDeficit.toLocaleString(undefined, { maximumFractionDigits: 0 })} added to deficit debt`);
        logs.push(`  Total deficit debt: $${existingDeficitDebt.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

        discretionaryCash = 0;
    }

    return { existingDeficitDebt, discretionaryCash, logs };
}
