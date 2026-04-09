import { test, expect } from '@playwright/test';

test('login page to app shell with locale switching', async ({ page }) => {
  await page.goto('/login');
  await page.selectOption('select[name="email"]', 'owner@courier.test');
  await page.getByRole('button', { name: 'Enter the app' }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Workspace dashboard' })).toBeVisible();

  await page.selectOption('#locale-switcher', 'es');
  await expect(page.getByRole('link', { name: 'Panel' })).toBeVisible();
});

