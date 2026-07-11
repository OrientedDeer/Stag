import {
    type ContributionGrowthStrategy,
    type AutoMax401kOption,
    type ESPPContributionType,
    type PensionSystem,
    type IncomeFrequency,
    type RSUVestingSchedule,
    type RSUVestFrequency
} from './models';

export type PassiveSourceType = 'Dividend' | 'Rental' | 'Royalty' | 'Other';
export type EarnedIncomeOption = 'Yes' | 'No';

export interface IncomeFormState {
    name: string;
    amount: number;
    frequency: IncomeFrequency;
    startDate: Date | undefined;
    endDate: Date | undefined;
    startMilestoneId: string | undefined;
    endMilestoneId: string | undefined;
    earnedIncome: EarnedIncomeOption;
    // Work income / 401k fields
    preTax401k: number;
    insurance: number;
    roth401k: number;
    employerMatchType: 'fixed' | 'percent';
    employerMatch: number;
    employerMatchPercent: number;
    employerMatchMax: number;
    matchAccountId: string;
    contributionGrowthStrategy: ContributionGrowthStrategy;
    hsaContribution: number;
    autoMax401k: AutoMax401kOption;
    pensionSystem: PensionSystem;
    // ESPP fields
    esppContributionType: ESPPContributionType;
    esppContributionAmount: number;
    esppDiscountPercent: number;
    esppHasLookback: boolean;
    esppAccountId: string;
    // RSU fields (#140) — mirror WorkIncome's 6 RSU fields. rsuAccountId is '' when
    // unlinked (constructor takes string | null; '' maps to null at construction).
    rsuVestingSchedule: RSUVestingSchedule;
    rsuGrantShares: number;
    rsuVestFrequency: RSUVestFrequency;
    rsuExpectedStockGrowth: number;
    rsuWithholdingRate: number;
    rsuAccountId: string;
    // Social Security fields
    claimingAge: number;
    // Passive income fields
    sourceType: PassiveSourceType;
    // Pension fields
    pensionYearsOfService: number;
    pensionHigh3Salary: number;
    pensionRetirementAge: number;
    autoCalculateHigh3: boolean;
    linkedIncomeId: string;
}

export type UpdateForm = <K extends keyof IncomeFormState>(field: K, value: IncomeFormState[K]) => void;

export function getInitialFormState(): IncomeFormState {
    return {
        name: '',
        amount: 0,
        frequency: 'Monthly',
        startDate: new Date(new Date().getFullYear(), 0, 1),
        endDate: undefined,
        startMilestoneId: undefined,
        endMilestoneId: undefined,
        earnedIncome: 'Yes',
        preTax401k: 0,
        insurance: 0,
        roth401k: 0,
        employerMatchType: 'fixed',
        employerMatch: 0,
        employerMatchPercent: 0,
        employerMatchMax: 0,
        matchAccountId: '',
        contributionGrowthStrategy: 'FIXED',
        hsaContribution: 0,
        autoMax401k: 'custom',
        pensionSystem: 'NONE',
        esppContributionType: 'NONE',
        esppContributionAmount: 0,
        esppDiscountPercent: 15,
        esppHasLookback: true,
        esppAccountId: '',
        rsuVestingSchedule: 'NONE',
        rsuGrantShares: 0,
        rsuVestFrequency: 'quarterly',
        rsuExpectedStockGrowth: 7,
        rsuWithholdingRate: 37,
        rsuAccountId: '',
        claimingAge: 67,
        sourceType: 'Dividend',
        pensionYearsOfService: 20,
        pensionHigh3Salary: 0,
        pensionRetirementAge: 62,
        autoCalculateHigh3: false,
        linkedIncomeId: '',
    };
}
