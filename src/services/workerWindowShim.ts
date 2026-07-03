/**
 * DEV-ONLY window shim for engine Web Workers. MUST be the FIRST import of
 * every worker entry that pulls in `.tsx` modules (the simulation engine graph
 * includes useSimulation.tsx, SimulationEngine.tsx, the domain models.tsx, …).
 *
 * Why: in `vite dev`, @vitejs/plugin-react injects its react-refresh preamble
 * into transformed modules, and the shared `/@react-refresh` runtime it imports
 * ends with `injectIntoGlobalHook(window)` at module scope. Inside a worker
 * there is no `window`, so the WHOLE worker module graph dies at load with
 * "Uncaught ReferenceError: window is not defined" — before onmessage is even
 * installed. Every caller then silently takes its main-thread sync fallback,
 * which is exactly the multi-second UI freeze the workers exist to prevent
 * (#158 joint search, #98 Monte Carlo). Production builds are unaffected
 * (no refresh preamble is injected), and there this shim is a harmless no-op
 * alias of `globalThis`.
 *
 * ES module evaluation is declaration-ordered and depth-first, and this module
 * imports nothing — so placing it first guarantees it runs before any engine
 * module (and thus before the refresh runtime) is evaluated.
 */
if (typeof window === 'undefined') {
    (globalThis as { window?: typeof globalThis }).window = globalThis;
}

export {};
