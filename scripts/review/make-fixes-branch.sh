#!/usr/bin/env bash
# Collect every campaign fix commit from main onto a clean branch off the
# baseline tag, for the ultra fact-check pass.
#
# Relies on the commit convention: every review-fix commit on main starts its
# subject with "fix(review7):" (see scripts/review/README.md). Feature work
# interleaves freely on main; only matching commits are cherry-picked.
#
# Usage: scripts/review/make-fixes-branch.sh
# Then: git switch review-fixes-7 && /code-review ultra
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CAMPAIGN="${CAMPAIGN:-7}"
BASELINE_TAG="${BASELINE_TAG:-review-campaign-start}"
BRANCH="review-fixes-${CAMPAIGN}"

commits=$(git rev-list --reverse "${BASELINE_TAG}..main" --grep="^fix(review${CAMPAIGN}):")
if [ -z "${commits}" ]; then
    echo "No 'fix(review${CAMPAIGN}):' commits found in ${BASELINE_TAG}..main."
    exit 1
fi

echo "Collecting $(echo "${commits}" | wc -l) fix commits onto ${BRANCH}:"
git log --oneline --no-walk ${commits}

git branch -f "${BRANCH}" "${BASELINE_TAG}"
wt="$(mktemp -d)"
git worktree add "${wt}" "${BRANCH}"
(
    cd "${wt}"
    for c in ${commits}; do
        # Conflicts mean a fix landed on top of interleaved feature work —
        # resolve by hand in the worktree, then `git cherry-pick --continue`
        # and re-run this script's remaining picks manually.
        git cherry-pick "${c}"
    done
    git push -fu origin "${BRANCH}"
)
git worktree remove "${wt}"

echo
echo "Done. For the ultra fact-check pass:"
echo "  git switch ${BRANCH}"
echo "  /code-review ultra    # no PR number — bundles the local branch"
echo
echo "Give ultra the claims, not just the diff: paste the campaign's"
echo "code-review-pr-NN.md findings/dispositions into the review context so it"
echo "can verify or refute each fix's claimed failure scenario."
