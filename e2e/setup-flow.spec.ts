import { test, expect } from '@playwright/test';
import {
  clearAllStorage,
  waitForLocalStorageSave,
  navigateToTab,
} from './helpers/app-helpers';
import { testAccounts, testIncome, testExpenses, STORAGE_KEYS } from './fixtures/test-data';

test.describe('Setup Flow - New User Journey', () => {
  test.setTimeout(10000);

  test.beforeEach(async ({ page }) => {
    // Start with clean state
    await page.goto('/');
    await clearAllStorage(page);
    await page.goto('/');
  });

  test('should show the app when loaded', async ({ page }) => {
    // Verify the app loads
    await expect(page).toHaveTitle(/stag/i);

    // The main content area should be visible
    await expect(page.locator('main')).toBeVisible({ timeout: 3000 });
  });

  test('should allow adding a savings account', async ({ page }) => {
    // Navigate to accounts via sidebar
    await navigateToTab(page, 'Accounts');

    // Click the Cash tab and then add cash button
    await page.getByRole('button', { name: /^cash$/i }).click();
    await page.getByRole('button', { name: /add cash/i }).click();

    // The modal should appear - wait for form fields
    await expect(page.getByLabel(/name/i).first()).toBeVisible({ timeout: 5000 });

    // Fill in account details
    await page.getByLabel(/name/i).first().fill(testAccounts.savings.name);
    // Currency input label includes ($)
    await page.getByLabel(/amount.*\(\$\)/i).first().fill(testAccounts.savings.amount.toString());

    // Save the account - click the "Add Account" button in the modal
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Verify the account appears in the list (use first() to handle multiple matches)
    await expect(page.getByText(testAccounts.savings.name).first()).toBeVisible();
  });

  test('should allow adding work income', async ({ page }) => {
    // Navigate to income via sidebar
    await navigateToTab(page, 'Income');

    // Click add income button (text is "+ Add Income")
    await page.getByRole('button', { name: /add income/i }).click();

    // Select Work Income type in the two-step modal
    // The buttons have labels like "Work Income", "Passive Income", etc.
    await page.getByRole('button', { name: /^work$/i }).click();

    // Now in step 2: fill in income details
    // Name field label is "Income Name"
    await page.getByLabel(/income name/i).fill(testIncome.salary.name);
    // Amount field label is "Gross Amount ($)"
    await page.getByLabel(/gross amount.*\(\$\)/i).fill(testIncome.salary.amount.toString());

    // Save - look for Add button at bottom of modal
    await page.getByRole('button', { name: /add income/i }).last().click();
    await waitForLocalStorageSave(page);

    // Verify the income appears
    await expect(page.getByText(testIncome.salary.name).first()).toBeVisible();
  });

  test('should allow adding an expense', async ({ page }) => {
    // Navigate to expenses via sidebar
    await navigateToTab(page, 'Expenses');

    // Click add expense button
    await page.getByRole('button', { name: /add expense/i }).click();

    // Select expense type in the two-step modal
    await page.getByRole('button', { name: /^rent$/i }).click();

    // Fill in expense details
    // Name field is "Expense Name" and may be pre-filled
    const nameField = page.getByLabel(/expense name/i);
    await nameField.clear();
    await nameField.fill(testExpenses.rent.name);
    // Amount field for rent is "Rent Payment ($)"
    await page.getByLabel(/rent payment.*\(\$\)/i).fill(testExpenses.rent.amount.toString());

    // Save - click the "Add Expense" button (last one is the modal submit button)
    await page.getByRole('button', { name: /add expense/i }).last().click();
    await waitForLocalStorageSave(page);

    // Verify the expense appears
    await expect(page.getByText(testExpenses.rent.name).first()).toBeVisible();
  });

  test('should persist data to localStorage', async ({ page }) => {
    // Add an account
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^cash$/i }).click();
    await page.getByRole('button', { name: /add cash/i }).click();

    await page.getByLabel(/name/i).first().fill(testAccounts.savings.name);
    await page.getByLabel(/amount.*\(\$\)/i).first().fill(testAccounts.savings.amount.toString());
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Verify localStorage has data
    const accountsData = await page.evaluate(
      (key) => localStorage.getItem(key),
      STORAGE_KEYS.accounts
    );
    expect(accountsData).not.toBeNull();
    expect(accountsData).toContain(testAccounts.savings.name);
  });

  test('should load persisted data on page reload', async ({ page }) => {
    // Add an account
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^cash$/i }).click();
    await page.getByRole('button', { name: /add cash/i }).click();

    await page.getByLabel(/name/i).first().fill(testAccounts.savings.name);
    await page.getByLabel(/amount.*\(\$\)/i).first().fill(testAccounts.savings.amount.toString());
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Reload the page
    await page.reload();

    // Navigate back to accounts
    await navigateToTab(page, 'Accounts');

    // Verify the account still exists (use first() to avoid strict mode)
    await expect(page.getByText(testAccounts.savings.name).first()).toBeVisible();
  });

  test('complete setup flow: add account, income, expense', async ({ page }) => {
    // Step 1: Add a savings account
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^cash$/i }).click();
    await page.getByRole('button', { name: /add cash/i }).click();
    await page.getByLabel(/name/i).first().fill(testAccounts.savings.name);
    await page.getByLabel(/amount.*\(\$\)/i).first().fill(testAccounts.savings.amount.toString());
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Step 2: Add work income
    await navigateToTab(page, 'Income');
    await page.getByRole('button', { name: /add income/i }).click();
    await page.getByRole('button', { name: /^work$/i }).click();
    await page.getByLabel(/income name/i).fill(testIncome.salary.name);
    await page.getByLabel(/gross amount.*\(\$\)/i).fill(testIncome.salary.amount.toString());
    await page.getByRole('button', { name: /add income/i }).last().click();
    await waitForLocalStorageSave(page);

    // Step 3: Add an expense
    await navigateToTab(page, 'Expenses');
    await page.getByRole('button', { name: /add expense/i }).click();
    await page.getByRole('button', { name: /^rent$/i }).click();
    // Name may be pre-filled, clear and fill
    const expenseNameField = page.getByLabel(/expense name/i);
    await expenseNameField.clear();
    await expenseNameField.fill(testExpenses.rent.name);
    await page.getByLabel(/rent payment.*\(\$\)/i).fill(testExpenses.rent.amount.toString());
    await page.getByRole('button', { name: /add expense/i }).last().click();
    await waitForLocalStorageSave(page);

    // Step 4: Navigate to Charts (Future) tab
    await navigateToTab(page, 'Charts');

    // The Charts tab should be visible with simulation data
    await expect(page.locator('main')).toBeVisible({ timeout: 3000 });
  });
});
