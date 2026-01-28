import { AnyAccount } from "../../components/Objects/Accounts/models";
import { AnyExpense } from "../../components/Objects/Expense/models";
import { AnyIncome } from "../../components/Objects/Income/models";
import { WithdrawalResult, GuardrailTrigger } from "../WithdrawalStrategies";
import { RMDCalculation } from "../../data/RMDData";

// Define the shape of a single year's result
export interface SimulationYear {
    year: number;
    incomes: AnyIncome[];
    expenses: AnyExpense[];
    accounts: AnyAccount[];
    cashflow: {
        totalIncome: number;
        totalExpense: number; // Taxes + Living Expenses + Payroll Deductions
        discretionary: number; // Unspent cash
        investedUser: number;  // User contributions + Saved Cash
        investedMatch: number; // Employer Match
        totalInvested: number; // Sum
        bucketAllocations: number; // Priority Bucket contributions
        bucketDetail: Record<string, number>; // Breakdown
        withdrawals: number; // Total withdrawn from accounts
        withdrawalDetail: Record<string, number>; // Per-account breakdown
    };
    taxDetails: {
        fed: number;
        state: number;
        fica: number;
        preTax: number;
        insurance: number;
        postTax: number;
        capitalGains: number; // Capital gains tax on brokerage withdrawals
    };
    logs: string[];
    // Withdrawal strategy tracking (for multi-year calculations)
    strategyWithdrawal?: WithdrawalResult;
    // Guyton-Klinger strategy adjustment tracking
    strategyAdjustment?: {
        guardrailTriggered: GuardrailTrigger;
        requiredAdjustment: number;      // $ amount GK wants to cut/add
        actualAdjustment: number;        // $ amount actually cut/added
        discretionaryAvailable: number;  // $ of discretionary expenses available
        warning?: string;                // Warning if cut couldn't be fully applied
    };
    // Auto Roth conversion tracking
    rothConversion?: {
        amount: number;                  // Total amount converted
        taxCost: number;                 // Tax paid on conversion
        taxAfter: number;               // Total federal tax after conversion
        fromAccounts: Record<string, number>;  // Amount from each Traditional account (by name)
        toAccounts: Record<string, number>;    // Amount to each Roth account (by name)
        fromAccountIds: Record<string, number>;  // Amount from each Traditional account (by id)
        toAccountIds: Record<string, number>;    // Amount to each Roth account (by id)
    };
    // Required Minimum Distribution tracking
    rmdDetails?: {
        totalRMD: number;                         // Total RMD required this year
        totalWithdrawn: number;                   // Actual amount withdrawn for RMD
        accountBreakdown: RMDCalculation[];       // Per-account RMD details
        shortfall: number;                        // Amount not withdrawn (if any)
        penalty: number;                          // 25% penalty on shortfall
    };
    // Milestone tracking
    milestoneEvents?: MilestoneReachEvent[];      // Milestones reached this year
    activeMilestones?: string[];                   // All milestone IDs reached so far
}

// Internal withdrawal tracking state passed between simulation phases
export interface WithdrawalState {
    userInflows: Record<string, number>;
    employerInflows: Record<string, number>;
    withdrawalTaxes: number;
    capitalGainsTaxTotal: number;
    strategyWithdrawalExecuted: number;
    totalWithdrawals: number;
    withdrawalDetail: Record<string, number>;
    withdrawalPenalties: number;
    totalGrossIncome: number;
}

// Milestone-based trigger types
export type MilestoneOperator = '>=' | '<=' | '=' | '>' | '<';

export type MilestoneConditionType =
    | 'NET_WORTH'              // Total assets - liabilities
    | 'LIQUID_NET_WORTH'       // Brokerage + Savings only (not retirement accounts)
    | 'TOTAL_DEBT'             // All debt accounts + loan balances
    | 'YEAR'                   // Fixed calendar year
    | 'AGE';                   // User's age

// What the right side of the condition compares against
export type MilestoneValueType =
    | 'FIXED'                  // Just a number (default)
    | 'EXPENSES'               // value × annual expenses (e.g., 25x for 4% rule) - living expenses only
    | 'EXPENSES_GROSSED_UP'    // value × (expenses / (1 - tax_rate)) - includes estimated taxes
    | 'MILESTONE_PLUS';        // milestone year/age + value offset

export interface MilestoneCondition {
    type: MilestoneConditionType;
    operator: MilestoneOperator;
    value: number;
    valueType?: MilestoneValueType;        // Default 'FIXED' for backwards compatibility
    referenceMilestoneId?: string;         // For MILESTONE_PLUS - which milestone to reference
}

export interface CustomMilestone {
    id: string;
    name: string;                      // "Coast FIRE", "Debt Free", etc.
    conditions: MilestoneCondition[];  // All must be met (AND logic)
    color?: string;                    // For timeline display
}

export interface MilestoneReachEvent {
    milestoneId: string;
    yearReached: number;
    ageReached: number;
}
