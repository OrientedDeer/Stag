/**
 * Test data fixtures for Stag E2E tests
 */

export const testAccounts = {
  savings: {
    name: 'Emergency Fund',
    amount: 10000,
    apr: 4.5,
  },
  checking: {
    name: 'Checking Account',
    amount: 5000,
    apr: 0.1,
  },
  investment: {
    name: '401k',
    amount: 50000,
    taxType: 'Traditional 401k',
  },
  rothIra: {
    name: 'Roth IRA',
    amount: 25000,
    taxType: 'Roth IRA',
  },
  property: {
    name: 'Primary Home',
    amount: 400000,
    financed: true,
    loanAmount: 300000,
    apr: 6.5,
    term: 30,
  },
  debt: {
    name: 'Car Loan',
    amount: 25000,
    apr: 5.0,
    term: 5,
  },
};

export const testIncome = {
  salary: {
    name: 'Software Engineer',
    amount: 120000,
    frequency: 'Annually' as const,
  },
  partTime: {
    name: 'Consulting',
    amount: 2000,
    frequency: 'Monthly' as const,
  },
  socialSecurity: {
    name: 'Future Social Security',
    claimingAge: 67,
  },
  rental: {
    name: 'Rental Property',
    amount: 1500,
    frequency: 'Monthly' as const,
  },
};

export const testExpenses = {
  rent: {
    name: 'Rent',
    amount: 2000,
    frequency: 'Monthly' as const,
  },
  food: {
    name: 'Groceries',
    amount: 600,
    frequency: 'Monthly' as const,
  },
  utilities: {
    name: 'Utilities',
    amount: 200,
    frequency: 'Monthly' as const,
  },
  insurance: {
    name: 'Health Insurance',
    amount: 500,
    frequency: 'Monthly' as const,
  },
  transportation: {
    name: 'Transportation',
    amount: 400,
    frequency: 'Monthly' as const,
  },
};

export const testTaxSettings = {
  single: {
    filingStatus: 'Single',
    stateResidency: 'California',
  },
  married: {
    filingStatus: 'Married Filing Jointly',
    stateResidency: 'Texas',
  },
};

export const testAssumptions = {
  default: {
    startAge: 30,
    retirementAge: 65,
    lifeExpectancy: 90,
    inflationRate: 3.0,
    returnRate: 7.0,
  },
  conservative: {
    startAge: 35,
    retirementAge: 67,
    lifeExpectancy: 85,
    inflationRate: 4.0,
    returnRate: 5.0,
  },
};

/**
 * localStorage keys used by the app
 */
export const STORAGE_KEYS = {
  accounts: 'user_accounts_data',
  incomes: 'user_incomes_data',
  expenses: 'user_expenses_data',
  taxes: 'tax_settings',
  assumptions: 'user_assumptions_data',
  simulation: 'user_simulation_data',
  scenarios: 'stag_scenarios',
  disclaimer: 'stag_disclaimer_dismissed',
  activeTab: 'account_active_tab',
} as const;
