import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
    captureCurrentState,
    createScenario,
    saveScenarioToStorage,
    loadScenariosFromStorage,
    exportScenarioToFile,
} from '../../services/ScenarioService';
import { SCENARIOS_STORAGE_KEY } from '../../services/ScenarioTypes';
import { defaultAssumptions } from '../../components/Objects/Assumptions/AssumptionsContext';
import { PassiveIncome, reconstituteIncome } from '../../components/Objects/Income/models';
import { FoodExpense, reconstituteExpense } from '../../components/Objects/Expense/models';
import { type TaxState } from '../../components/Objects/Taxes/TaxContext';

/**
 * Saved scenarios are re-simulated from storage (loadAndSimulateScenario →
 * reconstitute* → parseDate, which reads the date portion of the string locally).
 * Serializing with bare JSON.stringify emits UTC ISO strings, so for a UTC+ user a
 * local Jan 1 start date reloads as Dec 31 of the PREVIOUS year (#73 class).
 */
const assertSameCalendarDay = (actual: Date | undefined, expected: Date): void => {
    expect(actual).toBeInstanceOf(Date);
    expect(actual!.getFullYear()).toBe(expected.getFullYear());
    expect(actual!.getMonth()).toBe(expected.getMonth());
    expect(actual!.getDate()).toBe(expected.getDate());
};

const taxSettings = { filingStatus: 'Single', stateResidency: 'Texas' } as unknown as TaxState;

function buildScenario(start: Date, end: Date) {
    const incomes = [new PassiveIncome('inc-1', 'Rental', 12000, 'Annually', 'No', 'Rental', start, end)];
    const expenses = [new FoodExpense('exp-1', 'Food', 500, 'Monthly', start, end)];
    const inputs = captureCurrentState([], {}, incomes, expenses, taxSettings, defaultAssumptions);
    return createScenario('Tokyo plan', undefined, inputs);
}

describe('scenario serialization preserves calendar dates under UTC+ timezones', () => {
    beforeEach(() => {
        localStorage.removeItem(SCENARIOS_STORAGE_KEY);
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        localStorage.removeItem(SCENARIOS_STORAGE_KEY);
    });

    it('localStorage round-trip does not shift income/expense dates a day earlier', () => {
        vi.stubEnv('TZ', 'Asia/Tokyo');
        const start = new Date(2030, 0, 1);
        const end = new Date(2040, 0, 1);

        saveScenarioToStorage(buildScenario(start, end));
        const [loaded] = loadScenariosFromStorage();

        const income = reconstituteIncome(loaded.inputs.incomes[0]);
        const expense = reconstituteExpense(loaded.inputs.expenses[0]);
        assertSameCalendarDay(income!.startDate, start);
        assertSameCalendarDay(income!.end_date, end);
        assertSameCalendarDay(expense!.startDate, start);
        assertSameCalendarDay(expense!.endDate, end);
    });

    it('exported scenario file does not shift dates a day earlier', async () => {
        vi.stubEnv('TZ', 'Asia/Tokyo');
        const start = new Date(2030, 0, 1);
        const end = new Date(2040, 0, 1);

        let exported: Blob | undefined;
        URL.createObjectURL = vi.fn((b: Blob) => { exported = b; return 'blob:x'; });
        URL.revokeObjectURL = vi.fn();
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        exportScenarioToFile(buildScenario(start, end));
        const text = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsText(exported!);
        });
        const parsed = JSON.parse(text);

        const income = reconstituteIncome(parsed.inputs.incomes[0]);
        assertSameCalendarDay(income!.startDate, start);
        assertSameCalendarDay(income!.end_date, end);
    });
});
