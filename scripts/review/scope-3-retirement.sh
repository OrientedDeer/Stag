#!/usr/bin/env bash
# Scope 3/5: retirement flows — Roth conversions, RMDs, income projection,
# account growth, and their data tables (~3.9k lines, 11 files).
cd "$(git rev-parse --show-toplevel)"
source scripts/review/_lib.sh

TITLE="Scope: Roth/RMD/income-projection/account-growth services (source)"

BODY=$(cat <<'EOF'
Scoped review of the retirement-flow services: Roth conversion planning, RMDs,
income projection (SS/pensions/interest), account growth and contributions,
milestone evaluation, and their data tables. ONLY the source files added in
the diff are under review. The test files in this branch are a behavioral
reference ONLY (not in the diff) and may be wrong or timezone-dependent: if
source and a test disagree, flag it as a question, do not assume the test.

ADJUDICATIONS: code-review-pr-50.md … code-review-pr-53.md (in this tree, base
commit) record findings already fixed or ruled by-design — do not resurface
wont-fixes. Known-open low-priority items live there too (e.g. PR #53
findings 12/13). Roth conversion strategy is back-loaded BY DESIGN (SORR);
do not propose front-loading/bracket-equalization "fixes".

Recurring problem areas that have actually bitten us here — extra scrutiny:

  1. Roth conversion mechanics. IRS ordering (contributions -> oldest
     conversions -> earnings) and the 5-year clock; the ACA look-ahead and the
     main withdrawal loop must drain the SAME conversion list (no
     double-spend); conversion sizing must not double-count taxable SS in
     provisional income (bit us before).
  2. RMD modeling. Divisor basis (prior Dec-31 balance, vested vs full);
     divisor table values at extreme ages; duplicate divisor tables drifting
     (fix EVERY copy); the 25% shortfall excise flowing into the year's taxes.
  3. Contribution caps. 415(c) combined employee+employer limit — the trimmed
     deposit in AccountGrowth is authoritative; any path recomputing employer
     match without the trim drifts from what was actually deposited.
  4. The three SS income classes are siblings — instanceof lists naming only
     two silently drop the third. Pension COLA (FERS diet-COLA rules) and the
     MRA-to-62 supplement window boundaries.
  5. Date-only / timezone handling. Pension + SS start dates are built with
     Date.UTC in places and local constructors in others, then read with the
     other family's accessors (PR #53 finding 13 — reinvested-interest income
     built local, read UTC — is still open). The unit suite runs in UTC and
     structurally cannot catch these.
  6. Goal sinking funds (new architecture, 2026-06): goal funding is a
     committed transfer credited by the engine; goal-fund accounts are
     reserved. AccountGrowth/contribution paths must not also route generic
     inflows into them.
  7. Falsy-zero. `|| default` where 0 is valid (customROR=0, COLA=0,
     expenseRatio=0) should be `??`.

Output: ranked findings, each with a concrete failure scenario
(inputs/state -> wrong output). Findings that can't name a trigger should say
so explicitly.
EOF
)

make_scope "review/retirement-${CAMPAIGN}" "${TITLE}" "${BODY}" \
    src/services/simulation/RothConversionDP.ts \
    src/services/simulation/RMDService.ts \
    src/services/simulation/IncomeProjection.ts \
    src/services/simulation/IncomeClassifier.ts \
    src/services/simulation/AccountGrowth.ts \
    src/services/simulation/MilestoneEvaluator.ts \
    src/services/simulation/CashflowDetailBuilder.ts \
    src/data/RMDData.ts \
    src/data/ContributionLimits.ts \
    src/data/SocialSecurityData.tsx \
    src/data/PensionData.tsx
