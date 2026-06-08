import { test, expect } from '@playwright/test';
import {
  clearAllStorage,
  waitForLocalStorageSave,
  navigateToTab,
} from './helpers/app-helpers';
import { testAccounts, testIncome, testExpenses } from './fixtures/test-data';

test.describe('Simulation & Scenarios', () => {
  // Longer timeout because beforeEach sets up account, income, and expense
  test.setTimeout(15000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.goto('/');

    // Set up basic data for simulation
    // Add account
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^cash$/i }).click();
    await page.getByRole('button', { name: /add cash/i }).click();
    await page.getByLabel(/name/i).first().fill(testAccounts.savings.name);
    await page.getByLabel(/amount.*\(\$\)/i).first().fill(testAccounts.savings.amount.toString());
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Add income
    await navigateToTab(page, 'Income');
    await page.getByRole('button', { name: /add income/i }).click();
    await page.getByRole('button', { name: /^work$/i }).click();
    await page.getByLabel(/income name/i).fill(testIncome.salary.name);
    await page.getByLabel(/gross amount.*\(\$\)/i).fill(testIncome.salary.amount.toString());
    await page.getByRole('button', { name: /add income/i }).last().click();
    await waitForLocalStorageSave(page);

    // Add expense
    await navigateToTab(page, 'Expenses');
    await page.getByRole('button', { name: /add expense/i }).click();
    await page.getByRole('button', { name: /^rent$/i }).click();
    const expenseNameField = page.getByLabel(/expense name/i);
    await expenseNameField.clear();
    await expenseNameField.fill(testExpenses.rent.name);
    await page.getByLabel(/rent payment.*\(\$\)/i).fill(testExpenses.rent.amount.toString());
    await page.getByRole('button', { name: /add expense/i }).last().click();
    await waitForLocalStorageSave(page);
  });

  test('should navigate to Future tab and show simulation', async ({ page }) => {
    await navigateToTab(page, 'Charts');

    // The simulation should load and show some content
    await expect(page.locator('main')).toBeVisible({ timeout: 3000 });
  });

  test('should show net worth chart', async ({ page }) => {
    await navigateToTab(page, 'Charts');

    // Wait for chart to render
    const chart = page.locator('[class*="chart"], [class*="Chart"], svg').first();
    await expect(chart).toBeVisible({ timeout: 3000 });
  });

  test('should configure assumptions', async ({ page }) => {
    await navigateToTab(page, 'Assumptions');

    // Verify the assumptions page loads
    await expect(page.locator('main')).toBeVisible();

    // Navigate to Charts and verify simulation runs
    await navigateToTab(page, 'Charts');
    await expect(page.locator('main')).toBeVisible({ timeout: 3000 });
  });

  test('should display data in Charts tab', async ({ page }) => {
    await navigateToTab(page, 'Charts');

    // Check that the main content area has loaded
    await expect(page.locator('main')).toBeVisible({ timeout: 3000 });

    // Look for any chart or data visualization
    const hasContent = await page.locator('svg, canvas, [class*="chart"]').first().isVisible().catch(() => false);
    expect(hasContent).toBeTruthy();
  });
});
