# Ultra-Review Run Plan (Stag)

How to run `/code-review ultra` against the Stag simulation/tax core, scoped so
the review only flags the production source — not the tests — while still letting
the reviewer read the tests as a behavioral oracle.

The executable is checked in next to this file: [`scoped-review.sh`](./scoped-review.sh).

## What `/code-review ultra` is

- A multi-agent **cloud** review of the current branch (or a GitHub PR).
- **User-triggered and billed.** Claude Code (this CLI session) **cannot** launch
  it — don't try via Bash. You run it yourself from the prompt.
- Needs a git repository. The no-arg form bundles the local branch diff and does
  not need a GitHub remote.

### Invocation forms

- `/code-review ultra` — bundles the **local branch diff** (vs its base). No
  remote required.
- `/code-review ultra <PR#>` — reviews a **GitHub PR** directly (this is the form
  the scoped flow below uses).
- `/ultrareview` — deprecated alias for the same command.

## The scoping trick (orphan base)

The review only generates findings on the **diff**, but it can **read any file**
in the branch checkout. So:

1. **Orphan base branch** (`review-base`) holds **only the test files** — a
   behavioral oracle that is identical in both branches, so it never appears in
   the diff (no "fix this test" churn).
2. **Scope branch** (`review/sim-core`) = base + the **39 production source
   files** we want reviewed. These show up as additions in the diff = reviewed.
3. Push both, open a PR (base: `review-base`, compare: `review/sim-core`). The
   diff is the 39 source files; tests are present but invisible to the diff.
4. `/code-review ultra <PR#>`.

Run `scoped-review.sh` from the root of a **clean** checkout (commit/stash
first — it refuses to run on a dirty tree). The exact file-set regexes live in
the script (`KEEP` = source to review, `TESTS` = oracle kept out of the diff).

### PR description to paste

Tell the reviewer the tests are reference-only, possibly wrong:

> Scoped review of the simulation/tax core. Only the source files in the diff
> should be reviewed. The test files in this branch are present as a behavioral
> reference ONLY (they are not in the diff). Treat them as possibly-wrong: if
> source and a test disagree, flag it as a question rather than assuming the test
> is correct.

### Teardown

```bash
git checkout <your-branch>
git branch -D review-base review/sim-core
git push origin --delete review-base review/sim-core
```

## Gotchas learned the hard way

- **Pass `--comment` or the findings stay web-gated.** Last run "completed" but
  posted **nothing** to the PR because `--comment` wasn't used — the findings
  lived only in the auth-gated `claude.ai/code/session_...` web view, which
  WebFetch can't reach (403). We ended up extracting them from a screenshot.
  If you want the findings on the PR (and readable from this CLI session), make
  sure the run posts a comment.
- **`gh` on PATH here is the conda `gh` v0.0.4, NOT GitHub CLI.** `gh pr view`
  etc. will fail. For read-only PR data use the GitHub public API via `curl`
  (the repo is public).
- **The repo is PUBLIC.** Don't push anything sensitive to the review branches.
- **Don't trust findings blindly.** Last pass, the review wrongly *refuted* a real
  PMI inversion bug and under-framed several others (ACA cliff, 401k units, ESPP
  discount turned out deeper than labeled). Always verify each finding against the
  actual code before acting.

## Scope = 39 files (sim/tax core)

`src/services/simulation/*`, `SimulationEngine.tsx`, `AssumptionsContext.tsx`,
`TaxService.tsx`, `TaxContext.tsx`, `taxService/*`, the three big `models.tsx`
(Accounts / Income / Expense), and `src/data/{TaxData,RMDData,ContributionLimits,PensionData,SocialSecurityData}`.
See `KEEP` in the script for the authoritative list.
