import { describe, it, expect } from 'vitest';
import { InvestedAccount, reconstituteAccount } from '../../../components/Objects/Accounts/models';
import { defaultAssumptions, migrateAssumptions, type AssumptionsState } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { compactAssumptions, expandCompactAssumptions } from '../../../components/Objects/Accounts/QRTransfer/qrUtils';
import { getSimulationInputHash } from '../../../services/simulationHash';
import { defaultTaxState } from '../../../components/Objects/Taxes/TaxContext';

/**
 * #207: the per-account `stockPct` has to survive every hop a user's data takes —
 * serialization, QR transfer, and the simulation cache key. A dropped field here is
 * invisible in growth-math unit tests but silently reverts the user's allocation.
 */

describe('#207 allocation persistence', () => {
    describe('account reconstitution', () => {
        it('round-trips stockPct through JSON', () => {
            const acct = new InvestedAccount(
                'a1', 'Bonds-heavy IRA', 100_000, 0, 0, 0.1, 'Traditional IRA',
                true, 0.2, 100_000, undefined, [], [], 40,
            );
            const restored = reconstituteAccount(JSON.parse(JSON.stringify(acct)));
            expect((restored as InvestedAccount).stockPct).toBe(40);
        });

        it('leaves stockPct undefined for a pre-#207 account', () => {
            const legacy = {
                className: 'InvestedAccount', id: 'a1', name: 'Old', amount: 1000,
                taxType: 'Brokerage', costBasis: 1000,
            };
            const restored = reconstituteAccount(legacy);
            expect((restored as InvestedAccount).stockPct).toBeUndefined();
        });

        it('rejects a non-finite persisted stockPct rather than poisoning the blend', () => {
            const corrupt = {
                className: 'InvestedAccount', id: 'a1', name: 'Corrupt', amount: 1000,
                taxType: 'Brokerage', costBasis: 1000, stockPct: 'sixty',
            };
            const restored = reconstituteAccount(corrupt);
            expect((restored as InvestedAccount).stockPct).toBeUndefined();
        });
    });

    describe('QR transfer', () => {
        const withAllocation = (stockPct: number, bondRor: number): AssumptionsState => {
            const a = structuredClone(defaultAssumptions);
            a.investments.defaultAllocation = { stockPct };
            a.investments.returnRates.bondRor = bondRor;
            return a;
        };

        it('round-trips a non-default allocation and bond rate', () => {
            const restored = expandCompactAssumptions(compactAssumptions(withAllocation(60, 3.5) as unknown as Record<string, unknown>));
            const inv = restored.investments as AssumptionsState['investments'];
            expect(inv.defaultAllocation?.stockPct).toBe(60);
            expect(inv.returnRates.bondRor).toBe(3.5);
        });

        it('carries bondRor even when it sits at the default, so a 60/40 plan stays 60/40', () => {
            // bondRor and stockPct strip independently. If bondRor were strippable, this
            // plan would import with bonds blended at the STOCK rate.
            const defaultBond = defaultAssumptions.investments.returnRates.bondRor!;
            const restored = expandCompactAssumptions(compactAssumptions(withAllocation(60, defaultBond) as unknown as Record<string, unknown>));
            const inv = restored.investments as AssumptionsState['investments'];
            expect(inv.returnRates.bondRor).toBe(defaultBond);
            expect(inv.defaultAllocation?.stockPct).toBe(60);
        });

        it('round-trips an enabled glidepath', () => {
            const a = structuredClone(defaultAssumptions);
            a.investments.allocationGlidepath = {
                enabled: true, startAge: 45, endAge: 70, startStockPct: 90, endStockPct: 40,
            };
            const restored = expandCompactAssumptions(compactAssumptions(a as unknown as Record<string, unknown>));
            const inv = restored.investments as AssumptionsState['investments'];
            expect(inv.allocationGlidepath).toEqual(a.investments.allocationGlidepath);
        });
    });

    describe('migrateAssumptions', () => {
        it('backfills the new fields for a pre-#207 save', () => {
            const legacy = {
                investments: { returnRates: { ror: 7 }, withdrawalRate: 4 },
            };
            const migrated = migrateAssumptions(legacy, defaultAssumptions);
            expect(migrated.investments.returnRates.ror).toBe(7);
            expect(migrated.investments.returnRates.bondRor).toBe(
                defaultAssumptions.investments.returnRates.bondRor,
            );
            expect(migrated.investments.defaultAllocation?.stockPct).toBe(100);
            expect(migrated.investments.allocationGlidepath).toBeUndefined();
        });

        it('preserves a saved glidepath (mergeSection only walks default keys)', () => {
            const saved = {
                investments: {
                    returnRates: { ror: 7, bondRor: 3 },
                    defaultAllocation: { stockPct: 70 },
                    allocationGlidepath: {
                        enabled: true, startAge: 50, endAge: 65, startStockPct: 80, endStockPct: 30,
                    },
                },
            };
            const migrated = migrateAssumptions(saved, defaultAssumptions);
            expect(migrated.investments.defaultAllocation?.stockPct).toBe(70);
            expect(migrated.investments.allocationGlidepath).toEqual(
                saved.investments.allocationGlidepath,
            );
        });
    });

    describe('simulation cache key', () => {
        const baseAccount = () => new InvestedAccount(
            'a1', 'IRA', 100_000, 0, 0, 0.1, 'Traditional IRA', true, 0.2, 100_000,
        );

        it('changes when a per-account stockPct changes', () => {
            const before = baseAccount();
            const after = baseAccount();
            after.stockPct = 40;
            const hashOf = (a: InvestedAccount) =>
                getSimulationInputHash([a], [], [], defaultAssumptions, defaultTaxState);
            expect(hashOf(after)).not.toBe(hashOf(before));
        });

        it('changes when the global allocation changes', () => {
            const acct = baseAccount();
            const shifted = structuredClone(defaultAssumptions);
            shifted.investments.defaultAllocation = { stockPct: 55 };
            expect(getSimulationInputHash([acct], [], [], shifted, defaultTaxState))
                .not.toBe(getSimulationInputHash([acct], [], [], defaultAssumptions, defaultTaxState));
        });
    });
});
