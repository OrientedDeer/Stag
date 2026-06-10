#!/usr/bin/env bash
# Scope 1/5: the year solver and cash-allocation core (~6.0k lines, 8 files).
cd "$(git rev-parse --show-toplevel)"
source scripts/review/_lib.sh

TITLE="Scope: year solver + withdrawal/allocation core (source)"

BODY=$(cat <<'EOF'
Scoped review of the year solver and cash-allocation core. ONLY the source
files added in the diff are under review. The test files in this branch are a
behavioral reference ONLY (not in the diff) and may be wrong or
timezone-dependent: if source and a test disagree, flag it as a question, do
not assume the test.

ADJUDICATIONS: code-review-pr-50.md … code-review-pr-53.md (in this tree, base
commit) record findings already fixed or ruled by-design. Do not resurface
wont-fixes; in particular, from PR #53:
  - Caps are PACING, by design: surplus exceeding every priority cap with no
    uncapped destination is intentionally NOT force-deposited (it surfaces as
    `unallocated`). Force-filling FIXED/MAX buckets broke sinking-fund
    reservations — adjudicated, do not re-flag.
  - The withdrawal planner's 0% LTCG floor rate is accepted behavior, not a
    bug (adjudicated PR #53 finding 3).

Recurring problem areas that have actually bitten us here — extra scrutiny:

  1. Gross-up sizing. Binary-search bounds; omitting a tax component (state,
     NIIT, penalty) from the iteration so the search converges on the wrong
     number; the unguarded `1/(1 - rate)` form (combined marginal >= 90% ->
     Infinity — PR #53 finding 14, still open).
  2. Withdrawal ordering vs tax characterization. Brokerage/ESPP withdrawals
     carry capital gains while pre-tax carries ordinary income; the solver's
     `cashIn` math and the planner's tax estimates must drain the same lists
     in the same order (no double-spend across the ACA look-ahead and the
     main loop).
  3. GK guardrails and deficit handling. Budget-trim paths (totalExpenses vs
     pre-trim living expenses) have caused phantom Sankey imbalances; deficit
     debt is paid before priority buckets — check both ends of that contract.
  4. Goal sinking funds are COMMITTED transfers now (new architecture,
     2026-06): the engine counts the set-aside with living expenses and
     credits the fund directly; goal-fund accounts are RESERVED
     (`reservedAccountIds`) and must never absorb general surplus, including
     via the no-priorities smart-default. Anything in this scope that lets a
     reserved account receive generic surplus is a bug.
  5. Falsy-zero. `|| default` where 0 is a valid value (returnRate=0,
     costBasis, capValue=0, deductions) should be `??`.
  6. REMAINDER bucket semantics. Anything ordered after a REMAINDER bucket can
     never receive surplus — flows that assume otherwise are bugs.

Output: ranked findings, each with a concrete failure scenario
(inputs/state -> wrong output). Findings that can't name a trigger should say
so explicitly.
EOF
)

make_scope "review/solver-${CAMPAIGN}" "${TITLE}" "${BODY}" \
    src/services/simulation/YearSolver.ts \
    src/services/simulation/WithdrawalPlanner.ts \
    src/services/simulation/TaxOptimizedWithdrawal.ts \
    src/services/simulation/SurplusAllocator.ts \
    src/services/simulation/SpendingStrategy.ts \
    src/services/simulation/WithdrawalService.ts \
    src/services/simulation/helpers.ts \
    src/services/simulation/types.ts
