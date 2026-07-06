import { AnyIncome, WorkIncome, FutureSocialSecurityIncome, FERSPensionIncome, CSRSPensionIncome, PassiveIncome } from "../../components/Objects/Income/models";
import { AnyAccount, SavedAccount } from "../../components/Objects/Accounts/models";
import { AssumptionsState, getRetirementAge, getLifeExpectancy, getBirthYear } from "../../components/Objects/Assumptions/AssumptionsContext";
import { calculateHigh3, checkFERSEligibility, checkCSRSEligibility, calculateFERSBasicBenefit, calculateCSRSBasicBenefit, calculateFERSSupplement, getDisplayedFERSBenefit, getDisplayedCSRSBenefit } from "../../data/PensionData";
import { calculateAIME, extractEarningsFromSimulation, calculateEarningsTestReduction, shouldApplyEarningsTest } from "../SocialSecurityCalculator";
import { getFRA } from "../../data/SocialSecurityData";
import * as TaxService from "../../components/Objects/Taxes/TaxService";
import { SimulationYear } from "./types";

export interface IncomeProjectionResult {
    nextIncomes: AnyIncome[];
    interestIncomes: PassiveIncome[];
    allIncomes: AnyIncome[];
    /**
     * The source savings account id per synthetic reinvested-interest income, keyed
     * by the interest income's id (`interest-{accountId}-{year}`). The account id is
     * KNOWN here at mint time (`acc.id`), so the Cashflow Sankey resolves the
     * reinvested destination by EXACT id from this map instead of reverse-engineering
     * it from the id string — mirroring the RSU-vest account-id map.
     */
    interestAccountIdByIncomeId: Record<string, string>;
    logs: string[];
}

/**
 * Project incomes for the next year: grow work income, calculate pensions,
 * determine Social Security benefits, apply earnings test, and compute interest income.
 */
export function projectIncomes(
    year: number,
    incomes: AnyIncome[],
    accounts: AnyAccount[],
    assumptions: AssumptionsState,
    previousSimulation: SimulationYear[],
    currentAge: number,
    isRetired: boolean,
    logs: string[]
): IncomeProjectionResult {
    // Filter out previous year's interest, RMD, and RSU-vest income - they're
    // regenerated fresh each year (interest from balances, RMD from required
    // distributions, RSU vest from the grant schedule).
    const regularIncomes = incomes.filter(inc => {
        if (inc instanceof PassiveIncome && (inc.sourceType === 'Interest' || inc.sourceType === 'RMD' || inc.sourceType === 'RSU')) {
            return false;
        }
        return true;
    });

    const nextIncomes = regularIncomes.map(inc => {
        // End work income at retirement if no end date is set
        if (inc instanceof WorkIncome && isRetired && !inc.end_date) {
            const retirementYear = getBirthYear(assumptions.milestones) + getRetirementAge(assumptions.milestones);

            return new WorkIncome(
                inc.id,
                inc.name,
                0, // Zero out the income
                inc.frequency,
                inc.earned_income,
                0, // Zero out preTax401k
                0, // Zero out insurance
                0, // Zero out roth401k
                0, // Zero out employerMatch
                inc.matchAccountId,
                inc.taxType,
                inc.contributionGrowthStrategy,
                inc.startDate,
                new Date(retirementYear - 1, 11, 31),
                0, // hsaContribution
                inc.autoMax401k,
                inc.esppContributionType,
                0, // esppContributionAmount
                inc.esppDiscountPercent,
                inc.esppHasLookback,
                inc.esppOfferingPeriodMonths,
                inc.esppAccountId,
                inc.esppExpectedStockGrowth,
                // Preserve RSU config: a grant keeps vesting on schedule even after
                // the salary stops (zeroed here at retirement). Vest income is still
                // recognized as ordinary income in those years.
                inc.rsuVestingSchedule,
                inc.rsuGrantShares,
                inc.rsuVestFrequency,
                inc.rsuExpectedStockGrowth,
                inc.rsuAccountId,
                inc.rsuWithholdingRate,
                inc.pensionSystem,
                inc.startMilestoneId,
                inc.endMilestoneId,  // CRITICAL: Preserve milestone IDs
                inc.employerMatchType,
                inc.employerMatchPercent,
                inc.employerMatchMax,
            );
        }

        // Handle FERS Pension
        if (inc instanceof FERSPensionIncome) {
            if (inc.autoCalculateHigh3 && inc.linkedIncomeId) {
                // Build salary history from prior simulation years. The linked WorkIncome is
                // filtered out of `incomes` once the user retires, so the High-3 calculation
                // must NOT depend on it still being present in the current year's incomes.
                const salaryHistory: number[] = previousSimulation
                    .map(simYear => {
                        const prevLinked = simYear.incomes.find(i => i.id === inc.linkedIncomeId);
                        if (prevLinked instanceof WorkIncome) {
                            return prevLinked.getAnnualAmount(simYear.year);
                        }
                        return 0;
                    })
                    .filter(s => s > 0);

                // If the linked income is still active this year, include its salary too.
                const linkedIncome = incomes.find(i => i.id === inc.linkedIncomeId);
                if (linkedIncome instanceof WorkIncome) {
                    const currentSalary = linkedIncome.getAnnualAmount(year);
                    if (currentSalary > 0) salaryHistory.push(currentSalary);
                }

                // Activate on the FIRST projection year at/after the retirement age,
                // while the benefit is still uncalculated. Using `>=` (not `===`)
                // covers a federal employee already AT/PAST their retirement age when
                // the plan starts: the projection loop runs currentAge = startAge+1,
                // startAge+2, … so it would never see the exact `=== retirementAge`
                // year and the pension would silently pay $0 forever. The
                // `calculatedBenefit === 0` guard makes this fire exactly once; after
                // activation, increment() carries the benefit forward with COLA.
                if (currentAge >= inc.retirementAge && inc.calculatedBenefit === 0 && salaryHistory.length > 0) {
                    const high3 = calculateHigh3(salaryHistory);
                    const baseBenefit = calculateFERSBasicBenefit(inc.yearsOfService, high3, inc.retirementAge);
                    const eligibility = checkFERSEligibility(inc.retirementAge, inc.yearsOfService, inc.birthYear);
                    // Displayed (MRA+10-reduced) benefit via the shared helper so this
                    // sim value cannot drift from the Testing-tab estimate. Equals
                    // baseBenefit × (1 - reductionPercent/100); baseBenefit/eligibility
                    // are kept for the logs below.
                    const actualBenefit = getDisplayedFERSBenefit(inc.yearsOfService, high3, inc.retirementAge, inc.birthYear);

                    // Auto-compute the FERS MRA-to-62 supplement on activation. Auto
                    // pensions leave `fersSupplement` at its default 0, so deriving it
                    // here mirrors the model's calculateSupplement(): estimatedSSAt62 is
                    // stored as an ANNUAL figure and divided by 12 to feed the
                    // monthly-input calculateFERSSupplement. The model's increment()
                    // COLA-grows this value and zeroes it at 62.
                    //
                    // Gate exactly as calculateSupplement() does, plus a currentAge < 62
                    // guard this activation path needs that increment() would otherwise
                    // enforce: (1) retirementAge < 62 (bridge to 62 only), (2)
                    // reductionPercent === 0 — MRA+10 (reduced-annuity) retirees do NOT get
                    // the supplement, and (3) currentAge < 62 — a late-activation year past
                    // 62 (plan starting at/after 62) is already past the bridge, so pay $0.
                    const supplement = (inc.retirementAge < 62 && eligibility.reductionPercent === 0 && currentAge < 62)
                        ? calculateFERSSupplement(inc.yearsOfService, inc.estimatedSSAt62 / 12)
                        : 0;

                    logs.push(`[PENSION] FERS Pension started: High-3 calculated as $${high3.toLocaleString()}/yr from ${salaryHistory.length} years of salary history`);
                    if (eligibility.reductionPercent > 0) {
                        logs.push(`   Base benefit: $${baseBenefit.toLocaleString()}/yr, reduced by ${eligibility.reductionPercent}% (${eligibility.message})`);
                    }
                    logs.push(`   Annual benefit: $${actualBenefit.toLocaleString()}/yr`);
                    if (supplement > 0) {
                        logs.push(`[PENSION] FERS Supplement (MRA-to-62): $${supplement.toLocaleString()}/yr until age 62`);
                    }

                    return new FERSPensionIncome(
                        inc.id, inc.name, inc.yearsOfService, high3,
                        inc.retirementAge, inc.birthYear, actualBenefit,
                        supplement, inc.estimatedSSAt62,
                        inc.startDate, inc.end_date,
                        inc.autoCalculateHigh3, inc.linkedIncomeId,
                        inc.startMilestoneId, inc.endMilestoneId
                    );
                }
            }
            return inc.increment(assumptions, year, currentAge);
        }

        // Handle CSRS Pension
        if (inc instanceof CSRSPensionIncome) {
            if (inc.autoCalculateHigh3 && inc.linkedIncomeId) {
                // Build salary history from prior simulation years. The linked WorkIncome is
                // filtered out of `incomes` once the user retires, so the High-3 calculation
                // must NOT depend on it still being present in the current year's incomes.
                const salaryHistory: number[] = previousSimulation
                    .map(simYear => {
                        const prevLinked = simYear.incomes.find(i => i.id === inc.linkedIncomeId);
                        if (prevLinked instanceof WorkIncome) {
                            return prevLinked.getAnnualAmount(simYear.year);
                        }
                        return 0;
                    })
                    .filter(s => s > 0);

                // If the linked income is still active this year, include its salary too.
                const linkedIncome = incomes.find(i => i.id === inc.linkedIncomeId);
                if (linkedIncome instanceof WorkIncome) {
                    const currentSalary = linkedIncome.getAnnualAmount(year);
                    if (currentSalary > 0) salaryHistory.push(currentSalary);
                }

                // See the FERS note above: `>=` + `calculatedBenefit === 0` activates
                // exactly once, including when the employee is already at/past their
                // retirement age at plan start (the `=== retirementAge` year is never
                // hit by the projection loop, which starts at startAge+1).
                if (currentAge >= inc.retirementAge && inc.calculatedBenefit === 0 && salaryHistory.length > 0) {
                    const high3 = calculateHigh3(salaryHistory);
                    const baseBenefit = calculateCSRSBasicBenefit(inc.yearsOfService, high3);

                    const eligibility = checkCSRSEligibility(inc.retirementAge, inc.yearsOfService);
                    // Displayed (early-retirement-reduced) benefit via the shared helper
                    // so this sim value cannot drift from the Testing-tab estimate. Equals
                    // baseBenefit × (1 - reductionPercent/100); baseBenefit/eligibility
                    // are kept for the logs below.
                    const actualBenefit = getDisplayedCSRSBenefit(inc.yearsOfService, high3, inc.retirementAge);

                    logs.push(`[PENSION] CSRS Pension started: High-3 calculated as $${high3.toLocaleString()}/yr from ${salaryHistory.length} years of salary history`);
                    if (eligibility.reductionPercent > 0) {
                        logs.push(`   Base benefit: $${baseBenefit.toLocaleString()}/yr, reduced by ${eligibility.reductionPercent}% (${eligibility.message})`);
                    }
                    logs.push(`   Annual benefit: $${actualBenefit.toLocaleString()}/yr`);

                    return new CSRSPensionIncome(
                        inc.id, inc.name, inc.yearsOfService, high3,
                        inc.retirementAge, actualBenefit,
                        inc.startDate, inc.end_date,
                        inc.autoCalculateHigh3, inc.linkedIncomeId,
                        inc.startMilestoneId, inc.endMilestoneId
                    );
                }
            }
            return inc.increment(assumptions);
        }

        if (inc instanceof FutureSocialSecurityIncome) {
            // Recalculate PIA before claiming (reflect growing earnings history) and
            // activate it once at/after claiming age. After activation, fall through to
            // inc.increment() for COLA.
            //
            // Enter this block to ACTIVATE when calculatedPIA is still 0 AND either:
            //   • currentAge === claimingAge — the normal first-reach activation year, OR
            //   • currentAge  >  claimingAge AND projectedPIA === 0 — a claimant already
            //     PAST their claiming age when the plan starts (e.g. a 64-year-old who
            //     claimed at 63). The projection loop runs currentAge = startAge+1,
            //     startAge+2, … so the exact `=== claimingAge` year is never hit and the
            //     benefit would otherwise pay $0 forever. projectedPIA === 0 means it was
            //     never projected/activated (mirrors the FERS/CSRS late-start fix above).
            //
            // Deliberately EXCLUDED: an already-activated benefit that the earnings test
            // fully withheld this-or-a-prior year (calculatedPIA === 0 but projectedPIA > 0
            // and currentAge > claimingAge). Re-running AIME every withheld year would drop
            // COLA continuity; instead it falls through to increment() (which COLA-grows
            // projectedPIA) and the earnings-test pass below rebuilds the payable from
            // projectedPIA — restoring the benefit once earnings fall.
            const activatingNow = inc.calculatedPIA === 0 &&
                (currentAge === inc.claimingAge ||
                    (currentAge > inc.claimingAge && inc.projectedPIA === 0));
            const shouldRecalculate = currentAge < inc.claimingAge || activatingNow;

            if (shouldRecalculate) {
                try {
                    const inflationAdjusted = assumptions.macro.inflationAdjusted;
                    // Same rate used for AIME wage-indexing and PIA bend points below,
                    // so the SS wage-base cap projects at the same rate it's indexed by
                    // (otherwise capped earnings and the indexing/bend points drift apart).
                    const wageGrowthRate = assumptions.macro.inflationRate / 100;
                    const earningsHistory = extractEarningsFromSimulation(
                        previousSimulation,
                        assumptions.demographics.priorEarnings,
                        inflationAdjusted,
                        incomes,
                        wageGrowthRate
                    );

                    const birthYear = getBirthYear(assumptions.milestones);
                    const aimeCalc = calculateAIME(earningsHistory, year, inc.claimingAge, birthYear, wageGrowthRate, inflationAdjusted);

                    const fundingPercent = (assumptions.income?.socialSecurityFundingPercent ?? 100) / 100;
                    const adjustedMonthlyBenefit = aimeCalc.adjustedBenefit * fundingPercent;

                    logs.push(`Social Security PIA calculated: $${adjustedMonthlyBenefit.toFixed(2)}/month (claiming at age ${inc.claimingAge})`);
                    logs.push(`  AIME: $${aimeCalc.aime.toFixed(2)}, PIA: $${aimeCalc.pia.toFixed(2)}${fundingPercent < 1 ? `, Funding: ${fundingPercent * 100}%` : ''}`);

                    if (currentAge >= inc.claimingAge) {
                        // At/after claiming age - activate the income (fires once via the
                        // calculatedPIA === 0 guard above; a late plan start activates in
                        // its first simulated year).
                        // Set both calculatedPIA (feeds amount) and projectedPIA
                        const endDate = new Date(
                            birthYear + getLifeExpectancy(assumptions.milestones),
                            11, 31
                        );
                        return new FutureSocialSecurityIncome(
                            inc.id,
                            inc.name,
                            inc.claimingAge,
                            adjustedMonthlyBenefit,  // calculatedPIA - activates income (amount = PIA * 12)
                            year,
                            new Date(year, 0, 1),
                            endDate,
                            inc.startMilestoneId,
                            inc.endMilestoneId,
                            adjustedMonthlyBenefit   // projectedPIA - same as calculatedPIA at activation
                        );
                    } else {
                        // Before claiming age - store projectedPIA for planning, but keep amount = 0
                        // calculatedPIA = 0 so amount stays 0 (income not yet active)
                        // projectedPIA = calculated value for Roth conversion planning
                        const claimingYear = birthYear + inc.claimingAge;
                        const futureStartDate = new Date(claimingYear, 0, 1);
                        return new FutureSocialSecurityIncome(
                            inc.id,
                            inc.name,
                            inc.claimingAge,
                            0,  // calculatedPIA = 0 (amount stays 0, income not active)
                            year,  // calculationYear = current year when PIA was calculated
                            futureStartDate,
                            inc.end_date,
                            inc.startMilestoneId,
                            inc.endMilestoneId,
                            adjustedMonthlyBenefit  // projectedPIA = calculated value for planning
                        );
                    }
                } catch (error) {
                    logs.push(`[WARN] Error calculating Social Security benefits: ${error}`);
                    return inc.increment(assumptions);
                }
            }
            // After claiming age (or already activated): falls through to inc.increment() below for COLA
        }

        // Pass year and age for WorkIncome to support TRACK_ANNUAL_MAX strategy
        if (inc instanceof WorkIncome) {
            return inc.increment(assumptions, year, currentAge);
        }

        return inc.increment(assumptions);
    });

    // Apply earnings test to FutureSocialSecurityIncome if claiming before FRA
    const incomesWithEarningsTest = nextIncomes.map(inc => {
        // Apply the earnings test to an ACTIVATED FutureSocialSecurityIncome only
        // (currentAge >= claimingAge — a pre-claiming income has calculatedPIA=0 and must
        // stay inactive). Gate on projectedPIA too, not just calculatedPIA: a year fully
        // withheld by the earnings test stores calculatedPIA=0, and the old
        // `calculatedPIA > 0` gate then locked the benefit at $0 for LIFE (nothing ever
        // re-entered this block to restore it). projectedPIA is the full, COLA-grown PIA
        // and survives a full withholding, so it's the reliable "this SS benefit is
        // active" signal.
        if (
            inc instanceof FutureSocialSecurityIncome &&
            currentAge >= inc.claimingAge &&
            (inc.calculatedPIA > 0 || inc.projectedPIA > 0)
        ) {
            const birthYear = getBirthYear(assumptions.milestones);
            const fra = getFRA(birthYear);

            // Full, un-reduced monthly PIA. The earnings-test withholding is based on the
            // FULL benefit, NOT the running `inc.amount` (= calculatedPIA × 12): the rebuild
            // below stores the reduced monthly benefit back into calculatedPIA, so computing
            // off inc.amount would re-apply withholding to an already-reduced base and ratchet
            // the payable DOWN every year. projectedPIA is set equal to calculatedPIA at
            // activation and COLA-grown in lockstep, so it stays the full benefit. Fall back
            // to inc.amount/12 only when projectedPIA is unset (0).
            const fullMonthlyPIA = inc.projectedPIA > 0 ? inc.projectedPIA : inc.amount / 12;

            // shouldApplyEarningsTest (claimed early && <= ceil(fra)) rather than
            // < fra: the FRA-attainment year still has the lenient pre-FRA-months
            // test ($1/$3 rule), which a strict < fra gate made unreachable (#188)
            // — but only for EARLY claimers; claiming at/after FRA never has a
            // benefit month before FRA, so nothing is ever withheld.
            if (shouldApplyEarningsTest(currentAge, fra, inc.claimingAge) && fullMonthlyPIA > 0) {
                const earnedIncome = TaxService.getEarnedIncome(nextIncomes, year);
                const annualSSBenefit = inc.getProratedAnnual(fullMonthlyPIA * 12, year);
                const wageGrowthRate = assumptions.macro.inflationRate / 100;
                const inflationAdjusted = assumptions.macro.inflationAdjusted;

                const earningsTest = calculateEarningsTestReduction(
                    annualSSBenefit,
                    earnedIncome,
                    currentAge,
                    fra,
                    year,
                    wageGrowthRate,
                    inflationAdjusted
                );

                if (earningsTest.appliesTest && earningsTest.amountWithheld > 0) {
                    // This year's benefit is (fully or partly) withheld. Payable is always
                    // rebuilt off the FULL benefit (via fullMonthlyPIA above), so the
                    // withholding never compounds year-over-year.
                    const monthlyReduced = earningsTest.reducedBenefit / 12;

                    logs.push(`[WARN] Earnings test applied: SS benefit reduced from $${(annualSSBenefit/12).toFixed(2)}/month to $${monthlyReduced.toFixed(2)}/month`);
                    logs.push(`  ${earningsTest.reason}`);
                    logs.push(`  Amount withheld: $${earningsTest.amountWithheld.toLocaleString()}/year`);
                    logs.push(`  Note: Withheld benefits would be recalculated at FRA (not yet implemented)`);

                    return new FutureSocialSecurityIncome(
                        inc.id,
                        inc.name,
                        inc.claimingAge,
                        monthlyReduced,
                        inc.calculationYear,
                        inc.startDate,
                        inc.end_date,
                        inc.startMilestoneId,
                        inc.endMilestoneId,
                        inc.projectedPIA
                    );
                }
            }

            // No withholding this year (earnings fell, or currentAge is now >= FRA where
            // the earnings test no longer applies). SSA resumes the full unreduced payment,
            // so restore calculatedPIA to the full monthly PIA. This is what recovers a
            // benefit that a PRIOR year's earnings test reduced or zeroed — including past
            // FRA. A never-reduced benefit already has calculatedPIA === fullMonthlyPIA
            // (projectedPIA is grown in lockstep), so this is a no-op / byte-identical for it.
            if (inc.projectedPIA > 0 && inc.calculatedPIA !== fullMonthlyPIA) {
                return new FutureSocialSecurityIncome(
                    inc.id,
                    inc.name,
                    inc.claimingAge,
                    fullMonthlyPIA,
                    inc.calculationYear,
                    inc.startDate,
                    inc.end_date,
                    inc.startMilestoneId,
                    inc.endMilestoneId,
                    inc.projectedPIA
                );
            }
        }
        return inc;
    });

    // Calculate interest income from savings accounts (before they grow)
    const interestIncomes: PassiveIncome[] = [];
    // The source account id per minted interest income, keyed by the income id, so
    // the Cashflow Sankey resolves the reinvested destination by EXACT id (the id is
    // KNOWN here — `acc.id` — rather than parsed back out of the income id string).
    const interestAccountIdByIncomeId: Record<string, string> = {};
    for (const acc of accounts) {
        if (acc instanceof SavedAccount && acc.apr > 0 && acc.amount > 0) {
            const interestEarned = acc.amount * (acc.apr / 100);
            if (interestEarned > 0.01) {
                const interestIncomeId = `interest-${acc.id}-${year}`;
                interestIncomes.push(new PassiveIncome(
                    interestIncomeId,
                    `${acc.name} Interest`,
                    interestEarned,
                    'Annually',
                    'No',
                    'Interest',
                    // Build LOCAL date-only values (the repo convention). getIncomeActiveMultiplier
                    // now reads dates with local accessors, so a local Jan-1..Dec-31 window
                    // yields a clean full-calendar-year multiplier (1.0) in any timezone.
                    new Date(year, 0, 1),
                    new Date(year, 11, 31),
                    true  // isReinvested
                ));
                interestAccountIdByIncomeId[interestIncomeId] = acc.id;
            }
        }
    }

    // Combine regular incomes with interest income for tax calculations
    const allIncomes = [...incomesWithEarningsTest, ...interestIncomes];

    return {
        nextIncomes: incomesWithEarningsTest,
        interestIncomes,
        allIncomes,
        interestAccountIdByIncomeId,
        logs
    };
}
