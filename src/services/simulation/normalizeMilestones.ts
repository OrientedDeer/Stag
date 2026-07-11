import { type CustomMilestone } from "./types";

/**
 * Normalize a raw milestone array loaded from persisted/imported data so every
 * milestone is guaranteed to carry a `conditions` ARRAY.
 *
 * `CustomMilestone.conditions` is a REQUIRED `MilestoneCondition[]` in the type, but
 * milestones are restored from localStorage / file imports / QR backups via an
 * UNCHECKED cast (`data.milestones as CustomMilestone[]`). A malformed or older backup
 * whose milestone object lacks `conditions` violates the type, and every downstream
 * dereference (`milestone.conditions.every(...)`, `.find(...)`, `.some(...)`) then throws
 * `TypeError: ...reading 'every'` — white-screening the Priority/Income/Withdrawal tabs on
 * the very first render.
 *
 * Normalizing ONCE at the load boundary fixes all those call sites structurally: each
 * milestone is mapped to a copy whose `conditions` is the original array when it is one,
 * and `[]` otherwise. Valid milestones pass through with the SAME reference (no needless
 * copy). Use this at every milestone-load boundary (see migrateAssumptions).
 *
 * Lives in its own leaf module (not MilestoneEvaluator) because AssumptionsContext
 * calls it at the load boundary: importing it from MilestoneEvaluator gave the
 * Context module a value edge into the simulation/tax graph, closing a genuine
 * runtime import cycle (AssumptionsContext → MilestoneEvaluator → TaxService →
 * federalTax → getBirthYear → AssumptionsContext).
 */
export function normalizeMilestones(raw: CustomMilestone[]): CustomMilestone[] {
    return raw.map(m => (
        Array.isArray(m.conditions) ? m : { ...m, conditions: [] }
    ));
}
