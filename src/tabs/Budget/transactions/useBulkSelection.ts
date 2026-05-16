import { useCallback, useState } from 'react';

/**
 * Owns the set of selected transaction IDs plus the standard toggle / clear
 * primitives. The bulk-apply action lives in the parent because it needs
 * dispatch + auto-categorize rule logic that doesn't belong here.
 */
export function useBulkSelection() {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const toggle = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const clear = useCallback(() => {
        setSelectedIds(new Set());
    }, []);

    return { selectedIds, toggle, clear };
}
