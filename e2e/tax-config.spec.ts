import { test, expect } from '@playwright/test';
import {
  clearAllStorage,
  waitForLocalStorageSave,
  navigateToTab,
} from './helpers/app-helpers';
import { testIncome } from './fixtures/test-data';

test.describe('Tax Configuration', () => {
  test.setTimeout(5000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.goto('/');
  });

  test('should navigate to Taxes tab', async ({ page }) => {
    await navigateToTab(page, 'Taxes');

    // Verify we're on the taxes page
    await expect(page.locator('main')).toBeVisible();
  });

  test('should display tax page content', async ({ page }) => {
    await navigateToTab(page, 'Taxes');

    // Check that main content is visible
    await expect(page.locator('main')).toBeVisible();
  });

  test('should show tax info with income added', async ({ page }) => {
    // First add income
    await navigateToTab(page, 'Income');
    await page.getByRole('button', { name: /add income/i }).click();
    await page.getByRole('button', { name: /^work$/i }).click();
    await page.getByLabel(/income name/i).fill(testIncome.salary.name);
    await page.getByLabel(/gross amount.*\(\$\)/i).fill(testIncome.salary.amount.toString());
    await page.getByRole('button', { name: /add income/i }).last().click();
    await waitForLocalStorageSave(page);

    // Go to taxes tab
    await navigateToTab(page, 'Taxes');

    // Verify page loads
    await expect(page.locator('main')).toBeVisible();
  });
});
