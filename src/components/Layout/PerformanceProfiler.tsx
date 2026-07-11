import { Profiler, ProfilerOnRenderCallback, ReactNode, useCallback, useState } from 'react';

/**
 * In-code React Profiler wrapper that auto-logs slow renders. No need to open
 * DevTools and record sessions; if a commit exceeds the threshold, it shows
 * up as a console.warn with `[perf]` tag, the Profiler id (e.g. which tab),
 * and the render duration.
 *
 * Enable/disable at runtime without rebuilding:
 *   localStorage.setItem('stag_perf', '1')   // turn on
 *   localStorage.removeItem('stag_perf')     // turn off (default)
 *
 * Optional override of the slow-commit threshold (ms):
 *   localStorage.setItem('stag_perf_threshold', '32')
 *
 * Notes:
 * - `actualDuration` is the wall-clock time spent in this commit; renders
 *   skipped by memoization are NOT included, so it reflects work that
 *   actually happened.
 * - `baseDuration` is the time the same commit would take WITHOUT
 *   memoization — comparing the two tells you whether memoization is
 *   pulling weight or is actually overhead.
 * - The Profiler component is a no-op in production builds unless React is
 *   built with profiling enabled, so this is mostly a dev-time tool.
 */

const DEFAULT_THRESHOLD_MS = 50;

function isProfilerEnabled(): boolean {
    try {
        return typeof window !== 'undefined' && localStorage.getItem('stag_perf') === '1';
    } catch {
        return false;
    }
}

function readThresholdMs(): number {
    try {
        const raw = localStorage.getItem('stag_perf_threshold');
        if (!raw) return DEFAULT_THRESHOLD_MS;
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD_MS;
    } catch {
        return DEFAULT_THRESHOLD_MS;
    }
}

interface PerformanceProfilerProps {
    id: string;
    children: ReactNode;
}

/**
 * Wrap a subtree to automatically log slow commits under `id`.
 * Pass-through when profiling is disabled (no Profiler overhead).
 */
export function PerformanceProfiler({ id, children }: PerformanceProfilerProps) {
    // Resolve flag once per mount (lazy state init); cheap enough and avoids
    // per-commit cost. Kept as state — not a ref — so it can be read during
    // render without violating the ref-usage rule. It never changes after mount.
    const [enabled] = useState(isProfilerEnabled);
    const [threshold] = useState(readThresholdMs);

    const onRender = useCallback<ProfilerOnRenderCallback>((
        profilerId,
        phase,
        actualDuration,
        baseDuration,
    ) => {
        if (actualDuration < threshold) return;
        console.warn(
            `[perf] slow ${phase} in "${profilerId}": actual=${actualDuration.toFixed(1)}ms ` +
            `base=${baseDuration.toFixed(1)}ms ` +
            `(threshold=${threshold}ms)`
        );
    }, [threshold]);

    if (!enabled) return <>{children}</>;
    return <Profiler id={id} onRender={onRender}>{children}</Profiler>;
}
