# Scoped review campaign 7

Smaller-scope rerun of the sim-core reviews (PR #50–53 were 30–40 file
scopes; fact-checking suffered). Five scopes of ~8–15 files each, partitioned
along dependency seams, followed by ONE cloud ultra review that fact-checks
the accumulated fixes rather than re-reviewing the codebase.

Division of labor: **local `/code-review max` = recall** (find everything),
**`/code-review ultra` on the fix diff = precision** (catch bad "fixes" that
broke by-design behavior — the PR #53 finding-2 failure mode).

## The scaffold

Same shape as review/sim-core-6 (PR #53):

- `review-base-7` — orphan branch: test suites + prior adjudication docs
  (`code-review-pr-50..53.md`). In-tree for the reviewer, excluded from every
  diff. Intentionally not runnable (no configs/deps) — verification happens
  on main.
- `review/<scope>-7` — base + the scoped source files, snapshotted from the
  `review-campaign-start` tag so all five scopes review the same main.
- PR scope-branch → base-branch: the diff is exactly the scoped source.

## Workflow per scope

1. `scripts/review/scope-N-<name>.sh` — builds the branch + opens the PR.
2. `/code-review max <PR#>`.
3. Verify + fix ON MAIN (the review branch is not runnable). Hard rule:
   **every fix lands with a regression test that fails before the fix.**
   A finding the verifier can't write a red test for is a finding to be
   suspicious of — that discipline caught both of PR #53's bad fixes.
4. Commit convention: review fixes are their own commits, subject prefixed
   `fix(review7): …` (the collector greps for this). Feature work interleaves
   freely on main without the prefix.
5. Log every finding's disposition (fixed @ commit / refuted / wont-fix +
   why) in `code-review-pr-<PR#>.md` at the repo root, checked in. The next
   scope's reviewer reads these — it's what stops re-litigating wont-fixes.

## The scopes

1. `scope-1-solver.sh` — YearSolver, WithdrawalPlanner, TaxOptimizedWithdrawal,
   SurplusAllocator, SpendingStrategy, WithdrawalService, helpers, types.
2. `scope-2-tax.sh` — TaxService + taxService/* + TaxContext + TaxData.
3. `scope-3-retirement.sh` — RothConversionDP, RMDService, IncomeProjection,
   IncomeClassifier, AccountGrowth, MilestoneEvaluator, CashflowDetailBuilder
   + RMD/SS/Pension/ContributionLimits data.
4. `scope-4-models.sh` — SimulationEngine, useSimulation, Assumptions/
   Simulation/MonteCarlo contexts, the three domain models, modelUtils.
5. `scope-5-persistence.sh` — backupMerge, CSV/SSA import, cloud backup,
   qrUtils, the persisted contexts, persisted-reducer hooks. (Mostly
   never-reviewed ground.)

Run them in any order; one at a time keeps the fix loop focused.

## The ultra fact-check pass

When the local reviews are done (or every 2–3 scopes if the fix pile grows):

1. `scripts/review/make-fixes-branch.sh` — cherry-picks every
   `fix(review7):` commit since `review-campaign-start` onto
   `review-fixes-7`. (A full-diff ultra was tried and was too large; the fix
   diff is the part worth cloud-level scrutiny.)
2. `git switch review-fixes-7`, then `/code-review ultra` (no argument — it
   bundles the local branch; no GitHub PR needed).
3. Give ultra the CLAIMS, not just the diff: include the campaign's
   `code-review-pr-NN.md` findings so each fix is checked against its claimed
   failure scenario ("fix N claims inputs X → wrong output Y — verify or
   refute"), and ask specifically whether any fix changes behavior that looks
   intentional elsewhere in the tree.

## Rebuilding

Scope scripts refuse to overwrite an existing branch. To rebuild one:
delete the local + origin scope branch (and its PR), then re-run. To restart
the campaign on a newer main: move the `review-campaign-start` tag, delete
`review-base-7` local+origin, and re-run the scope scripts.
