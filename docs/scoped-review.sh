#!/usr/bin/env bash
#
# Prepare a scoped /code-review ultra of the Stag financial core:
# simulation engine + Roth conversion + the tax / data / model closure.
#
# Trick: the review only generates findings on the DIFF, but can READ any file
# in the branch. So:
#   * 39 production source files  -> ADDED in the diff   = reviewed
#   * all test files             -> identical in both branches = NOT in the diff,
#                                   but present in the checkout as a read-only
#                                   behavioral oracle (no "fix this test" churn).
#
# How it works:
#   1. Orphan base branch holding ONLY the tests          -> "review-base"
#   2. Scope branch = base + the 39 source files          -> "review/sim-core"
#   3. Push both. PR (base: review-base, compare: review/sim-core).
#      diff = the 39 source files as additions; tests unchanged = invisible.
#
# Then in Claude Code (logged in with a Claude.ai account):
#       /code-review ultra <PR-number>
#
# Run from the root of a CLEAN checkout (commit/stash first).

set -euo pipefail

# --- Production source to REVIEW (these appear in the diff). ------------------
KEEP='^(src/services/simulation/|src/components/Objects/Assumptions/SimulationEngine\.tsx$|src/components/Objects/Assumptions/AssumptionsContext\.tsx$|src/components/Objects/Taxes/TaxService\.tsx$|src/components/Objects/Taxes/TaxContext\.tsx$|src/components/Objects/Taxes/taxService/|src/components/Objects/Accounts/models\.tsx$|src/components/Objects/Income/models\.tsx$|src/components/Objects/Expense/models\.tsx$|src/data/TaxData\.tsx$|src/data/RMDData\.ts$|src/data/ContributionLimits\.ts$|src/data/PensionData\.tsx$|src/data/SocialSecurityData\.tsx$)'

# --- Test artifacts: context-only oracle, kept OUT of the diff. ---------------
TESTS='(__tests__/|\.test\.|\.spec\.|__snapshots__/)'

# Branch names are overridable so you can re-cut after code changes without
# colliding with an earlier run, e.g.:
#     REVIEW_SUFFIX=-2 bash docs/scoped-review.sh
SRC_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SUFFIX="${REVIEW_SUFFIX:-}"
BASE_BRANCH="${BASE_BRANCH:-review-base${SUFFIX}}"
SCOPE_BRANCH="${SCOPE_BRANCH:-review/sim-core${SUFFIX}}"

# --- Safety: refuse to run on a dirty tree. ----------------------------------
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: working tree is dirty. Commit or stash first." >&2
  exit 1
fi

# --- Resolve the two file sets from the source branch up front. ---------------
TEST_FILES="$(git ls-tree -r --name-only "$SRC_BRANCH" | grep -Ei "$TESTS")"
SRC_FILES="$(git ls-tree -r --name-only "$SRC_BRANCH" | grep -E "$KEEP" | grep -vEi "$TESTS")"

echo ">> Source branch: $SRC_BRANCH"
echo ">> Reviewing $(printf '%s\n' "$SRC_FILES" | wc -l | tr -d ' ') source files; carrying $(printf '%s\n' "$TEST_FILES" | wc -l | tr -d ' ') tests as context."

# 1. Orphan base holding ONLY the tests.
git checkout --orphan "$BASE_BRANCH"
git rm -rf . >/dev/null 2>&1 || true
printf '%s\n' "$TEST_FILES" | xargs -d '\n' git checkout "$SRC_BRANCH" --
git commit -q -m "Base: tests only (behavioral oracle, excluded from diff)"

# 2. Scope branch = base + source files.
git checkout -b "$SCOPE_BRANCH"
printf '%s\n' "$SRC_FILES" | xargs -d '\n' git checkout "$SRC_BRANCH" --
git commit -q -m "Scope: simulation engine + Roth + tax/data/model closure (source)"

# 3. Push both branches.
git push -u origin "$BASE_BRANCH"
git push -u origin "$SCOPE_BRANCH"

cat <<EOF

>> Done. Open a PR on GitHub:
     base:    $BASE_BRANCH
     compare: $SCOPE_BRANCH

>> Paste this into the PR description so the reviewer treats tests correctly:
   ----------------------------------------------------------------------
   Scoped review of the simulation / tax core. ONLY the source files added in
   the diff are under review. The test files in this branch are a behavioral
   reference ONLY (not in the diff) and may be wrong or timezone-dependent: if
   source and a test disagree, flag it as a question, do not assume the test.

   This core has been through several prior scoped reviews. Recurring problem
   areas — each has actually bitten us, so give them extra scrutiny:

     1. Date-only / timezone handling. parseDate (modelUtils.ts) stores
        date-only values at LOCAL midnight via new Date(y, m-1, d), so they must
        be read with LOCAL getFullYear/getMonth, NOT getUTC*. Some existing code
        reads them with getUTC* under a comment that wrongly claims parseDate
        returns UTC — a latent off-by-one in positive-offset zones. Check
        parseDate itself, not the comments. The unit suite runs in UTC, so it
        structurally cannot catch these.
     2. Social Security tax. Taxable SS double-counted in Roth-conversion sizing
        (provisional income); the three SS income classes are siblings, so a
        filter listing only two silently drops the third; SS-exempt-state logic.
     3. Duplicated logic that drifts. calculateStateTax vs
        calculateUnifiedStateTax applying deductions differently; duplicate RMD
        divisor tables; "recompute" paths that drift from the sim's actual values
        (e.g. employer match vs the 415(c)-trimmed deposit). Fix EVERY copy.
     4. Falsy-zero. '|| default' where 0 is a valid value (returnRate=0,
        costBasis, deductions, contributions) should be '?? default'.
     5. Persistence / migration. A deep-merge that copies only keys present in
        the DEFAULTS silently drops saved-only fields (e.g. imported SSA
        earnings) on reload.
     6. Roth conversion mechanics. IRS ordering (contributions -> oldest
        conversions -> earnings) and the 5-year clock; the ACA look-ahead and the
        main withdrawal loop must drain the SAME conversion list (no double-spend).
     7. Contribution / RMD modeling. 415(c) combined employee+employer cap; RMD
        basis (vested vs full balance); RMD divisor values at extreme ages.
     8. Gross-up sizing. Binary-search bounds, and omitting a tax component from
        the denominator (e.g. the ordinary bargain element on an ESPP sale).
     9. Sankey cash accounting. inflows must equal outflows; never count one
        dollar as both income and a withdrawal (RMD is the classic trap).
    10. Tax data tables. Year-specific figures (SS wage base, LTCG thresholds,
        brackets) copy-pasted from a prior year instead of the real value.

   Advice for this final pass:
     * Verify every suspected bug against the actual implementation / data flow,
       not a comment or a variable name — comments in this code have been wrong.
     * Green tests do NOT mean correct: the suite runs in UTC (hides date bugs)
       and some oracle values were written to match buggy behavior. A failing
       oracle test may mean the TEST is wrong — flag it rather than matching it.
     * Before flagging, confirm it is not intended behavior — some "overshoots"
       are deliberate and have a test asserting them.
     * Prefer deep fixes over special-cases; name the inputs/state that trigger
       each bug and the wrong output it produces.
   ----------------------------------------------------------------------

>> Then in Claude Code:  /code-review ultra <PR-number>
>> Back to your work:    git checkout $SRC_BRANCH

>> Teardown when finished:
     git checkout $SRC_BRANCH
     git branch -D $BASE_BRANCH $SCOPE_BRANCH
     git push origin --delete $BASE_BRANCH $SCOPE_BRANCH
EOF
