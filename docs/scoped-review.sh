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
   Scoped review of the simulation/tax core. Only the source files in the
   diff should be reviewed. The test files in this branch are present as a
   behavioral reference ONLY (they are not in the diff). Treat them as
   possibly-wrong: if source and a test disagree, flag it as a question
   rather than assuming the test is correct.
   ----------------------------------------------------------------------

>> Then in Claude Code:  /code-review ultra <PR-number>
>> Back to your work:    git checkout $SRC_BRANCH

>> Teardown when finished:
     git checkout $SRC_BRANCH
     git branch -D $BASE_BRANCH $SCOPE_BRANCH
     git push origin --delete $BASE_BRANCH $SCOPE_BRANCH
EOF
