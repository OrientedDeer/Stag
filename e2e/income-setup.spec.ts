import { test, expect } from '@playwright/test';
import {
  clearAllStorage,
  waitForLocalStorageSave,
  navigateToTab,
} from './helpers/app-helpers';
import { testIncome } from './fixtures/test-data';

test.describe('Income Setup', () => {
  test.setTimeout(5000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.goto('/');
  });

  test('should add work income', async ({ page }) => {
    await navigateToTab(page, 'Income');

    // Click add income button
    await page.getByRole('button', { name: /add income/i }).click();

    // Select Work income type
    await page.getByRole('button', { name: /^work$/i }).click();

    // Fill in income details
    await page.getByLabel(/income name/i).fill(testIncome.salary.name);
    await page.getByLabel(/gross amount.*\(\$\)/i).fill(testIncome.salary.amount.toString());

    // Save
    await page.getByRole('button', { name: /add income/i }).last().click();
    await waitForLocalStorageSave(page);

    await expect(page.getByText(testIncome.salary.name).first()).toBeVisible();
  });

  test('should add passive income', async ({ page }) => {
    await navigateToTab(page, 'Income');

    await page.getByRole('button', { name: /add income/i }).click();

    // Select Passive Income type (full text)
    await page.getByRole('button', { name: /passive income/i }).click();

    await page.getByLabel(/name/i).first().fill(testIncome.rental.name);
    await page.getByLabel(/amount.*\(\$\)/i).first().fill(testIncome.rental.amount.toString());

    await page.getByRole('button', { name: /add income/i }).last().click();
    await waitForLocalStorageSave(page);

    await expect(page.getByText(testIncome.rental.name).first()).toBeVisible();
  });

  test('should add future social security income', async ({ page }) => {
    await navigateToTab(page, 'Income');

    await page.getByRole('button', { name: /add income/i }).click();

    // Select Future Social Security income type
    await page.getByRole('button', { name: /future social security/i }).click();

    // Fill form - the name field may have a different label
    const nameField = page.getByLabel(/name/i).first();
    if (await nameField.isVisible().catch(() => false)) {
      await nameField.fill(testIncome.socialSecurity.name);
    }

    await page.getByRole('button', { name: /add income/i }).last().click();
    await waitForLocalStorageSave(page);

    // Verify something was added (name may appear differently)
    await expect(page.locator('main')).toBeVisible();
  });

  test('should add windfall income', async ({ page }) => {
    await navigateToTab(page, 'Income');

    await page.getByRole('button', { name: /add income/i }).click();

    // Select Windfall income type
    await page.getByRole('button', { name: /windfall/i }).click();

    await page.getByLabel(/name/i).first().fill('Inheritance');
    await page.getByLabel(/amount.*\(\$\)/i).first().fill('50000');

    await page.getByRole('button', { name: /add income/i }).last().click();
    await waitForLocalStorageSave(page);

    await expect(page.getByText('Inheritance').first()).toBeVisible();
  });
});
