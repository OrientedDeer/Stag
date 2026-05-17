import { memo, useCallback, useState } from 'react';

interface PendingSliderProps {
    label: string;
    committedValue: number;
    min: number;
    max: number;
    step: number;
    formatValue: (displayValue: number) => string;
    onCommit: (displayValue: number) => void;
}

// Slider that holds its "in-flight" value locally during a drag and only
// fires onCommit on release. Owning the pending state here (instead of the
// parent) keeps drag ticks from re-rendering sibling controls and help text.
function PendingSliderInner({
    label,
    committedValue,
    min,
    max,
    step,
    formatValue,
    onCommit,
}: PendingSliderProps) {
    const [pending, setPending] = useState<number | null>(null);
    const displayValue = pending ?? committedValue;

    const commit = useCallback(() => {
        if (pending === null) return;
        const next = pending;
        setPending(null);
        onCommit(next);
    }, [pending, onCommit]);

    return (
        <label className="block">
            <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-200">{label}</span>
                <span className="text-sm text-gray-400 tabular-nums">
                    {formatValue(displayValue)}
                    {pending !== null && (
                        <span className="ml-2 text-yellow-500">(release to apply)</span>
                    )}
                </span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={displayValue}
                onChange={(e) => setPending(Number(e.target.value))}
                onMouseUp={commit}
                onTouchEnd={commit}
                onKeyUp={commit}
                onBlur={commit}
                className="w-full"
            />
        </label>
    );
}

export const PendingSlider = memo(PendingSliderInner);
