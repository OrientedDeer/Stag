#!/usr/bin/env bash
# Scope 5/5: persistence + import/export — mostly never-reviewed ground
# (~3.4k lines, 13 files).
cd "$(git rev-parse --show-toplevel)"
source scripts/review/_lib.sh

TITLE="Scope: persistence, contexts, import/export, QR + cloud backup (source)"

BODY=$(cat <<'EOF'
Scoped review of the persistence layer: localStorage hydration (contexts +
persisted-reducer hooks), backup merge, CSV/SSA import, QR transfer
compression, and cloud backup. Most of this has NOT been through a scoped
review before. ONLY the source files added in the diff are under review. The
test files in this branch are a behavioral reference ONLY (not in the diff)
and may be wrong or timezone-dependent: if source and a test disagree, flag it
as a question, do not assume the test.

ADJUDICATIONS: code-review-pr-50.md … code-review-pr-53.md (in this tree, base
commit) record findings already fixed or ruled by-design — do not resurface
wont-fixes.

Recurring problem areas that have actually bitten us here — extra scrutiny:

  1. Deep-merge dropping saved-only fields. A merge that iterates only the
     keys present in the DEFAULTS silently drops fields that exist only in
     the saved data (e.g. imported SSA earnings) on reload. Check every
     merge/hydration path: context reducers' load, backupMerge, cloud
     restore. This is PR #53-era problem area 5 and the single most likely
     real-data-loss class in the app.
  2. QR key-shortening round-trip. qrUtils' key map must round-trip every
     persisted field — a field added to a model but missing from the map (or
     mapped twice to the same short key) corrupts QR backups. Date objects
     need special handling in shortenKeys (known sharp edge). Legacy short
     keys (e.g. 'gv' for the removed goalTargetDate) must keep DECODING even
     though nothing writes them anymore.
  3. Reconstitution ordering + migration. Legacy-data migrations live in
     reconstitute* (e.g. goalTargetDate -> endDate, 2026-06); hydration paths
     that bypass reconstitute (direct JSON.parse) skip migrations. Find any.
  4. Date round-trips. toISOString()/new Date('YYYY-MM-DD') UTC-parse
     off-by-one for date-only values (repo-wide recurring bug; the CSV/SSA
     importers and AddESPPLotModal-style `new Date(dateString)` calls are the
     usual suspects). Storage should round-trip through formatDateForInput/
     parseDate.
  5. Write races. Debounced localStorage writes vs imports that dispatch many
     actions: an import immediately followed by a reload can persist a stale
     snapshot; ImportKeyContext remounts charts but does not flush writes.
  6. Balance-history integrity. CSV "Import balances" + amountHistory: 401k
     split handling, duplicate-date entries, and merge of history arrays in
     backupMerge (last-write vs union).
  7. Cloud backup (self-hosted CouchDB /backup). Merge semantics shared with
     local backupMerge — verify both call the SAME helper and neither has
     drifted; auth-failure paths must not wipe local state.

Output: ranked findings, each with a concrete failure scenario
(inputs/state -> wrong output). Findings that can't name a trigger should say
so explicitly.
EOF
)

make_scope "review/persistence-${CAMPAIGN}" "${TITLE}" "${BODY}" \
    src/services/backupMerge.ts \
    src/services/CSVImportService.ts \
    src/services/SSAImportService.ts \
    src/services/cloud/CloudBackupService.ts \
    src/components/Objects/Accounts/QRTransfer/qrUtils.ts \
    src/components/Objects/Accounts/AccountContext.tsx \
    src/components/Objects/Accounts/ImportKeyContext.tsx \
    src/components/Objects/Accounts/useFileManager.ts \
    src/components/Objects/Expense/ExpenseContext.tsx \
    src/components/Objects/Income/IncomeContext.tsx \
    src/components/Objects/Budget/BudgetContext.tsx \
    src/hooks/usePersistedReducer.ts \
    src/hooks/useDebouncedLocalStorage.ts
