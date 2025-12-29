export const defaultData = {
  "accounts": [
    {
      "id": "ACC-1766974804380-931",
      "name": "Emergency Fund",
      "amount": 8000,
      "apr": 0.5,
      "className": "SavedAccount"
    },
    {
      "id": "ACC-1766974855009-474",
      "name": "Traditional 401k",
      "amount": 73763,
      "NonVestedAmount": 1241,
      "expenseRatio": 0.15,
      "taxType": "Traditional 401k",
      "isContributionEligible": true,
      "className": "InvestedAccount"
    },
    {
      "id": "ACC-1766976623210-626",
      "name": "Student Loans",
      "amount": 22500,
      "linkedAccountId": "EXS-1766976623210-626",
      "apr": 5.5,
      "className": "DebtAccount"
    },
    {
      "id": "ACC-1766976696301-739",
      "name": "House",
      "amount": 419300,
      "ownershipType": "Financed",
      "loanAmount": 252505,
      "startingLoanBalance": 366300,
      "linkedAccountId": "EXS-1766976696301-739",
      "className": "PropertyAccount"
    },
    {
      "id": "ACC-1766976720840-959",
      "name": "Car Loan",
      "amount": 24297,
      "linkedAccountId": "EXS-1766976720840-959",
      "apr": 7,
      "className": "DebtAccount"
    },
    {
      "id": "ACC-1766976734506-429",
      "name": "Credit Cards",
      "amount": 6730,
      "linkedAccountId": "EXS-1766976734506-429",
      "apr": 20,
      "className": "DebtAccount"
    }
  ],
  "amountHistory": {
    "ACC-1766974804380-931": [
      {
        "date": "2024-01-01",
        "num": 6000
      },
      {
        "date": "2025-01-01",
        "num": 7500
      },
      {
        "date": "2025-12-29",
        "num": 8000
      }
    ],
    "ACC-1766974855009-474": [
      {
        "date": "2024-01-01",
        "num": 53792
      },
      {
        "date": "2025-01-01",
        "num": 68231
      },
      {
        "date": "2025-12-29",
        "num": 73763
      }
    ],
    "ACC-1766976623210-626": [
      {
        "date": "2024-01-01",
        "num": 24400
      },
      {
        "date": "2025-12-29",
        "num": 22500
      }
    ],
    "ACC-1766976696301-739": [
      {
        "date": "2025-01-01",
        "num": 407000
      },
      {
        "date": "2025-12-29",
        "num": 419300
      }
    ],
    "ACC-1766976720840-959": [
      {
        "date": "2024-01-01",
        "num": 0
      },
      {
        "date": "2025-12-29",
        "num": 24297
      }
    ],
    "ACC-1766976734506-429": [
      {
        "date": "2024-01-01",
        "num": 5400
      },
      {
        "date": "2025-12-29",
        "num": 6730
      }
    ]
  },
  "incomes": [
    {
      "id": "INC-1766974988688-655",
      "name": "Primary Job",
      "amount": 83730,
      "frequency": "Annually",
      "earned_income": "Yes",
      "startDate": "2025-01-01T00:00:00.000Z",
      "end_date": "2025-12-29T02:49:19.498Z",
      "annualGrowthRate": 0.03,
      "isInflationAdjusted": true,
      "preTax401k": 2000,
      "insurance": 0,
      "roth401k": 0,
      "employerMatch": 0,
      "matchAccountId": null,
      "taxType": null,
      "className": "WorkIncome"
    }
  ],
  "expenses": [
    {
      "id": "EXS-1766976623210-626",
      "name": "Student Loans",
      "amount": 22500,
      "frequency": "Monthly",
      "startDate": "2023-01-01T00:00:00.000Z",
      "endDate": "2034-12-01T00:00:00.000Z",
      "apr": 5.5,
      "interest_type": "Compounding",
      "payment": 244.18,
      "is_tax_deductible": "No",
      "tax_deductible": 0,
    },
    {
      "id": "EXS-1766976696301-739",
      "name": "House",
      "amount": 3209.0599796646575,
      "frequency": "Monthly",
      "startDate": "2024-01-01T00:00:00.000Z",
      "valuation": 419300,
      "loan_balance": 252505,
      "starting_loan_balance": 366300,
      "apr": 6.23,
      "term_length": 30,
      "property_taxes": 0.85,
      "valuation_deduction": 89850,
      "maintenance": 1,
      "utilities": 180,
      "home_owners_insurance": 0.56,
      "pmi": 0,
      "hoa_fee": 0,
      "is_tax_deductible": "Itemized",
      "tax_deductible": 1310.9217916666666,
      "linkedAccountId": "ACC-1766976696301-739",
      "payment": 3209.0599796646575,
      "extra_payment": 0,
      "className": "MortgageExpense"
    },
    {
      "id": "EXS-1766976720840-959",
      "name": "Car Loan",
      "amount": 24297,
      "frequency": "Monthly",
      "startDate": "2023-01-01T00:00:00.000Z",
      "endDate": "2035-10-13T00:00:00.000Z",
      "apr": 7,
      "interest_type": "Compounding",
      "payment": 392.11,
      "is_tax_deductible": "No",
      "tax_deductible": 0,
      "linkedAccountId": "ACC-1766976720840-959",
      "className": "LoanExpense"
    },
    {
      "id": "EXS-1766976734506-429",
      "name": "Credit Cards",
      "amount": 6730,
      "frequency": "Monthly",
      "startDate": "2023-01-01T00:00:00.000Z",
      "endDate": "2035-12-29T02:52:14.998Z",
      "apr": 20,
      "interest_type": "Compounding",
      "payment": 130.06,
      "is_tax_deductible": "No",
      "tax_deductible": 0,
      "linkedAccountId": "ACC-1766976734506-429",
      "className": "LoanExpense"
    }
  ],
};