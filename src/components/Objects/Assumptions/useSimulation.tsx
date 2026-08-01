import { simulateOneYear, type SimulationYear } from './SimulationEngine';
import * as TaxService from '../../Objects/Taxes/TaxService';
import { WorkIncome, getIncomeActiveMonthOverlap } from '../Income/models';
import { type AnyAccount, InvestedAccount, SavedAccount, DebtAccount, DeficitDebtAccount } from '../Accounts/models';
import { type AnyIncome } from '../Income/models';
import { type AnyExpense, MortgageExpense, CLASS_TO_CATEGORY } from '../Expense/models';
import { buildCashflowDetail } from '../../../services/simulation/CashflowDetailBuilder';
import { effectiveRoR, blendedMonteCarloReturn, defaultBlendedRoR, resolveStockPct, defaultStockPctForYear } from '../../../services/simulation/allocation';
import { type CashflowDetail } from '../../../services/simulation/types';
import { type AssumptionsState, getLifeExpectancy, getBirthYear, getRetirementAge } from './AssumptionsContext';
import { resolveRothConversionStrategy } from './rothConversionStrategy';
import { type TaxState, resolveTaxEventsForYear } from '../Taxes/TaxContext';
import { activeSurvivorScenario, applySurvivorTransition } from '../../../services/simulation/SurvivorScenario';
import { type BaselineProjections } from '../../../services/simulation/types';
import { getRMDStartAge } from '../../../data/RMDData';
import { buildDPYearContexts, planConversionsViaDP, type DPPlan, type DPInputs, type DPObjectiveOptions, type DPPolicy, type QuadratureNodes } from '../../../services/simulation/RothConversionDP';
import { searchConversionPlanByEngine, extractConversionPlan, generateCandidateWithdrawalOrders, withAllSellableAccounts } from '../../../services/simulation/EngineDirectConversionSearch';
import { getIRMAASchedule } from '../../../data/IRMAAData';
import { getTotalBrokerageBalance, getTotalTraditionalBalance, getTotalRothBalance } from '../../../services/simulation/YearSolver';
import { buildTradValuation, terminalAfterTaxNetWorth } from '../../../tabs/Future/tabs/FutureUtils';

/**
 * Scope a TaxState for FUTURE (projected) years. Dollar tax overrides
 * (fed/fica/state) apply to the CURRENT year only — clearing them here means a
 * current-year correction no longer pins a flat amount across the projection.
 * Used by both runSimulation (its inline year-0 derivation) and the DP context
 * builder so the DP optimizes against the same future-year tax state the final
 * sim executes.
 */
export function scopeFutureTaxState(taxState: TaxState): TaxState {
    return {
        ...taxState,
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
    };
}

/**
 * Build the per-source `cashflowDetail` for the synthetic END-OF-YEAR adjustment
 * row (#148). Without it that row takes the Sankey's raw-expenses FALLBACK path,
 * which mixes units: the row's income/taxes/`livingExpenses` are PRORATED by
 * `remainingFraction`, but the fallback's per-category expense links are FULL-YEAR
 * (`getAnnualAmount`). Net Pay's in ≠ out by exactly the un-prorated expense slice
 * `fullYearLivingNonMortgage × (1 − remainingFraction)`.
 *
 * Giving the row a real `cashflowDetail` moves it onto the Sankey's PREFERRED
 * path (the same path every engine-projected year uses post-#147), so it never
 * re-derives anything from raw inputs. We reuse `buildCashflowDetail` for the
 * income / deferral / employer-match / mortgage classification (one source of
 * truth) and scale every dollar field by `remainingFraction` so the detail is
 * uniformly prorated and lines up with the row's already-prorated income, taxes,
 * and `livingExpenses`.
 *
 * `expensesByCategory` is rebuilt here from `getAnnualAmount` (long-term goals →
 * $0, mortgage excluded) rather than taken from `buildCashflowDetail`, because
 * the row's `livingExpenses` (= Σ `getAnnualAmount` over yearZero's expenses) also
 * excludes goal set-asides. Matching that basis keeps the Sankey's close term
 * (`livingExpenses − mortgage`) and the emitted per-category links consistent, so
 * Net Pay balances even for users funding a long-term goal.
 *
 * Built from `yearZero`'s ORIGINAL expenses (the same set `livingExpenses` is
 * derived from), not the EOY row's amortization-adjusted expenses, so the mortgage
 * split here matches the mortgage payment baked into `livingExpenses`.
 */
function buildEoyCashflowDetail(
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    accounts: AnyAccount[],
    insurance: number,
    year: number,
    remainingFraction: number,
): CashflowDetail {
    // No vest/interest account-id maps (rsuVestAccountId / interestAccountIdByIncomeId)
    // are passed here, and that is intentional: this builds the EOY row from
    // `yearZero.incomes`, which holds only the user's RAW incomes (WorkIncome,
    // pensions, SS, etc.). The synthetic reinvested incomes those maps key on —
    // `rsu-vest-…` vest ids and `interest-…` interest ids — are minted ONLY inside
    // the engine's per-year projection (RSUVesting / IncomeProjection) and never
    // reach `yearZero.incomes`, so there is nothing for the maps to resolve and the
    // reinvested-destination branch in buildCashflowDetail is not exercised on this
    // path. (If a synthetic vest/interest id ever did reach here, the resolver would
    // fall back to the raw income name — still correct, just unlabeled by account.)
    //
    // Lightweight dev-only guard so the invariant above doesn't live in prose alone:
    // if a future regression ever routes a synthetic `interest-`/`rsu-vest-` id into
    // the raw income set, those incomes would need the (omitted) account-id maps to
    // resolve their reinvested destination, so omitting the maps would silently
    // mislabel them. Throwing in dev (tests run with import.meta.env.DEV === true)
    // turns that latent drift into a loud failure; stripped from production builds,
    // so the render/sim hot path pays nothing.
    if (import.meta.env.DEV) {
        const synthetic = incomes.find(
            inc => inc.id.startsWith('interest-') || inc.id.startsWith('rsu-vest-'),
        );
        if (synthetic) {
            throw new Error(
                `buildEoyCashflowDetail received a synthetic income id ("${synthetic.id}") in ` +
                `yearZero.incomes, but omits the rsuVestAccountId/interestAccountIdByIncomeId ` +
                `maps needed to resolve its reinvested destination. Pass the account-id maps ` +
                `here, or keep synthetic ids out of yearZero.incomes.`,
            );
        }
    }

    const fullYear = buildCashflowDetail({
        incomes,
        expenses,
        accounts,
        insurance,
        year,
        brokerageLTCGFromGross: 0,
    });

    // Rebuild expense categories from the same getAnnualAmount basis as the row's
    // livingExpenses (goals → 0, mortgage split out), so close term == link sum.
    const expensesByCategory: Record<string, number> = {};
    for (const exp of expenses) {
        if (exp instanceof MortgageExpense) continue;
        const amount = exp.getAnnualAmount(year);
        if (amount <= 0) continue; // long-term goals report 0 here
        const category = CLASS_TO_CATEGORY[exp.constructor.name] || 'Other';
        expensesByCategory[category] = (expensesByCategory[category] || 0) + amount * remainingFraction;
    }

    const f = remainingFraction;
    return {
        incomeBySource: fullYear.incomeBySource.map(s => ({ ...s, amount: s.amount * f })),
        userPreTax401k: fullYear.userPreTax401k * f,
        userRoth401k: fullYear.userRoth401k * f,
        employerMatchPreTax: fullYear.employerMatchPreTax * f,
        employerMatchRoth: fullYear.employerMatchRoth * f,
        insurance: fullYear.insurance * f,
        mortgagePrincipal: fullYear.mortgagePrincipal * f,
        mortgageInterestEscrow: fullYear.mortgageInterestEscrow * f,
        expensesByCategory,
        brokerageLTCGFromGross: 0,
    };
}

/**
 * Resolve `autoMax401k` on WorkIncomes for a given start year/age. When
 * autoMax401k is 'traditional' or 'roth', the stored preTax401k/roth401k values
 * are the user's custom values, not the IRS-limit-capped values; this bakes the
 * effective values in so downstream consumers (year-0 metrics, calibration,
 * partial-year adjustments) see capped amounts. Returns a new array; incomes
 * that need no change are returned by reference.
 */
export function resolveIncomes(
    incomes: AnyIncome[],
    startYear: number,
    startAge: number,
): AnyIncome[] {
    return incomes.map(inc => {
        if (inc instanceof WorkIncome && inc.autoMax401k !== 'custom') {
            const effective = inc.getEffective401k(startYear, startAge);
            if (effective.preTax !== inc.preTax401k || effective.roth !== inc.roth401k) {
                return new WorkIncome(
                    inc.id, inc.name, inc.amount, inc.frequency,
                    inc.earned_income, effective.preTax, inc.insurance,
                    effective.roth, inc.employerMatch, inc.matchAccountId,
                    inc.taxType, inc.contributionGrowthStrategy,
                    inc.startDate, inc.end_date, inc.hsaContribution,
                    inc.autoMax401k, inc.esppContributionType,
                    inc.esppContributionAmount, inc.esppDiscountPercent,
                    inc.esppHasLookback, inc.esppOfferingPeriodMonths,
                    inc.esppAccountId, inc.esppExpectedStockGrowth,
                    inc.rsuVestingSchedule, inc.rsuGrantShares, inc.rsuVestFrequency,
                    inc.rsuExpectedStockGrowth, inc.rsuAccountId, inc.rsuWithholdingRate,
                    inc.pensionSystem, inc.startMilestoneId, inc.endMilestoneId,
                    inc.employerMatchType, inc.employerMatchPercent, inc.employerMatchMax
                );
            }
        }
        return inc;
    });
}

/**
 * Derive the FUTURE-year assumptions, applying opt-in calibration: carry the
 * current-year tax override forward as a % by scaling the marginal rates
 * (assumptions.macro.taxCalibration). Tax is linear in the rates, so this scales
 * the bill exactly and flows through gross-up sizing with no cash-balance risk.
 * Returns `assumptions` unchanged when calibration is off or yields no factor.
 *
 * Extracted from runSimulation's inline year-0 block so the DP context builder
 * can derive the SAME calibrated assumptions the final sim executes against.
 *
 * `resolvedIncomes` must already have effective 401k values baked in (see
 * resolveIncomes) so the computed-without-override base matches year 0.
 */
export function deriveFutureAssumptions(
    assumptions: AssumptionsState,
    taxState: TaxState,
    resolvedIncomes: AnyIncome[],
    expenses: AnyExpense[],
    startYear: number,
): AssumptionsState {
    let futureAssumptions = assumptions;
    if (taxState.calibrateFutureYears) {
        // Only calibrate a component when its override is a POSITIVE number. An
        // override of exactly 0 is not null, but treating it as a factor would
        // scale every future rate to 0 and silently zero all future tax — so
        // a 0 override must NOT calibrate (future years fall back to current law).
        const hasFedOverride = taxState.fedOverride !== null && taxState.fedOverride > 0;
        const hasStateOverride = taxState.stateOverride !== null && taxState.stateOverride > 0;
        const computedFed = hasFedOverride
            ? TaxService.calculateFederalTaxFromIncomes({ ...taxState, fedOverride: null }, resolvedIncomes, expenses, 0, startYear, assumptions)
            : 0;
        const computedState = hasStateOverride
            ? TaxService.calculateStateTax({ ...taxState, stateOverride: null }, resolvedIncomes, expenses, startYear, assumptions)
            : 0;
        const fedFactor = hasFedOverride && computedFed > 1 ? taxState.fedOverride! / computedFed : 1;
        const stateFactor = hasStateOverride && computedState > 1 ? taxState.stateOverride! / computedState : 1;
        if (fedFactor !== 1 || stateFactor !== 1) {
            futureAssumptions = { ...assumptions, macro: { ...assumptions.macro, taxCalibration: { fed: fedFactor, state: stateFactor } } };
        }
    }
    return futureAssumptions;
}

/**
 * Extract baseline projections from a simulation run WITHOUT Roth conversions.
 * These projections capture the actual simulated values at RMD age, including:
 * - Traditional balance with all contributions, growth, and withdrawals
 * - SS income with COLA applied
 * - Pension income with COLA applied
 */
export function extractBaselineProjections(
    simulation: SimulationYear[],
    birthYear: number
): BaselineProjections | null {
    const rmdStartAge = getRMDStartAge(birthYear);
    const rmdYear = birthYear + rmdStartAge;

    const rmdYearData = simulation.find(y => y.year === rmdYear);
    if (!rmdYearData) {
        // RMD year is beyond simulation range
        return null;
    }

    // Sum Traditional balances from all Traditional accounts
    const traditionalBalanceAtRMD = rmdYearData.accounts
        .filter(acc => acc instanceof InvestedAccount &&
            (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA'))
        .reduce((sum, acc) => sum + (acc as InvestedAccount).amount, 0);

    // Get SS at RMD year (already has COLA applied by simulation)
    const ssAtRMD = TaxService.getSocialSecurityBenefits(rmdYearData.incomes, rmdYear);

    // Get pension at RMD year (already has COLA applied)
    const pensionAtRMD = rmdYearData.incomes
        .filter(inc =>
            inc.className === 'FERSPensionIncome' ||
            inc.className === 'CSRSPensionIncome')
        .reduce((sum, inc) => sum + (inc.getAnnualAmount?.(rmdYear) ?? 0), 0);

    // Get passive income at RMD year (rental, dividends, interest — excludes RMD-sourced).
    // This matches the filter YearSolver uses for current-year passive, so the projection
    // is consistent with what the ceiling calculator expects.
    const passiveAtRMD = rmdYearData.incomes
        .filter(inc =>
            inc.className === 'PassiveIncome' &&
            (inc as { sourceType?: string }).sourceType !== 'RMD')
        .reduce((sum, inc) => sum + (inc.getAnnualAmount?.(rmdYear) ?? 0), 0);

    return { traditionalBalanceAtRMD, ssAtRMD, pensionAtRMD, passiveAtRMD, rmdYear };
}

/**
 * Per-year forward projection sub-simulation.
 *
 * Runs from `currentSimYear` forward to the user's RMD year, doing only
 * standard-deduction-headroom (0% bracket) Roth conversions. Returns the
 * BaselineProjections snapshot at RMD year, which the main sim feeds into
 * the rate-match algorithm so that "future marginal rate at RMD" is
 * decoupled from the live, depleting Traditional balance.
 *
 * Capped at the RMD year per user direction — only `traditionalBalanceAtRMD`
 * (and SS/pension/passive at RMD) feed back into the main sim, so projecting
 * past that point is wasted work.
 *
 * Recursion guard: this sub-sim runs in 'std-ded-only' mode, which makes
 * `calculateDynamicConversionCeiling` short-circuit and never re-enter
 * `runProjectionSubsim`.
 */
function runProjectionSubsim(
    currentSimYear: number,
    currentAccounts: AnyAccount[],
    currentIncomes: AnyIncome[],
    currentExpenses: AnyExpense[],
    timelineSoFar: SimulationYear[],
    previousActiveMilestones: string[],
    milestoneReachYears: Map<string, number>,
    assumptions: AssumptionsState,
    taxState: TaxState,
    birthYear: number,
): BaselineProjections | undefined {
    const rmdYear = birthYear + getRMDStartAge(birthYear);
    const yearsToProject = rmdYear - currentSimYear;
    if (yearsToProject <= 0) return undefined;

    // Shallow-copy in-flight collections so the sub-sim doesn't mutate main-sim
    // state (account `amount` etc. are mutated in place by simulateOneYear).
    const subTimeline: SimulationYear[] = [...timelineSoFar];
    runSimulationLoop({
        previousSimYear: currentSimYear,
        yearsToRun: yearsToProject,
        currentAccounts: [...currentAccounts],
        currentIncomes: [...currentIncomes],
        currentExpenses: [...currentExpenses],
        timeline: subTimeline,
        previousActiveMilestones: [...previousActiveMilestones],
        milestoneReachYears: new Map(milestoneReachYears),
        assumptions,
        taxState,
        conversionMode: 'std-ded-only',
        // No baselineProvider — std-ded-only mode short-circuits rate-match,
        // so a baseline projection would be unused. This also breaks any
        // theoretical recursion.
    });

    return extractBaselineProjections(subTimeline, birthYear) ?? undefined;
}

/**
 * Per-year loop body extracted from `runSimulation`. Lets the main sim and
 * `runProjectionSubsim` share the same iteration logic without re-running
 * year-0 setup (year-0 synthesis, partial-year payroll, EOY projection
 * injection) on mid-trajectory state.
 */
function runSimulationLoop(args: {
    previousSimYear: number;
    yearsToRun: number;
    currentAccounts: AnyAccount[];
    currentIncomes: AnyIncome[];
    currentExpenses: AnyExpense[];
    timeline: SimulationYear[];
    previousActiveMilestones: string[];
    milestoneReachYears: Map<string, number>;
    assumptions: AssumptionsState;
    taxState: TaxState;
    yearlyReturns?: number[];
    conversionMode: 'rate-match' | 'std-ded-only';
    baselineProvider?: (
        simulationYear: number,
        currentAccounts: AnyAccount[],
        currentIncomes: AnyIncome[],
        currentExpenses: AnyExpense[],
        timeline: SimulationYear[],
        previousActiveMilestones: string[],
        milestoneReachYears: Map<string, number>,
    ) => BaselineProjections | undefined;
    /** Pre-solved DP conversion plan; keyed by simulation year. */
    dpConversionPlan?: Map<number, number>;
    /** Per-year DP solver debug strings; keyed by simulation year. */
    dpDebugByYear?: Map<number, string[]>;
    /** #98 closed-loop conversion policy. MC path only. */
    mcConversionPolicy?: DPPolicy;
    /** #170: candidate-scoring runs — skip the display-only tax-cost refinements. */
    skipDisplayRefinement?: boolean;
}): void {
    let { currentAccounts, currentIncomes, currentExpenses, previousActiveMilestones } = args;
    const { milestoneReachYears, timeline, assumptions, taxState, yearlyReturns,
            previousSimYear, yearsToRun, conversionMode, baselineProvider, dpConversionPlan, dpDebugByYear,
            mcConversionPolicy, skipDisplayRefinement } = args;

    // #146 [4]: true while any milestone-started income may still be dormant. Latches
    // off once they have all fired (the dormant list empties) — milestones are
    // cumulative so it can never refill — so the per-year Set bookkeeping below stops
    // running for the rest of the horizon (matters on the Monte Carlo hot path).
    let dormantCarryActive = currentIncomes.some(inc => inc.startMilestoneId);

    // Survivor scenario (fp-review F3b): gate resolved once — same predicate the
    // filing-status seam (resolveTaxEventsForYear) uses, so both halves of the
    // composition fire under identical conditions.
    const survivor = activeSurvivorScenario(taxState);

    for (let i = 1; i <= yearsToRun; i++) {
        const simulationYear = previousSimYear + i;
        const returnOverride = yearlyReturns ? yearlyReturns[i - 1] : undefined;

        const baseline = baselineProvider?.(
            simulationYear, currentAccounts, currentIncomes, currentExpenses,
            timeline, previousActiveMilestones, milestoneReachYears,
        );

        // Survivor scenario: at the death year, apply the one-time non-tax
        // transition to the carried-forward collections — drop all but the
        // largest SS benefit, scale expenses. Fires exactly at `deathYear`
        // (never `>=`): the loop feeds the transformed collections forward, so
        // a `>=` would re-scale expenses every year. Runs AFTER the
        // baselineProvider call on purpose — the rolling-baseline sub-sim
        // starts its own loop at THIS simulationYear and applies its own
        // transition to its (still untransformed) copies; transforming first
        // would hand it inputs it then transforms a second time. The
        // filing-status half rides resolveTaxEventsForYear below.
        if (survivor && simulationYear === survivor.deathYear) {
            ({ incomes: currentIncomes, expenses: currentExpenses } =
                applySurvivorTransition(currentIncomes, currentExpenses, survivor.expenseFactor ?? 1));
        }

        // Apply any scheduled tax life events (moving states, filing-status
        // change) that have fired by this year. milestoneReachYears holds the
        // years milestones were reached in prior loop iterations.
        const effectiveTaxState = resolveTaxEventsForYear(taxState, simulationYear, milestoneReachYears);

        const result = simulateOneYear(
            simulationYear,
            currentIncomes,
            currentExpenses,
            currentAccounts,
            assumptions,
            effectiveTaxState,
            timeline,
            returnOverride,
            previousActiveMilestones,
            milestoneReachYears,
            {
                baselineProjections: baseline,
                conversionMode,
                dpConversionPlan,
                dpDebugByYear,
                mcConversionPolicy,
                skipDisplayRefinement,
            },
        );

        timeline.push(result);

        // #146: result.incomes is milestone-FILTERED, so an income whose START
        // milestone hasn't fired yet is absent from it. Feeding only result.incomes
        // forward would permanently DROP that income before its milestone can ever
        // fire — its salary, and any RSU vesting, would never appear for the whole
        // horizon. Carry forward the mutated active incomes AND re-include the
        // dormant, not-yet-started milestone incomes (unmutated) so they survive
        // until their milestone hits. Only incomes with an UNREACHED start milestone
        // are re-added: ended/retired drops (their start milestone is already
        // reached) and regenerated RMD incomes (no start milestone) stay out.
        // Skip the bookkeeping entirely when nothing is (or remains) milestone-gated
        // — avoids per-year Set/array allocations on the Monte Carlo hot path
        // (runSimulation runs once per scenario × year).
        if (dormantCarryActive) {
            const reachedMilestoneSet = new Set(result.activeMilestones || []);
            const survivingIncomeIds = new Set(result.incomes.map(inc => inc.id));
            const dormantMilestoneIncomes = currentIncomes.filter(inc =>
                inc.startMilestoneId &&
                !reachedMilestoneSet.has(inc.startMilestoneId) &&
                // An income whose END milestone has already fired is DONE, not
                // dormant — don't re-add it (else the list grows every year for the
                // rest of the horizon).
                !(inc.endMilestoneId && reachedMilestoneSet.has(inc.endMilestoneId)) &&
                !survivingIncomeIds.has(inc.id));
            if (dormantMilestoneIncomes.length > 0) {
                currentIncomes = [...result.incomes, ...dormantMilestoneIncomes];
            } else {
                // All milestone incomes have started; none can become dormant again.
                currentIncomes = result.incomes;
                dormantCarryActive = false;
            }
        } else {
            currentIncomes = result.incomes;
        }
        currentExpenses = result.expenses;
        currentAccounts = result.accounts;
        previousActiveMilestones = result.activeMilestones || [];

        result.milestoneEvents?.forEach(event => {
            if (!milestoneReachYears.has(event.milestoneId)) {
                milestoneReachYears.set(event.milestoneId, event.yearReached);
            }
        });
    }
}

/**
 * Trailing optional bag for `runSimulation`. The leading args (years, accounts,
 * incomes, expenses, assumptions, taxState, yearlyReturns) stay positional; every
 * optional knob lives here so call sites are self-documenting and inserting a new
 * option can't silently shift an existing one into the wrong slot (#97). Threaded
 * down through `runSimulationLoop` → `simulateOneYear` to the solver.
 */
export interface RunSimulationOptions {
    referenceDate?: Date;
    /** Conversion-decision mode for the rate-match path. Default 'rate-match'. */
    conversionMode?: 'rate-match' | 'std-ded-only';
    /** Run a forward sub-sim each year to derive the conversion ceiling baseline. */
    useRollingBaseline?: boolean;
    dpConversionPlan?: Map<number, number>;
    dpDebugByYear?: Map<number, string[]>;
    /** accountId → extra dollars to add to the synthetic EOY projection row.
     *  Populated by callers from `computeEOYBudgetContributions` so that
     *  non-payroll priority contributions (Brokerage / IRA / HSA / Savings)
     *  show up in the Projected Dec point. */
    eoyContributionAdditions?: Record<string, number>;
    /** DebtAccount id → principal $ to subtract from the synthetic EOY row,
     *  so loan balances reflect amortization through year-end. */
    eoyDebtReductions?: Record<string, number>;
    /** MortgageExpense id → principal $ to subtract from its loan_balance on
     *  the synthetic EOY row (mortgages don't live on a DebtAccount). */
    eoyMortgageReductions?: Record<string, number>;
    /** #98 closed-loop conversion POLICY. Set ONLY by the MC engine; the
     *  production/deterministic call sites leave it undefined. When present, the DP
     *  conversion strategy looks up the conversion at the path's realized
     *  (Traditional, Roth) state — see YearSolver.planConversionDP. */
    mcConversionPolicy?: DPPolicy;
    /** #170: candidate-SCORING runs only (engine-direct conversion search, joint
     *  withdrawal-order search, MC h*-cap derivation). Skips the display-only
     *  conversion tax-cost refinements — the #164 counterfactual re-solve and the
     *  #159 working-year finite-difference decomposition — which scoring
     *  timelines never surface. Reporting-only: amounts, balances, taxes, and
     *  cashflows are identical either way. NEVER set on the run whose timeline
     *  reaches the UI — displayed taxAmount must stay finite-difference-exact. */
    skipDisplayRefinement?: boolean;
}

export const runSimulation = (
    yearsToRun: number = 30,
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    yearlyReturns?: number[],
    options: RunSimulationOptions = {},
): SimulationYear[] => {
    const {
        referenceDate,
        conversionMode = 'rate-match',
        useRollingBaseline = false,
        dpConversionPlan,
        dpDebugByYear,
        eoyContributionAdditions,
        eoyDebtReductions,
        eoyMortgageReductions,
        mcConversionPolicy,
        skipDisplayRefinement,
    } = options;

    // Calculate start year and current age from birth year
    // If priorYearMode is enabled, start simulation from last year (for verified data entry)
    const currentYear = new Date().getFullYear();
    const startYear = assumptions.demographics.priorYearMode
        ? currentYear - 1
        : currentYear;
    const birthYear = getBirthYear(assumptions.milestones);
    const startAge = startYear - birthYear;

    // --- LIFE EXPECTANCY CAP ---
    // Calculate how many years the user actually has left (derived from End of Plan milestone)
    const lifeExpectancy = getLifeExpectancy(assumptions.milestones);
    const yearsUntilDeath = Math.max(0, lifeExpectancy - startAge);

    // Run for the requested time, OR until death—whichever comes first.
    const effectiveYearsToRun = Math.min(yearsToRun, yearsUntilDeath);

    const timeline: SimulationYear[] = [];

    // --- STEP 0.5: RESOLVE autoMax401k ON WORK INCOMES ---
    // When autoMax401k is 'traditional' or 'roth', the stored preTax401k/roth401k values
    // are the user's custom values, not the IRS-limit-capped values. Resolve them now
    // so Year 0 incomes have effective values for Sankey charts and partial-year adjustments.
    const resolvedIncomes: AnyIncome[] = resolveIncomes(incomes, startYear, startAge);

    // --- STEP 1: CREATE YEAR 0 (Baseline) ---
    // Note: Interest income is NOT included in Year 0 to allow users to match
    // their actual tax situation. Interest is generated starting in Year 1.

    // Calculate current baseline metrics using existing TaxService logic
    // Resolved incomes have effective 401k values baked in, so useStoredValue=true is safe
    const currentGross = TaxService.getGrossIncome(resolvedIncomes, startYear);
    const currentPreTax = TaxService.getPreTaxExemptions(resolvedIncomes, startYear, startAge, true);
    const currentPostTax = TaxService.getPostTaxExemptions(resolvedIncomes, startYear, startAge, true);
    const currentInsurance = resolvedIncomes.reduce((sum, inc) =>
        inc instanceof WorkIncome ? sum + inc.getProratedAnnual(inc.insurance, startYear) : sum, 0
    );

    const currentFed = TaxService.calculateFederalTaxFromIncomes(taxState, resolvedIncomes, expenses, 0, startYear, assumptions);
    const currentState = TaxService.calculateStateTax(taxState, resolvedIncomes, expenses, startYear, assumptions);
    const currentFica = TaxService.calculateFicaTax(taxState, resolvedIncomes, startYear, assumptions);
    const currentTotalTax = currentFed + currentState + currentFica;

    // Dollar tax overrides apply to the CURRENT year only (year 0, computed
    // above with the overrides intact). Every projected (future) year uses a
    // scoped copy with the overrides cleared, so a current-year correction no
    // longer pins a flat amount across decades.
    const futureTaxState: TaxState = scopeFutureTaxState(taxState);

    // Calibration (opt-in): carry the current-year correction forward as a %.
    // Derive the per-component factor = override ÷ engine's computed-without-
    // override for this year, and inject it as a runtime field the future-year
    // getTaxParameters reads to SCALE the marginal rates. Tax is linear in the
    // rates, so this scales the bill exactly and flows through gross-up sizing
    // with no cash-balance risk. FICA is excluded (mechanical); a ~zero
    // computed base (retirement) is guarded so the ratio can't blow up.
    const futureAssumptions = deriveFutureAssumptions(assumptions, taxState, resolvedIncomes, expenses, startYear);

    const currentLivingExpenses = expenses.reduce((sum, exp) => sum + exp.getAnnualAmount(startYear), 0);

    // For Year 0, discretionary is what's left over from your current input data
    const currentDiscretionary = currentGross - currentPreTax - currentPostTax - currentTotalTax - currentLivingExpenses;

    const yearZero: SimulationYear = {
        year: startYear,
        incomes: [...resolvedIncomes],
        expenses: [...expenses],
        accounts: [...accounts],
        cashflow: {
            totalIncome: currentGross,
            totalExpense: currentLivingExpenses + currentTotalTax + currentPreTax + currentPostTax,
            livingExpenses: currentLivingExpenses,
            discretionary: currentDiscretionary,
            // In Year 0, we treat the input as "Static", so invested is effectively 0 or the sum of payroll deductions
            investedUser: currentPreTax + currentPostTax - currentInsurance,
            investedMatch: resolvedIncomes.reduce((sum, inc) => inc instanceof WorkIncome ? sum + inc.getEffectiveAnnualEmployerMatch() : sum, 0),
            totalInvested: (currentPreTax + currentPostTax - currentInsurance) +
                            resolvedIncomes.reduce((sum, inc) => inc instanceof WorkIncome ? sum + inc.getEffectiveAnnualEmployerMatch() : sum, 0),
            bucketAllocations: 0,
            bucketDetail: {}, // Initialize empty for Year 0
            withdrawals: 0,
            withdrawalDetail: {}
        },
        taxDetails: {
            fed: currentFed,
            state: currentState,
            fica: currentFica,
            preTax: currentPreTax - currentInsurance,
            insurance: currentInsurance,
            postTax: currentPostTax,
            capitalGains: 0,
            withdrawalOrdinaryTax: 0,
            niit: 0
        },
        // MAGI ≈ AGI for the current year. Stored so a later year's Medicare IRMAA
        // lookback (year N reads year N-2) has a real basis rather than a proxy.
        // AGI counts only the TAXABLE portion of Social Security, not gross SS, so
        // subtract the non-taxable SS: AGI = (gross − preTax − grossSS) + taxableSS.
        magi: (() => {
            const grossSS = TaxService.getSocialSecurityBenefits(resolvedIncomes, startYear);
            const nonSSAgi = currentGross - currentPreTax - grossSS;
            const taxableSS = TaxService.getTaxableSocialSecurityBenefits(
                grossSS, Math.max(0, nonSSAgi), 0, taxState.filingStatus,
            );
            return Math.max(0, nonSSAgi + taxableSS);
        })(),
        logs: ["Baseline Year 0 initialized from current context data."]
    };

    timeline.push(yearZero);

    // --- STEP 1.5: PARTIAL-YEAR ADJUSTMENT ---
    // Apply remaining fraction of current year's growth and contributions
    // so Year 1 starts from projected end-of-year balances, not today's balances.
    const refDate = referenceDate ?? new Date();
    const currentMonth = refDate.getMonth(); // 0=Jan, 11=Dec
    const remainingFraction = (11 - currentMonth) / 12; // Jan→11/12, Dec→0/12

    let adjustedAccounts: AnyAccount[] = [...yearZero.accounts];

    if (remainingFraction > 0 && !assumptions.demographics.priorYearMode) {
        // Calculate partial-year payroll contributions per account
        const partialContributions: Record<string, { user: number; employer: number }> = {};

        yearZero.incomes.forEach(inc => {
            if (inc instanceof WorkIncome && inc.matchAccountId) {
                // TRUE month-interval overlap of the remaining-months tail
                // [currentMonth+1 .. Dec] with the income's active window this year.
                // The old min(remainingFraction, activeMultiplier) counted a job that
                // had already ENDED earlier in the year (e.g. ended March, viewed in
                // October) as still depositing ~2 months of annualized 401k+match into
                // the accounts that seed Year 1 — a permanent phantom deposit that
                // compounds across the whole plan.
                const effectiveFraction = getIncomeActiveMonthOverlap(inc, startYear, currentMonth + 1);
                if (effectiveFraction <= 0) return;

                // preTax401k/roth401k are per pay period; annualize before applying the
                // partial-year fraction so non-annual frequencies aren't under-counted.
                const userContrib = inc.getProratedAnnual(inc.preTax401k + inc.roth401k) * effectiveFraction;
                const employerContrib = inc.getEffectiveAnnualEmployerMatch() * effectiveFraction;

                const existing = partialContributions[inc.matchAccountId] || { user: 0, employer: 0 };
                partialContributions[inc.matchAccountId] = {
                    user: existing.user + userContrib,
                    employer: existing.employer + employerContrib,
                };
            }
        });

        // Apply partial-year contributions (no growth — Year 1 handles full-year growth)
        adjustedAccounts = adjustedAccounts.map(acc => {
            if (acc instanceof InvestedAccount) {
                const contribs = partialContributions[acc.id] || { user: 0, employer: 0 };
                if (contribs.user === 0 && contribs.employer === 0) return acc;

                const newAmount = acc.amount + contribs.user + contribs.employer;
                const newEmployerBalance = acc.employerBalance + contribs.employer;
                const newCostBasis = acc.costBasis + contribs.user + contribs.employer;

                return new InvestedAccount(
                    acc.id, acc.name, newAmount, newEmployerBalance,
                    acc.tenureYears, acc.expenseRatio, acc.taxType,
                    acc.isContributionEligible, acc.vestedPerYear, newCostBasis, acc.customROR,
                    acc.conversionHistory, acc.lots, acc.stockPct
                );
            }

            return acc;
        });

        // Layer on budget-tracked priority contributions (Brokerage / IRA / HSA /
        // Savings). Without this, the Projected Dec point only reflects payroll
        // and ignores everything the user is actively budgeting toward.
        if (eoyContributionAdditions) {
            adjustedAccounts = adjustedAccounts.map(acc => {
                const extra = eoyContributionAdditions[acc.id] || 0;
                if (extra <= 0) return acc;
                if (acc instanceof InvestedAccount) {
                    return new InvestedAccount(
                        acc.id, acc.name, acc.amount + extra, acc.employerBalance,
                        acc.tenureYears, acc.expenseRatio, acc.taxType,
                        acc.isContributionEligible, acc.vestedPerYear, acc.costBasis + extra, acc.customROR,
                        acc.conversionHistory, acc.lots, acc.stockPct
                    );
                }
                if (acc instanceof SavedAccount) {
                    return new SavedAccount(acc.id, acc.name, acc.amount + extra, acc.apr);
                }
                return acc;
            });
        }

        // Layer on expected debt principal pay-down for the remainder of the
        // year so mortgage / loan balances at the Projected Dec point reflect
        // amortization through year-end rather than today's balance.
        if (eoyDebtReductions) {
            adjustedAccounts = adjustedAccounts.map(acc => {
                if (!(acc instanceof DebtAccount) || acc instanceof DeficitDebtAccount) return acc;
                const reduction = eoyDebtReductions[acc.id] || 0;
                if (reduction <= 0) return acc;
                const nextAmount = Math.max(0, acc.amount - reduction);
                return new DebtAccount(acc.id, acc.name, nextAmount, acc.linkedAccountId, acc.apr);
            });
        }
    }

    // --- STEP 1.75: INSERT END-OF-YEAR PROJECTION ---
    // Insert a synthetic data point representing projected balances at December 31 of the current year.
    // This prevents the "big jump" confusion between Year 0 (today) and Year 1 (end of next year).
    if (remainingFraction > 0 && !assumptions.demographics.priorYearMode) {
        // Layer on expected mortgage principal pay-down so MortgageExpense.loan_balance
        // on the synthetic EOY row reflects amortization through year-end.
        let adjustedExpenses = yearZero.expenses;
        if (eoyMortgageReductions) {
            adjustedExpenses = yearZero.expenses.map(exp => {
                if (!(exp instanceof MortgageExpense)) return exp;
                const reduction = eoyMortgageReductions[exp.id] || 0;
                if (reduction <= 0) return exp;
                const nextBalance = Math.max(0, exp.loan_balance - reduction);
                return new MortgageExpense(
                    exp.id, exp.name, exp.frequency,
                    exp.valuation, nextBalance, exp.starting_loan_balance,
                    exp.apr, exp.term_length, exp.property_taxes, exp.valuation_deduction,
                    exp.maintenance, exp.utilities, exp.home_owners_insurance, exp.pmi, exp.hoa_fee,
                    exp.is_tax_deductible, exp.tax_deductible, exp.linkedAccountId,
                    exp.startDate, exp.payment, exp.extra_payment, exp.endDate,
                    exp.startMilestoneId, exp.endMilestoneId,
                );
            });
        }
        const eoyYear: SimulationYear = {
            ...yearZero,
            accounts: adjustedAccounts,
            expenses: adjustedExpenses,
            cashflow: {
                ...yearZero.cashflow,
                totalIncome: yearZero.cashflow.totalIncome * remainingFraction,
                totalExpense: yearZero.cashflow.totalExpense * remainingFraction,
                livingExpenses: yearZero.cashflow.livingExpenses * remainingFraction,
                investedUser: yearZero.cashflow.investedUser * remainingFraction,
                investedMatch: yearZero.cashflow.investedMatch * remainingFraction,
                totalInvested: yearZero.cashflow.totalInvested * remainingFraction,
                discretionary: yearZero.cashflow.discretionary * remainingFraction,
            },
            taxDetails: {
                ...yearZero.taxDetails,
                fed: yearZero.taxDetails.fed * remainingFraction,
                state: yearZero.taxDetails.state * remainingFraction,
                fica: yearZero.taxDetails.fica * remainingFraction,
                earlyWithdrawalPenalty: (yearZero.taxDetails.earlyWithdrawalPenalty ?? 0) * remainingFraction,
                longTermCapitalGains: (yearZero.taxDetails.longTermCapitalGains ?? 0) * remainingFraction,
            },
            // #148: attach a prorated per-source cashflow detail so the Sankey takes
            // its PREFERRED path for this row instead of the fallback, whose
            // full-year expense links disagreed with the row's prorated livingExpenses
            // and left Net Pay's inflow ≠ outflow. Derived from yearZero's ORIGINAL
            // full-year expenses (the basis of livingExpenses) and scaled by
            // remainingFraction, matching the row's already-prorated income/taxes.
            cashflowDetail: buildEoyCashflowDetail(
                yearZero.incomes, yearZero.expenses, adjustedAccounts,
                currentInsurance, startYear, remainingFraction,
            ),
            isEndOfYearProjection: true,
            logs: [],
        };
        timeline.push(eoyYear);
    }

    // --- STEP 2: RUN FUTURE SIMULATION ---
    // Build the rolling baseline provider when in rate-match mode and rolling
    // baselines are requested (used by `runSimulationWithOptimization`). Each
    // year, the provider runs a forward sub-sim from the in-flight state to RMD
    // year doing only std-ded-headroom conversions, then extracts baseline
    // projections to feed into the rate-match conversion ceiling. This decouples
    // "future marginal at RMD" from the live, depleting Trad balance.
    const rmdYear = birthYear + getRMDStartAge(birthYear);
    const baselineProvider = useRollingBaseline
        && conversionMode === 'rate-match'
        && assumptions.investments.taxOptimizationEnabled
        ? (
            simulationYear: number,
            subAccounts: AnyAccount[],
            subIncomes: AnyIncome[],
            subExpenses: AnyExpense[],
            subTimeline: SimulationYear[],
            subActiveMilestones: string[],
            subReachYears: Map<string, number>,
        ) => {
            if (simulationYear >= rmdYear) return undefined;
            return runProjectionSubsim(
                simulationYear - 1, // sub-sim starts AFTER previous year, ends at rmdYear
                subAccounts, subIncomes, subExpenses,
                subTimeline, subActiveMilestones, subReachYears,
                futureAssumptions, futureTaxState, birthYear,
            );
        }
        : undefined;

    runSimulationLoop({
        previousSimYear: startYear,
        yearsToRun: effectiveYearsToRun,
        currentAccounts: adjustedAccounts,
        currentIncomes: yearZero.incomes,
        currentExpenses: yearZero.expenses,
        timeline,
        previousActiveMilestones: [],
        milestoneReachYears: new Map(),
        assumptions: futureAssumptions,
        taxState: futureTaxState,
        yearlyReturns,
        conversionMode,
        baselineProvider,
        dpConversionPlan,
        dpDebugByYear,
        mcConversionPolicy,
        skipDisplayRefinement,
    });

    return timeline;
};

/**
 * Build the DP solve inputs (per-year contexts, starting balances, objective)
 * from a std-ded-only baseline timeline. Shared by the deterministic projection
 * (`runSimulationWithOptimization`) and the Monte Carlo policy solve
 * (`buildMcConversionPolicy`) so the two solve against identical contexts —
 * the only difference is whether a `returnDistribution` is layered on (#98).
 * Extracted verbatim from runSimulationWithOptimization; behavior-preserving.
 */
export function buildDpSolveInputs(
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    baselineTimeline: SimulationYear[],
    dpObjective?: DPObjectiveOptions,
): { dpInputs: DPInputs; effectiveDpObjective: DPObjectiveOptions } {
    const birthYear = getBirthYear(assumptions.milestones);
    const retirementYear = birthYear + getRetirementAge(assumptions.milestones);

    // Brokerage balance entering retirementYear (= end of retirementYear − 1).
    // buildDPYearContexts looks this up from baseline when available; this
    // fallback handles the already-retired-today case where no prior baseline
    // year exists. Mirrors the trad/roth fallback below.
    const preRetirementSimYearForBrokerage = baselineTimeline.find(y => y.year === retirementYear - 1);
    const startingBrokerageBalance = getTotalBrokerageBalance(
        (preRetirementSimYearForBrokerage ?? { accounts }).accounts,
    );

    // The final sim (Pass 3) runs against the SAME future-year tax state and
    // calibrated assumptions that runSimulation derives internally. Derive
    // them here too so the DP optimizes against the rates/events it will
    // actually execute against — not the un-calibrated year-0 tax state.
    //   #4 (calibration): dpAssumptions carries assumptions.macro.taxCalibration
    //       when TaxState.calibrateFutureYears is on, so getTaxParameters
    //       inside buildDPYearContexts scales the brackets to match.
    //   #3 (scheduled tax events): dpTaxState clears dollar overrides (which
    //       getTaxParameters ignores anyway) so the DP's future-year tax
    //       state matches the executed one; the per-year filing/state move
    //       itself is resolved inside buildDPYearContexts via taxEvents.
    const currentYear = new Date().getFullYear();
    const startYear = assumptions.demographics.priorYearMode ? currentYear - 1 : currentYear;
    const startAge = startYear - birthYear;
    const resolvedIncomes = resolveIncomes(incomes, startYear, startAge);
    const dpAssumptions = deriveFutureAssumptions(assumptions, taxState, resolvedIncomes, expenses, startYear);
    const dpTaxState = scopeFutureTaxState(taxState);

    const contexts = buildDPYearContexts(
        baselineTimeline, dpAssumptions, dpTaxState, retirementYear, startingBrokerageBalance,
    );

    // Critical: the DP solves from its FIRST context year onward, so its forward
    // sweep needs the trad balance ENTERING that year, not today. Pulling
    // accounts.vestedAmount here would feed today's balance into year 0
    // of the contexts, missing intervening growth and 401k contributions.
    // Pull from the baseline timeline instead — that's already simulated
    // through the full pre-horizon period.
    //
    // #159: the first context is normally the retirement year, but when a
    // pre-retirement income GAP year qualifies for a context (see
    // buildDPYearContexts), the horizon starts THERE and the starting
    // balances must too — anchor on contexts[0].year rather than
    // retirementYear. With no gap years the two are the same lookup,
    // byte-for-byte.
    //
    // SimulationYear records END-of-year state, so we look up
    // (firstContextYear - 1) to get end-of-prior-year, which equals
    // start-of-first-context-year — the correct t=0 state for the DP
    // forward sweep. Looking up firstContextYear directly produces an
    // off-by-one (DP starts from end-of-first-year, double-counts
    // year 0's flows). If the horizon starts in the very first sim year
    // (no prior records), fall back to today's account balances.
    const firstContextYear = contexts.length > 0 ? contexts[0].year : retirementYear;
    const preRetirementSimYear = baselineTimeline.find(y => y.year === firstContextYear - 1);
    // Pull from the pre-retirement baseline row when it exists (captures
    // pre-retirement growth + 401k contributions); otherwise fall back to today's
    // actual balances (already retired / retiring in year 0). Same tax-type filters
    // and vested-balance weighting as the YearSolver helpers, so the DP inputs are
    // identical to the prior inlined sums.
    const startingBalanceAccounts = (preRetirementSimYear ?? { accounts }).accounts;
    const startingTradBalance = getTotalTraditionalBalance(startingBalanceAccounts);
    const startingRothBalance = getTotalRothBalance(startingBalanceAccounts);
    // Production dp-precomputed = max-wealth with the bracket-aware terminal
    // valuation (#89), parameterized by the user's self-liquidate-vs-bequeath
    // choice. A caller-supplied `dpObjective` (tests) overrides this so the
    // legacy min-tax / flat-τ paths stay reachable for regression coverage.
    const effectiveDpObjective = dpObjective ?? {
        objectiveMode: 'max-wealth' as const,
        terminalValuation: 'bracket-aware' as const,
        // Default 'self-liquidate' (ratified product decision, #89): spend-down. The
        // UI default sets this explicitly; the ?? covers legacy assumptions missing
        // the field. User can switch to 'bequeath'.
        userSituation: assumptions.investments.rothConversionUserSituation ?? 'self-liquidate',
        // COLA for the terminal drawdown (#10): grow the residual's persisting SS +
        // fixed income with inflation each year, matching the nominal engine (SS
        // income increments by this same rate — see Income models' increment()).
        terminalCola: assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate / 100 : 0,
    };

    return {
        dpInputs: {
            contexts,
            currentTradBalance: startingTradBalance,
            currentRothBalance: startingRothBalance,
            backloadDelta: assumptions.investments.rothConversionDPBackloadDelta,
        },
        effectiveDpObjective,
    };
}

/**
 * Solve the Monte Carlo conversion POLICY once per run (#98). Runs the
 * deterministic std-ded baseline for the exogenous contexts, then solves the
 * STOCHASTIC DP — re-centering each account's rate on the MC mean (`meanShift`)
 * and integrating the MC volatility (`returnStdDev`) — to emit a closed-loop
 * policy each MC path looks up at its realized state. Returns the full DPPlan
 * (its `policy` is the closed-loop table; its `conversionsByYear` is the central
 * schedule). Returns `undefined` when the strategy isn't dp-precomputed (or tax
 * optimization is off), in which case MC falls back to per-path rate-match.
 *
 * `returnMean`/`returnStdDev` are PERCENT (the MonteCarloConfig units).
 */
export const buildMcConversionPolicy = (
    yearsToRun: number,
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    returnMean: number,
    returnStdDev: number,
    nodes?: QuadratureNodes,
): DPPlan | undefined => {
    const strategy = resolveRothConversionStrategy(assumptions.investments.rothConversionStrategy);
    if (strategy !== 'dp-precomputed' || !assumptions.investments.taxOptimizationEnabled) {
        return undefined;
    }
    // Deterministic std-ded baseline supplies the exogenous (income / spending /
    // tax / RMD) contexts — the same baseline the deterministic projection uses.
    const baselineAssumptions: AssumptionsState = {
        ...assumptions,
        investments: { ...assumptions.investments, rothConversionStrategy: 'rate-match' },
    };
    const baselineTimeline = runSimulation(
        yearsToRun, accounts, incomes, expenses, baselineAssumptions, taxState, undefined,
        { conversionMode: 'std-ded-only' },
    );
    const { dpInputs, effectiveDpObjective } = buildDpSolveInputs(
        accounts, incomes, expenses, assumptions, taxState, baselineTimeline,
    );
    // Re-center the DP's per-account deterministic rates on the MC draw mean and
    // add the MC volatility as the common shock. `meanShift` is the gap between
    // the MC mean and the deterministic base rate, in decimal; matching how MC
    // applies overrideReturnRate as (R − ER)/100.
    //
    // CRITICAL (#98 review): `ctx.growthRate` is the TRADITIONAL-BALANCE-WEIGHTED
    // average of per-account `effectiveRoR + inflation − expenseRatio`
    // (see getNetGrowthRate in RothConversionDP.ts). Monte Carlo's
    // InvestedAccount.increment grows every account at `(drawn − ER)/100`,
    // IGNORING customROR when an override is present. So a flat `rorBase` built
    // from the GLOBAL ror would center the policy on the wrong drift whenever any
    // Traditional account carries a customROR ≠ global. Instead build `rorBase`
    // as the Traditional-balance-weighted average of `effectiveRoR`
    // (+ inflation), using the SAME tax-type filter and balance weighting as
    // getNetGrowthRate but WITHOUT subtracting ER (ER stays inside ctx.growthRate).
    // Then `ctx.growthRate + meanShift == (mcMean − weighted-ER)/100` exact on
    // the Traditional axis. The Roth axis reuses this same meanShift, so a
    // residual remains only when the Roth accounts' rate blend differs from
    // the Traditional accounts' — an accepted second-order approximation.
    //
    // #207 (asset allocation) changes TWO things here:
    //  1. Both sides of the gap are now allocation-aware. The deterministic side uses
    //     `effectiveRoR` (customROR, else the stock/bond blend); the MC side uses
    //     `blendedMonteCarloReturn`, since MC now applies only `stockPct` of the drawn
    //     return and tops up with the bond rate.
    //  2. A glidepath makes the deterministic drift VARY BY YEAR, so a single scalar
    //     meanShift cannot equal the gap in every year. We therefore emit a per-year
    //     SCHEDULE (planConversionsViaDP accepts `number | number[]`), preserving the
    //     exactness property across the whole horizon rather than only at year 0.
    // Balances are the year-0 vested amounts in every year's weighting — the same
    // approximation the scalar version made; only the RATES vary by year here.
    const inflation = assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0;
    const tradAccounts = accounts.filter((a): a is InvestedAccount =>
        a instanceof InvestedAccount &&
        (a.taxType === 'Traditional 401k' || a.taxType === 'Traditional IRA'));
    const tradTotal = tradAccounts.reduce((s, a) => s + a.vestedAmount, 0);
    const shiftStartYear = new Date().getFullYear();
    const weightedBy = (rateOf: (a: InvestedAccount) => number, fallback: number): number =>
        tradTotal > 0
            ? tradAccounts.reduce((sum, a) => sum + rateOf(a) * a.vestedAmount, 0) / tradTotal
            : fallback;
    const meanShiftSchedule = Array.from({ length: Math.max(1, yearsToRun) }, (_, t) => {
        const year = shiftStartYear + t;
        // Deterministic drift the DP's ctx.growthRate is built from (ER excluded).
        const rorBase = weightedBy(
            a => effectiveRoR(a, assumptions, year),
            defaultBlendedRoR(assumptions, year),
        ) + inflation;
        // What MC's mean draw actually becomes per account after the allocation blend.
        const mcMean = weightedBy(
            a => blendedMonteCarloReturn(a, assumptions, returnMean, year),
            blendedMonteCarloReturn({}, assumptions, returnMean, year),
        );
        return (mcMean - rorBase) / 100;
    });
    // #207: MC applies only `stockPct` of the drawn shock to each account, so the shock the
    // Traditional axis actually experiences is the balance-weighted stock fraction of the
    // configured vol. Solving against the unscaled vol would make the policy conservative
    // (wider shock than reality) for any bond-bearing allocation. Year-0 allocation is used
    // as the single grid-wide vol; a glidepath's drift is handled by the schedule above.
    const weightedStockFraction = weightedBy(
        a => resolveStockPct(a, assumptions, shiftStartYear),
        defaultStockPctForYear(assumptions, shiftStartYear),
    ) / 100;
    // Solve the stochastic closed-loop policy — the #98 table each MC path looks up.
    const stochasticPlan = planConversionsViaDP(dpInputs, {
        ...effectiveDpObjective,
        returnDistribution: {
            stdDev: (returnStdDev * weightedStockFraction) / 100,
            meanShift: meanShiftSchedule,
            nodes,
        },
    });

    // #89 MC over-conversion cap. Derive the deterministic engine-search optimum (h*) and ride it on
    // the policy so each path caps its conversion at fill-to-(stdDed + h*) (YearSolver.planConversionDP),
    // preventing the stochastic policy from over-converting past the validated peak on low/no-SS
    // large-Traditional profiles — while leaving it untouched where the DP is already optimal
    // (real-SS → DP wins the search → no cap). Perf note: the DP candidate is the stochastic policy's
    // CENTRAL schedule, so the MC setup needs no second (deterministic) DP solve — only the
    // engine-search's forward sims. h* uses the same precise search as the deterministic default, so an
    // on-track path reduces to that default.
    const ruler = buildTradValuation(baselineTimeline, assumptions, taxState);
    const scorePlan = (plan: Map<number, number>) => {
        const tl = runSimulation(
            yearsToRun, accounts, incomes, expenses, assumptions, taxState, undefined,
            // #170: pure scoring — these timelines only feed the h*-cap derivation,
            // never a display, so skip the per-conversion-year counterfactual re-solve.
            { dpConversionPlan: plan, skipDisplayRefinement: true },
        );
        return { afterTaxNW: terminalAfterTaxNetWorth(tl, ruler), timeline: tl };
    };
    const search = searchConversionPlanByEngine(dpInputs.contexts, scorePlan, {
        baseline: {
            afterTaxNW: terminalAfterTaxNetWorth(baselineTimeline, ruler),
            timeline: baselineTimeline,
            plan: extractConversionPlan(baselineTimeline),
        },
        seedPlans: [{ label: 'legacy-dp', plan: stochasticPlan.conversionsByYear }],
        startingTradBalance: dpInputs.currentTradBalance,
        // F9: same IRMAA/ACA cliff probes as the deterministic search, so h* is derived
        // from an identically-gridded search.
        irmaaScheduleForYear: (year, fs) => getIRMAASchedule(fs, year, assumptions),
    });
    // h* = the optimum's taxable-income headroom above the standard deduction:
    //   • a fill-to-h grid point won → that headroom (cap at it);
    //   • the std-ded baseline won → 0 (tight cap — the over-conversion corner);
    //   • the DP (policy central) won → undefined ⇒ NO cap (policy already at/under the optimum,
    //     e.g. real-SS; capping would neuter the #98 bull-path adaptivity).
    //   • a SCALED seed variant won (F8, label 'legacy-dp×k') → bestHeadroom is null ⇒ undefined
    //     ⇒ no cap, matching the pre-F8 behavior on that class (the raw DP used to win there);
    //     a DP-shaped winner has no h to cap against.
    //   • a TAIL-TRIMMED composite won (#165) → classify by its ANCHOR's family (the search
    //     reports it via trimAnchorLabel/-Headroom): a trim keeps the anchor's plan through
    //     the cutover and only shrinks the tail, so the anchor's scalar cap is still the
    //     right (slightly conservative) per-path ceiling — a trim of a grid winner keeps the
    //     cap at h (the #89 over-conversion corner stays protected), a trim of the DP seed
    //     keeps no cap.
    const isTrim = search.diagnostics.trimAnchorLabel !== undefined;
    const capLabel = isTrim ? search.diagnostics.trimAnchorLabel : search.diagnostics.bestLabel;
    const capH = isTrim ? search.diagnostics.trimAnchorHeadroom : search.diagnostics.bestHeadroom;
    const capHeadroom: number | undefined =
        capLabel === 'legacy-dp' ? undefined
            : capLabel === 'std-ded-baseline' ? 0
                : (capH ?? undefined);
    if (stochasticPlan.policy) stochasticPlan.policy.capHeadroom = capHeadroom;
    return stochasticPlan;
};

// ---------------------------------------------------------------------------
// #158 — per-order artifact memo cache for the joint conversion/order search.
//
// Every debounced input edit re-runs `runSimulationWithOptimization`, and each
// candidate withdrawal order pays a std-ded baseline sim + DP-context build
// (+ the single F5a DP solve under the user's order). Those artifacts are pure
// functions of (the inputs, the order), so we memoize them across calls: an
// edit that leaves an order's inputs unchanged (e.g. only the user's stored
// withdrawal order was reordered — the tax-aware candidate orders' inputs are
// untouched) reuses that order's artifacts instead of recomputing.
//
// WHAT THE KEY COVERS (be honest): the key serializes every argument the run
// reads — yearsToRun, the model instances' own enumerable props (JSON.stringify
// of the class instances; Dates → ISO strings), assumptions (minus
// withdrawalStrategy, which is keyed separately per order), taxState,
// yearlyReturns, the EOY contribution/debt/mortgage records, dpObjective — plus
// the wall-clock YEAR (runSimulation's `new Date().getFullYear()` start-year
// anchor) and the reference date's YEAR+MONTH (`remainingFraction` reads only
// the month). NOT covered: the day of month (the engine never reads it), and
// any hypothetical module-global state a model method might read (none known).
// Over-keying only costs a spurious miss; the serialization above is exhaustive
// over the inputs, so a hit is guaranteed to describe an identical computation.
//
// HOME + EVICTION: module state — thread-local, so the worker (jointSearch.
// worker.ts) and the main thread (sync fallback, WithdrawalTab what-ifs) each
// hold their own instance. LRU with max 8 entries (~2 recent input states × 3
// candidate orders + slack); the runner keeps the worker alive across requests
// so its cache survives between recalcs, but a superseded (terminated) worker
// loses it — the next run simply recomputes.
//
// MUTATION SAFETY: callers mutate year 0 of returned timelines (logs.push +
// field stamps in runSimulationWithOptimization), so entries store — and every
// hit returns — a timeline whose year-0 row is a fresh shallow copy with its
// own `logs` array. Years 1+ are shared; the only post-run write to them is
// the dpTrace stamp, which is deterministic-identical on a key hit (same
// inputs ⇒ same plan ⇒ same trace), hence idempotent.
// ---------------------------------------------------------------------------
interface JointSearchArtifactsEntry {
    /** std-ded-only baseline timeline under this (inputs, order); year-0-protected. */
    baselineTimeline: SimulationYear[];
    dpInputs?: DPInputs;
    effectiveDpObjective?: DPObjectiveOptions;
    /**
     * Only set when THIS order's DP was actually solved (the user's order under
     * F5a). Candidate orders seeded via `reuseDpPlan` do NOT store the seed here:
     * it belongs to the user-order key, and caching it under the candidate's key
     * would let a later run where THIS order is the user's order skip a solve it
     * is supposed to perform.
     */
    dpPlan?: DPPlan;
}
const jointSearchArtifactCache = new Map<string, JointSearchArtifactsEntry>();
const JOINT_SEARCH_ARTIFACT_CACHE_MAX = 8;
// Raw NUL as key separator: JSON.stringify escapes control characters inside
// its output, so the separator can never collide with serialized content.
const JOINT_KEY_SEP = '\u0000';

/** Test hook (also handy at a REPL): drop all memoized joint-search artifacts. */
export function clearJointSearchArtifactCache(): void {
    jointSearchArtifactCache.clear();
}

function jointCacheGet(key: string): JointSearchArtifactsEntry | undefined {
    const entry = jointSearchArtifactCache.get(key);
    if (entry) {
        // LRU touch: re-insert so iteration order tracks recency.
        jointSearchArtifactCache.delete(key);
        jointSearchArtifactCache.set(key, entry);
    }
    return entry;
}

function jointCachePut(key: string, entry: JointSearchArtifactsEntry): void {
    jointSearchArtifactCache.delete(key);
    jointSearchArtifactCache.set(key, entry);
    while (jointSearchArtifactCache.size > JOINT_SEARCH_ARTIFACT_CACHE_MAX) {
        const oldest = jointSearchArtifactCache.keys().next().value as string;
        jointSearchArtifactCache.delete(oldest);
    }
}

/** Shallow-copy year 0 (with its own logs array) so post-run year-0 mutations
 *  never contaminate a cached timeline or a previously returned one. */
function withFreshYearZero(timeline: SimulationYear[]): SimulationYear[] {
    if (timeline.length === 0) return timeline;
    return [{ ...timeline[0], logs: [...timeline[0].logs] }, ...timeline.slice(1)];
}

/** Serialize the order-independent inputs once per run (see cache doc above). */
function buildJointSearchInputsKey(
    yearsToRun: number,
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    yearlyReturns: number[] | undefined,
    referenceDate: Date | undefined,
    eoyContributionAdditions: Record<string, number> | undefined,
    eoyDebtReductions: Record<string, number> | undefined,
    eoyMortgageReductions: Record<string, number> | undefined,
    dpObjective: DPObjectiveOptions | undefined,
): string {
    const { withdrawalStrategy: _perOrder, ...assumptionsSansOrder } = assumptions;
    void _perOrder;
    const refDate = referenceDate ?? new Date();
    return JSON.stringify({
        yearsToRun,
        accounts,
        incomes,
        expenses,
        assumptions: assumptionsSansOrder,
        taxState,
        yearlyReturns: yearlyReturns ?? null,
        wallYear: new Date().getFullYear(),
        refYear: refDate.getFullYear(),
        refMonth: refDate.getMonth(),
        eoyContributionAdditions: eoyContributionAdditions ?? null,
        eoyDebtReductions: eoyDebtReductions ?? null,
        eoyMortgageReductions: eoyMortgageReductions ?? null,
        dpObjective: dpObjective ?? null,
    });
}

/**
 * Run simulation with rolling per-year baseline sub-simulations for accurate
 * Roth conversion decisions.
 *
 * For each year of the main run, before deciding the conversion ceiling, a
 * forward sub-simulation projects from the in-flight state to RMD year doing
 * only standard-deduction-headroom (0% bracket) conversions. The resulting
 * `traditionalBalanceAtRMD` (and SS/pension/passive at RMD) feed into the
 * rate-match algorithm, decoupling "future marginal rate at RMD" from the
 * live, depleting Trad balance. This replaces the older two-pass approach
 * that used a single zero-conversion baseline for the entire run.
 *
 * When tax optimization is disabled, this falls through to a plain
 * single-pass `runSimulation` with no baselines and no conversions.
 */
export const runSimulationWithOptimization = (
    yearsToRun: number = 30,
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    yearlyReturns?: number[],
    referenceDate?: Date,
    eoyContributionAdditions?: Record<string, number>,
    eoyDebtReductions?: Record<string, number>,
    eoyMortgageReductions?: Record<string, number>,
    /**
     * DP objective override (#89). When OMITTED (the production/app call site), production
     * DERIVES the live default below (`effectiveDpObjective`): max-wealth + bracket-aware
     * terminal, parameterized by the user's self-liquidate-vs-bequeath choice. A caller may
     * pass this to A/B the legacy objectives (min-tax / flat-τ) through the executed sim —
     * those are retained for regression tests only, no production caller selects them.
     * See RothConversionDP.planConversionsViaDP.
     */
    dpObjective?: DPObjectiveOptions,
    /**
     * Optional coarse progress reporting (#158). Invoked with a short human-
     * readable stage message before each expensive milestone (baseline sim, DP
     * solve, each candidate order's engine search) so the worker path can keep
     * the UI spinner honest. Purely observational — never affects the result;
     * the sync/test call sites simply omit it.
     */
    onProgress?: (message: string) => void,
): SimulationYear[] => {
    // DEFAULT is bracket-aware DP (#89); rate-match is the non-default fallback. The default
    // is resolved through the shared helper (single source of truth in AssumptionsContext).
    const strategy = resolveRothConversionStrategy(assumptions.investments.rothConversionStrategy);
    const taxOptOn = assumptions.investments.taxOptimizationEnabled;

    // #158: order-independent half of the artifact cache key, built once per run.
    const inputsKey = buildJointSearchInputsKey(
        yearsToRun, accounts, incomes, expenses, assumptions, taxState, yearlyReturns,
        referenceDate, eoyContributionAdditions, eoyDebtReductions, eoyMortgageReductions,
        dpObjective,
    );
    const orderCacheKeyFor = (order: AssumptionsState['withdrawalStrategy']): string =>
        inputsKey + JOINT_KEY_SEP + JSON.stringify(order);

    // Always run a full-horizon std-ded-only baseline up front. Used for:
    //   1. Live "your strategy vs free-conversions only" comparison in
    //      WithdrawalTab — no extra sim needed at comparison time.
    //   2. Context-building input for the DP solver (DP path only).
    // Override strategy to rate-match so std-ded conversions actually fire —
    // otherwise selectConversionStrategy dispatches to planConversionDP,
    // which sees no dpConversionPlan and skips conversion entirely. We want
    // std-ded-only conversions (what conversionMode='std-ded-only' inside
    // the rate-match path produces), not zero conversions.
    const baselineAssumptions: AssumptionsState = {
        ...assumptions,
        investments: { ...assumptions.investments, rothConversionStrategy: 'rate-match' },
    };
    // #158: the user's stored order runs this baseline — memoize it under that order's key.
    const storedOrderCacheKey = orderCacheKeyFor(assumptions.withdrawalStrategy);
    const cachedStoredOrderEntry = jointCacheGet(storedOrderCacheKey);
    let stdDedBaselineTimeline: SimulationYear[];
    if (cachedStoredOrderEntry) {
        stdDedBaselineTimeline = withFreshYearZero(cachedStoredOrderEntry.baselineTimeline);
    } else {
        onProgress?.('Projecting baseline (standard-deduction-only)…');
        stdDedBaselineTimeline = runSimulation(
            yearsToRun, accounts, incomes, expenses, baselineAssumptions, taxState,
            yearlyReturns,
            {
                referenceDate,
                conversionMode: 'std-ded-only',
                eoyContributionAdditions,
                eoyDebtReductions,
                eoyMortgageReductions,
            },
        );
        jointCachePut(storedOrderCacheKey, { baselineTimeline: withFreshYearZero(stdDedBaselineTimeline) });
    }
    // After-tax terminal net worth of the std-ded baseline, for the Withdrawal-tab
    // "After-Tax Wealth Gained" comparison (#94). Build ONE situation-based discount ruler
    // from the strategy-INDEPENDENT baseline timeline and reuse it for both the baseline and
    // the selected strategy's terminal balances (below), so the comparison is apples-to-apples
    // and the baseline figure is invariant to the selected strategy — only the self-liquidate
    // ↔ bequeath toggle moves it.
    const tradValuationRuler = buildTradValuation(stdDedBaselineTimeline, assumptions, taxState);
    const stdDedBaselineTerminalAfterTaxNW = terminalAfterTaxNetWorth(stdDedBaselineTimeline, tradValuationRuler);

    if (strategy === 'std-ded-only' && taxOptOn) {
        // 'std-ded-only' strategy: the executed plan IS the std-ded baseline we just ran
        // (convert only the free standard-deduction headroom each year). Reuse it directly
        // rather than re-running — the selected strategy and the comparison baseline are the
        // same sim, so "After-Tax Wealth Gained" is $0 by construction.
        if (stdDedBaselineTimeline.length > 0) {
            stdDedBaselineTimeline[0].stdDedBaselineTerminalAfterTaxNW = stdDedBaselineTerminalAfterTaxNW;
            stdDedBaselineTimeline[0].strategyTerminalAfterTaxNW = stdDedBaselineTerminalAfterTaxNW;
        }
        return stdDedBaselineTimeline;
    }

    if (strategy === 'dp-precomputed' && taxOptOn) {
        // Conversion plan for the dp-precomputed strategy. Two paths:
        //   • DEFAULT (no explicit dpObjective): the #89 ROOT FIX — an engine-direct
        //     search that picks conversions by scoring candidate plans on the REAL
        //     engine (after-tax terminal NW), rather than the DP's internal terminal
        //     valuation (which over-converts on low/no-SS, large-Traditional profiles —
        //     see docs/roth-review/00-cookbook-review-synthesis.md §5). The std-ded
        //     baseline plan is one of the candidates, so the result is ≥ the baseline
        //     BY CONSTRUCTION → the feasibility floor below never fires for this path.
        //   • LEGACY DP (explicit dpObjective): retained for regression tests that A/B
        //     the min-tax / flat-τ / bracket-aware objectives, and for comparison.
        let finalTimeline: SimulationYear[];
        // In the DEFAULT branch the winning timeline is already scored on the ruler (best.nw), so we
        // carry that value out to avoid recomputing terminalAfterTaxNetWorth below. Stays undefined on
        // the legacy branch, which has no pre-scored result and computes the terminal NW standalone.
        let defaultBranchTerminalAfterTaxNW: number | undefined;

        if (dpObjective === undefined) {
            // JOINT CONVERSION + DRAWDOWN-ORDER OPTIMIZER. Tax Optimization's UI promises it picks the
            // best withdrawal order, but the engine used to always run the user's stored order — wasting,
            // on some profiles, the cheap post-SS standard-deduction conversion band (a large Traditional
            // spent for living before it can be converted at 0%). Now we ALSO optimize the order. The
            // optimal order is scenario-specific (Roth-before-Traditional wins for high-SS / large-Traditional
            // / long-horizon profiles, the conventional order for others), so it's PICKED, not hardcoded.
            // Every candidate is scored with the SAME ruler (tradValuationRuler, built once above from the
            // strategy-independent baseline) — the load-bearing requirement for a valid cross-order comparison.
            //
            // generateCandidateWithdrawalOrders returns at most 3 orders (the user's + 2 tax-aware
            // sequences), so we simply FULL-SEARCH EVERY candidate on the real engine and keep the one
            // with the highest after-tax terminal net worth. No biased probe-and-rank: a probe by a
            // single aggressive legacy-DP plan over-rates an order in a no-SS regime and a std-ded proxy
            // under-rates a Traditional-preserving order in a high-SS regime, so the only sound tiebreak
            // is the full de-converted search itself. The user's order is always in the candidate set, so
            // the result can never regress below the manual order; when it wins, the result matches the
            // single-order engine.
            // Under Tax Optimization the algorithm OWNS the withdrawal order, so the user's manual order
            // and any account EXCLUSIONS do not bind: an account the user left OUT of the order must still
            // be a first-class participant the optimizer can place and score. Augment the user's order with
            // synthesized entries for every sellable account it omits BEFORE generating candidates, so each
            // candidate (the user-derived order #0 and the two tax-aware sequences) covers all sellable
            // accounts. withAllSellableAccounts returns the SAME reference when nothing is omitted (the common
            // case), so this is byte-for-byte unchanged whenever the order already lists every account — and
            // `fullStrategy` then serves as the user-derived anchor for the no-regression guarantee below.
            const fullStrategy = withAllSellableAccounts(
                accounts, assumptions.withdrawalStrategy,
                (a) => ({ id: `synth-${a.id}`, name: a.name, accountId: a.id }),
            );
            const candidateOrders = generateCandidateWithdrawalOrders(accounts, fullStrategy);
            // We can reuse the already-computed std-ded baseline (and `assumptions` verbatim) for the
            // user-derived anchor ONLY when augmenting added nothing — otherwise the anchor drains under
            // `fullStrategy`, a different order, and must run its own baseline. In the common (nothing-omitted)
            // case this is true and the path is byte-for-byte identical to before.
            const canReuseUserBaseline = fullStrategy === assumptions.withdrawalStrategy;
            const buildArtifacts = (order: typeof assumptions.withdrawalStrategy, reuseDpPlan?: DPPlan) => {
                const isUser = order === fullStrategy;
                const aOrder: AssumptionsState = (isUser && canReuseUserBaseline)
                    ? assumptions : { ...assumptions, withdrawalStrategy: order };
                // #158: per-order artifact memoization. On a key hit (identical inputs + identical
                // order) the baseline sim, the DP-context build, and — for the order that solved it —
                // the DP solve are all skipped; cached values are exactly what a fresh compute would
                // produce (the key serializes every input), so warm results are byte-equal to cold.
                const orderCacheKey = orderCacheKeyFor(aOrder.withdrawalStrategy);
                const cached = jointCacheGet(orderCacheKey);
                let baselineO: SimulationYear[];
                if (isUser && canReuseUserBaseline) {
                    // Same key as the outer std-ded baseline — reuse the run (or its cache hit) directly.
                    baselineO = stdDedBaselineTimeline;
                } else if (cached) {
                    baselineO = withFreshYearZero(cached.baselineTimeline);
                } else {
                    onProgress?.(`Projecting baseline for order ${order.map(w => w.name).join(' → ')}…`);
                    baselineO = runSimulation(
                        yearsToRun, accounts, incomes, expenses,
                        { ...aOrder, investments: { ...aOrder.investments, rothConversionStrategy: 'rate-match' } },
                        taxState, yearlyReturns,
                        { referenceDate, conversionMode: 'std-ded-only', eoyContributionAdditions, eoyDebtReductions, eoyMortgageReductions },
                    );
                }
                const { dpInputs, effectiveDpObjective } = (cached?.dpInputs && cached.effectiveDpObjective)
                    ? { dpInputs: cached.dpInputs, effectiveDpObjective: cached.effectiveDpObjective }
                    : buildDpSolveInputs(accounts, incomes, expenses, aOrder, taxState, baselineO);
                // F5a (fp-review 2026-07-02): the synchronous DP solve is the dominant cost of the joint
                // search (~3–5s per order vs a fraction of that for all of an order's engine replays),
                // and its plan is only a SEED — the engine-direct search scores it on the real engine
                // like every other candidate. So the DP is solved ONCE, under the user's order, and
                // REUSED as the seed for every candidate order (≈ halves interactive latency with 2
                // orders, ~2/3 with 3). The dominance guarantees survive: the user-order search still
                // contains its own true DP seed, and a candidate order only replaces the incumbent on a
                // strictly HIGHER engine score. What a candidate order gives up is its own DP shape as a
                // seed; the fill-to-h family + the F8 scaled-seed sweep cover magnitude, and the engine
                // score decides. (The per-order dpInputs/contexts are still built from that order's own
                // baseline — only the expensive solve is shared.)
                //
                // #158 precedence: an explicit reuseDpPlan ALWAYS wins (that's the F5a semantics — the
                // candidate order must seed from the user-order plan, even if a solved plan for this
                // order happens to sit in the cache from a run where it WAS the user's order); only a
                // would-have-solved call (reuseDpPlan undefined) may take the cached solve.
                if (reuseDpPlan === undefined && cached?.dpPlan === undefined) {
                    onProgress?.('Solving the Roth-conversion plan (DP)…');
                }
                const dpPlan = reuseDpPlan ?? cached?.dpPlan ?? planConversionsViaDP(dpInputs, effectiveDpObjective);
                jointCachePut(orderCacheKey, {
                    baselineTimeline: cached?.baselineTimeline ?? withFreshYearZero(baselineO),
                    dpInputs,
                    effectiveDpObjective,
                    // Cache the plan only when this call would have solved it (see interface doc).
                    dpPlan: reuseDpPlan === undefined ? dpPlan : cached?.dpPlan,
                });
                return { order, aOrder, baselineO, dpInputs, dpPlan };
            };
            // #170: candidate SCORING runs pass skipDisplayRefinement — their timelines
            // never reach the UI, so they skip the #164 per-conversion-year counterfactual
            // re-solve (and the #159 working-year decomposition). The final user-facing
            // projection re-runs the winner below with the refinement ON.
            const runUnderOrder = (aOrder: AssumptionsState, plan: Map<number, number>, skipDisplayRefinement: boolean) => runSimulation(
                yearsToRun, accounts, incomes, expenses, aOrder, taxState, yearlyReturns,
                { referenceDate, dpConversionPlan: plan, skipDisplayRefinement, eoyContributionAdditions, eoyDebtReductions, eoyMortgageReductions },
            );
            // A full conversion engine-search under one order's artifacts → {order, aOrder, plan, timeline, nw, label, sims, dpPlan}.
            const fullSearch = (art: ReturnType<typeof buildArtifacts>) => {
                const scorePlan = (plan: Map<number, number>) => {
                    const tl = runUnderOrder(art.aOrder, plan, true);
                    return { afterTaxNW: terminalAfterTaxNetWorth(tl, tradValuationRuler), timeline: tl };
                };
                const s = searchConversionPlanByEngine(art.dpInputs.contexts, scorePlan, {
                    baseline: { afterTaxNW: terminalAfterTaxNetWorth(art.baselineO, tradValuationRuler), timeline: art.baselineO, plan: extractConversionPlan(art.baselineO) },
                    seedPlans: [{ label: 'legacy-dp', plan: art.dpPlan.conversionsByYear }],
                    startingTradBalance: art.dpInputs.currentTradBalance,
                    // F9: lets the search append IRMAA-tier (and ACA-cliff) h-grid probes.
                    irmaaScheduleForYear: (year, fs) => getIRMAASchedule(fs, year, assumptions),
                });
                return {
                    order: art.order, aOrder: art.aOrder, plan: s.conversionsByYear,
                    timeline: s.winningTimeline,
                    nw: terminalAfterTaxNetWorth(s.winningTimeline, tradValuationRuler),
                    label: s.diagnostics.bestLabel, sims: s.diagnostics.sims + 1,
                    dpPlan: art.dpPlan, // the DP seed this order searched with (since F5a: always the user-order solve) — its traces feed the debug screen
                };
            };
            // Full-search EVERY candidate order and keep the highest after-tax NW. The user's order is
            // first in the candidate set, so the result can never regress below the manual order.
            // The user-order artifacts run FIRST and own the single DP solve (F5a); every other
            // candidate order reuses that plan as its seed.
            const userArtifacts = buildArtifacts(fullStrategy);
            onProgress?.(`Searching conversions — order 1 of ${candidateOrders.length}…`);
            const userResult = fullSearch(userArtifacts);
            let best = userResult;
            let totalSims = userResult.sims;
            let orderIndex = 1;
            for (const order of candidateOrders) {
                if (order === fullStrategy) continue;
                orderIndex += 1;
                const artifacts = buildArtifacts(order, userArtifacts.dpPlan);
                onProgress?.(`Searching conversions — order ${orderIndex} of ${candidateOrders.length}…`);
                const result = fullSearch(artifacts);
                totalSims += result.sims;
                if (result.nw > best.nw + 1) best = result; // the de-converted truth decides; ties keep the incumbent
            }
            // #170: scoring ran unrefined, but the displayed conversion taxAmount must stay
            // finite-difference-exact (#164) — re-run the winning (order, plan) ONCE with the
            // refinement on. One extra full sim replaces one counterfactual year-solve per
            // conversion year per scored candidate. Skipped when the std-ded baseline won
            // (its timeline came from the conversionMode:'std-ded-only' run, which never had
            // the refinement — pre-existing display contract for that path — and replaying
            // its extracted plan via dpConversionPlan would execute through a different code
            // path) and when the winner executed no conversions (the refinement is a no-op).
            const winnerHasConversions = best.timeline.some(
                y => !y.isEndOfYearProjection && (y.rothConversion?.amount ?? 0) > 0);
            if (best.label !== 'std-ded-baseline' && winnerHasConversions) {
                onProgress?.('Refining the chosen projection…');
                finalTimeline = runUnderOrder(best.aOrder, best.plan, false);
            } else {
                finalTimeline = best.timeline;
            }
            defaultBranchTerminalAfterTaxNW = best.nw; // already scored on the ruler (the #170 refined re-run only changes reported tax costs, never balances)
            if (finalTimeline.length > 0) {
                const orderChanged = best.order !== fullStrategy;
                const orderGain = best.nw - userResult.nw; // full-search value of the chosen order alone
                // Report EXECUTED conversions (what the engine actually moved), not the plan's intended
                // fill — a "fill to headroom" plan can request far more than the Traditional can supply.
                const executedTotal = finalTimeline.reduce((s, y) => s + (y.isEndOfYearProjection ? 0 : (y.rothConversion?.amount ?? 0)), 0);
                finalTimeline[0].chosenWithdrawalOrder = best.order.map(w => ({ accountId: w.accountId, name: w.name }));
                finalTimeline[0].orderOptimizationGain = orderGain; // economic payoff of the order choice (best vs user order, co-optimized)
                finalTimeline[0].logs.push(
                    `[joint optimizer] full-searched ${candidateOrders.length} candidate order(s) ` +
                    `(${totalSims} engine sims); chose order ` +
                    `${best.order.map(w => w.name).join(' → ')}${orderChanged ? '' : ' (user order)'}; ` +
                    `order-optimization gain $${Math.round(orderGain).toLocaleString()}; ` +
                    `conversions: ${best.label} (total converted $${Math.round(executedTotal).toLocaleString()}).`,
                );
                // Restore the Roth-conversion debug screen (RothConversionDebug reads selectedYear.dpTrace).
                // Since F5a the DP is solved ONCE under the USER's order and reused as every candidate
                // order's seed, so best.dpPlan — whichever order wins — always carries the USER-ORDER DP
                // analysis. That's the explicit fallback for a winning non-user order (its own DP was never
                // solved): the trace shown is exactly the seed that order's search actually scored, just
                // solved against the user-order baseline. NOTE (pre-existing) the executed plan is the
                // engine-direct search result, which may differ from the DP plan — dpTrace explains the
                // seed, not the executed conversions. (We don't re-sim just to populate dpDebugByYear;
                // trace + summary is enough.)
                for (const year of finalTimeline) {
                    const trace = best.dpPlan.diagnostics.perYearTraces.get(year.year);
                    if (trace) year.dpTrace = trace;
                }
                finalTimeline[0].logs.push(...best.dpPlan.diagnostics.summaryLogs);
            }
        } else {
            // LEGACY DP path — reached only with an explicit dpObjective (regression tests).
            const { dpInputs, effectiveDpObjective } = buildDpSolveInputs(
                accounts, incomes, expenses, assumptions, taxState, stdDedBaselineTimeline, dpObjective,
            );
            const dpPlan: DPPlan = planConversionsViaDP(dpInputs, effectiveDpObjective);
            finalTimeline = runSimulation(
                yearsToRun, accounts, incomes, expenses, assumptions, taxState,
                yearlyReturns,
                {
                    referenceDate,
                    dpConversionPlan: dpPlan.conversionsByYear,
                    dpDebugByYear: dpPlan.diagnostics.perYearDebug,
                    eoyContributionAdditions,
                    eoyDebtReductions,
                    eoyMortgageReductions,
                },
            );
            if (finalTimeline.length > 0) finalTimeline[0].logs.push(...dpPlan.diagnostics.summaryLogs);
            for (const year of finalTimeline) {
                const trace = dpPlan.diagnostics.perYearTraces.get(year.year);
                if (trace) year.dpTrace = trace;
            }
        }

        // Stash both after-tax terminal net worths on year 0 for the live Withdrawal-tab
        // comparison panel (#94). Same ruler as the baseline above, applied to this
        // strategy's terminal balances. The default branch already scored its winning timeline on
        // the ruler (best.nw), so reuse it; only the legacy branch computes it standalone here.
        const strategyTerminalAfterTaxNW = finalTimeline.length === 0
            ? 0
            : (defaultBranchTerminalAfterTaxNW ?? terminalAfterTaxNetWorth(finalTimeline, tradValuationRuler));
        if (finalTimeline.length > 0) {
            finalTimeline[0].stdDedBaselineTerminalAfterTaxNW = stdDedBaselineTerminalAfterTaxNW;
            finalTimeline[0].strategyTerminalAfterTaxNW = strategyTerminalAfterTaxNW;
        }

        // FEASIBILITY FLOOR (#89) — now a BACKSTOP. The DEFAULT engine-direct search includes the
        // std-ded plan in its candidate set, so its result is ≥ the baseline by construction and this
        // never fires for it; the floor still guards the LEGACY DP path (explicit dpObjective). The
        // optimizer must never leave the household worse off (on after-tax terminal net worth) than
        // the trivial, always-feasible std-ded-only baseline. The legacy DP's terminal valuation can,
        // on large Traditional + low/no Social Security profiles drawn down trad-first, over-value
        // draining the residual and convert PAST the wealth peak (draining Traditional toward $0),
        // ending BELOW the baseline; when it does, fall back to the std-ded-only plan, which is
        // strictly better here. This is the cookbook's "feasibility-floor property".
        //
        // SOLVENCY-GATED: only engage when the std-ded baseline is itself solvent (its final year
        // carries no deficit-debt). On a household that depletes even under the minimal baseline,
        // the after-tax-NW comparison is dominated by deficit-debt noise and there is no better
        // feasible plan to fall back to, so the DP plan is returned untouched.
        //
        // This caps the downside at the (conservative) std-ded baseline; it does NOT move the plan
        // to the true wealth peak — the baseline mildly under-converts vs the peak. The root fix is
        // to size conversions by a direct engine search rather than the DP's internal terminal
        // valuation (docs/roth-review/00-cookbook-review-synthesis.md §5). Deterministic projection
        // only; the Monte-Carlo closed-loop policy is unaffected.
        const baselineSolvent = stdDedBaselineTimeline.length > 0
            && !stdDedBaselineTimeline[stdDedBaselineTimeline.length - 1].accounts.some(
                a => a instanceof DeficitDebtAccount && a.amount > 0);
        const floorEps = Math.max(1, Math.abs(stdDedBaselineTerminalAfterTaxNW) * 1e-6);
        if (finalTimeline.length > 0
            && baselineSolvent
            && strategyTerminalAfterTaxNW < stdDedBaselineTerminalAfterTaxNW - floorEps) {
            const shortfall = stdDedBaselineTerminalAfterTaxNW - strategyTerminalAfterTaxNW;
            stdDedBaselineTimeline[0].stdDedBaselineTerminalAfterTaxNW = stdDedBaselineTerminalAfterTaxNW;
            stdDedBaselineTimeline[0].strategyTerminalAfterTaxNW = stdDedBaselineTerminalAfterTaxNW;
            stdDedBaselineTimeline[0].feasibilityFloorApplied = true;
            stdDedBaselineTimeline[0].logs.push(
                `[feasibility floor] DP plan's after-tax terminal net worth was $${Math.round(shortfall).toLocaleString()} below the standard-deduction-only baseline (the DP over-converted on this profile); fell back to std-ded-only conversions.`,
            );
            return stdDedBaselineTimeline;
        }

        return finalTimeline;
    }

    // Default: rate-match with rolling per-year sub-sim baselines.
    const finalTimeline = runSimulation(
        yearsToRun, accounts, incomes, expenses, assumptions, taxState,
        yearlyReturns,
        {
            referenceDate,
            useRollingBaseline: true,
            eoyContributionAdditions,
            eoyDebtReductions,
            eoyMortgageReductions,
        },
    );
    if (finalTimeline.length > 0) {
        finalTimeline[0].stdDedBaselineTerminalAfterTaxNW = stdDedBaselineTerminalAfterTaxNW;
        finalTimeline[0].strategyTerminalAfterTaxNW = terminalAfterTaxNetWorth(finalTimeline, tradValuationRuler);
    }
    return finalTimeline;
};