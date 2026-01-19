# Stag

**A free, open-source retirement planning tool with comprehensive tax modeling.**

Plan your financial future with year-by-year projections that account for taxes, Social Security, pensions, investment growth, and withdrawal strategies. No subscriptions, no ads, no paywalls.

**[Try it now](https://orienteddeer.github.io/Stag/)**

---

## Why Stag?

Most retirement calculators oversimplify the math or hide the good stuff behind a paywall. Stag gives you the full picture for free:

- **Free & Open Source** — No subscriptions, no ads, no "premium" features. Everything is available to everyone.
- **Comprehensive Simulation** — Models income, expenses, taxes, RMDs, Social Security, federal pensions (FERS/CSRS), and more across your entire lifetime.
- **Tax-Smart** — Automatic Roth conversion optimization, withdrawal strategy modeling, and bracket-aware planning.
- **Private by Design** — Runs entirely in your browser. Your financial data never leaves your device.

---

## Features

### Dashboard
- Net worth tracking with historical charts
- Income and expense breakdowns
- Interactive Sankey cashflow diagram
- Key metrics at a glance (savings rate, tax burden, etc.)

### Accounts & Assets
- **Cash** — Savings, checking, emergency funds
- **Investments** — 401(k), IRA, Roth IRA, HSA, brokerage accounts with vesting schedules
- **Property** — Real estate with appreciation and linked mortgages
- **Debt** — Loans, credit cards, mortgages with amortization

### Income Sources
- Work income with 401(k) contributions and employer matching
- Social Security (current benefits or future projections with earnings history)
- Federal pensions (FERS and CSRS with automatic High-3 calculation)
- Passive income, rentals, and windfalls

### Expenses
- Categorized spending (housing, food, transport, healthcare, etc.)
- Mortgage and loan amortization
- Discretionary vs. essential expense tracking for retirement flexibility

### Future Projections
- Year-by-year simulation from now until end of life
- Monte Carlo analysis with percentile bands
- Multiple withdrawal strategies (Fixed, Guardrails, Guyton-Klinger)
- Automatic Roth conversion optimization to fill low tax brackets
- RMD calculations and compliance
- Scenario comparison to evaluate different strategies

### Data Management
- Export/import JSON backups
- QR code transfer between devices
- Everything stored locally in your browser

---

## Getting Started

### Use the Hosted Version
Visit **[orienteddeer.github.io/Stag](https://orienteddeer.github.io/Stag/)** — no installation required.

### Run Locally

```bash
# Clone the repository
git clone https://github.com/OrientedDeer/Stag.git
cd Stag

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## How It Works

Stag runs a detailed year-by-year simulation that:

1. **Projects income** — Salary growth, Social Security benefits (calculated from earnings history), pension payouts with COLA adjustments
2. **Calculates taxes** — Federal and state income tax, FICA, capital gains, with proper handling of Social Security taxation
3. **Applies expenses** — Inflation-adjusted spending, mortgage/loan amortization, lifestyle creep modeling
4. **Manages withdrawals** — Tax-efficient withdrawal ordering, RMD compliance, Roth conversion optimization
5. **Grows assets** — Compound growth with configurable return rates or Monte Carlo randomization

The simulation accounts for interactions between these systems—like how Roth conversions affect Social Security taxation, or how withdrawal timing impacts lifetime taxes.

---

## Tech Stack

- **React 19** + **TypeScript** + **Vite**
- **Tailwind CSS** for styling
- **Nivo** for charts and visualizations
- **LocalStorage** for data persistence (no backend)

---

## Contributing

Contributions are welcome! This project is a work in progress.

```bash
# Run tests
npm run test

# Run linting
npm run lint

# Build for production
npm run build
```

---

## About the Name

"Stag" is a placeholder name. I just like deer, and Stag sounded like a cooler project name than "Deer" or "Fawn." A real name may come eventually.

---

## License

MIT License — use it however you like.

---

## Disclaimer

Stag is a planning tool for educational purposes. It is not financial advice. Tax laws change, and individual situations vary. Consult a qualified financial advisor for personalized guidance.

This project was built with significant help from [Claude Code](https://claude.ai/code), Anthropic's AI coding assistant.
