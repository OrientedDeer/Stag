import { useEffect } from 'react';

interface Shortcut {
    keys: string[];      // e.g. ['g', 'd'] or ['?']
    description: string;
}

interface ShortcutSection {
    title: string;
    shortcuts: Shortcut[];
}

const SECTIONS: ShortcutSection[] = [
    {
        title: 'Pages (sidebar)',
        shortcuts: [
            { keys: ['Shift', '↑'], description: 'Previous page in sidebar' },
            { keys: ['Shift', '↓'], description: 'Next page in sidebar' },
        ],
    },
    {
        title: 'Sub-tabs',
        shortcuts: [
            { keys: ['Shift', '←'], description: 'Previous sub-tab' },
            { keys: ['Shift', '→'], description: 'Next sub-tab' },
        ],
    },
    {
        title: 'Within a tab',
        shortcuts: [
            { keys: ['←'], description: 'Previous month (Budget) / earlier year on chart sliders' },
            { keys: ['→'], description: 'Next month (Budget) / later year on chart sliders' },
            { keys: ['↑'], description: 'Scroll up' },
            { keys: ['↓'], description: 'Scroll down' },
        ],
    },
    {
        title: 'General',
        shortcuts: [
            { keys: ['?'], description: 'Show this help overlay' },
            { keys: ['Esc'], description: 'Close overlay or modal' },
        ],
    },
];

interface KeyboardShortcutsOverlayProps {
    open: boolean;
    onClose: () => void;
}

export default function KeyboardShortcutsOverlay({ open, onClose }: KeyboardShortcutsOverlayProps) {
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
        >
            <div
                className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6 border-b border-gray-800 flex items-center justify-between">
                    <h2 className="text-xl font-semibold text-white">Keyboard Shortcuts</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white text-2xl leading-none"
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>
                <div className="p-6 space-y-6">
                    {SECTIONS.map(section => (
                        <div key={section.title}>
                            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                                {section.title}
                            </h3>
                            <div className="space-y-2">
                                {section.shortcuts.map((s, i) => (
                                    <div key={i} className="flex items-center justify-between gap-4">
                                        <span className="text-gray-300 text-sm">{s.description}</span>
                                        <div className="flex gap-1 shrink-0">
                                            {s.keys.map((k, j) => (
                                                <kbd
                                                    key={j}
                                                    className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs font-mono text-gray-200 min-w-[1.75rem] text-center"
                                                >
                                                    {k}
                                                </kbd>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="p-4 border-t border-gray-800 text-center text-xs text-gray-500">
                    Press <kbd className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded font-mono">?</kbd> any time to open this help.
                </div>
            </div>
        </div>
    );
}
