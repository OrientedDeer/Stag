import pako from 'pako';

// Epoch for date conversion: 2020-01-01
const EPOCH = new Date('2020-01-01').getTime();
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Key mapping for compact format
const KEY_MAP: Record<string, string> = {
    // Common
    id: 'd', name: 'n', amount: 'a', className: 'c',
    // Accounts
    apr: 'r', taxType: 'x', employerBalance: 'b', expenseRatio: 'p',
    tenureYears: 'y', vestedPerYear: 'v', costBasis: 'o',
    isContributionEligible: 'g', linkedAccountId: 'L', nonVestedAmount: 'V',
    // Income/Expense
    frequency: 'f', startDate: 's', endDate: 'E', annualGrowthRate: 'w',
    earned_income: 'I', isDiscretionary: 'D',
    // Work income
    preTax401k: 'k', roth401k: 'K', insurance: 'u', employerMatch: 'M',
    matchAccountId: 'A', contributionGrowthStrategy: 'G', hsaContribution: 'H', autoMax401k: 'X',
    // Passive income
    sourceType: 'O', isReinvested: 'R', end_date: 'Z',
    // Social security
    claimingAge: 'C', calculatedPIA: 'P', calculationYear: 'W',
    // Expenses
    payment: 'J', utilities: 'U', interest_type: 'T', is_tax_deductible: 'B', tax_deductible: 'Q',
    // Tax
    filingStatus: 'F', stateResidency: 'S', deductionMethod: 'N', year: 'Y',
    fedOverride: 'O1', ficaOverride: 'O2', stateOverride: 'O3',
    // Assumptions
    inflationRate: 'ir', healthcareInflation: 'hi', inflationAdjusted: 'ia',
    salaryGrowth: 'sg', qualifiesForSocialSecurity: 'ss', socialSecurityFundingPercent: 'sp',
    lifestyleCreep: 'lc', housingAppreciation: 'ha', rentInflation: 'ri',
    ror: 'rr', withdrawalStrategy: 'ws', withdrawalRate: 'wr',
    gkUpperGuardrail: 'gu', gkLowerGuardrail: 'gl', gkAdjustmentPercent: 'ga', autoRothConversions: 'ar',
    retirementAge: 'ra', lifeExpectancy: 'le', birthYear: 'by', priorYearMode: 'pm',
    useCompactCurrency: 'cc', showExperimentalFeatures: 'ef', hsaEligible: 'he',
    // Priorities/Withdrawal
    type: 't', accountId: 'ai', capType: 'ct', capValue: 'cv',
};

// Create reverse mapping
const REVERSE_KEY_MAP: Record<string, string> = Object.entries(KEY_MAP).reduce(
    (acc, [full, short]) => ({ ...acc, [short]: full }),
    {} as Record<string, string>
);

// Default values to strip (type -> field -> default)
const DEFAULTS: Record<string, Record<string, unknown>> = {
    account: {
        employerBalance: 0,
        tenureYears: 0,
        vestedPerYear: 0,
        costBasis: 0,
        nonVestedAmount: 0,
        expenseRatio: 0,
    },
    income: {
        annualGrowthRate: 0.03,
        matchAccountId: null,
        hsaContribution: 0,
        autoMax401k: false,
    },
    expense: {
        annualGrowthRate: 0.03,
        is_tax_deductible: false,
        tax_deductible: false,
    },
};

/**
 * Converts an ISO date string to days since epoch.
 */
function dateToDays(dateStr: string): number {
    const date = new Date(dateStr);
    return Math.floor((date.getTime() - EPOCH) / MS_PER_DAY);
}

/**
 * Converts days since epoch back to ISO date string.
 */
function daysToDate(days: number): string {
    const date = new Date(EPOCH + days * MS_PER_DAY);
    return date.toISOString().split('T')[0];
}

/**
 * Recursively shorten all keys in an object.
 */
function shortenKeys(obj: unknown): unknown {
    if (Array.isArray(obj)) {
        return obj.map(shortenKeys);
    }
    if (obj !== null && typeof obj === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            const shortKey = KEY_MAP[key] || key;
            result[shortKey] = shortenKeys(value);
        }
        return result;
    }
    return obj;
}

/**
 * Recursively expand all keys in an object.
 */
function expandKeys(obj: unknown): unknown {
    if (Array.isArray(obj)) {
        return obj.map(expandKeys);
    }
    if (obj !== null && typeof obj === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            const fullKey = REVERSE_KEY_MAP[key] || key;
            result[fullKey] = expandKeys(value);
        }
        return result;
    }
    return obj;
}

/**
 * Strips default values from an object.
 */
function stripDefaults(obj: Record<string, unknown>, type: string): Record<string, unknown> {
    const typeDefaults = DEFAULTS[type] || {};
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
        // Skip null values
        if (value === null) continue;
        // Skip default values
        if (key in typeDefaults && typeDefaults[key] === value) continue;
        result[key] = value;
    }

    return result;
}

/**
 * Restores default values to an object.
 */
function restoreDefaults(obj: Record<string, unknown>, type: string): Record<string, unknown> {
    const typeDefaults = DEFAULTS[type] || {};
    return { ...typeDefaults, ...obj };
}

/**
 * Compacts amountHistory to use indexes and day arrays.
 */
function compactHistory(
    history: Record<string, Array<{ date: string; num: number }>>,
    accounts: Array<{ id: string }>
): Record<string, Array<[number, number]>> {
    const idToIndex = new Map(accounts.map((acc, idx) => [acc.id, idx]));
    const result: Record<string, Array<[number, number]>> = {};

    for (const [accountId, entries] of Object.entries(history)) {
        const index = idToIndex.get(accountId);
        if (index === undefined) continue;

        result[String(index)] = entries.map(entry => [
            dateToDays(entry.date),
            Math.round(entry.num)
        ]);
    }

    return result;
}

/**
 * Expands compacted amountHistory back to full format.
 */
function expandHistory(
    compact: Record<string, Array<[number, number]>>,
    accounts: Array<{ id: string }>
): Record<string, Array<{ date: string; num: number }>> {
    const result: Record<string, Array<{ date: string; num: number }>> = {};

    for (const [indexStr, entries] of Object.entries(compact)) {
        const index = parseInt(indexStr, 10);
        if (index >= accounts.length) continue;

        const accountId = accounts[index].id;
        result[accountId] = entries.map(([days, num]) => ({
            date: daysToDate(days),
            num
        }));
    }

    return result;
}

interface FullBackup {
    version: number;
    accounts: Array<{ id: string } & Record<string, unknown>>;
    amountHistory: Record<string, Array<{ date: string; num: number }>>;
    incomes: Array<Record<string, unknown>>;
    expenses: Array<Record<string, unknown>>;
    taxSettings: Record<string, unknown>;
    assumptions: Record<string, unknown>;
}

interface CompactBackup {
    v: number;
    a: Array<Record<string, unknown>>;
    h: Record<string, Array<[number, number]>>;
    i: Array<Record<string, unknown>>;
    e: Array<Record<string, unknown>>;
    t: Record<string, unknown>;
    m: Record<string, unknown>;
}

/**
 * Creates a compact backup from a full backup.
 */
export function createCompactBackup(full: FullBackup): CompactBackup {
    // Process accounts - strip defaults and shorten keys
    const compactAccounts = full.accounts.map(acc =>
        shortenKeys(stripDefaults(acc, 'account'))
    ) as Array<Record<string, unknown>>;

    // Compact history using account indexes
    const compactHistoryData = compactHistory(full.amountHistory, full.accounts);

    // Process incomes
    const compactIncomes = full.incomes.map(inc =>
        shortenKeys(stripDefaults(inc, 'income'))
    ) as Array<Record<string, unknown>>;

    // Process expenses
    const compactExpenses = full.expenses.map(exp =>
        shortenKeys(stripDefaults(exp, 'expense'))
    ) as Array<Record<string, unknown>>;

    return {
        v: full.version,
        a: compactAccounts,
        h: compactHistoryData,
        i: compactIncomes,
        e: compactExpenses,
        t: shortenKeys(full.taxSettings) as Record<string, unknown>,
        m: shortenKeys(full.assumptions) as Record<string, unknown>,
    };
}

/**
 * Expands a compact backup to full format.
 */
export function expandCompactBackup(compact: CompactBackup): FullBackup {
    // First expand accounts to get IDs for history mapping
    const expandedAccounts = compact.a.map(acc =>
        restoreDefaults(expandKeys(acc) as Record<string, unknown>, 'account')
    ) as Array<{ id: string } & Record<string, unknown>>;

    // Expand history using account IDs
    const expandedHistory = expandHistory(compact.h, expandedAccounts);

    // Expand incomes
    const expandedIncomes = compact.i.map(inc =>
        restoreDefaults(expandKeys(inc) as Record<string, unknown>, 'income')
    );

    // Expand expenses
    const expandedExpenses = compact.e.map(exp =>
        restoreDefaults(expandKeys(exp) as Record<string, unknown>, 'expense')
    );

    return {
        version: compact.v,
        accounts: expandedAccounts,
        amountHistory: expandedHistory,
        incomes: expandedIncomes,
        expenses: expandedExpenses,
        taxSettings: expandKeys(compact.t) as Record<string, unknown>,
        assumptions: expandKeys(compact.m) as Record<string, unknown>,
    };
}

/**
 * Checks if data is in compact format.
 */
export function isCompactFormat(data: unknown): data is CompactBackup {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    return 'v' in obj && 'a' in obj && 'h' in obj;
}

/**
 * Compresses a JavaScript object to a base64-encoded string using pako (zlib).
 */
export function compressData(data: object): string {
    const jsonString = JSON.stringify(data);
    const compressed = pako.deflate(jsonString);
    // Convert Uint8Array to base64
    const binaryString = Array.from(compressed)
        .map(byte => String.fromCharCode(byte))
        .join('');
    return btoa(binaryString);
}

/**
 * Decompresses a base64-encoded string back to a JavaScript object.
 */
export function decompressData(compressed: string): object {
    // Convert base64 to Uint8Array
    const binaryString = atob(compressed);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const decompressed = pako.inflate(bytes, { to: 'string' });
    return JSON.parse(decompressed);
}

/**
 * Validates that the payload has the expected structure for a full backup.
 */
export function validatePayload(data: unknown): data is {
    version: number;
    accounts: unknown[];
    amountHistory: Record<string, unknown>;
    incomes: unknown[];
    expenses: unknown[];
    taxSettings: unknown;
    assumptions: unknown;
} {
    if (typeof data !== 'object' || data === null) {
        return false;
    }

    const backup = data as Record<string, unknown>;

    // Check required fields exist
    if (typeof backup.version !== 'number') return false;
    if (!Array.isArray(backup.accounts)) return false;
    if (typeof backup.amountHistory !== 'object' || backup.amountHistory === null) return false;
    if (!Array.isArray(backup.incomes)) return false;
    if (!Array.isArray(backup.expenses)) return false;
    if (typeof backup.taxSettings !== 'object' || backup.taxSettings === null) return false;
    if (typeof backup.assumptions !== 'object' || backup.assumptions === null) return false;

    return true;
}

/**
 * Maximum safe size for QR code data (in bytes).
 * QR codes can technically hold up to ~3KB, but 2.5KB is safer for reliable scanning.
 */
export const MAX_QR_DATA_SIZE = 2500;

/**
 * Checks if the compressed data exceeds the safe QR code size limit.
 */
export function exceedsQRLimit(compressedData: string): boolean {
    return compressedData.length > MAX_QR_DATA_SIZE;
}
