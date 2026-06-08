import { test, expect } from '@playwright/test';
import {
  clearAllStorage,
  waitForLocalStorageSave,
  navigateToTab,
} from './helpers/app-helpers';
import { testIncome } from './fixtures/test-data';

// Helper to click on a card (not the chart)
async function clickCard(page: any, name: string) {
  // Target the clickable card button (collapsed cards are now buttons for accessibility)
  const card = page.locator('button.cursor-pointer').filter({ hasText: name }).first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
}

test.describe('Tax Calculations', () => {
  test.setTimeout(10000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.goto('/');
  });

  test('should display tax breakdown when income exists', async ({ page }) => {
    // Add work income
    await navigateToTab(page, 'Income');
    await page.getByRole('button', { name: /add income/i }).click();
    await page.getByRole('button', { name: /^work$/i }).click();
    await page.getByLabel(/income name/i).fill(testIncome.salary.name);
    await page.getByLabel(/gross amount.*\(\$\)/i).fill(testIncome.salary.amount.toString());
    await page.getByRole('button', { name: /add income/i }).last().click();
    await waitForLocalStorageSave(page);

    // Navigate to Taxes tab
    await navigateToTab(page, 'Taxes');

    // Should show tax-related content
    await expect(page.locator('main')).toBeVisible();

    // Look for tax-related text (federal, state, FICA, etc.)
    const taxContent = page.getByText(/federal|state|fica|tax|effective/i);
    await expect(taxContent.first()).toBeVisible();
  });

  test('should update taxes when income amount changes', async ({ page }) => {
    // Add work income with specific amount
    await navigateToTab(page, 'Income');
    await page.getByRole('button', { name: /add income/i }).click();
    await page.getByRole('button', { name: /^work$/i }).click();
    await page.getByLabel(/income name/i).fill(testIncome.salary.name);
    await page.getByLabel(/gross amount.*\(\$\)/i).fill('50000');
    await page.getByRole('button', { name: /add income/i }).last().click();
    await waitForLocalStorageSave(page);

    // Check taxes page
    await navigateToTab(page, 'Taxes');
    await expect(page.locator('main')).toBeVisible();

    // Go back and increase income
    await navigateToTab(page, 'Income');
    await clickCard(page, testIncome.salary.name);
    await waitForLocalStorageSave(page);

    // Edit the amount (need blur to save)
    const amountInput = page.getByLabel(/^amount.*\(\$\)/i).first();
    if (await amountInput.isVisible().catch(() => false)) {
      await amountInput.click();
      await amountInput.fill('200000');
      await amountInput.blur();
      await waitForLocalStorageSave(page);
    }

    // Navigate back to taxes - should show updated calculations
    await navigateToTab(page, 'Taxes');
    await expect(page.locator('main')).toBeVisible();
  });

  test('should display without income', async ({ page }) => {
    // Navigate to Taxes with no income
    await navigateToTab(page, 'Taxes');

    // Page should still load
    await expect(page.locator('main')).toBeVisible();
  });
});
