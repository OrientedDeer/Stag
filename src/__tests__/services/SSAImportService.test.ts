/**
 * Unit tests for SSA XML Import Service
 */
import { describe, it, expect } from 'vitest';
import { parseSSAXml, validateEarningsImport, formatEarningsSummary } from '../../services/SSAImportService';

describe('SSAImportService', () => {
  describe('parseSSAXml', () => {
    it('should parse a full SSA XML file with namespace', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<osss:OnlineSocialSecurityStatementData xmlns:osss="http://ssa.gov/osss/schemas/2.0">
    <osss:FileCreationDate>2026-01-13T07:44:17.257-05:00</osss:FileCreationDate>
    <osss:UserInformation>
        <osss:Name>JOHN DOE</osss:Name>
        <osss:DateOfBirth>1990-05-15</osss:DateOfBirth>
    </osss:UserInformation>
    <osss:EarningsRecord>
        <osss:Earnings startYear="2020" endYear="2020">
            <osss:FicaEarnings>50000</osss:FicaEarnings>
            <osss:MedicareEarnings>50000</osss:MedicareEarnings>
        </osss:Earnings>
        <osss:Earnings startYear="2021" endYear="2021">
            <osss:FicaEarnings>55000</osss:FicaEarnings>
            <osss:MedicareEarnings>55000</osss:MedicareEarnings>
        </osss:Earnings>
        <osss:Earnings startYear="2022" endYear="2022">
            <osss:FicaEarnings>60000</osss:FicaEarnings>
            <osss:MedicareEarnings>60000</osss:MedicareEarnings>
        </osss:Earnings>
    </osss:EarningsRecord>
</osss:OnlineSocialSecurityStatementData>`;

      const result = parseSSAXml(xml);

      expect(result.earnings).toHaveLength(3);
      expect(result.earnings[0]).toEqual({ year: 2020, amount: 50000 });
      expect(result.earnings[1]).toEqual({ year: 2021, amount: 55000 });
      expect(result.earnings[2]).toEqual({ year: 2022, amount: 60000 });
      expect(result.dateOfBirth).toBe('1990-05-15');
      expect(result.name).toBe('JOHN DOE');
    });

    it('should filter out -1 values (not yet recorded)', () => {
      const xml = `<?xml version="1.0"?>
<root>
    <EarningsRecord>
        <Earnings startYear="2023" endYear="2023">
            <FicaEarnings>80000</FicaEarnings>
        </Earnings>
        <Earnings startYear="2024" endYear="2024">
            <FicaEarnings>-1</FicaEarnings>
        </Earnings>
        <Earnings startYear="2025" endYear="2025">
            <FicaEarnings>-1</FicaEarnings>
        </Earnings>
    </EarningsRecord>
</root>`;

      const result = parseSSAXml(xml);

      expect(result.earnings).toHaveLength(1);
      expect(result.earnings[0]).toEqual({ year: 2023, amount: 80000 });
    });

    it('should filter out zero earnings', () => {
      const xml = `<?xml version="1.0"?>
<root>
    <Earnings startYear="2020" endYear="2020">
        <FicaEarnings>0</FicaEarnings>
    </Earnings>
    <Earnings startYear="2021" endYear="2021">
        <FicaEarnings>50000</FicaEarnings>
    </Earnings>
</root>`;

      const result = parseSSAXml(xml);

      expect(result.earnings).toHaveLength(1);
      expect(result.earnings[0].year).toBe(2021);
    });

    it('should handle XML snippet without root element', () => {
      const snippet = `
        <Earnings startYear="2022" endYear="2022">
            <FicaEarnings>75000</FicaEarnings>
        </Earnings>
        <Earnings startYear="2023" endYear="2023">
            <FicaEarnings>85000</FicaEarnings>
        </Earnings>`;

      const result = parseSSAXml(snippet);

      expect(result.earnings).toHaveLength(2);
      expect(result.earnings[0]).toEqual({ year: 2022, amount: 75000 });
      expect(result.earnings[1]).toEqual({ year: 2023, amount: 85000 });
    });

    it('should sort earnings by year ascending', () => {
      const xml = `<?xml version="1.0"?>
<root>
    <Earnings startYear="2023" endYear="2023">
        <FicaEarnings>80000</FicaEarnings>
    </Earnings>
    <Earnings startYear="2020" endYear="2020">
        <FicaEarnings>50000</FicaEarnings>
    </Earnings>
    <Earnings startYear="2022" endYear="2022">
        <FicaEarnings>70000</FicaEarnings>
    </Earnings>
</root>`;

      const result = parseSSAXml(xml);

      expect(result.earnings).toHaveLength(3);
      expect(result.earnings[0].year).toBe(2020);
      expect(result.earnings[1].year).toBe(2022);
      expect(result.earnings[2].year).toBe(2023);
    });

    it('should handle empty earnings record', () => {
      const xml = `<?xml version="1.0"?>
<root>
    <EarningsRecord>
    </EarningsRecord>
</root>`;

      const result = parseSSAXml(xml);

      expect(result.earnings).toHaveLength(0);
    });

    it('should throw on invalid XML', () => {
      const invalidXml = 'not xml at all < > & broken';

      expect(() => parseSSAXml(invalidXml)).toThrow('Invalid XML format');
    });
  });

  describe('validateEarningsImport', () => {
    it('should pass validation for reasonable earnings', () => {
      const earnings = [
        { year: 2015, amount: 30000 },
        { year: 2016, amount: 35000 },
        { year: 2020, amount: 50000 },
      ];

      const result = validateEarningsImport(earnings, 1990);

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should warn about earnings before age 14', () => {
      const earnings = [
        { year: 2000, amount: 5000 }, // Age 10 if birth year is 1990
        { year: 2010, amount: 30000 },
      ];

      const result = validateEarningsImport(earnings, 1990);

      expect(result.valid).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('age');
    });

    it('should warn about empty earnings', () => {
      const result = validateEarningsImport([], 1990);

      expect(result.valid).toBe(false);
      expect(result.warnings).toContain('No valid earnings records found');
    });

    it('should warn about earnings before 1951', () => {
      const earnings = [
        { year: 1950, amount: 1000 },
        { year: 2020, amount: 50000 },
      ];

      const result = validateEarningsImport(earnings, 1930);

      expect(result.valid).toBe(false);
      expect(result.warnings.some(w => w.includes('1951'))).toBe(true);
    });

    it('should warn about future year earnings', () => {
      const currentYear = new Date().getFullYear();
      const earnings = [
        { year: 2020, amount: 50000 },
        { year: currentYear + 1, amount: 60000 },
      ];

      const result = validateEarningsImport(earnings, 1990);

      expect(result.warnings.some(w => w.includes('future'))).toBe(true);
    });
  });

  describe('formatEarningsSummary', () => {
    it('should format single year of earnings', () => {
      const earnings = [{ year: 2023, amount: 80000 }];

      const result = formatEarningsSummary(earnings);

      expect(result).toContain('1 years');
      expect(result).toContain('2023-2023');
      expect(result).toContain('80,000');
    });

    it('should format multiple years of earnings', () => {
      const earnings = [
        { year: 2020, amount: 50000 },
        { year: 2021, amount: 55000 },
        { year: 2022, amount: 60000 },
        { year: 2023, amount: 80000 },
      ];

      const result = formatEarningsSummary(earnings);

      expect(result).toContain('4 years');
      expect(result).toContain('2020-2023');
      expect(result).toContain('245,000');
    });

    it('should handle empty earnings', () => {
      const result = formatEarningsSummary([]);

      expect(result).toBe('No earnings');
    });

    it('should handle non-consecutive years', () => {
      const earnings = [
        { year: 2015, amount: 30000 },
        { year: 2020, amount: 50000 },
        { year: 2023, amount: 80000 },
      ];

      const result = formatEarningsSummary(earnings);

      expect(result).toContain('3 years');
      expect(result).toContain('2015-2023');
    });
  });
});
