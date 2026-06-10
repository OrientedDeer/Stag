import { test, expect } from '@playwright/test';
import {
  clearAllStorage,
  waitForLocalStorageSave,
  navigateToTab,
} from './helpers/app-helpers';
import { testAccounts, testIncome, testExpenses } from './fixtures/test-data';

// Helper to click on an account/income/expense card (not the chart)
async function clickCard(page: any, name: string) {
  // Target the clickable card button (collapsed cards are now buttons for accessibility)
  const card = page.locator('button.cursor-pointer').filter({ hasText: name }).first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
}

// Helper to edit a currency input field (needs blur to save)
async function editCurrencyField(page: any, labelPattern: RegExp, newValue: string) {
  const input = page.getByLabel(labelPattern).first();
  await input.click();
  await input.fill(newValue);
  await input.blur();
}

test.describe('Edit Operations', () => {
  test.setTimeout(10000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.goto('/');
  });

  test('should edit a savings account', async ({ page }) => {
    // First add an account
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^cash$/i }).click();
    await page.getByRole('button', { name: /add cash/i }).click();
    await page.getByLabel(/name/i).first().fill(testAccounts.savings.name);
    await page.getByLabel(/amount.*\(\$\)/i).first().fill(testAccounts.savings.amount.toString());
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Click on the account card to expand it
    await clickCard(page, testAccounts.savings.name);
    await waitForLocalStorageSave(page);

    // Edit the amount (need to blur to trigger save)
    await editCurrencyField(page, /current amount.*\(\$\)/i, '20000');
    await waitForLocalStorageSave(page);

    // Reload and verify persistence
    await page.reload();
    await navigateToTab(page, 'Accounts');

    // The display format includes commas
    await expect(page.getByText(/20,000/).first()).toBeVisible();
  });

  test('should edit work income amount', async ({ page }) => {
    // Add work income
    await navigateToTab(page, 'Income');
    await page.getByRole('button', { name: /add income/i }).click();
    await page.getByRole('button', { name: /^work$/i }).click();
    await page.getByLabel(/income name/i).fill(testIncome.salary.name);
    await page.getByLabel(/gross amount.*\(\$\)/i).fill(testIncome.salary.amount.toString());
    await page.getByRole('button', { name: /add income/i }).last().click();
    await waitForLocalStorageSave(page);

    // Click on the income card to expand it
    await clickCard(page, testIncome.salary.name);
    await waitForLocalStorageSave(page);

    // Edit the amount (label is "Amount ($)" in edit mode, not "Gross Amount")
    await editCurrencyField(page, /^amount.*\(\$\)/i, '150000');
    await waitForLocalStorageSave(page);

    // Reload and verify persistence
    await page.reload();
    await navigateToTab(page, 'Income');
    // Display uses compact format: $150.0K for values >= 100K
    await expect(page.getByText(/150\.0K|\$150,000/).first()).toBeVisible();
  });

  test('should edit expense amount', async ({ page }) => {
    // Add expense
    await navigateToTab(page, 'Expenses');
    await page.getByRole('button', { name: /add expense/i }).click();
    await page.getByRole('button', { name: /^food$/i }).click();
    const nameField = page.getByLabel(/expense name/i);
    await nameField.clear();
    await nameField.fill(testExpenses.food.name);
    await page.getByLabel(/amount.*\(\$\)/i).first().fill(testExpenses.food.amount.toString());
    await page.getByRole('button', { name: /add expense/i }).last().click();
    await waitForLocalStorageSave(page);

    // Click on the expense card to expand it
    await clickCard(page, testExpenses.food.name);
    await waitForLocalStorageSave(page);

    // Edit the amount
    await editCurrencyField(page, /amount.*\(\$\)/i, '800');
    await waitForLocalStorageSave(page);

    // Reload and verify persistence
    await page.reload();
    await navigateToTab(page, 'Expenses');
    await expect(page.getByText(/800/).first()).toBeVisible();
  });

  test('should persist edits after page reload', async ({ page }) => {
    // Add an account
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^cash$/i }).click();
    await page.getByRole('button', { name: /add cash/i }).click();
    await page.getByLabel(/name/i).first().fill('Test Savings');
    await page.getByLabel(/amount.*\(\$\)/i).first().fill('5000');
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Edit the account
    await clickCard(page, 'Test Savings');
    await editCurrencyField(page, /current amount.*\(\$\)/i, '7500');
    await waitForLocalStorageSave(page);

    // Navigate away and back
    await navigateToTab(page, 'Income');
    await navigateToTab(page, 'Accounts');

    // Verify the edit persisted
    await expect(page.getByText(/7,500/).first()).toBeVisible();
  });
});
