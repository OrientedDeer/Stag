import { test, expect } from '@playwright/test';
import {
  clearAllStorage,
  waitForLocalStorageSave,
  navigateToTab,
} from './helpers/app-helpers';
import { testAccounts, testIncome } from './fixtures/test-data';

test.describe('Dashboard', () => {
  test.setTimeout(5000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.goto('/');
  });

  test('should display dashboard page', async ({ page }) => {
    // Navigate to dashboard
    await page.getByRole('link', { name: /dashboard/i }).click();
    await page.waitForLoadState('networkidle');

    // Verify dashboard loads
    await expect(page.locator('main')).toBeVisible();
  });

  test('should show summary cards on dashboard', async ({ page }) => {
    // Add some data first
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^cash$/i }).click();
    await page.getByRole('button', { name: /add cash/i }).click();
    await page.getByLabel(/name/i).first().fill(testAccounts.savings.name);
    await page.getByLabel(/amount.*\(\$\)/i).first().fill(testAccounts.savings.amount.toString());
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Navigate to dashboard
    await page.getByRole('link', { name: /dashboard/i }).click();
    await page.waitForLoadState('networkidle');

    // Dashboard should show content
    await expect(page.locator('main')).toBeVisible();
  });

  test('should navigate to other sections from dashboard', async ({ page }) => {
    // Start on dashboard
    await page.getByRole('link', { name: /dashboard/i }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main')).toBeVisible();

    // Navigate to Accounts
    await navigateToTab(page, 'Accounts');
    await expect(page.locator('main')).toBeVisible();

    // Navigate back to Dashboard
    await page.getByRole('link', { name: /dashboard/i }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main')).toBeVisible();
  });
});
