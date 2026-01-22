# Budget Tracking Feature - Requirements Gathering

## Data Input & Structure

### 1. Transaction Entry
How do you want to get spending data into Stag?
- [ ] Manual entry per transaction
- [ ] Manual entry of category totals (e.g., "I spent $450 on groceries this month")
- [ ] CSV import from your bank (what bank/format?)
- [x] Some combination

**Response:**
I think ideally we'd be importing from a csv file or maybe we make a custom google sheet template that the user can add their bank transactions to and then we import from that to make a more controlled input.

### 2. Budget Categories
What categories do you track in your current spreadsheet? Are these the same as or different from the Expense categories already in Stag (Housing, Food, Loans, etc.)?
Housing, food, loans, etc should probably be good. I think treating each expense object they have as a different category strikes a good balance.
**Response:**


### 3. Budget Variability
Is your budget the same every month, or do some categories vary (e.g., higher utilities in winter, annual subscriptions)?
We should allow some budget items to be marked as annual and spread over the course of the year.
**Response:**


---

## Goals & Tracking

### 4. Account Goals
When you say "end of year account balance goals" - are these:
- [ ] Specific dollar targets for each account (e.g., "Emergency fund at $20k by Dec 31")
- [ ] Net worth targets
- [ ] Savings rate targets
- [x] Something else

**Response:**
Ideally someone sets this up in Jan-2026 and the simulation engine has an estimate for what their Jan-2027 balance is. I think it would be good to see month by month how they're doing on getting to that balance/investing as much as they said they would. It's a little complicated because we don't want a bad stock market year to make them feel like they've done a bad job, but we also want to know if we're tracking with what was predicted. I think checking that amount spend and the amount invested is a good barameter, with comparing actual balances to expected balances can be a nice bonus.

### 5. Time Horizon
Do you want to track just the current month/year, or see historical trends (last 6 months, year-over-year)?

**Response:**
I want them to input month by month, and after 6 months quickly see how well they are doing, and also be able to see how well they will be doing if they stick to their budget.

---

## UI Location & Visualization

### 6. Where should this live?
- [x] New dedicated "Budget" or "Tracking" tab
- [ ] Integrated into the existing "Current" tab
- [ ] A dashboard that replaces or augments the current home view

**Response:**
A fully new tab. Current, Budget, Future

### 7. What views would be most useful?
- [X] Monthly budget vs. actual table with over/under indicators
- [X] Visual progress bars per category
- [X] Spending trend charts over time
- [X] Calendar/timeline view
- [X] Account goal progress visualization

**Response:**
All of these. I think I would also like to see a spreadsheet style month by month account balance.

---

## Integration with Existing Features

### 8. Relationship to Expenses
Should tracked actual spending update or inform the Expense projections in the simulation, or keep them separate (projection vs. reality)?

**Response:**
I think we should keep the link between projected expenses and the simulation. I'm not fully sure I know how the account balances get factored into the spreadsheet, but we should probably have the expected income get proated over the course of the year. i.e. by june they say they have 30k in savings. They net 60k a year and have a priority of it all going into savings. We should expect savings to be 60k by the end of the year. 30k + 60k/2 = 60k

### 9. Relationship to Accounts
Should you manually update account balances monthly, or derive them from income minus spending?

**Response:**
Manually track. I find it helpful to try and reconcile my transaction history with my account balances, but I think that may result in some frustration as currently with my spreadsheet it can occasionally be a huge headache to figure out which transaction I'm missing and why my transactions add up to $540 but by accounts went down by $546. If we can sort of automate this that would be awesome. Try and automatically reconcile the transactions with the account balance, but it might be too hard.

---

## Current Workflow

### 10. Current Spreadsheet Workflow
Describe your current spreadsheet workflow - how do you use it today? What works well? What's frustrating?
**Response:**
Currently I go to my bank website, download the csv. Import it into my google spreadsheet and add a new column for categories. I have very simple categories bc more would have been too much effort. So I mark them a grocery, dining (eating out), pet, other. Ideally this would be more grainular but it's a headache. Then I have some formulas for sorting all the transactions into seperate months based on when the credit card statement including that transaction is due. (this is also kind of a headache bc it means my budget tracking kind of trails by a month, this makes it hard to notice spending issues as their happening) I have a page that sums up that months credit card purchases with all of the manually entered utilites for the month (my utilties change every month and don't have a way to download a csv) Then I have a seperate spreadsheet where I take my previous account balance, subtract the spending from the first spreadsheet and visually verify it matches my actual account balance in my banking app. If they don't match I have to go and figure out which transaction is wrong (usually a row missing from my banks csv file, or the dates were wrong for which transactions appear on which credit card statement) This can be easy, or become a 30 minute debugging session. The account balance reconciling and the delay of one month for the credit card statement are two of the biggest issues.

---

## Additional Notes

Any other thoughts, ideas, or must-haves?

**Response:**
I just like to have estimated account balances for the next 6 months, and then see how my spending changes the expected outcome. If I spend less I see I'll end the year higher, if I spend more I see I'll end the year lower. I would like if this feature was easily ignored if others just want to use this webapp as a financial planner, but I also want to be able to replace my complicated google sheets with this webapp and I might be the only user anyways so making it great for me is maybe good enough.
