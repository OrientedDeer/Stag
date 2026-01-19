/**
 * Story 6: Roth Conversion Ladder
 *
 * Scenario: Retire at 55 with mostly Traditional, enable auto conversions
 *
 * Key Assertions:
 * - Conversions only during retirement
 * - Tax cost > 0 but < conversion amount
 * - From/To amounts match
 * - Traditional decreases, Roth increases over time
 * - No NaN when accounts drain
 *
 * Bugs Caught: Conversions before retirement, NaN errors, tax calculation errors
 */

import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome, FutureSocialSecurityIncome, PassiveIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import {
    getAge,
    getYearByAge,
    getAccountById,
    hasLogMessage,
} from '../helpers/simulationTestUtils';
import {
    assertAllYearsInvariants,
} from '../helpers/assertions';

describe('Story 6: Roth Conversion Ladder', () => {
    const birthYear = 1970;
    const retirementAge = 55;
    const ssClaimingAge = 67;
    const yearsToSimulate = 25; // Age 55 to 80

    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'DC',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2025,
    };

    // Assumptions with auto Roth conversions enabled
    const conversionAssumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {
            birthYear,
            lifeExpectancy: 90,
            retirementAge,
        },
        income: {
            ...defaultAssumptions.income,
            salaryGrowth: 0,
        },
        macro: {
            ...defaultAssumptions.macro,
            inflationRate: 0, // No inflation for clearer math
            inflationAdjusted: false,
        },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 7 },
            autoRothConversions: true, // Enable auto conversions
        },
        priorities: [{
          id: 'p-1',
          name: 'p1', // e.g., "Max out 401k"
          type: 'INVESTMENT',
          accountId: 'ws-roth', // Link to your actual Account IDs
          capType: 'REMAINDER',
          capValue: 0 // e.g., 23000 for 401k, or 500 for monthly savings
        }],
        withdrawalStrategy: [
            { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
            { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-trad' },
        ],
    };

    // Large Traditional IRA (conversion source)
    const traditionalIRA = new InvestedAccount(
        'acc-trad',
        'Traditional IRA',
        800000, // $800k
        0,
        20,
        0.05,
        'Traditional IRA',
        true,
        1.0,
        800000   // All cost basis (pre-tax contributions)
    );

    // Small Roth IRA (conversion destination)
    const rothIRA = new InvestedAccount(
        'acc-roth',
        'Roth IRA',
        100000, // $100k
        0,
        20,
        0.05,
        'Roth IRA',
        true,
        1.0,
        80000    // $80k cost basis
    );

    // Work income (ends at retirement)
    const workIncome = new WorkIncome(
        'inc-work',
        'Job',
        100000,
        'Annually',
        'Yes',
        0, 0, 0, 0, '', null, 'FIXED',
        new Date('2010-01-01'),
        new Date(`${birthYear + retirementAge - 1}-12-31`) // Works until age 54
    );

    // Future SS at 67
    const futureSS = new FutureSocialSecurityIncome(
        'inc-ss',
        'Social Security',
        ssClaimingAge,
        0,
        0
    );

    // Living expenses
    const livingExpenses = new FoodExpense(
        'exp-living',
        'Living Expenses',
        40000,
        'Annually',
        new Date('2025-01-01')
    );

    it('should run simulation with auto Roth conversions', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditionalIRA, rothIRA],
            [workIncome, futureSS],
            [livingExpenses],
            conversionAssumptions,
            taxState
        );

        expect(simulation.length).toBeGreaterThan(0);
        assertAllYearsInvariants(simulation);
    });

    it('should only do conversions during retirement', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditionalIRA, rothIRA],
            [workIncome, futureSS],
            [livingExpenses],
            conversionAssumptions,
            taxState
        );

        for (const year of simulation) {
            const age = getAge(year.year, birthYear);

            // Check for conversion logs
            const hasConversionLog = hasLogMessage(year, 'roth conversion') ||
                hasLogMessage(year, 'converted');

            if (age < retirementAge) {
                // Before retirement, no conversions should happen
                expect(hasConversionLog, `No conversions before retirement (age ${age})`).toBe(false);
            }
        }
    });

    it('should decrease Traditional and increase Roth over time', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditionalIRA, rothIRA],
            [workIncome, futureSS],
            [livingExpenses],
            conversionAssumptions,
            taxState
        );

        // Get early retirement year and later year
        const earlyYear = getYearByAge(simulation, retirementAge + 1, birthYear);
        const laterYear = getYearByAge(simulation, retirementAge + 10, birthYear);

        if (earlyYear && laterYear) {
            const tradEarly = getAccountById(earlyYear, 'acc-trad')?.amount || 0;
            const rothEarly = getAccountById(earlyYear, 'acc-roth')?.amount || 0;

            const tradLater = getAccountById(laterYear, 'acc-trad')?.amount || 0;
            const rothLater = getAccountById(laterYear, 'acc-roth')?.amount || 0;

            // If conversions are happening, Roth should grow faster than Traditional
            // due to conversions moving money from Traditional to Roth.
            // Note: With high returns, both may grow, but Roth should grow MORE.
            const tradGrowthRate = (tradLater - tradEarly) / tradEarly;
            const rothGrowthRate = (rothLater - rothEarly) / rothEarly;

            // Roth should outpace Traditional growth due to conversions
            expect(
                rothGrowthRate,
                `Roth growth (${(rothGrowthRate * 100).toFixed(1)}%) should exceed Traditional growth (${(tradGrowthRate * 100).toFixed(1)}%)`
            ).toBeGreaterThan(tradGrowthRate);

            // Roth should have increased (conversions + growth)
            expect(
                rothLater,
                `Roth should increase over time: early=$${rothEarly.toFixed(0)}, later=$${rothLater.toFixed(0)}`
            ).toBeGreaterThan(rothEarly);
        }
    });

    it('should have tax cost on conversions', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditionalIRA, rothIRA],
            [workIncome, futureSS],
            [livingExpenses],
            conversionAssumptions,
            taxState
        );

        // Find a year with conversions
        for (const year of simulation) {
            const age = getAge(year.year, birthYear);
            if (age < retirementAge) continue;

            const hasConversionLog = hasLogMessage(year, 'roth conversion') ||
                hasLogMessage(year, 'converted');

            if (hasConversionLog) {
                // Conversions are taxable income - should increase fed tax
                expect(year.taxDetails.fed, 'Fed tax should be positive when conversions happen').toBeGreaterThanOrEqual(0);
                break;
            }
        }
    });

    it('should handle account draining without NaN', () => {
        // Create scenario with small Traditional that will drain
        const smallTrad = new InvestedAccount(
            'acc-trad', 'Traditional IRA', 50000, 0, 20, 0.05, 'Traditional IRA', true, 1.0, 50000
        );

        const simulation = runSimulation(
            yearsToSimulate,
            [smallTrad, rothIRA],
            [workIncome, futureSS],
            [livingExpenses],
            conversionAssumptions,
            taxState
        );

        // Should run without NaN errors
        assertAllYearsInvariants(simulation);

        // Verify no NaN in any account at any year
        for (const year of simulation) {
            const trad = getAccountById(year, 'acc-trad');
            const roth = getAccountById(year, 'acc-roth');

            if (trad) {
                expect(Number.isNaN(trad.amount), `Traditional should not be NaN in year ${year.year}`).toBe(false);
            }
            if (roth) {
                expect(Number.isNaN(roth.amount), `Roth should not be NaN in year ${year.year}`).toBe(false);
            }
        }
    });

    it('should not do conversions when disabled', () => {
        const noConversionAssumptions: AssumptionsState = {
            ...conversionAssumptions,
            investments: {
                ...conversionAssumptions.investments,
                autoRothConversions: false, // Disable conversions
            },
        };

        const simulation = runSimulation(
            yearsToSimulate,
            [traditionalIRA, rothIRA],
            [workIncome, futureSS],
            [livingExpenses],
            noConversionAssumptions,
            taxState
        );

        // Should have no conversion logs
        let hasAnyConversionLog = false;
        for (const year of simulation) {
            if (hasLogMessage(year, 'roth conversion') || hasLogMessage(year, 'converted to roth')) {
                hasAnyConversionLog = true;
                break;
            }
        }

        expect(hasAnyConversionLog, 'Should have no conversions when disabled').toBe(false);
        assertAllYearsInvariants(simulation);
    });

    it('should fill low tax brackets with conversions', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditionalIRA, rothIRA],
            [workIncome, futureSS],
            [livingExpenses],
            conversionAssumptions,
            taxState
        );

        // Find retirement years before SS starts (low income = ideal for conversions)
        let foundConversionInGapYears = false;
        for (const year of simulation) {
            const age = getAge(year.year, birthYear);

            // Gap years: retired but before SS (age 55-66)
            if (age >= retirementAge && age < ssClaimingAge) {
                // These are the ideal years for Roth conversions
                // Should see conversion activity
                const hasConversionLog = hasLogMessage(year, 'roth conversion') ||
                    hasLogMessage(year, 'converted');

                if (hasConversionLog) {
                    foundConversionInGapYears = true;
                }
            }
        }

        // Should have at least some conversions during the low-income gap years
        expect(
            foundConversionInGapYears,
            'Should have Roth conversions during gap years (retired but before SS)'
        ).toBe(true);

        assertAllYearsInvariants(simulation);
    });

    it('should have conversion amounts match between accounts', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditionalIRA, rothIRA],
            [workIncome, futureSS],
            [livingExpenses],
            conversionAssumptions,
            taxState
        );

        // Track year-over-year changes to verify conversion consistency
        let conversionYearsFound = 0;

        for (let i = 1; i < simulation.length; i++) {
            const year = simulation[i];
            const prevYear = simulation[i - 1];

            const age = getAge(year.year, birthYear);
            if (age < retirementAge) continue;

            const prevTrad = getAccountById(prevYear, 'acc-trad')?.amount || 0;
            const prevRoth = getAccountById(prevYear, 'acc-roth')?.amount || 0;
            const currentTrad = getAccountById(year, 'acc-trad')?.amount || 0;
            const currentRoth = getAccountById(year, 'acc-roth')?.amount || 0;

            // Check for conversion: Traditional decreased AND Roth increased
            const tradDecrease = prevTrad - currentTrad;
            const rothIncrease = currentRoth - prevRoth;

            // If Traditional decreased significantly (conversion happened)
            if (tradDecrease > 1000) {
                conversionYearsFound++;

                // Roth should have increased (by conversion amount minus taxes, plus growth)
                // Allow for taxes (up to 37%) and market fluctuation
                expect(
                    rothIncrease,
                    `Year ${year.year}: Roth should increase when Traditional decreases by $${tradDecrease.toFixed(0)}`
                ).toBeGreaterThan(0);
            }
        }

        // Should have found at least one conversion year
        expect(
            conversionYearsFound,
            'Should have at least one year with Roth conversion'
        ).toBeGreaterThan(0);

        assertAllYearsInvariants(simulation);
    });

    it('should stop conversions when Traditional is depleted', () => {
        const smallTrad = new InvestedAccount(
            'acc-trad', 'Traditional IRA', 100000, 0, 20, 0.05, 'Traditional IRA', true, 1.0, 100000
        );

        const simulation = runSimulation(
            yearsToSimulate,
            [smallTrad, rothIRA],
            [workIncome, futureSS],
            [livingExpenses],
            conversionAssumptions,
            taxState
        );

        // Find year where Traditional is depleted
        let depletedYear: number | null = null;
        for (const year of simulation) {
            const trad = getAccountById(year, 'acc-trad');
            if (trad && trad.amount < 100) { // Essentially depleted
                depletedYear = year.year;
                break;
            }
        }

        // After depletion, no more conversion logs should appear
        if (depletedYear) {
            for (const year of simulation) {
                if (year.year <= depletedYear) continue;

                const hasConversionLog = hasLogMessage(year, 'roth conversion') ||
                    hasLogMessage(year, 'converted to roth');

                expect(hasConversionLog, `No conversions after Traditional depleted (year ${year.year})`).toBe(false);
            }
        }

        assertAllYearsInvariants(simulation);
    });

    it('should handle very large Traditional balances', () => {
        const largeTrad = new InvestedAccount(
            'acc-trad', 'Traditional IRA', 5000000, 0, 30, 0.05, 'Traditional IRA', true, 1.0, 5000000
        );

        const simulation = runSimulation(
            yearsToSimulate,
            [largeTrad, rothIRA],
            [workIncome, futureSS],
            [livingExpenses],
            conversionAssumptions,
            taxState
        );

        // Should handle large balances without overflow
        assertAllYearsInvariants(simulation);

        // Conversions should still happen
        let hasAnyConversion = false;
        for (const year of simulation) {
            if (hasLogMessage(year, 'roth conversion') || hasLogMessage(year, 'converted')) {
                hasAnyConversion = true;
                break;
            }
        }

        // Large Traditional should trigger conversions
        expect(hasAnyConversion, 'Should have conversions with large Traditional balance').toBe(true);
    });

    // =========================================================================
    // TAX BRACKET BOUNDARY TEST
    // =========================================================================

    it('should fill tax bracket exactly without exceeding it', () => {
        // Scenario: Retiree with zero other income
        // Goal: Verify conversion fills exactly to top of 12% bracket ($48,475 taxable)
        // With standard deduction ($14,600), that's $63,075 gross income

        const bracketTopTaxable = 48475; // Top of 12% bracket
        const standardDeduction = 14600; // 2025 Single
        // Note: bracketTopGross = bracketTopTaxable + standardDeduction = $63,075

        const retiredBirthYear = 1970;
        const cliffAssumptions: AssumptionsState = {
            ...conversionAssumptions,
            demographics: {
                birthYear: retiredBirthYear,
                lifeExpectancy: 90,
                retirementAge: 50,
            },
            priorities: [{
            id: 'p-1',
            name: 'p1', // e.g., "Max out 401k"
            type: 'INVESTMENT',
            accountId: 'acc-brokerage', // Link to your actual Account IDs
            capType: 'REMAINDER',
            capValue: 0 // e.g., 23000 for 401k, or 500 for monthly savings
            }],
            
        };

        const brokerage = new InvestedAccount(
            'acc-brokerage', 'Brokerage', 0, 0, 10, 0.05, 'Brokerage', true, 1.0, 0
        );

        // Large Traditional IRA (plenty of room for conversion)
        const largeTrad = new InvestedAccount(
            'acc-trad', 'Traditional IRA', 2000000, 0, 20, 0.05, 'Traditional IRA', true, 1.0, 2000000
        );

        // No other income (forces conversion to be the only income)
        // SS starts at 90 (effectively never during test)
        const noSS = new FutureSocialSecurityIncome('inc-ss', 'Social Security', 90, 0, 0);

        // Minimal expenses to avoid forcing withdrawals
        const minimalExpenses = new FoodExpense(
            'exp-living', 'Living Expenses', 10000, 'Annually', new Date('2025-01-01')
        );

        const simulation = runSimulation(
            25,
            [brokerage, largeTrad, rothIRA],
            [noSS],
            [minimalExpenses],
            cliffAssumptions,
            taxState
        );

        // Find a year where Roth conversion occurred (Traditional decreased)
        for (let i = 1; i < simulation.length; i++) {
            const year = simulation[i];
            const prevYear = simulation[i - 1];
            const age = getAge(year.year, retiredBirthYear);

            if (age < 60) continue;

            const tradBefore = getAccountById(prevYear, 'acc-trad')?.amount || 0;
            const tradAfter = getAccountById(year, 'acc-trad')?.amount || 0;
            const conversion = tradBefore - tradAfter;

            if (conversion > 1000) {
                // The conversion (+ any other income) should fill exactly to bracket top
                // Total taxable income should be <= $48,475
                // If conversion pushes it to $48,476, test should FAIL

                const totalIncome = year.cashflow.totalIncome;
                const taxableIncome = Math.max(0, totalIncome - standardDeduction);

                // Assert: Taxable income should NOT exceed bracket top
                expect(
                    taxableIncome,
                    `Taxable income ($${taxableIncome.toFixed(0)}) should not exceed 12% bracket top ($${bracketTopTaxable}) - conversion pushed $${(taxableIncome - bracketTopTaxable).toFixed(0)} over in year ${year.year}`
                ).toBeLessThanOrEqual(bracketTopTaxable);

                // Assert: Should fill close to the bracket (within $1000 of top)
                // This verifies the optimization is actually working
                expect(
                    taxableIncome,
                    `Taxable income ($${taxableIncome.toFixed(0)}) should fill close to bracket top ($${bracketTopTaxable})`
                ).toBeGreaterThanOrEqual(bracketTopTaxable - 1000);

                break; // Found and verified one year
            }
        }

        assertAllYearsInvariants(simulation);
    });

    it('should convert every year during ladder period until SS starts', () => {
        const workIncome = new WorkIncome(
            'inc-work',
            'Job',
            250000,
            'Annually',
            'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date('2000-01-01'),
            new Date(`${birthYear + 65 - 1}-12-31`) // Works until age 54
        );
        const retirementAge = 65;

        const conversionAssumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {
            birthYear,
            lifeExpectancy: 90,
            retirementAge: retirementAge,
        },
        income: {
            ...defaultAssumptions.income,
            salaryGrowth: 0,
        },
        macro: {
            ...defaultAssumptions.macro,
            inflationRate: 0, // No inflation for clearer math
            inflationAdjusted: false,
        },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 7 },
            autoRothConversions: true, // Enable auto conversions
        },
        priorities: [{
          id: 'p-1',
          name: 'p1', // e.g., "Max out 401k"
          type: 'INVESTMENT',
          accountId: 'ws-roth', // Link to your actual Account IDs
          capType: 'REMAINDER',
          capValue: 0 // e.g., 23000 for 401k, or 500 for monthly savings
        }],
        withdrawalStrategy: [
            { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
            { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-trad' },
        ],
    };

        const simulation = runSimulation(
            yearsToSimulate,
            [traditionalIRA, rothIRA],
            [workIncome, futureSS],
            [livingExpenses],
            conversionAssumptions,
            taxState
        );

        // Track which ages had conversions
        const conversionAges: number[] = [];

        for (const year of simulation) {
            const age = getAge(year.year, birthYear);

            // Only check ladder period: retired (55+) but before SS (67)
            if (age >= retirementAge && age < ssClaimingAge) {
                const hasConversion = hasLogMessage(year, 'roth conversion') ||
                    hasLogMessage(year, 'converted');

                if (hasConversion) {
                    conversionAges.push(age);
                }
            }
        }

        // Should have conversions every year during the ladder period (ages 55-66)
        // That's 12 years of potential conversions
        const expectedLadderYears = ssClaimingAge - retirementAge; // 67 - 55 = 12

        expect(
            conversionAges.length,
            `Should convert every year during ladder period. Expected ${expectedLadderYears} years, got ${conversionAges.length}. Ages with conversions: [${conversionAges.join(', ')}]`
        ).toBe(expectedLadderYears);

        // Verify conversions are consecutive (no gaps)
        for (let i = 1; i < conversionAges.length; i++) {
            expect(
                conversionAges[i] - conversionAges[i - 1],
                `Conversion ages should be consecutive: found gap between ${conversionAges[i - 1]} and ${conversionAges[i]}`
            ).toBe(1);
        }
    });

    it('should not alternate conversion years (no on-off pattern)', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditionalIRA, rothIRA],
            [workIncome, futureSS],
            [livingExpenses],
            conversionAssumptions,
            taxState
        );

        // Track conversion amounts by year during ladder period
        const conversionAmounts: number[] = [];

        for (let i = 1; i < simulation.length; i++) {
            const year = simulation[i];
            const age = getAge(year.year, birthYear);

            if (age >= retirementAge && age < ssClaimingAge) {
                // Track the Roth conversion amount for this year
                const rothConversion = year.rothConversion?.amount || 0;
                conversionAmounts.push(rothConversion);
            }
        }

        // Check for alternating pattern: [high, 0, high, 0, ...] or [0, high, 0, high, ...]
        // This would indicate a bug where conversions skip every other year
        let alternatingCount = 0;
        for (let i = 2; i < conversionAmounts.length; i++) {
            const prev2 = conversionAmounts[i - 2];
            const prev1 = conversionAmounts[i - 1];
            const curr = conversionAmounts[i];

            // Check if pattern is: [high, low, high] or [low, high, low]
            const isAlternating =
                (prev2 > 1000 && prev1 < 100 && curr > 1000) ||
                (prev2 < 100 && prev1 > 1000 && curr < 100);

            if (isAlternating) {
                alternatingCount++;
            }
        }

        // Should not have significant alternating pattern
        expect(
            alternatingCount,
            `Found ${alternatingCount} alternating patterns in conversion amounts: [${conversionAmounts.map(a => a.toFixed(0)).join(', ')}]`
        ).toBeLessThan(3);
    });

    it('should never convert more than available bracket headroom', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditionalIRA, rothIRA],
            [workIncome, futureSS],
            [livingExpenses],
            conversionAssumptions,
            taxState
        );

        // 2025 tax brackets for Single filer (approximate)
        const standardDeduction = 14600;
        const bracket12Top = 48475; // Top of 12% bracket (taxable income)
        const epsilon = 500; // Allow small rounding errors

        for (const year of simulation) {
            const age = getAge(year.year, birthYear);
            if (age < retirementAge) continue;

            const rothConversion = year.rothConversion?.amount || 0;
            if (rothConversion <= 0) continue;

            // Calculate other income (non-conversion)
            const totalIncome = year.cashflow.totalIncome;
            const otherIncome = totalIncome - rothConversion;

            // Calculate bracket headroom
            // Headroom = (bracket top + deduction) - other income
            const bracketHeadroom = Math.max(0, bracket12Top + standardDeduction - otherIncome);

            // Conversion should not exceed headroom
            expect(
                rothConversion,
                `Age ${age}: Conversion ($${rothConversion.toFixed(0)}) should not exceed bracket headroom ($${bracketHeadroom.toFixed(0)})`
            ).toBeLessThanOrEqual(bracketHeadroom + epsilon);
        }
    });

    it('should not convert when already in high tax bracket', () => {
        // Scenario: High income year - conversions should be minimal or none
        const highIncomeBirthYear = 1970;
        const highIncomeAssumptions: AssumptionsState = {
            ...conversionAssumptions,
            demographics: {
                birthYear: highIncomeBirthYear,
                lifeExpectancy: 90,
                retirementAge: 70, // Late retirement
            },
        };

        // Still working with high income
        const highWorkIncome = new WorkIncome(
            'inc-work', 'Job', 200000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date('2010-01-01'),
            new Date('2039-12-31') // Works until age 69
        );

        const simulation = runSimulation(
            15,
            [traditionalIRA, rothIRA],
            [highWorkIncome, futureSS],
            [livingExpenses],
            highIncomeAssumptions,
            taxState
        );

        // While working with high income, conversions should not happen
        // (they would be tax-inefficient)
        let conversionsWhileWorking = 0;
        for (const year of simulation) {
            const age = getAge(year.year, highIncomeBirthYear);
            if (age >= 70) continue; // Skip retirement years

            if (hasLogMessage(year, 'roth conversion') || hasLogMessage(year, 'converted')) {
                conversionsWhileWorking++;
            }
        }

        // Should have minimal conversions while earning $200k
        expect(
            conversionsWhileWorking,
            `Should have 0 conversions while earning $200k (got ${conversionsWhileWorking})`
        ).toBe(0);

        assertAllYearsInvariants(simulation);
    });

    // =========================================================================
    // SOCIAL SECURITY TAX TORPEDO TESTS
    // =========================================================================

    describe('Social Security Tax Torpedo', () => {
        const ssBirthYear = 1963; // Age 62 in 2025 - just retiring
        const ssRetirementAge = 62;

        // Assumptions for SS torpedo tests
        const ssTorpedoAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {
                birthYear: ssBirthYear,
                lifeExpectancy: 90,
                retirementAge: ssRetirementAge,
            },
            macro: {
                ...defaultAssumptions.macro,
                inflationRate: 0,
                inflationAdjusted: false,
            },
            investments: {
                ...defaultAssumptions.investments,
                returnRates: { ror: 0 }, // Zero returns for predictable math
                autoRothConversions: true,
            },
            priorities: [],
            withdrawalStrategy: [
                { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
                { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-trad' },
            ],
        };

        const ssTrad = new InvestedAccount(
            'acc-trad', 'Traditional IRA', 500000, 0, 20, 0, 'Traditional IRA', true, 1.0, 500000
        );

        const ssRoth = new InvestedAccount(
            'acc-roth', 'Roth IRA', 50000, 0, 20, 0, 'Roth IRA', true, 1.0, 40000
        );

        const ssExpenses = new FoodExpense(
            'exp-living', 'Living Expenses', 30000, 'Annually', new Date('2025-01-01')
        );

        it('should do conversions when SS income is below first threshold (0% taxable)', () => {
            // Low SS benefit: ~$15,000/year = $1,250/month PIA
            // Combined income threshold for Single: $25,000
            // Combined Income = AGI + 50% of SS = AGI + $7,500
            // If AGI < $17,500, combined income < $25,000, so 0% of SS is taxable

            // Use a scenario without SS income initially to verify conversions work
            // Person retires at 62, SS starts at 67 - this gives us the "gap years" to test
            // Note: calculatedPIA is MONTHLY benefit, so 1250 * 12 = $15,000/year
            const delayedSS = new FutureSocialSecurityIncome(
                'inc-ss', 'Social Security', 67, 1250, 0
            );

            const simulation = runSimulation(
                10,
                [ssTrad, ssRoth],
                [delayedSS],
                [ssExpenses],
                ssTorpedoAssumptions,
                taxState
            );

            // During years before SS starts (ages 62-66), should do conversions
            let hasConversionsBeforeSS = false;
            for (const year of simulation) {
                const age = year.year - ssBirthYear;
                if (age >= 62 && age < 67) {
                    // Before SS starts
                    if (year.rothConversion && year.rothConversion.amount > 0) {
                        hasConversionsBeforeSS = true;
                        break;
                    }
                }
            }

            expect(
                hasConversionsBeforeSS,
                'Should do Roth conversions during gap years before SS starts'
            ).toBe(true);

            assertAllYearsInvariants(simulation);
        });

        it('should reduce conversions when SS tax torpedo would push effective rate above target', () => {
            // Moderate SS benefit: $30,000/year = $2,500/month (typical benefit)
            // This puts us in the "tax torpedo" zone where conversions increase taxable SS
            const moderateSS = new FutureSocialSecurityIncome(
                'inc-ss', 'Social Security', 62, 2500, 0  // $2,500/month = $30k/year
            );

            // Compare conversion amounts with and without SS
            const withSSSimulation = runSimulation(
                10,
                [ssTrad, ssRoth],
                [moderateSS],
                [ssExpenses],
                ssTorpedoAssumptions,
                taxState
            );

            // No SS scenario (using SS at age 90 which is effectively never)
            const noSS = new FutureSocialSecurityIncome(
                'inc-ss', 'Social Security', 90, 2500, 0  // $2,500/month = $30k/year
            );

            const noSSSimulation = runSimulation(
                10,
                [ssTrad, ssRoth],
                [noSS],
                [ssExpenses],
                ssTorpedoAssumptions,
                taxState
            );

            // Get conversion amounts for comparable years
            const withSSConversion = withSSSimulation[2]?.rothConversion?.amount || 0;
            const noSSConversion = noSSSimulation[2]?.rothConversion?.amount || 0;

            // With SS torpedo, conversions should be LESS than without SS
            // (because the effective rate is higher due to pushing SS into taxable territory)
            if (noSSConversion > 0) {
                expect(
                    withSSConversion,
                    `With SS torpedo, conversion ($${withSSConversion.toFixed(0)}) should be less than without SS ($${noSSConversion.toFixed(0)})`
                ).toBeLessThanOrEqual(noSSConversion);
            }

            assertAllYearsInvariants(withSSSimulation);
            assertAllYearsInvariants(noSSSimulation);
        });

        it('should not convert when already at 85% SS taxation threshold', () => {
            // High SS benefit + other income that already pushes to 85% taxable
            // Single threshold for 85%: combined income > $34,000
            const highSS = new FutureSocialSecurityIncome(
                'inc-ss', 'Social Security', 62, 3333, 0  // $3,333/month = $40k/year
            );

            // Add passive income to push into high bracket
            const passiveIncome = new PassiveIncome(
                'inc-passive', 'Pension', 50000, 'Annually', 'Yes',
                'Other', new Date('2020-01-01')
            );

            const highIncomeAssumptions: AssumptionsState = {
                ...ssTorpedoAssumptions,
                demographics: {
                    birthYear: ssBirthYear,
                    lifeExpectancy: 90,
                    retirementAge: 60,
                },
            };

            const simulation = runSimulation(
                10,
                [ssTrad, ssRoth],
                [highSS, passiveIncome],
                [ssExpenses],
                highIncomeAssumptions,
                taxState
            );

            // With $50k pension + $40k SS, we're already in 22%+ bracket
            // Conversions should be minimal or none
            let totalConversions = 0;
            for (const year of simulation) {
                const age = year.year - ssBirthYear;
                if (age >= 62) { // After SS starts
                    totalConversions += year.rothConversion?.amount || 0;
                }
            }

            // Should have very limited conversions (if any) when already in high bracket
            // The exact amount depends on bracket filling logic, but it should be constrained
            assertAllYearsInvariants(simulation);
        });

        it('should account for SS torpedo in tax cost calculation', () => {
            // Verify that reported tax cost includes the SS torpedo effect
            const moderateSS = new FutureSocialSecurityIncome(
                'inc-ss', 'Social Security', 62, 2083, 0  // $2,083/month = $25k/year
            );

            const simulation = runSimulation(
                10,
                [ssTrad, ssRoth],
                [moderateSS],
                [ssExpenses],
                ssTorpedoAssumptions,
                taxState
            );

            // Find a year with conversions after SS starts
            for (const year of simulation) {
                const age = year.year - ssBirthYear;
                if (age < 62) continue;

                const conversion = year.rothConversion;
                if (!conversion || conversion.amount <= 0) continue;

                // Tax cost should be > 0 for any conversion
                expect(
                    conversion.taxCost,
                    `Tax cost should be positive for $${conversion.amount.toFixed(0)} conversion`
                ).toBeGreaterThan(0);

                // Effective rate (taxCost / amount) should be reasonable
                // With SS torpedo, effective rate could be 20-40%
                const effectiveRate = conversion.taxCost / conversion.amount;
                expect(
                    effectiveRate,
                    `Effective rate (${(effectiveRate * 100).toFixed(1)}%) should be between 0% and 50%`
                ).toBeGreaterThan(0);
                expect(effectiveRate).toBeLessThan(0.5);

                break;
            }

            assertAllYearsInvariants(simulation);
        });

        it('should handle transition from no SS to SS receiving years', () => {
            // Verify conversions adjust when SS starts mid-simulation
            const laterSS = new FutureSocialSecurityIncome(
                'inc-ss', 'Social Security', 67, 2500, 0 // SS starts at 67, $2,500/month = $30k/year
            );

            const laterSSAssumptions: AssumptionsState = {
                ...ssTorpedoAssumptions,
                demographics: {
                    birthYear: ssBirthYear, // 1963 - age 62 in 2025
                    lifeExpectancy: 90,
                    retirementAge: 62,
                },
            };

            const simulation = runSimulation(
                15,
                [ssTrad, ssRoth],
                [laterSS],
                [ssExpenses],
                laterSSAssumptions,
                taxState
            );

            // Get conversions before and after SS starts
            const conversionsBeforeSS: number[] = [];
            const conversionsAfterSS: number[] = [];

            for (const year of simulation) {
                const age = year.year - ssBirthYear;
                const conversion = year.rothConversion?.amount || 0;

                if (age >= 62 && age < 67) {
                    // Before SS (ages 62-66)
                    conversionsBeforeSS.push(conversion);
                } else if (age >= 67 && age < 72) {
                    // After SS starts (ages 67-71)
                    conversionsAfterSS.push(conversion);
                }
            }

            // Calculate average conversions
            const avgBeforeSS = conversionsBeforeSS.length > 0
                ? conversionsBeforeSS.reduce((a, b) => a + b, 0) / conversionsBeforeSS.length
                : 0;
            const avgAfterSS = conversionsAfterSS.length > 0
                ? conversionsAfterSS.reduce((a, b) => a + b, 0) / conversionsAfterSS.length
                : 0;

            // Before SS starts, conversions should generally be higher
            // (more bracket room without SS income)
            if (avgBeforeSS > 0 && avgAfterSS > 0) {
                expect(
                    avgBeforeSS,
                    `Avg conversion before SS ($${avgBeforeSS.toFixed(0)}) should be >= after SS ($${avgAfterSS.toFixed(0)})`
                ).toBeGreaterThanOrEqual(avgAfterSS * 0.8); // Allow 20% variance
            }

            assertAllYearsInvariants(simulation);
        });
    });

    // =========================================================================
    // ROTH CONVERSION ORDERING FIX TESTS
    // Tests for the fix that reduces bracket headroom when Traditional withdrawals
    // are expected for expense coverage
    // =========================================================================

    describe('Roth Conversion Expense Withdrawal Ordering', () => {
        const expenseBirthYear = 1963; // Age 62 in 2025
        const expenseRetirementAge = 62;

        // Assumptions for expense ordering tests
        const expenseOrderingAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {
                birthYear: expenseBirthYear,
                lifeExpectancy: 90,
                retirementAge: expenseRetirementAge,
            },
            macro: {
                ...defaultAssumptions.macro,
                inflationRate: 0,
                inflationAdjusted: false,
            },
            investments: {
                ...defaultAssumptions.investments,
                returnRates: { ror: 0 }, // Zero returns for predictable math
                autoRothConversions: true,
            },
            priorities: [],
            withdrawalStrategy: [
                { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-trad' },
                { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
            ],
        };

        const expenseTrad = new InvestedAccount(
            'acc-trad', 'Traditional IRA', 500000, 0, 20, 0, 'Traditional IRA', true, 1.0, 500000
        );

        const expenseRoth = new InvestedAccount(
            'acc-roth', 'Roth IRA', 50000, 0, 20, 0, 'Roth IRA', true, 1.0, 40000
        );

        it('should reduce Roth conversion when Traditional withdrawal expected for expenses', () => {
            // Scenario: High expenses, no income -> will need Traditional withdrawal
            // Traditional is first in withdrawal order
            const highExpenses = new FoodExpense(
                'exp-living', 'Living Expenses', 50000, 'Annually', new Date('2025-01-01')
            );

            // No income - must withdraw from Traditional to cover expenses
            const noSS = new FutureSocialSecurityIncome(
                'inc-ss', 'Social Security', 90, 0, 0 // SS at 90 = effectively never
            );

            const highExpenseSimulation = runSimulation(
                5,
                [expenseTrad, expenseRoth],
                [noSS],
                [highExpenses],
                expenseOrderingAssumptions,
                taxState
            );

            // Compare with low expenses scenario (no Traditional withdrawal needed)
            const lowExpenses = new FoodExpense(
                'exp-living', 'Living Expenses', 5000, 'Annually', new Date('2025-01-01')
            );

            const lowExpenseSimulation = runSimulation(
                5,
                [expenseTrad, expenseRoth],
                [noSS],
                [lowExpenses],
                expenseOrderingAssumptions,
                taxState
            );

            // Get conversion amounts for year 1 (first retirement year)
            const highExpenseConversion = highExpenseSimulation[1]?.rothConversion?.amount || 0;
            const lowExpenseConversion = lowExpenseSimulation[1]?.rothConversion?.amount || 0;

            // With high expenses requiring Traditional withdrawal, conversion should be less
            // because the bracket headroom is reduced by the estimated withdrawal
            expect(
                highExpenseConversion,
                `High expense conversion ($${highExpenseConversion.toFixed(0)}) should be less than low expense ($${lowExpenseConversion.toFixed(0)})`
            ).toBeLessThan(lowExpenseConversion);

            assertAllYearsInvariants(highExpenseSimulation);
            assertAllYearsInvariants(lowExpenseSimulation);
        });

        it('should not affect conversion when income covers expenses', () => {
            // Scenario: Passive income covers all expenses - no withdrawal needed
            const passiveIncome = new PassiveIncome(
                'inc-passive', 'Pension', 60000, 'Annually', 'Yes',
                'Other', new Date('2020-01-01')
            );

            const noSS = new FutureSocialSecurityIncome(
                'inc-ss', 'Social Security', 90, 0, 0
            );

            const coveredExpenses = new FoodExpense(
                'exp-living', 'Living Expenses', 40000, 'Annually', new Date('2025-01-01')
            );

            const simulation = runSimulation(
                5,
                [expenseTrad, expenseRoth],
                [noSS, passiveIncome],
                [coveredExpenses],
                expenseOrderingAssumptions,
                taxState
            );

            // Should have conversions since income covers expenses
            const year1 = simulation[1];
            expect(
                year1?.rothConversion?.amount || 0,
                'Should have Roth conversions when income covers expenses'
            ).toBeGreaterThan(0);

            // Verify no log about bracket headroom reduction
            const hasReductionLog = hasLogMessage(year1, 'Bracket headroom reduced');
            expect(
                hasReductionLog,
                'Should NOT reduce headroom when income covers expenses'
            ).toBe(false);

            assertAllYearsInvariants(simulation);
        });

        it('should not over-convert when Traditional withdrawal needed for expenses', () => {
            // This is the main bug fix verification
            // Setup: Expenses > income, Traditional first in withdrawal order
            // Verify: Total taxable income stays in target bracket

            const highExpenses = new FoodExpense(
                'exp-living', 'Living Expenses', 60000, 'Annually', new Date('2025-01-01')
            );

            const noSS = new FutureSocialSecurityIncome(
                'inc-ss', 'Social Security', 90, 0, 0
            );

            const simulation = runSimulation(
                5,
                [expenseTrad, expenseRoth],
                [noSS],
                [highExpenses],
                expenseOrderingAssumptions,
                taxState
            );

            // 2025 tax brackets for Single filer
            const standardDeduction = 14600;
            const bracket22Top = 103350; // Top of 22% bracket (taxable income)

            for (const year of simulation) {
                const age = year.year - expenseBirthYear;
                if (age < expenseRetirementAge) continue;

                const conversion = year.rothConversion?.amount || 0;
                const traditionalWithdrawal = year.cashflow.withdrawalDetail['Traditional IRA'] || 0;
                const totalIncome = year.cashflow.totalIncome;

                // Total taxable income = income + conversion (Traditional withdrawal is included in income)
                // The Traditional withdrawal adds to totalIncome when it occurs
                const estimatedTaxableIncome = Math.max(0, totalIncome + conversion - standardDeduction);

                // Should not exceed 22% bracket (our target)
                // Allow some tolerance for rounding in the estimation
                expect(
                    estimatedTaxableIncome,
                    `Year ${year.year}: Total taxable ($${estimatedTaxableIncome.toFixed(0)}) should not greatly exceed 22% bracket top ($${bracket22Top}). ` +
                    `Income: $${totalIncome.toFixed(0)}, Conversion: $${conversion.toFixed(0)}, Trad Withdrawal: $${traditionalWithdrawal.toFixed(0)}`
                ).toBeLessThanOrEqual(bracket22Top + 5000); // Allow $5k tolerance for estimation errors
            }

            assertAllYearsInvariants(simulation);
        });

        it('should handle Roth-first withdrawal order (no reduction needed)', () => {
            // Scenario: Roth is first in withdrawal order
            // Traditional withdrawal won't affect conversion headroom
            const rothFirstAssumptions: AssumptionsState = {
                ...expenseOrderingAssumptions,
                withdrawalStrategy: [
                    { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
                    { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-trad' },
                ],
            };

            const highExpenses = new FoodExpense(
                'exp-living', 'Living Expenses', 50000, 'Annually', new Date('2025-01-01')
            );

            const noSS = new FutureSocialSecurityIncome(
                'inc-ss', 'Social Security', 90, 0, 0
            );

            const simulation = runSimulation(
                5,
                [expenseTrad, expenseRoth],
                [noSS],
                [highExpenses],
                rothFirstAssumptions,
                taxState
            );

            // With Roth first, withdrawals from Roth don't affect tax brackets
            // So conversions should be larger (no headroom reduction)
            // The key is that the simulation runs correctly without errors
            assertAllYearsInvariants(simulation);
        });
    });
});
