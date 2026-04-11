import { expect, test } from '@playwright/test';
import { resetE2EState } from './helpers.js';

const loginAs = async (page, email) => {
  await page.goto('/login');
  await page.selectOption('select[name="email"]', email);
  await page.getByRole('button', { name: /enter the app/i }).click();
};

test.beforeEach(async ({ request }) => {
  await resetE2EState(request);
});

test('pending invitee can review and mark inbox items as read from the notification center', async ({
  page
}) => {
  await loginAs(page, 'pending@courier.test');

  await expect(page.locator('[data-inbox-nav-badge]')).toHaveText('1');

  await page.locator('aside nav').getByRole('link', { name: /inbox/i }).click();
  await expect(page).toHaveURL(/\/inbox$/);

  const invitesFilter = page.locator('a[href="/inbox?filter=invites"]');
  await invitesFilter.focus();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/inbox\?filter=invites$/);
  await expect(page.locator('[data-inbox-item-read="false"]')).toHaveCount(1);

  await page.getByRole('button', { name: /mark read/i }).click();

  await expect(page.locator('[data-inbox-item-read="false"]')).toHaveCount(0);
  await expect(page.locator('[data-inbox-nav-badge]')).toBeHidden();
});
