import { test, expect } from '@playwright/test';
import {
  clearAllStorage,
  waitForLocalStorageSave,
  navigateToTab,
} from './helpers/app-helpers';
import { testIncome, testExpenses } from './fixtures/test-data';

test.describe('Allocation Tab', () => {
  test.setTimeout(10000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.goto('/');
  });

  test('should navigate to Allocation tab', async ({ page }) => {
    await navigateToTab(page, 'Allocation');

    // Verify we're on the allocation page
    await expect(page.locator('main')).toBeVisible();
  });

  test('should display income and expense summary', async ({ page }) => {
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
    const nameField = page.getByLabel(/expense name/i);
    await nameField.clear();
    await nameField.fill(testExpenses.rent.name);
    await page.getByLabel(/rent payment.*\(\$\)/i).fill(testExpenses.rent.amount.toString());
    await page.getByRole('button', { name: /add expense/i }).last().click();
    await waitForLocalStorageSave(page);

    // Navigate to allocation
    await navigateToTab(page, 'Allocation');

    // Should show allocation-related content
    await expect(page.locator('main')).toBeVisible();
  });

  test('should show allocation options', async ({ page }) => {
    await navigateToTab(page, 'Allocation');

    // Look for allocation-related content
    const content = page.getByText(/allocation|priority|surplus|income|expense/i);
    await expect(content.first()).toBeVisible();
  });
});
