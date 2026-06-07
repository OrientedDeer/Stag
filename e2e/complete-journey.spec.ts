import { test, expect } from '@playwright/test';
import {
  clearAllStorage,
  waitForLocalStorageSave,
  navigateToTab,
} from './helpers/app-helpers';
import { testAccounts, testIncome, testExpenses } from './fixtures/test-data';

test.describe('Complete User Journey', () => {
  test.setTimeout(20000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.goto('/');
  });

  test('should complete full setup and view projections', async ({ page }) => {
    // Step 1: Add savings account
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^cash$/i }).click();
    await page.getByRole('button', { name: /add cash/i }).click();
    await page.getByLabel(/name/i).first().fill(testAccounts.savings.name);
    await page.getByLabel(/amount.*\(\$\)/i).first().fill(testAccounts.savings.amount.toString());
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);
    await expect(page.getByText(testAccounts.savings.name).first()).toBeVisible();

    // Step 2: Add investment account
    await page.getByRole('button', { name: /^invested$/i }).click();
    await page.getByRole('button', { name: /add investment/i }).click();
    await page.getByLabel(/name/i).first().fill(testAccounts.investment.name);
    await page.getByLabel(/amount.*\(\$\)/i).first().fill(testAccounts.investment.amount.toString());
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Step 3: Add work income
    await navigateToTab(page, 'Income');
    await page.getByRole('button', { name: /add income/i }).click();
    await page.getByRole('button', { name: /^work$/i }).click();
    await page.getByLabel(/income name/i).fill(testIncome.salary.name);
    await page.getByLabel(/gross amount.*\(\$\)/i).fill(testIncome.salary.amount.toString());
    await page.getByRole('button', { name: /add income/i }).last().click();
    await waitForLocalStorageSave(page);
    await expect(page.getByText(testIncome.salary.name).first()).toBeVisible();

    // Step 4: Add expense
    await navigateToTab(page, 'Expenses');
    await page.getByRole('button', { name: /add expense/i }).click();
    await page.getByRole('button', { name: /^rent$/i }).click();
    const nameField = page.getByLabel(/expense name/i);
    await nameField.clear();
    await nameField.fill(testExpenses.rent.name);
    await page.getByLabel(/rent payment.*\(\$\)/i).fill(testExpenses.rent.amount.toString());
    await page.getByRole('button', { name: /add expense/i }).last().click();
    await waitForLocalStorageSave(page);
    await expect(page.getByText(testExpenses.rent.name).first()).toBeVisible();

    // Step 5: View assumptions
    await navigateToTab(page, 'Assumptions');
    await expect(page.locator('main')).toBeVisible();

    // Step 6: View charts/projections
    await navigateToTab(page, 'Charts');
    await expect(page.locator('main')).toBeVisible();

    // Verify chart renders
    const chart = page.locator('svg, canvas, [class*="chart"]').first();
    await expect(chart).toBeVisible({ timeout: 5000 });
  });

  test('should show charts with all account types configured', async ({ page }) => {
    // Add one of each account type
    await navigateToTab(page, 'Accounts');

    // Savings
    await page.getByRole('button', { name: /^cash$/i }).click();
    await page.getByRole('button', { name: /add cash/i }).click();
    await page.getByLabel(/name/i).first().fill('Emergency Fund');
    await page.getByLabel(/amount.*\(\$\)/i).first().fill('10000');
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Investment
    await page.getByRole('button', { name: /^invested$/i }).click();
    await page.getByRole('button', { name: /add investment/i }).click();
    await page.getByLabel(/name/i).first().fill('Retirement 401k');
    await page.getByLabel(/amount.*\(\$\)/i).first().fill('50000');
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Property
    await page.getByRole('button', { name: /^property$/i }).click();
    await page.getByRole('button', { name: /add property/i }).click();
    await page.getByLabel(/name/i).first().fill('Home');
    await page.getByLabel(/value.*\(\$\)|amount.*\(\$\)/i).first().fill('300000');
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Debt
    await page.getByRole('button', { name: /^debt$/i }).click();
    await page.getByRole('button', { name: /add debt/i }).click();
    await page.getByLabel(/name/i).first().fill('Car Loan');
    await page.getByLabel(/amount.*\(\$\)|balance.*\(\$\)/i).first().fill('15000');
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Add income for complete picture
    await navigateToTab(page, 'Income');
    await page.getByRole('button', { name: /add income/i }).click();
    await page.getByRole('button', { name: /^work$/i }).click();
    await page.getByLabel(/income name/i).fill('Salary');
    await page.getByLabel(/gross amount.*\(\$\)/i).fill('100000');
    await page.getByRole('button', { name: /add income/i }).last().click();
    await waitForLocalStorageSave(page);

    // Navigate to charts
    await navigateToTab(page, 'Charts');
    await expect(page.locator('main')).toBeVisible();

    // Verify chart content
    const chart = page.locator('svg, canvas, [class*="chart"]').first();
    await expect(chart).toBeVisible({ timeout: 5000 });
  });
});
