#!/usr/bin/env bash
# Shared builder for scoped code-review PRs (campaign 7).
#
# The scaffold (same shape as review/sim-core-6 / PR #53):
#   - review-base-N: an ORPHAN branch holding only the test suites plus the
#     prior reviews' adjudication docs. Everything in it is visible in the
#     reviewed tree but OUTSIDE the diff. Intentionally not runnable (no
#     package.json/configs) — verification and fixing happen on main.
#   - review/<scope>-N: review-base-N + the scoped source files, taken from
#     the frozen BASELINE_TAG so all scopes review the same snapshot of main.
#   - A PR from the scope branch into the base branch: its diff is exactly
#     the scoped source. Run `/code-review max <PR#>` against it.
#
# Sourced by the scope-*.sh scripts; not run directly.
set -euo pipefail

CAMPAIGN="${CAMPAIGN:-7}"
BASELINE_TAG="${BASELINE_TAG:-review-campaign-start}"
BASE_BRANCH="review-base-${CAMPAIGN}"

ADJUDICATION_DOCS=(
    code-review-pr-50.md
    code-review-pr-51.md
    code-review-pr-52.md
    code-review-pr-53.md
)

# Build the shared tests-only base branch if it doesn't exist yet (local or
# remote). Uses a temp worktree so the main checkout is never disturbed.
ensure_base() {
    if git rev-parse --verify --quiet "refs/heads/${BASE_BRANCH}" >/dev/null; then
        return
    fi
    if git rev-parse --verify --quiet "refs/remotes/origin/${BASE_BRANCH}" >/dev/null; then
        git branch "${BASE_BRANCH}" "origin/${BASE_BRANCH}"
        return
    fi
    git rev-parse --verify --quiet "refs/tags/${BASELINE_TAG}" >/dev/null \
        || { echo "Missing tag ${BASELINE_TAG} — create it on the snapshot of main to review."; exit 1; }

    local wt
    wt="$(mktemp -d)"
    git worktree add --detach "${wt}" "${BASELINE_TAG}"
    (
        cd "${wt}"
        git switch --orphan "${BASE_BRANCH}"
        # Tests are the behavioral oracle; adjudication docs stop reviewers
        # from resurfacing known wont-fixes. Both live in the BASE commit so
        # they're in-tree but excluded from every scope's diff.
        git checkout "${BASELINE_TAG}" -- e2e src/__tests__ "${ADJUDICATION_DOCS[@]}"
        git commit -m "Base: tests + prior adjudications (oracle, excluded from diff)"
        git push -u origin "${BASE_BRANCH}"
    )
    git worktree remove "${wt}"
    echo "Created ${BASE_BRANCH}."
}

# make_scope <scope-branch> <pr-title> <pr-body> <file>...
# Creates the scope branch off the base, adds the listed source files from the
# baseline tag, pushes, and opens the PR.
make_scope() {
    local scope_branch="$1" title="$2" body="$3"
    shift 3

    ensure_base

    if git rev-parse --verify --quiet "refs/heads/${scope_branch}" >/dev/null \
       || git rev-parse --verify --quiet "refs/remotes/origin/${scope_branch}" >/dev/null; then
        echo "Scope branch ${scope_branch} already exists — delete it first to rebuild."
        exit 1
    fi

    # Fail fast on a typo'd file list before any branch is created.
    local f
    for f in "$@"; do
        git cat-file -e "${BASELINE_TAG}:${f}" 2>/dev/null \
            || { echo "Not in ${BASELINE_TAG}: ${f}"; exit 1; }
    done

    local wt
    wt="$(mktemp -d)"
    git worktree add "${wt}" -b "${scope_branch}" "${BASE_BRANCH}"
    (
        cd "${wt}"
        git checkout "${BASELINE_TAG}" -- "$@"
        git commit -m "${title}"
        git push -u origin "${scope_branch}"
        gh pr create \
            --base "${BASE_BRANCH}" \
            --head "${scope_branch}" \
            --title "${title}" \
            --body "${body}"
    )
    git worktree remove "${wt}"
    echo "Done: ${scope_branch} ($# files). Run /code-review max on the new PR."
}
