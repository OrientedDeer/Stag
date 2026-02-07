import { AnyIncome, WorkIncome, FutureSocialSecurityIncome, FERSPensionIncome, CSRSPensionIncome, PassiveIncome } from "../../components/Objects/Income/models";
import { AnyAccount, SavedAccount } from "../../components/Objects/Accounts/models";
import { AssumptionsState, getRetirementAge, getLifeExpectancy, getBirthYear } from "../../components/Objects/Assumptions/AssumptionsContext";
import { calculateHigh3, checkFERSEligibility, checkCSRSEligibility } from "../../data/PensionData";
import { calculateAIME, extractEarningsFromSimulation, calculateEarningsTestReduction } from "../SocialSecurityCalculator";
import { getFRA } from "../../data/SocialSecurityData";
import * as TaxService from "../../components/Objects/Taxes/TaxService";
import { SimulationYear } from "./types";

export interface IncomeProjectionResult {
    nextIncomes: AnyIncome[];
    interestIncomes: PassiveIncome[];
    allIncomes: AnyIncome[];
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
    // Filter out previous year's interest and RMD income - they're regenerated fresh each year
    const regularIncomes = incomes.filter(inc => {
        if (inc instanceof PassiveIncome && (inc.sourceType === 'Interest' || inc.sourceType === 'RMD')) {
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
                new Date(Date.UTC(retirementYear - 1, 11, 31)),
                0, // hsaContribution
                inc.autoMax401k,
                inc.esppContributionType,
                0, // esppContributionAmount
                inc.esppDiscountPercent,
                inc.esppHasLookback,
                inc.esppOfferingPeriodMonths,
                inc.esppAccountId,
                inc.esppExpectedStockGrowth,
                inc.pensionSystem,
                inc.startMilestoneId,
                inc.endMilestoneId  // CRITICAL: Preserve milestone IDs
            );
        }

        // Handle FERS Pension
        if (inc instanceof FERSPensionIncome) {
            if (inc.autoCalculateHigh3 && inc.linkedIncomeId) {
                const linkedIncome = incomes.find(i => i.id === inc.linkedIncomeId);
                if (linkedIncome instanceof WorkIncome) {
                    const currentSalary = linkedIncome.getAnnualAmount(year);
                    const salaryHistory: number[] = previousSimulation
                        .map(simYear => {
                            const prevLinked = simYear.incomes.find(i => i.id === inc.linkedIncomeId);
                            if (prevLinked instanceof WorkIncome) {
                                return prevLinked.getAnnualAmount(simYear.year);
                            }
                            return 0;
                        })
                        .filter(s => s > 0);
                    salaryHistory.push(currentSalary);

                    if (currentAge === inc.retirementAge && inc.calculatedBenefit === 0) {
                        const high3 = calculateHigh3(salaryHistory);
                        const baseBenefit = (inc.retirementAge >= 62 && inc.yearsOfService >= 20 ? 0.011 : 0.01)
                            * inc.yearsOfService * high3;
                        const eligibility = checkFERSEligibility(inc.retirementAge, inc.yearsOfService, inc.birthYear);
                        const reductionFactor = 1 - (eligibility.reductionPercent / 100);
                        const actualBenefit = baseBenefit * reductionFactor;

                        logs.push(`[PENSION] FERS Pension started: High-3 calculated as $${high3.toLocaleString()}/yr from ${salaryHistory.length} years of salary history`);
                        if (eligibility.reductionPercent > 0) {
                            logs.push(`   Base benefit: $${baseBenefit.toLocaleString()}/yr, reduced by ${eligibility.reductionPercent}% (${eligibility.message})`);
                        }
                        logs.push(`   Annual benefit: $${actualBenefit.toLocaleString()}/yr`);

                        return new FERSPensionIncome(
                            inc.id, inc.name, inc.yearsOfService, high3,
                            inc.retirementAge, inc.birthYear, actualBenefit,
                            inc.fersSupplement, inc.estimatedSSAt62,
                            inc.startDate, inc.end_date,
                            inc.autoCalculateHigh3, inc.linkedIncomeId
                        );
                    }
                }
            }
            return inc.increment(assumptions, year, currentAge);
        }

        // Handle CSRS Pension
        if (inc instanceof CSRSPensionIncome) {
            if (inc.autoCalculateHigh3 && inc.linkedIncomeId) {
                const linkedIncome = incomes.find(i => i.id === inc.linkedIncomeId);
                if (linkedIncome instanceof WorkIncome) {
                    const currentSalary = linkedIncome.getAnnualAmount(year);
                    const salaryHistory: number[] = previousSimulation
                        .map(simYear => {
                            const prevLinked = simYear.incomes.find(i => i.id === inc.linkedIncomeId);
                            if (prevLinked instanceof WorkIncome) {
                                return prevLinked.getAnnualAmount(simYear.year);
                            }
                            return 0;
                        })
                        .filter(s => s > 0);
                    salaryHistory.push(currentSalary);

                    if (currentAge === inc.retirementAge && inc.calculatedBenefit === 0) {
                        const high3 = calculateHigh3(salaryHistory);
                        let baseBenefit = 0;
                        const first5 = Math.min(inc.yearsOfService, 5);
                        baseBenefit += first5 * high3 * 0.015;
                        if (inc.yearsOfService > 5) {
                            const next5 = Math.min(inc.yearsOfService - 5, 5);
                            baseBenefit += next5 * high3 * 0.0175;
                        }
                        if (inc.yearsOfService > 10) {
                            const remaining = inc.yearsOfService - 10;
                            baseBenefit += remaining * high3 * 0.02;
                        }
                        baseBenefit = Math.min(baseBenefit, high3 * 0.80);

                        const eligibility = checkCSRSEligibility(inc.retirementAge, inc.yearsOfService);
                        const reductionFactor = 1 - (eligibility.reductionPercent / 100);
                        const actualBenefit = baseBenefit * reductionFactor;

                        logs.push(`[PENSION] CSRS Pension started: High-3 calculated as $${high3.toLocaleString()}/yr from ${salaryHistory.length} years of salary history`);
                        if (eligibility.reductionPercent > 0) {
                            logs.push(`   Base benefit: $${baseBenefit.toLocaleString()}/yr, reduced by ${eligibility.reductionPercent}% (${eligibility.message})`);
                        }
                        logs.push(`   Annual benefit: $${actualBenefit.toLocaleString()}/yr`);

                        return new CSRSPensionIncome(
                            inc.id, inc.name, inc.yearsOfService, high3,
                            inc.retirementAge, actualBenefit,
                            inc.startDate, inc.end_date,
                            inc.autoCalculateHigh3, inc.linkedIncomeId
                        );
                    }
                }
            }
            return inc.increment(assumptions);
        }

        if (inc instanceof FutureSocialSecurityIncome) {
            // Recalculate PIA every year until claiming age so it reflects growing earnings history.
            // After claiming age (or if already activated), fall through to inc.increment() for COLA.
            // Only enter this block if: (before claiming) OR (at claiming and not yet activated)
            const shouldRecalculate = currentAge < inc.claimingAge ||
                (currentAge === inc.claimingAge && inc.calculatedPIA === 0);

            if (shouldRecalculate) {
                try {
                    const inflationAdjusted = assumptions.macro.inflationAdjusted;
                    const earningsHistory = extractEarningsFromSimulation(
                        previousSimulation,
                        assumptions.demographics.priorEarnings,
                        inflationAdjusted,
                        incomes
                    );

                    const birthYear = getBirthYear(assumptions.milestones);
                    const wageGrowthRate = assumptions.macro.inflationRate / 100;
                    const aimeCalc = calculateAIME(earningsHistory, year, inc.claimingAge, birthYear, wageGrowthRate, inflationAdjusted);

                    const fundingPercent = (assumptions.income?.socialSecurityFundingPercent ?? 100) / 100;
                    const adjustedMonthlyBenefit = aimeCalc.adjustedBenefit * fundingPercent;

                    logs.push(`Social Security PIA calculated: $${adjustedMonthlyBenefit.toFixed(2)}/month (claiming at age ${inc.claimingAge})`);
                    logs.push(`  AIME: $${aimeCalc.aime.toFixed(2)}, PIA: $${aimeCalc.pia.toFixed(2)}${fundingPercent < 1 ? `, Funding: ${fundingPercent * 100}%` : ''}`);

                    if (currentAge === inc.claimingAge) {
                        // At claiming age - activate the income
                        // Set both calculatedPIA (feeds amount) and projectedPIA
                        const endDate = new Date(Date.UTC(
                            birthYear + getLifeExpectancy(assumptions.milestones),
                            11, 31
                        ));
                        return new FutureSocialSecurityIncome(
                            inc.id,
                            inc.name,
                            inc.claimingAge,
                            adjustedMonthlyBenefit,  // calculatedPIA - activates income (amount = PIA * 12)
                            year,
                            new Date(Date.UTC(year, 0, 1)),
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
                        const futureStartDate = new Date(Date.UTC(claimingYear, 0, 1));
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
                    console.error('Error calculating Social Security benefits:', error);
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
        if (inc instanceof FutureSocialSecurityIncome && inc.calculatedPIA > 0) {
            const birthYear = getBirthYear(assumptions.milestones);
            const fra = getFRA(birthYear);

            if (currentAge < fra) {
                const earnedIncome = TaxService.getEarnedIncome(nextIncomes, year);
                const annualSSBenefit = inc.getProratedAnnual(inc.amount, year);
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
                        inc.end_date
                    );
                }
            }
        }
        return inc;
    });

    // Calculate interest income from savings accounts (before they grow)
    const interestIncomes: PassiveIncome[] = [];
    for (const acc of accounts) {
        if (acc instanceof SavedAccount && acc.apr > 0 && acc.amount > 0) {
            const interestEarned = acc.amount * (acc.apr / 100);
            if (interestEarned > 0.01) {
                interestIncomes.push(new PassiveIncome(
                    `interest-${acc.id}-${year}`,
                    `${acc.name} Interest`,
                    interestEarned,
                    'Annually',
                    'No',
                    'Interest',
                    new Date(`${year}-01-01`),
                    new Date(`${year}-12-31`),
                    true  // isReinvested
                ));
            }
        }
    }

    // Combine regular incomes with interest income for tax calculations
    const allIncomes = [...incomesWithEarningsTest, ...interestIncomes];

    return {
        nextIncomes: incomesWithEarningsTest,
        interestIncomes,
        allIncomes,
        logs
    };
}
