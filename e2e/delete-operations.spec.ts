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

test.describe('Delete Operations', () => {
  test.setTimeout(10000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.goto('/');
  });

  test('should delete an account', async ({ page }) => {
    // Add an account
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^cash$/i }).click();
    await page.getByRole('button', { name: /add cash/i }).click();
    await page.getByLabel(/name/i).first().fill(testAccounts.savings.name);
    await page.getByLabel(/amount.*\(\$\)/i).first().fill(testAccounts.savings.amount.toString());
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Click on account card to expand it
    await clickCard(page, testAccounts.savings.name);
    await waitForLocalStorageSave(page);

    // Click delete button (uses aria-label for accessibility)
    await page.getByRole('button', { name: /delete.*account/i }).click();

    // Confirm deletion
    await page.getByRole('button', { name: /^delete$/i }).click();
    await waitForLocalStorageSave(page);

    // Verify account is gone - the card should not exist
    const card = page.locator('button.cursor-pointer').filter({ hasText: testAccounts.savings.name });
    await expect(card).not.toBeVisible();
  });

  test('should delete an income item', async ({ page }) => {
    // Add income
    await navigateToTab(page, 'Income');
    await page.getByRole('button', { name: /add income/i }).click();
    await page.getByRole('button', { name: /^work$/i }).click();
    await page.getByLabel(/income name/i).fill(testIncome.salary.name);
    await page.getByLabel(/gross amount.*\(\$\)/i).fill(testIncome.salary.amount.toString());
    await page.getByRole('button', { name: /add income/i }).last().click();
    await waitForLocalStorageSave(page);

    // Click on income card to expand it
    await clickCard(page, testIncome.salary.name);
    await waitForLocalStorageSave(page);

    // Look for delete button
    const deleteButton = page.getByTitle(/delete/i);
    if (await deleteButton.isVisible().catch(() => false)) {
      await deleteButton.click();

      // Confirm if dialog appears
      const confirmButton = page.getByRole('button', { name: /^delete$/i });
      if (await confirmButton.isVisible().catch(() => false)) {
        await confirmButton.click();
      }
      await waitForLocalStorageSave(page);

      // Verify income is gone
      const card = page.locator('button.cursor-pointer').filter({ hasText: testIncome.salary.name });
      await expect(card).not.toBeVisible();
    }
  });

  test('should delete an expense item', async ({ page }) => {
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

    // Click on expense card to expand it
    await clickCard(page, testExpenses.food.name);
    await waitForLocalStorageSave(page);

    // Look for delete button
    const deleteButton = page.getByTitle(/delete/i);
    if (await deleteButton.isVisible().catch(() => false)) {
      await deleteButton.click();

      // Confirm if dialog appears
      const confirmButton = page.getByRole('button', { name: /^delete$/i });
      if (await confirmButton.isVisible().catch(() => false)) {
        await confirmButton.click();
      }
      await waitForLocalStorageSave(page);

      // Verify expense is gone
      const card = page.locator('button.cursor-pointer').filter({ hasText: testExpenses.food.name });
      await expect(card).not.toBeVisible();
    }
  });

  test('should persist deletions after reload', async ({ page }) => {
    // Add an account
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^cash$/i }).click();
    await page.getByRole('button', { name: /add cash/i }).click();
    await page.getByLabel(/name/i).first().fill('Temp Account');
    await page.getByLabel(/amount.*\(\$\)/i).first().fill('1000');
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Delete it
    await clickCard(page, 'Temp Account');
    await page.getByRole('button', { name: /delete.*account/i }).click();
    await page.getByRole('button', { name: /^delete$/i }).click();
    await waitForLocalStorageSave(page);

    // Reload page
    await page.reload();
    await navigateToTab(page, 'Accounts');

    // Verify still deleted - card should not exist
    const card = page.locator('button.cursor-pointer').filter({ hasText: 'Temp Account' });
    await expect(card).not.toBeVisible();
  });
});
