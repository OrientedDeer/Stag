/**
 * Survivor-scenario composition — the non-tax half of the "first death at
 * year N" composer (fp-review F3b; the widow's penalty).
 *
 * The filing-status half lives in `resolveTaxEventsForYear` (TaxContext.tsx):
 * from `deathYear` on the household files Single through the same seam
 * scheduled tax life events use. THIS module handles the two simulation-input
 * changes that seam can't express, applied ONCE at `deathYear` to the
 * collections the simulation loop carries forward (`runSimulationLoop` in
 * useSimulation.tsx):
 *
 *   1. SS SURVIVOR RULE — the household keeps the LARGER of its Social
 *      Security benefits, not both: with 2+ SS incomes, all but the largest
 *      are dropped; with one (or none), nothing changes (the survivor keeps
 *      it). Because the loop feeds each year's mutated incomes forward,
 *      dropping once at `deathYear` removes the benefit for the rest of the
 *      horizon.
 *
 *   2. EXPENSES — every expense is scaled by `expenseFactor` via the same
 *      `adjustAmount` seam Guyton-Klinger uses. Contractual obligations
 *      (MortgageExpense / LoanExpense) return themselves unchanged from
 *      `adjustAmount` BY DESIGN — debt payments don't shrink because a spouse
 *      died — so "scale all expenses" is automatically "scale all scalable
 *      expenses".
 *
 * PENSIONS ARE DELIBERATELY NOT ADJUSTED. Survivor-benefit elections
 * (100%/50%/0% joint-and-survivor, FERS/CSRS survivor annuities, …) are
 * plan-specific; the user models them with the pension income's end date (or
 * a reduced-amount successor income). The UI copy states this.
 *
 * Because everything downstream (the DP contexts, the engine-direct search's
 * replays, the exit ruler, Monte Carlo) consumes either the loop's timeline or
 * `resolveTaxEventsForYear`, no other wiring exists — that is the point of the
 * seam.
 */
import { AnyIncome, isSocialSecurity, FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { AnyExpense } from '../../components/Objects/Expense/models';

/**
 * The persisted survivor-scenario config (stored on TaxState.survivorScenario,
 * so it rides the tax-settings persistence / QR backup like taxEvents does).
 * Default OFF. When enabled on an MFJ household, from `deathYear` on the
 * projection composes the transition out of EXISTING mechanisms:
 *   - filing status resolves to Single (resolveTaxEventsForYear);
 *   - one SS benefit + scaled expenses (applySurvivorTransition below).
 *
 * `deathYear` is the first FULL survivor year and must be a FUTURE projection
 * year (the UI clamps it — the loop-level transition fires exactly at
 * `deathYear`, so a past year never composes).
 */
export interface SurvivorScenario {
    enabled: boolean;
    /** First survivor year: files Single, one SS benefit, scaled expenses. */
    deathYear: number;
    /**
     * Multiplier on (non-contractual) expenses from `deathYear` on.
     * 1 = unchanged (default); one-person households typically run ~0.75–0.85.
     */
    expenseFactor?: number;
}

/**
 * The survivor scenario composes only while the household's CURRENT filing
 * status is MFJ — the UI offers the toggle only there, and a stale enabled
 * config must not keep silently mutating the projection after the user
 * switches filing status. Single source of the gate for BOTH composition
 * seams (filing status in resolveTaxEventsForYear, SS/expenses in
 * runSimulationLoop). Structurally typed so this module doesn't import
 * TaxState back from TaxContext.
 */
export function activeSurvivorScenario(
    taxState: { filingStatus: string; survivorScenario?: SurvivorScenario },
): SurvivorScenario | null {
    const s = taxState.survivorScenario;
    return s?.enabled && taxState.filingStatus === 'Married Filing Jointly' ? s : null;
}

/**
 * Comparable annual benefit level of an SS income, for picking the LARGEST
 * one to survive. `FutureSocialSecurityIncome` needs special handling: its
 * `amount` is `calculatedPIA × 12`, which stays 0 until the engine computes
 * the PIA at claiming age — for a benefit not yet claimed at `deathYear`,
 * compare on the planning `projectedPIA` instead so an unclaimed larger
 * benefit isn't discarded (a real survivor can still claim the deceased
 * spouse's larger benefit later).
 */
function ssBenefitLevel(inc: AnyIncome): number {
    if (inc instanceof FutureSocialSecurityIncome || inc.className === 'FutureSocialSecurityIncome') {
        const f = inc as FutureSocialSecurityIncome;
        return Math.max(f.calculatedPIA || 0, f.projectedPIA || 0) * 12;
    }
    return inc.getProratedAnnual(inc.amount);
}

export interface SurvivorTransitionResult {
    incomes: AnyIncome[];
    expenses: AnyExpense[];
}

/**
 * Apply the one-time death-year transition to the loop's carried-forward
 * collections. Fires exactly once (the caller gates on
 * `simulationYear === deathYear`); it is NOT idempotent (expense scaling
 * compounds), so it must never be applied twice to the same trajectory.
 */
export function applySurvivorTransition(
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    expenseFactor: number,
): SurvivorTransitionResult {
    // SS survivor rule: keep only the largest benefit. Ties keep the first.
    const ssIncomes = incomes.filter(inc => isSocialSecurity(inc));
    let survivorIncomes = incomes;
    if (ssIncomes.length >= 2) {
        let keep = ssIncomes[0];
        for (const inc of ssIncomes) {
            if (ssBenefitLevel(inc) > ssBenefitLevel(keep)) keep = inc;
        }
        survivorIncomes = incomes.filter(inc => !isSocialSecurity(inc) || inc === keep);
    }

    const survivorExpenses = expenseFactor === 1
        ? expenses
        : expenses.map(exp => exp.adjustAmount(expenseFactor));

    return { incomes: survivorIncomes, expenses: survivorExpenses };
}
