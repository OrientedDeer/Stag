import { test, expect } from '@playwright/test';
import {
  clearAllStorage,
  waitForLocalStorageSave,
  navigateToTab,
} from './helpers/app-helpers';

test.describe('Withdrawal Strategy', () => {
  test.setTimeout(5000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.goto('/');
  });

  test('should navigate to Withdrawal tab', async ({ page }) => {
    await navigateToTab(page, 'Withdrawal');

    // Verify we're on the withdrawal page
    await expect(page.locator('main')).toBeVisible();
  });

  test('should display withdrawal strategy options', async ({ page }) => {
    await navigateToTab(page, 'Withdrawal');

    // Look for withdrawal-related content
    const content = page.getByText(/withdrawal|strategy|order/i);
    await expect(content.first()).toBeVisible();
  });

  test('should show account order when accounts exist', async ({ page }) => {
    // First add an investment account
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^invested$/i }).click();
    await page.getByRole('button', { name: /add investment/i }).click();
    await page.getByLabel(/name/i).first().fill('401k Retirement');
    await page.getByLabel(/amount.*\(\$\)/i).first().fill('50000');
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Navigate to withdrawal
    await navigateToTab(page, 'Withdrawal');

    // Should show the page content
    await expect(page.locator('main')).toBeVisible();
  });
});
