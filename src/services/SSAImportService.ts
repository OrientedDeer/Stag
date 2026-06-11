/**
 * SSA XML Import Service
 *
 * Parses Social Security Administration XML export files to extract
 * earnings history for use in benefit calculations.
 *
 * XML Format (from ssa.gov):
 * <osss:EarningsRecord>
 *   <osss:Earnings startYear="2020" endYear="2020">
 *     <osss:FicaEarnings>50000</osss:FicaEarnings>
 *     <osss:MedicareEarnings>50000</osss:MedicareEarnings>
 *   </osss:Earnings>
 * </osss:EarningsRecord>
 */

import { EarningsRecord } from './SocialSecurityCalculator';

export interface SSAEarningsImport {
  earnings: EarningsRecord[];
  dateOfBirth?: string;
  name?: string;
}

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
}

/**
 * Parse SSA XML export file and extract earnings history.
 * Handles both full XML files and EarningsRecord snippets.
 * Works with or without the osss: namespace prefix.
 */
export function parseSSAXml(xmlString: string): SSAEarningsImport {
  // Wrap snippet in root element if needed (for pasted EarningsRecord sections)
  let xmlToParse = xmlString.trim();
  if (!xmlToParse.startsWith('<?xml') && !xmlToParse.includes('OnlineSocialSecurityStatementData')) {
    xmlToParse = `<?xml version="1.0"?><root>${xmlToParse}</root>`;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlToParse, 'text/xml');

  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid XML format');
  }

  const earnings: EarningsRecord[] = [];

  // Find all Earnings elements (handles both osss:Earnings and Earnings)
  // querySelectorAll with local-name() doesn't work, so we try both patterns
  let earningsElements: Element[] = Array.from(doc.querySelectorAll('Earnings'));

  // If no elements found with simple selector, try getElementsByTagName which handles namespaces
  if (earningsElements.length === 0) {
    earningsElements = Array.from(doc.getElementsByTagName('osss:Earnings'));
  }

  earningsElements.forEach(el => {
    const startYear = el.getAttribute('startYear');
    const year = parseInt(startYear || '0', 10);

    // Find FicaEarnings - try both with and without namespace
    let ficaElement = el.querySelector('FicaEarnings');
    if (!ficaElement) {
      // Try with namespace
      const ficaElements = el.getElementsByTagName('osss:FicaEarnings');
      ficaElement = ficaElements[0] || null;
    }

    const ficaEarnings = parseInt(ficaElement?.textContent || '0', 10);

    // Filter out invalid entries:
    // - year must be valid
    // - earnings must be positive (-1 means "not yet recorded")
    if (year > 0 && ficaEarnings > 0) {
      earnings.push({ year, amount: ficaEarnings });
    }
  });

  // Sort by year ascending
  earnings.sort((a, b) => a.year - b.year);

  // Extract optional user info
  let dateOfBirth: string | undefined;
  let name: string | undefined;

  const dobElement = doc.querySelector('DateOfBirth') ||
                     doc.getElementsByTagName('osss:DateOfBirth')[0];
  if (dobElement?.textContent) {
    // Parse ISO date format: 2001-04-11T00:00:00 or just 2001-04-11
    dateOfBirth = dobElement.textContent.split('T')[0];
  }

  const nameElement = doc.querySelector('Name') ||
                      doc.getElementsByTagName('osss:Name')[0];
  if (nameElement?.textContent) {
    name = nameElement.textContent;
  }

  return { earnings, dateOfBirth, name };
}

/**
 * Validate imported earnings against app's birth year.
 * Returns warnings for suspicious data but doesn't block import.
 */
export function validateEarningsImport(
  earnings: EarningsRecord[],
  appBirthYear: number
): ValidationResult {
  const warnings: string[] = [];

  if (earnings.length === 0) {
    warnings.push('No valid earnings records found');
    return { valid: false, warnings };
  }

  // Check if any earnings are before a reasonable working age (14)
  const earliestYear = Math.min(...earnings.map(e => e.year));
  const ageAtFirstEarnings = earliestYear - appBirthYear;
  if (ageAtFirstEarnings < 14) {
    warnings.push(
      `Earliest earnings (${earliestYear}) would be at age ${ageAtFirstEarnings}. ` +
      `This may indicate a birth year mismatch.`
    );
  }

  // Check for suspiciously old earnings (before 1951 - SS started tracking)
  if (earliestYear < 1951) {
    warnings.push(`Earnings found before 1951 (${earliestYear}), which is before SS records began`);
  }

  // Check for future years that slipped through
  const currentYear = new Date().getFullYear();
  const futureEarnings = earnings.filter(e => e.year > currentYear);
  if (futureEarnings.length > 0) {
    warnings.push(`Found ${futureEarnings.length} future year(s) which will be ignored`);
  }

  return { valid: warnings.length === 0, warnings };
}

/**
 * Format earnings summary for display
 */
export function formatEarningsSummary(earnings: EarningsRecord[]): string {
  if (earnings.length === 0) return 'No earnings';

  const years = earnings.map(e => e.year).sort((a, b) => a - b);
  const firstYear = years[0];
  const lastYear = years[years.length - 1];
  const totalEarnings = earnings.reduce((sum, e) => sum + e.amount, 0);

  return `${earnings.length} years (${firstYear}-${lastYear}), $${totalEarnings.toLocaleString()} total`;
}
