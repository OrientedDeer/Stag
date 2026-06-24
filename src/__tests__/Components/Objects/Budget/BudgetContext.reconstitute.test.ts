import { describe, it, expect } from 'vitest';
import { reconstituteBudgetState } from '../../../../components/Objects/Budget/BudgetContext';

describe('reconstituteBudgetState — importSettings.categoryMappings defaulting', () => {
    it('defaults categoryMappings to [] when an imported backup omits it', () => {
        // Older / hand-edited backups may carry importSettings without
        // categoryMappings. Before the fix this left it undefined, and the
        // category-mapping reducers + SettingsTab would spread/map/filter
        // undefined and throw a TypeError.
        const parsed = {
            months: [],
            importSettings: {
                dateColumn: 'Date',
                amountColumn: 'Amount',
                descriptionColumn: 'Description',
                savedCSVFormats: [],
                autoCreateRules: false,
                // categoryMappings intentionally absent
            },
        };

        const result = reconstituteBudgetState(parsed);

        expect(result.importSettings?.categoryMappings).toEqual([]);
        // The defaulted value must be safe to spread/map/filter.
        expect(() => [...result.importSettings!.categoryMappings]).not.toThrow();
        expect(() => result.importSettings!.categoryMappings.map(m => m.id)).not.toThrow();
        expect(() => result.importSettings!.categoryMappings.filter(() => true)).not.toThrow();
    });

    it('preserves categoryMappings when the backup includes them', () => {
        const mapping = {
            id: 'cm-1',
            pattern: 'COFFEE',
            expenseId: 'food',
        };
        const parsed = {
            months: [],
            importSettings: {
                dateColumn: 'Date',
                amountColumn: 'Amount',
                descriptionColumn: 'Description',
                categoryMappings: [mapping],
                savedCSVFormats: [],
                autoCreateRules: false,
            },
        };

        const result = reconstituteBudgetState(parsed);

        expect(result.importSettings?.categoryMappings).toEqual([mapping]);
    });

    it('leaves importSettings absent (no crash) when the backup omits it entirely', () => {
        const result = reconstituteBudgetState({ months: [] });
        // No importSettings key at all is a separate path; just make sure it
        // returns without throwing and doesn't fabricate a partial one.
        expect(result.importSettings).toBeUndefined();
    });
});
