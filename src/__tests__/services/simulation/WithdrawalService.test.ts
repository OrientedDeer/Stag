/**
 * Unit tests for WithdrawalService.
 *
 * The legacy executeWithdrawals + executeWithdrawalPlan tests were removed
 * along with the dead production functions; production withdrawal flow now
 * goes through WithdrawalPlanner.planWithdrawals, which is covered by the
 * Scenario*.test.ts suite plus RothAndHSAEdgeCases.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { processDeficitDebt } from '../../../services/simulation/WithdrawalService';
import { AnyAccount, DeficitDebtAccount } from '../../../components/Objects/Accounts/models';

describe('processDeficitDebt', () => {
    describe('no deficit scenarios', () => {
        it('should not create debt when cash is positive', () => {
            const accounts: AnyAccount[] = [];
            const logs: string[] = [];

            const result = processDeficitDebt(10000, accounts, logs);

            expect(result.existingDeficitDebt).toBeUndefined();
            expect(result.discretionaryCash).toBe(10000);
        });

        it('should not create debt when cash is zero', () => {
            const accounts: AnyAccount[] = [];
            const logs: string[] = [];

            const result = processDeficitDebt(0, accounts, logs);

            expect(result.existingDeficitDebt).toBeUndefined();
            expect(result.discretionaryCash).toBe(0);
        });

        it('should ignore small negative values (rounding)', () => {
            const accounts: AnyAccount[] = [];
            const logs: string[] = [];

            const result = processDeficitDebt(-0.001, accounts, logs);

            expect(result.existingDeficitDebt).toBeUndefined();
        });
    });

    describe('deficit debt creation', () => {
        it('should create DeficitDebtAccount for uncovered deficit', () => {
            const accounts: AnyAccount[] = [];
            const logs: string[] = [];

            const result = processDeficitDebt(-5000, accounts, logs);

            expect(result.existingDeficitDebt).toBeDefined();
            expect(result.existingDeficitDebt?.amount).toBe(5000);
        });

        it('should use system ID for deficit debt', () => {
            const accounts: AnyAccount[] = [];
            const logs: string[] = [];

            const result = processDeficitDebt(-5000, accounts, logs);

            expect(result.existingDeficitDebt?.id).toBe('system-deficit-debt');
            expect(result.existingDeficitDebt?.name).toBe('Uncovered Deficit');
        });

        it('should log warning about uncovered deficit', () => {
            const accounts: AnyAccount[] = [];
            const logs: string[] = [];

            processDeficitDebt(-5000, accounts, logs);

            expect(logs.some(l => l.includes('Uncovered deficit'))).toBe(true);
            expect(logs.some(l => l.includes('$5,000'))).toBe(true);
        });
    });

    describe('existing deficit debt', () => {
        it('should add to existing deficit debt', () => {
            const existingDebt = new DeficitDebtAccount('system-deficit-debt', 'Uncovered Deficit', 3000);
            const accounts: AnyAccount[] = [existingDebt];
            const logs: string[] = [];

            const result = processDeficitDebt(-2000, accounts, logs);

            // Should accumulate: 3000 + 2000 = 5000
            expect(result.existingDeficitDebt?.amount).toBe(5000);
        });

        it('should log total deficit debt amount', () => {
            const existingDebt = new DeficitDebtAccount('system-deficit-debt', 'Uncovered Deficit', 3000);
            const accounts: AnyAccount[] = [existingDebt];
            const logs: string[] = [];

            processDeficitDebt(-2000, accounts, logs);

            expect(logs.some(l => l.includes('Total deficit debt'))).toBe(true);
            expect(logs.some(l => l.includes('$5,000'))).toBe(true);
        });
    });

    describe('return values', () => {
        it('should return existingDeficitDebt', () => {
            const accounts: AnyAccount[] = [];
            const logs: string[] = [];

            const result = processDeficitDebt(-1000, accounts, logs);

            expect(result.existingDeficitDebt).toBeInstanceOf(DeficitDebtAccount);
        });

        it('should return deficitDebtPayment', () => {
            const accounts: AnyAccount[] = [];
            const logs: string[] = [];

            const result = processDeficitDebt(-1000, accounts, logs);

            expect(result.deficitDebtPayment).toBeDefined();
            expect(typeof result.deficitDebtPayment).toBe('number');
        });

        it('should set discretionaryCash to 0 after debt creation', () => {
            const accounts: AnyAccount[] = [];
            const logs: string[] = [];

            const result = processDeficitDebt(-5000, accounts, logs);

            expect(result.discretionaryCash).toBe(0);
        });
    });
});
