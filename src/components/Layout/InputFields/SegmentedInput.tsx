import { type ReactElement, type ReactNode } from "react";

export interface SegmentedOption<T extends string | number | boolean> {
    value: T;
    label: string;
    /** Shown under the control while this option is selected. */
    caption?: ReactNode;
}

interface SegmentedInputProps<T extends string | number | boolean> {
    label: string;
    value: T;
    options: readonly SegmentedOption<T>[];
    onChange: (value: T) => void;
    className?: string;
}

/**
 * Shared segmented (pill button-group) control: one button per option, the
 * selected option highlighted, with an optional per-option caption rendered
 * under the control while that option is selected. Replaces the hand-rolled
 * button groups previously duplicated for Inflation Adjusted / Number Display.
 */
export function SegmentedInput<T extends string | number | boolean>({
    label,
    value,
    options,
    onChange,
    className = "",
}: SegmentedInputProps<T>): ReactElement {
    const selected = options.find((opt) => opt.value === value);

    return (
        <div className={className}>
            <h4 className="text-xs uppercase text-content-muted font-semibold mb-2">{label}</h4>
            <div
                role="group"
                aria-label={label}
                className="flex bg-surface-overlay p-1 rounded-lg border border-border-default"
            >
                {options.map((opt) => (
                    <button
                        key={String(opt.value)}
                        type="button"
                        aria-pressed={opt.value === value}
                        onClick={() => onChange(opt.value)}
                        className={`flex-1 py-1.5 text-xs rounded-md transition-all ${
                            opt.value === value
                                ? "bg-positive-solid text-white shadow-lg"
                                : "text-content-muted hover:text-white"
                        }`}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
            {selected?.caption != null && (
                <p className="text-xs text-content-muted mt-1">{selected.caption}</p>
            )}
        </div>
    );
}
