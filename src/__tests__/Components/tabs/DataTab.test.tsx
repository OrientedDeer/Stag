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
import { InvestedAccount, PropertyAccount, DebtAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
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

/**
 * #143: the Net Worth column (and chart series) lead with VESTED net worth — gross
 * minus the unvested employer match — matching the Dashboard card and the Overview
 * tooltip. A new Unvested column keeps the arithmetic visible:
 *   Total Assets − Total Debt − Unvested = Net Worth.
 */
describe('DataTab vested net worth + unvested column (#143)', () => {
    // InvestedAccount args: (id, name, amount, employerBalance, tenureYears,
    //   expenseRatio, taxType, isContributionEligible, vestedPerYear, ...)
    // amount 100k; employer 40k; 1yr @ 20%/yr graded => 20% vested => 32k unvested.
    function makeVestingSimYear(): SimulationYear {
        return {
            ...makeSimYear(),
            expenses: [],
            accounts: [
                new InvestedAccount('inv-1', '401k', 100000, 40000, 1, 0.1, 'Traditional 401k', true, 0.2),
            ],
        };
    }

    it('table shows the Unvested column and a VESTED Net Worth value', () => {
        render(<DataTab simulationData={[makeVestingSimYear()]} birthYear={1990} />);

        // Header carries the new Unvested column.
        expect(screen.getByText('Unvested')).toBeInTheDocument();

        // Unvested = 40k * (1 - 0.2) = 32k; rendered exact (< $100K).
        expect(screen.getByText('$32,000')).toBeInTheDocument();

        // Net Worth column is VESTED = gross 100k - unvested 32k = 68k (NOT the gross 100k).
        expect(screen.getByText('$68,000')).toBeInTheDocument();
        expect(screen.queryByText('$100.0K')).toBeNull();
    });

    it('CSV export writes a Vested Net Worth and a gross Unvested column', async () => {
        let capturedBlob: Blob | null = null;
        const urlAny = URL as unknown as { createObjectURL?: (b: Blob) => string };
        urlAny.createObjectURL = (b: Blob) => { capturedBlob = b; return 'blob:mock'; };
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        render(<DataTab simulationData={[makeVestingSimYear()]} birthYear={1990} />);
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

        const nwCol = headers.indexOf('Net Worth');
        const assetsCol = headers.indexOf('Total Assets');
        const debtCol = headers.indexOf('Total Debt');
        const unvestedCol = headers.indexOf('Unvested');

        expect(unvestedCol).toBeGreaterThan(-1);
        expect(Number(values[assetsCol])).toBe(100000);  // gross assets unchanged
        expect(Number(values[debtCol])).toBe(0);
        expect(Number(values[unvestedCol])).toBe(32000);  // unvested employer match
        expect(Number(values[nwCol])).toBe(68000);         // VESTED = 100k - 32k

        // Arithmetic stays visible: Assets - Debt - Unvested = Net Worth.
        expect(Number(values[assetsCol]) - Number(values[debtCol]) - Number(values[unvestedCol]))
            .toBe(Number(values[nwCol]));

        delete urlAny.createObjectURL;
    });
});

/**
 * #143 review: the CSV's Total Debt column must use the SAME account-side liability
 * basis as the Net Worth (vested) column — DebtAccount balances + PropertyAccount
 * loanAmount — NOT the expense-side LoanExpense.amount / MortgageExpense.loan_balance.
 * Otherwise, for any user with a mortgage/loan, the reconciliation identity
 *   Total Assets − Total Debt − Unvested = Net Worth
 * breaks (the expense-side debt diverges from the account-side liabilities that drive
 * the gross net worth the Net Worth column nets the unvested match out of).
 */
describe('DataTab CSV reconciles with a mortgage + loan + unvested match (#143 review)', () => {
    // Account side (drives Net Worth):
    //   assets      = 400k property + 100k 401k                      = 500,000
    //   liabilities = 250k property loanAmount + 15k DebtAccount     = 265,000
    //   gross       = 500k − 265k                                    = 235,000
    //   unvested    = 40k employer * (1 − 0.2 vested)                =  32,000
    //   vested (NW) = 235k − 32k                                     = 203,000
    // Expense side is DELIBERATELY different (mortgage 240k, loan 14k) to prove the
    // CSV does NOT source Total Debt from the expenses.
    function makeReconcileSimYear(): SimulationYear {
        return {
            ...makeSimYear(),
            accounts: [
                new PropertyAccount('prop1', 'House', 400000, 'Financed', 250000, 250000, 'mort1'),
                new DebtAccount('debt1', 'Car Debt', 15000, 'loan1', 5),
                new InvestedAccount('inv1', '401k', 100000, 40000, 1, 0.1, 'Traditional 401k', true, 0.2),
            ],
            expenses: [
                // loan_balance 240k ≠ PropertyAccount.loanAmount 250k.
                new MortgageExpense('mort1', 'Home', 'Monthly', 400000, 240000, 250000, 3, 30, 1, 0, 0, 0, 0.3, 0, 0, 'No', 0, 'prop1', new Date(PAYOFF_YEAR - 5, 0, 1)),
                // LoanExpense.amount 14k ≠ DebtAccount.amount 15k.
                new LoanExpense('loan1', 'Car Loan', 14000, 'Monthly', 5, 'Compounding', 0, 'No', 0, 'debt1', new Date(PAYOFF_YEAR - 2, 0, 1)),
            ],
        };
    }

    it('Total Debt uses the account-side basis so Assets − Debt − Unvested = Net Worth holds', async () => {
        let capturedBlob: Blob | null = null;
        const urlAny = URL as unknown as { createObjectURL?: (b: Blob) => string };
        urlAny.createObjectURL = (b: Blob) => { capturedBlob = b; return 'blob:mock'; };
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        render(<DataTab simulationData={[makeReconcileSimYear()]} birthYear={1990} />);
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

        const assets = Number(values[headers.indexOf('Total Assets')]);
        const debt = Number(values[headers.indexOf('Total Debt')]);
        const unvested = Number(values[headers.indexOf('Unvested')]);
        const netWorth = Number(values[headers.indexOf('Net Worth')]);

        // Account-side basis — NOT the expense-side 240k mortgage / 14k loan.
        expect(assets).toBe(500000);
        expect(debt).toBe(265000);     // 250k property loanAmount + 15k DebtAccount
        expect(unvested).toBe(32000);
        expect(netWorth).toBe(203000); // vested = gross 235k − unvested 32k

        // The headline identity the CSV claims actually holds for a mortgage/loan user.
        expect(assets - debt - unvested).toBe(netWorth);

        delete urlAny.createObjectURL;
    });
});

// Shared CSV reader used by the blocks below.
async function exportAndReadCsv(simYear: SimulationYear, birthYear = 1990): Promise<{ csv: string; headers: string[]; values: string[] }> {
    let capturedBlob: Blob | null = null;
    const urlAny = URL as unknown as { createObjectURL?: (b: Blob) => string };
    urlAny.createObjectURL = (b: Blob) => { capturedBlob = b; return 'blob:mock'; };
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<DataTab simulationData={[simYear]} birthYear={birthYear} />);
    fireEvent.click(screen.getByText('CSV'));

    expect(capturedBlob).not.toBeNull();
    const csv: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(capturedBlob!);
    });
    delete urlAny.createObjectURL;
    const [headerLine, dataLine] = csv.split('\n');
    return { csv, headers: headerLine.split(','), values: dataLine.split(',') };
}

/**
 * #189: "Total Taxes" / "Eff. Tax %" must sum ALL tax components, not just
 * fed/state/FICA — otherwise a retiree drawing a Traditional IRA (whose tax lives
 * in withdrawalOrdinaryTax/capitalGains/NIIT/IRMAA/ACA) shows ~$0 taxes while the
 * same row's expenses embed the real tax bill. Single-sourced via totalTaxesOf.
 */
describe('DataTab Total Taxes sums all components (#189)', () => {
    function makeRetireeTaxSimYear(): SimulationYear {
        return {
            ...makeSimYear(),
            expenses: [],
            // fed/state/FICA are a small slice; the bulk is withdrawal/cap-gains/etc.
            taxDetails: {
                fed: 1000, state: 0, fica: 0,
                preTax: 0, insurance: 0, postTax: 0,
                capitalGains: 3000, withdrawalOrdinaryTax: 20000, niit: 500,
                irmaa: 800, aca: 1200,
            },
            cashflow: { ...makeSimYear().cashflow, totalIncome: 100000 },
        };
    }

    it('table shows the full 8-component tax total, not just fed/state/FICA', () => {
        render(<DataTab simulationData={[makeRetireeTaxSimYear()]} birthYear={1990} />);
        // 1000 + 3000 + 20000 + 500 + 800 + 1200 = 26,500 (not the old $1,000).
        expect(screen.getByText('$26,500')).toBeInTheDocument();
        expect(screen.queryByText('$1,000')).toBeNull();
    });

    it('CSV Total Taxes column carries the full sum', async () => {
        const { headers, values } = await exportAndReadCsv(makeRetireeTaxSimYear());
        expect(Number(values[headers.indexOf('Total Taxes')])).toBe(26500);
    });
});

/**
 * #189 regression: broadening the "Total Taxes" NUMERATOR to include
 * withdrawal/cap-gains/NIIT/IRMAA/ACA taxes left the "Eff. Tax %" DENOMINATOR at
 * cashflow.totalIncome, which EXCLUDES the gross withdrawals those taxes are
 * levied on — so a retiree drawing a Traditional IRA showed an impossible >100%
 * effective rate. The denominator must be the year's AGI-equivalent tax base
 * (magi), the same income that generated the taxes.
 */
describe('DataTab Eff. Tax % denominator includes withdrawal gross (#189)', () => {
    function makeRetireeWithdrawalSimYear(): SimulationYear {
        return {
            ...makeSimYear(),
            expenses: [],
            // $20k Social Security is the only cashflow "income"; the bulk of
            // spendable cash is a $100k gross Traditional-IRA withdrawal, whose
            // tax lands in withdrawalOrdinaryTax + capitalGains.
            cashflow: { ...makeSimYear().cashflow, totalIncome: 20000, withdrawals: 100000 },
            taxDetails: {
                fed: 5000, state: 0, fica: 0,
                preTax: 0, insurance: 0, postTax: 0,
                capitalGains: 3000, withdrawalOrdinaryTax: 22000, niit: 0,
            },
            // AGI-equivalent tax base: $20k SS (taxable) + $100k gross Trad draw.
            magi: 120000,
        };
    }

    it('rates the full tax bill against magi, not against SS-only income (no >100%)', () => {
        render(<DataTab simulationData={[makeRetireeWithdrawalSimYear()]} birthYear={1990} />);
        // totalTaxes = 5000 + 3000 + 22000 = 30,000. Against magi 120,000 => 25.0%.
        // The pre-fix code divided by totalIncome 20,000 => an impossible 150.0%.
        expect(screen.getByText('25.0%')).toBeInTheDocument();
        expect(screen.queryByText('150.0%')).toBeNull();
    });
});

/**
 * #189: CSV income columns must export ANNUAL amounts (getAnnualAmount), not the
 * raw per-period figure — a $3,000 bi-weekly salary belongs next to the annual
 * Gross Income column as ~$78,000, not 3000.
 */
describe('DataTab CSV annualizes per-period income (#189)', () => {
    function makeBiweeklyIncomeSimYear(): SimulationYear {
        return {
            ...makeSimYear(),
            expenses: [],
            incomes: [
                new WorkIncome('inc-1', 'Salary', 3000, 'Bi-Weekly', 'Yes',
                    0, 0, 0, 0, '', null, 'FIXED',
                    new Date(2000, 0, 1), new Date(2040, 11, 31)),
            ],
        };
    }

    it('exports 3000 bi-weekly as its $78,000 annual', async () => {
        const { headers, values } = await exportAndReadCsv(makeBiweeklyIncomeSimYear());
        const col = headers.indexOf('INC: Salary');
        expect(col).toBeGreaterThan(-1);
        expect(Number(values[col])).toBe(78000); // 3000 * 26, not the per-period 3000
    });
});

/**
 * #189: CSV must quote fields containing commas (a name like "Rent, apt" would
 * otherwise shift every following column) and must keep same-named items as
 * distinct columns (columns keyed by id, not name).
 */
describe('DataTab CSV escaping + de-dupe (#189)', () => {
    it('quotes a comma-bearing name and keeps two same-named incomes as separate columns', async () => {
        const simYear: SimulationYear = {
            ...makeSimYear(),
            expenses: [],
            incomes: [
                new WorkIncome('g1', 'Side Gig', 1000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED', new Date(2000, 0, 1), new Date(2040, 11, 31)),
                new WorkIncome('g2', 'Side Gig', 2000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED', new Date(2000, 0, 1), new Date(2040, 11, 31)),
                new WorkIncome('r1', 'Rent, apt', 5000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED', new Date(2000, 0, 1), new Date(2040, 11, 31)),
            ],
        };
        const { csv } = await exportAndReadCsv(simYear);
        const headerLine = csv.split('\n')[0];
        // Comma-bearing header is quoted so it stays one field.
        expect(headerLine).toContain('"INC: Rent, apt"');
        // Both same-named "Side Gig" incomes survive as separate columns (id-keyed).
        const sideGigCount = headerLine.split(',').filter(h => h === 'INC: Side Gig').length;
        expect(sideGigCount).toBe(2);
    });
});

/**
 * #189: Age must derive from the row's calendar year (year - birthYear), not the
 * array index — with priorYearMode the array starts a year early, so index-based
 * ages were off by one for every row.
 */
describe('DataTab Age derives from calendar year (#189)', () => {
    it('shows year - birthYear, independent of the array index / current year', () => {
        // makeSimYear().year === 2030; birthYear 1990 → age 40. The old
        // index-based formula (thisYear - birthYear + 0) would show ~36.
        render(<DataTab simulationData={[makeSimYear()]} birthYear={1990} />);
        expect(screen.getByText('40')).toBeInTheDocument();
        expect(screen.queryByText('36')).toBeNull();
    });
});
