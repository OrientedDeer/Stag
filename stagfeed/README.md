# stagfeed — headless importer entry

The headless SimpleFIN→Stag importer lives here. It reuses Stag's own pure
functions so the automated path and the in-app import path can't drift:

- `src/services/encryption/CryptoService.ts` — `decrypt` / `encrypt` (the blob envelope)
- `src/services/backupMerge.ts` — `makeTransaction`, `applyTransactions`, `applyBalances`

## Why it's a top-level dir

`tsconfig.app.json` includes only `src`, and this dir isn't in the root
`tsconfig.json` references, so `npm run build` (`tsc -b && vite build`) never
compiles or bundles it. It's a Node-side tool, run on its own.

## Running

```bash
npm run feed:example     # vite-node stagfeed/example.ts  (the template wiring)
npm run feed:check       # typecheck this dir against the shared helpers
```

`vite-node` runs these TS files through Vite's exact transform/resolution (same
as the app), so the shared imports resolve with zero drift and no build step.

## What stag-feed owns (not in this repo's helpers)

- SimpleFIN fetch → CSV → `Transaction[]` (build via `makeTransaction`, passing the
  SimpleFIN id as `Transaction.id` and `{ dedup: 'id' }` to `applyTransactions`).
- CouchDB I/O against the single per-user doc: GET (capture `_rev`) → decrypt →
  merge → encrypt → PUT with `_rev`, retry on 409.
- Refusing to write an encrypted blob over ~5 MB (the browser/back end cap).
- The three crown-jewel secrets (SimpleFIN access URL, backup passphrase, DB creds).

See `example.ts` for the end-to-end skeleton.

## Adding Node deps

When you wire real fs/CouchDB, add `@types/node` (and set `"types": ["node"]` in
this dir's tsconfig) plus the CouchDB client of your choice. Keep them out of the
app's dependencies.
