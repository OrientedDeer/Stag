/**
 * Regression test: future-year FicaEarnings records must be dropped at parse
 * time so they never reach AIME/PIA.
 *
 * The import flow shows a "Found N future year(s) which will be ignored"
 * warning. That promise was previously false — the full earnings array was
 * dispatched and every record landed in calculateAIME's top-35, inflating
 * AIME/PIA above reality. parseSSAXml now excludes future years so the warning
 * is honored.
 */
import { describe, it, expect } from 'vitest';
import { parseSSAXml } from '../../services/SSAImportService';

describe('parseSSAXml — future-year filtering', () => {
  it('drops a future-year earnings record while keeping past/current years', () => {
    const currentYear = new Date().getFullYear();
    const futureYear = currentYear + 5;

    const xml = `<?xml version="1.0"?>
<root>
    <EarningsRecord>
        <Earnings startYear="${currentYear - 1}" endYear="${currentYear - 1}">
            <FicaEarnings>50000</FicaEarnings>
        </Earnings>
        <Earnings startYear="${currentYear}" endYear="${currentYear}">
            <FicaEarnings>60000</FicaEarnings>
        </Earnings>
        <Earnings startYear="${futureYear}" endYear="${futureYear}">
            <FicaEarnings>999999</FicaEarnings>
        </Earnings>
    </EarningsRecord>
</root>`;

    const result = parseSSAXml(xml);

    const years = result.earnings.map(e => e.year);
    expect(years).toContain(currentYear - 1);
    expect(years).toContain(currentYear);
    expect(years).not.toContain(futureYear);
    expect(result.earnings).toHaveLength(2);
    // The crafted future-year amount must not appear at all.
    expect(result.earnings.some(e => e.amount === 999999)).toBe(false);
  });

  it('keeps the current year (boundary is inclusive)', () => {
    const currentYear = new Date().getFullYear();

    const xml = `<?xml version="1.0"?>
<root>
    <Earnings startYear="${currentYear}" endYear="${currentYear}">
        <FicaEarnings>70000</FicaEarnings>
    </Earnings>
</root>`;

    const result = parseSSAXml(xml);

    expect(result.earnings).toHaveLength(1);
    expect(result.earnings[0]).toEqual({ year: currentYear, amount: 70000 });
  });
});
