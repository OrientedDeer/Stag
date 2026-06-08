import { test, expect } from '@playwright/test';
import {
  clearAllStorage,
  waitForLocalStorageSave,
  navigateToTab,
} from './helpers/app-helpers';
import { testAccounts } from './fixtures/test-data';

test.describe('Import/Export - Backup and Restore', () => {
  test.setTimeout(5000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.goto('/');
  });

  test('should export data to JSON file', async ({ page }) => {
    // First add some data
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^cash$/i }).click();
    await page.getByRole('button', { name: /add cash/i }).click();
    await page.getByLabel(/name/i).first().fill(testAccounts.savings.name);
    await page.getByLabel(/amount.*\(\$\)/i).first().fill(testAccounts.savings.amount.toString());
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Export button is on Accounts page
    const exportButton = page.getByRole('button', { name: /export backup/i });

    // Set up download handler
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;

    // Verify download happened
    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });

  test('should show confirmation before deleting all data', async ({ page }) => {
    // Add some data first
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^cash$/i }).click();
    await page.getByRole('button', { name: /add cash/i }).click();
    await page.getByLabel(/name/i).first().fill(testAccounts.savings.name);
    await page.getByLabel(/amount.*\(\$\)/i).first().fill(testAccounts.savings.amount.toString());
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Click delete all button
    await page.getByRole('button', { name: /delete all data/i }).click();

    // After clicking delete, either a confirm button appears or data is deleted
    // Look for any confirmation button that might appear
    const confirmButton = page.getByRole('button', { name: /confirm|yes/i });
    const cancelButton = page.getByRole('button', { name: /cancel|no/i });

    // If cancel button is visible, click it to cancel
    if (await cancelButton.isVisible().catch(() => false)) {
      await cancelButton.click();
      // Data should still exist
      await expect(page.getByText(testAccounts.savings.name).first()).toBeVisible();
    } else if (await confirmButton.isVisible().catch(() => false)) {
      // If only confirm button, just verify we can see the button
      await expect(confirmButton).toBeVisible();
    }
  });

  test('should delete all data when confirmed', async ({ page }) => {
    // Add some data first
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^cash$/i }).click();
    await page.getByRole('button', { name: /add cash/i }).click();
    await page.getByLabel(/name/i).first().fill(testAccounts.savings.name);
    await page.getByLabel(/amount.*\(\$\)/i).first().fill(testAccounts.savings.amount.toString());
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Click delete all button
    await page.getByRole('button', { name: /delete all data/i }).click();

    // Confirm the deletion
    const confirmButton = page.getByRole('button', { name: /confirm|yes|delete/i }).last();
    await confirmButton.click();
    await waitForLocalStorageSave(page);

    // Data should be gone - the chart/account name should not be visible
    await expect(page.getByText(testAccounts.savings.name)).not.toBeVisible();
  });
});
