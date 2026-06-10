#!/usr/bin/env bash
# Scope 4/5: domain models + engine orchestration (~5.6k lines, 9 files).
cd "$(git rev-parse --show-toplevel)"
source scripts/review/_lib.sh

TITLE="Scope: domain models + simulation orchestration (source)"

BODY=$(cat <<'EOF'
Scoped review of the domain model classes (Accounts/Expense/Income), the
simulation engine orchestration (SimulationEngine + useSimulation), and the
assumptions/simulation contexts. ONLY the source files added in the diff are
under review. The test files in this branch are a behavioral reference ONLY
(not in the diff) and may be wrong or timezone-dependent: if source and a test
disagree, flag it as a question, do not assume the test.

ADJUDICATIONS: code-review-pr-50.md … code-review-pr-53.md (in this tree, base
commit) record findings already fixed or ruled by-design — do not resurface
wont-fixes.

ARCHITECTURE NOTES (recent, intentional — flag violations, not the design):
  - Goal funding is COMMITTED and DERIVED (2026-06): `endDate` IS a
    targetDate goal's target (no separate goalTargetDate field — reconstitute
    migrates legacy data); the set-aside is derived live
    (getGoalMonthlySetAside / getGoalFundAnnualSetAside, months-prorated) and
    counted with living expenses while the engine credits the fund directly.
    There is NO goal priority bucket and NO stored set-aside. Anything
    reintroducing stored copies, or reading a stored capValue for a goal
    fund, is a bug.
  - Goal `amount` is the TOTAL cost with frequency 'Monthly';
    getAnnualAmount/getMonthlyAmount return 0 for goals by design. Display
    sites must use the set-aside helpers.

Recurring problem areas that have actually bitten us here — extra scrutiny:

  1. Date-only / timezone handling (UNRESOLVED convention — the single
     highest-yield area). Creation is split between local midnight
     (parseDate/modelUtils, `new Date(y, m-1, d)`) and UTC midnight
     (Date.UTC in form defaults and model methods); readers split between
     getUTC* and local accessors. The unit suite runs in UTC and structurally
     cannot catch mismatches. Map creation sites to reader sites and flag
     every mismatched pair; if you can, propose the single convention.
  2. Reconstitution / persistence. `reconstitute*()` must round-trip every
     field the classes carry — a field added to a class but not to its
     reconstitute (or copyMetaTo/clone) silently vanishes on reload or on
     year-increment. Diff the class fields against both paths field by field.
  3. increment()/clone drift. Year-over-year increment methods rebuild
     objects through constructors; constructor-parameter drift (added params,
     reordered args) corrupts cloned state quietly.
  4. Engine totals. totalLivingExpenses composition (amortized mortgage/loan
     payments + getAnnualAmount + committed goal set-asides) flows into the
     solver, GK trims, and the Sankey — the per-category cashflowDetail must
     sum to the same number or the Sankey is unbalanced (bit us twice).
  5. Milestone resolution. Deleted-milestone fallbacks, END_OF_PLAN
     defaulting, and age-vs-date milestone math at year boundaries.
  6. Falsy-zero in model getters and context merge defaults (`||` vs `??`).

Output: ranked findings, each with a concrete failure scenario
(inputs/state -> wrong output). Findings that can't name a trigger should say
so explicitly.
EOF
)

make_scope "review/models-${CAMPAIGN}" "${TITLE}" "${BODY}" \
    src/components/Objects/Assumptions/SimulationEngine.tsx \
    src/components/Objects/Assumptions/useSimulation.tsx \
    src/components/Objects/Assumptions/AssumptionsContext.tsx \
    src/components/Objects/Assumptions/SimulationContext.tsx \
    src/components/Objects/Assumptions/MonteCarloContext.tsx \
    src/components/Objects/Accounts/models.tsx \
    src/components/Objects/Expense/models.tsx \
    src/components/Objects/Income/models.tsx \
    src/components/Objects/modelUtils.ts
