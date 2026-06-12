/**
 * DataTab: expense sums must be year-aware (PR #59 finding #4)
 *
 * Campaign 7 made LoanExpense.getAnnualAmount(year) cap the payment in the
 * payoff year via amortization (you can't pay 12 full installments on a loan
 * that retires mid-year). Every other consumer of a simulation year's expenses
 * (Sankey, sunburst, the engine's own totalLivingExpenses) passes the year;
 * DataTab's table sum and CSV export used the no-arg form, so the table showed
 * the uncapped payment×12 in the payoff year and disagreed with the charts.
 *
 * These tests render DataTab with a synthetic SimulationYear in a loan's
 * payoff year and assert both the table cell and the CSV export use the
 * capped, year-aware amount.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { DataTab } from '../../../tabs/Future/tabs/DataTab';
import { LoanExpense, FoodExpense, MortgageExpense } from '../../../components/Objects/Expense/models';
import { SimulationYear } from '../../../services/simulation/types';

// The hidden PDF-capture chart is irrelevant here and nivo needs ResizeObserver
// plumbing — stub it out.
vi.mock('@nivo/line', () => ({
    ResponsiveLine: () => <div data-testid="mock-line" />,
}));

const PAYOFF_YEAR = 2030;

/**
 * $5,000 balance at the start of the payoff year, $1,000/month payment, 0% APR:
 * - getAnnualAmount()            → payment × 12 = $12,000 (uncapped, no-arg form)
 * - getAnnualAmount(PAYOFF_YEAR) → amortized     = $5,000 (capped: 5 payments clear it)
 */
function makePayoffYearLoan(): LoanExpense {
    return new LoanExpense(
        'loan-1', 'Car Loan',
        5000,            // current balance
        'Monthly',
        0,               // apr
        'Simple',
        1000,            // monthly payment
        'No', 0, '',
        new Date(PAYOFF_YEAR - 2, 0, 1),   // started Jan two years earlier
        new Date(PAYOFF_YEAR, 11, 31),     // contract end Dec of payoff year
    );
}

// A plain full-year expense so the table's Expenses total ($7,400 capped vs
// $14,400 uncapped) is distinct from the Debt Load cell (also $5,000).
function makeFoodExpense(): FoodExpense {
    return new FoodExpense('food-1', 'Food', 200, 'Monthly', new Date(PAYOFF_YEAR - 2, 0, 1));
}

/**
 * Mortgage in its payoff year (backlog A1). 0% APR for exact numbers:
 * starting $360k over 30y → standard P&I $1,000/month, no escrow (all
 * rates/fees 0). $5,000 balance left at the start of the payoff year:
 * - payment × 12                              → $12,000 (the old DataTab value)
 * - calculateAnnualAmortization(PAYOFF_YEAR)  → $5,000 (engine/Sankey value)
 */
function makePayoffYearMortgage(): MortgageExpense {
    return new MortgageExpense(
        'mort-1', 'Home', 'Monthly',
        400000,  // valuation
        5000,    // loan_balance at start of payoff year
        360000,  // starting_loan_balance
        0,       // apr
        30,      // term_length
        0, 0, 0, 0, 0, // taxes, deduction, maintenance, utilities, insurance
        0, 0, 'No', 0, 'acc-1',
        new Date(PAYOFF_YEAR - 2, 0, 1), // purchased Jan two years earlier
    );
}

// Distinct food amount ($250/mo = $3,000/yr) so the capped total ($8,000)
// differs from both the Debt Load cell ($5,000) and the loan test's totals.
function makeMortgageFoodExpense(): FoodExpense {
    return new FoodExpense('food-2', 'Groceries', 250, 'Monthly', new Date(PAYOFF_YEAR - 2, 0, 1));
}

function makeMortgageSimYear(): SimulationYear {
    return {
        ...makeSimYear(),
        expenses: [makePayoffYearMortgage(), makeMortgageFoodExpense()],
    };
}

function makeSimYear(): SimulationYear {
    return {
        year: PAYOFF_YEAR,
        incomes: [],
        expenses: [makePayoffYearLoan(), makeFoodExpense()],
        accounts: [],
        cashflow: {
            totalIncome: 0,
            totalExpense: 0,
            livingExpenses: 0,
            discretionary: 0,
            investedUser: 0,
            investedMatch: 0,
            totalInvested: 0,
            bucketAllocations: 0,
            bucketDetail: {},
            withdrawals: 0,
            withdrawalDetail: {},
        },
        taxDetails: {
            fed: 0, state: 0, fica: 0,
            preTax: 0, insurance: 0, postTax: 0,
            capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0,
        },
        logs: [],
    };
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('DataTab year-aware expense sums (PR #59 #4)', () => {
    it('sanity: the loan caps its payment in the payoff year only when the year is passed', () => {
        const loan = makePayoffYearLoan();
        expect(loan.getAnnualAmount()).toBe(12000);          // no-arg: uncapped
        expect(loan.getAnnualAmount(PAYOFF_YEAR)).toBe(5000); // year-aware: capped
    });

    it('table Expenses column shows the capped (year-aware) total in the payoff year', () => {
        render(<DataTab simulationData={[makeSimYear()]} birthYear={1990} />);

        // Capped: $5,000 loan payoff + $2,400 food.
        expect(screen.getByText('$7,400')).toBeInTheDocument();
        // Uncapped ($12,000 + $2,400) must NOT appear — that's the chart/table
        // mismatch this fix removes.
        expect(screen.queryByText('$14,400')).toBeNull();
    });

    it('CSV export writes the capped (year-aware) per-expense amount', async () => {
        let capturedBlob: Blob | null = null;
        // jsdom has no URL.createObjectURL; capture the blob handed to it.
        const urlAny = URL as unknown as { createObjectURL?: (b: Blob) => string };
        urlAny.createObjectURL = (b: Blob) => { capturedBlob = b; return 'blob:mock'; };
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        render(<DataTab simulationData={[makeSimYear()]} birthYear={1990} />);
        fireEvent.click(screen.getByText('CSV'));

        expect(capturedBlob).not.toBeNull();
        // jsdom's Blob has no .text(); read it via FileReader.
        const csv: string = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(capturedBlob!);
        });
        const [headerLine, dataLine] = csv.split('\n');
        const headers = headerLine.split(',');
        const values = dataLine.split(',');

        const loanCol = headers.indexOf('EXP: Car Loan');
        expect(loanCol).toBeGreaterThan(-1);
        expect(Number(values[loanCol])).toBe(5000); // capped, not 12000

        delete urlAny.createObjectURL;
    });
});

describe('DataTab mortgage payoff year matches the amortization (engine/Sankey) value — backlog A1', () => {
    it('sanity: the mortgage caps its payment in the payoff year only when the year is passed', () => {
        const mortgage = makePayoffYearMortgage();
        expect(mortgage.getAnnualAmount()).toBeCloseTo(12000, 2);            // no-arg: "today" payment×12
        expect(mortgage.getAnnualAmount(PAYOFF_YEAR)).toBeCloseTo(5000, 2);  // year-aware: amortized
    });

    it('table Expenses column shows the amortization-consistent total in the payoff year', () => {
        render(<DataTab simulationData={[makeMortgageSimYear()]} birthYear={1990} />);

        // Amortized: $5,000 mortgage payoff + $3,000 food.
        expect(screen.getByText('$8,000')).toBeInTheDocument();
        // payment×12 ($12,000 + $3,000) must NOT appear — that's the
        // table/Sankey mismatch this fix removes.
        expect(screen.queryByText('$15,000')).toBeNull();
    });

    it('CSV export writes the amortization-consistent per-mortgage amount', async () => {
        let capturedBlob: Blob | null = null;
        const urlAny = URL as unknown as { createObjectURL?: (b: Blob) => string };
        urlAny.createObjectURL = (b: Blob) => { capturedBlob = b; return 'blob:mock'; };
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        render(<DataTab simulationData={[makeMortgageSimYear()]} birthYear={1990} />);
        fireEvent.click(screen.getByText('CSV'));

        expect(capturedBlob).not.toBeNull();
        const csv: string = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(capturedBlob!);
        });
        const [headerLine, dataLine] = csv.split('\n');
        const headers = headerLine.split(',');
        const values = dataLine.split(',');

        const mortgageCol = headers.indexOf('EXP: Home');
        expect(mortgageCol).toBeGreaterThan(-1);
        expect(Number(values[mortgageCol])).toBeCloseTo(5000, 2); // amortized, not 12000

        delete urlAny.createObjectURL;
    });
});
