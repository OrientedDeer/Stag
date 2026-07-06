/**
 * #173: Working years at RMD age — RMD dollars must not vanish.
 *
 * processRMDs drains the Traditional account and surfaces the distribution as a
 * PassiveIncome with sourceType 'RMD' in the incomes list. The retirement path passes
 * that same total in as `rmdAmount`; solveWorkingYear passes 0. The classifier strips
 * the RMD-sourced passive income (it's meant to be re-added via `rmdAmount`), so with a
 * 0 argument the drained dollars were never taxed and never arrived as spendable cash.
 *
 * The fix derives the RMD from the incomes list when the caller passes 0, keeping the
 * retirement path (rmdAmount > 0) byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { classifyIncome } from '../../../services/simulation/IncomeClassifier';
import { PassiveIncome } from '../../../components/Objects/Income/models';

// Mirrors exactly how RMDService.processRMDs mints the RMD income.
function makeRmdIncome(accountId: string, year: number, amount: number): PassiveIncome {
    return new PassiveIncome(
        `rmd-${accountId}-${year}`,
        `RMD from ${accountId}`,
        amount,
        'Annually',
        'No',
        'RMD',
        new Date(year, 0, 1),
        new Date(year, 11, 31),
        false, // not reinvested — RMD is spendable
    );
}

describe('#173 IncomeClassifier — RMD in a working year (rmdAmount=0 path)', () => {
    it('counts the RMD as spendable/taxable when rmdAmount is 0 but an RMD income is present', () => {
        const rmd = makeRmdIncome('trad-ira', 2050, 40000);

        // solveWorkingYear passes rmdAmount=0.
        const result = classifyIncome([rmd], 0, 0, 2050);

        // Before the fix these were all 0 — the dollars left the account but never
        // arrived as income.
        expect(result.classified.spendable).toBe(40000);
        expect(result.classified.rmdIncome).toBe(40000);
        expect(result.classified.breakdown.rmd).toBe(40000);
        expect(result.classified.taxableTotal).toBe(40000);
    });

    it('sums multiple RMD incomes (e.g. two Traditional accounts)', () => {
        const rmdA = makeRmdIncome('trad-ira', 2050, 30000);
        const rmdB = makeRmdIncome('trad-401k', 2050, 12000);

        const result = classifyIncome([rmdA, rmdB], 0, 0, 2050);

        expect(result.classified.spendable).toBe(42000);
        expect(result.classified.rmdIncome).toBe(42000);
    });

    it('retirement path (rmdAmount > 0) stays byte-identical — no double-count', () => {
        const rmd = makeRmdIncome('trad-ira', 2050, 40000);

        // Retirement path: the same total is passed in AND the income is in the list.
        const result = classifyIncome([rmd], 40000, 0, 2050);

        // Exactly one RMD, not two: the passed amount wins and the list income is stripped.
        expect(result.classified.spendable).toBe(40000);
        expect(result.classified.rmdIncome).toBe(40000);
        expect(result.classified.taxableTotal).toBe(40000);
    });
});
