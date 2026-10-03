/**
 * OBBBA senior bonus ($6,000/person, tax years 2025–2028) is NOT available to
 * Married Filing Separately filers: IRC §151(d)(5) (OBBBA §70103) allows it to a
 * married individual only if a joint return is filed. The regular 65+ additional
 * standard deduction (IRC §63(f)) still applies to MFS.
 */
import { describe, it, expect } from 'vitest';

import { getTaxParameters } from '../../components/Objects/Taxes/taxService/parameters';
import { getEffectiveDeduction } from '../../components/Objects/Taxes/taxService/federalTax';
import { defaultAssumptions } from '../../components/Objects/Assumptions/AssumptionsContext';

describe('OBBBA senior bonus — Married Filing Separately', () => {
    for (const year of [2025, 2026, 2027, 2028]) {
        it(`${year}: a 66-year-old MFS filer gets only the regular 65+ add-on, no $6,000 bonus`, () => {
            const p = getTaxParameters(year, 'Married Filing Separately', 'federal', undefined, defaultAssumptions)!;
            const deduction = getEffectiveDeduction(p, 'Married Filing Separately', 66, year, 40_000, 0, 'Standard');
            expect(deduction).toBe(p.standardDeduction + p.seniorDeduction!);
        });
    }

    it('Single and MFJ still receive the bonus', () => {
        const single = getTaxParameters(2026, 'Single', 'federal', undefined, defaultAssumptions)!;
        expect(getEffectiveDeduction(single, 'Single', 66, 2026, 40_000, 0, 'Standard'))
            .toBe(single.standardDeduction + single.seniorDeduction! + 6000);

        const mfj = getTaxParameters(2026, 'Married Filing Jointly', 'federal', undefined, defaultAssumptions)!;
        expect(getEffectiveDeduction(mfj, 'Married Filing Jointly', 66, 2026, 40_000, 0, 'Standard'))
            .toBe(mfj.standardDeduction + 2 * mfj.seniorDeduction! + 12000);
    });
});
