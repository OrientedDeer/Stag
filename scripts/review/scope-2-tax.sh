#!/usr/bin/env bash
# Scope 2/5: tax computation services + tax data tables (~2.6k lines, 15 files).
cd "$(git rev-parse --show-toplevel)"
source scripts/review/_lib.sh

TITLE="Scope: tax services + tax data tables (source)"

BODY=$(cat <<'EOF'
Scoped review of federal/state/FICA/capital-gains tax computation and the tax
data tables. ONLY the source files added in the diff are under review. The
test files in this branch are a behavioral reference ONLY (not in the diff)
and may be wrong or timezone-dependent: if source and a test disagree, flag it
as a question, do not assume the test.

ADJUDICATIONS: code-review-pr-50.md … code-review-pr-53.md (in this tree, base
commit) record findings already fixed or ruled by-design — do not resurface
wont-fixes. The planner-side 0% LTCG floor is adjudicated (PR #53 finding 3);
bracket-boundary fixes from PR #53 findings 1/5/7 are already on main.

Recurring problem areas that have actually bitten us here — extra scrutiny:

  1. Social Security taxation. Provisional-income math (85%/50% tiers); the
     THREE SS income classes (SocialSecurityIncome, CurrentSocialSecurityIncome,
     FutureSocialSecurityIncome) are siblings — any filter or instanceof list
     naming only two silently drops the third; SS-exempt-state handling.
  2. Duplicated logic that drifts. calculateStateTax vs
     calculateUnifiedStateTax have diverged before (deductions applied
     differently). If a rule exists in two places, verify EVERY copy; flag the
     duplication itself.
  3. Bracket math edges. Inclusive/exclusive boundary at bracket tops;
     marginal-rate lookups at taxableIncome <= 0 (empty-bracket deref is
     PR #53 finding 15, still open); stacking order of ordinary income vs LTCG
     for the 0/15/20 thresholds; NIIT MAGI threshold (not inflation-indexed by
     law — check it isn't being inflated).
  4. Falsy-zero. `|| default` where 0 is legitimate (a 0% state rate, $0
     deduction override, 0 taxable income) should be `??`.
  5. Data freshness vs logic. The tables (TaxData, brackets, standard
     deductions) drive everything — spot-check a handful of 2025/2026 figures
     against published IRS/SSA values and flag mismatches as DATA findings,
     separate from logic findings (PR #53 flagged the 2025 SS bend points).
  6. Filing-status coverage. MFJ vs Single paths copy-pasted with slight
     variation; verify each threshold table actually differs where the law
     differs (and not where it doesn't).

Output: ranked findings, each with a concrete failure scenario
(inputs/state -> wrong output). Findings that can't name a trigger should say
so explicitly.
EOF
)

make_scope "review/tax-${CAMPAIGN}" "${TITLE}" "${BODY}" \
    src/components/Objects/Taxes/TaxService.tsx \
    src/components/Objects/Taxes/TaxContext.tsx \
    src/components/Objects/Taxes/taxService/bracketTax.ts \
    src/components/Objects/Taxes/taxService/capitalGainsTax.ts \
    src/components/Objects/Taxes/taxService/deductions.ts \
    src/components/Objects/Taxes/taxService/esppTax.ts \
    src/components/Objects/Taxes/taxService/federalTax.ts \
    src/components/Objects/Taxes/taxService/ficaTax.ts \
    src/components/Objects/Taxes/taxService/incomeAggregation.ts \
    src/components/Objects/Taxes/taxService/marginalRates.ts \
    src/components/Objects/Taxes/taxService/parameters.ts \
    src/components/Objects/Taxes/taxService/socialSecurity.ts \
    src/components/Objects/Taxes/taxService/stateTax.ts \
    src/data/TaxData.tsx
