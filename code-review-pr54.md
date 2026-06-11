# PR #54 review — outstanding tasks

13 of the 15 review findings are fixed and committed to `main`
(commits `55e4ab5`, `2aaa8bf`, `0f843fb`, `69fc644`, `c6ed1fa`). The two below
were **not** shipped — each is a deliberate design/policy decision rather than a
defect, so they need a product call before changing.

---

## #6 — State Social-Security treatment is hardcoded exempt in the solver/planner
- **Where:** `src/services/simulation/YearSolver.ts` (authoritative state tax, ~1567/1601) and `src/services/simulation/WithdrawalPlanner.ts` (~824)
- **What:** State tax is computed via the low-level bracket function with taxable SS manually stripped (`allOrdinaryIncome - currentSSTaxable`), hardcoding "SS exempt" for every state. This bypasses the data-driven `socialSecurityTreatment` flag that `stateTax.ts` and `RothConversionDP.ts` (which checks `=== 'taxable'`) honor.
- **Status:** **Latent** — every state in `TaxData` is currently `socialSecurityTreatment: 'exempt'`, so the result is correct today. The inline SS-stripping looks like the same deliberate choice as #15.
- **Decision needed:** If a `'taxable'` state is ever added (CO/CT/MN/etc. tax SS in reality), the solver/planner would silently undercharge state tax. Worth routing state tax through the SS-treatment-aware path **only if** taxable-SS states will be modeled. Otherwise leave as-is.

## #15 — ACA FPL cliff is clamped flat for years beyond the published table
- **Where:** `src/services/simulation/TaxOptimizedWithdrawal.ts` — `getAcaCliffThreshold`
- **What:** `FPL_BASE` has explicit entries only through 2026; later years reuse the most recent known value instead of growing it with inflation.
- **Status:** **Intentional design.** Implementing "grow the cliff ~3%/yr past the table" broke 3 existing tests under a describe block named *"Future Years (Uses Most Recent Known)"* — the flat-clamp is documented behavior. Reverted.
- **Decision needed:** Policy call — clamp (conservative, current behavior) vs. project FPL forward by inflation (more realistic for long projections, but speculative). If you want it projected, the existing "Future Years" tests must be updated to expect the grown values.
