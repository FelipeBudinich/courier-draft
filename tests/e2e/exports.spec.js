import { expect, test } from '@playwright/test';

const loginAs = async (page, email) => {
  await page.goto('/login');
  await page.selectOption('select[name="email"]', email);
  await page.getByRole('button', { name: /enter the app/i }).click();
};

test('owner can export a full standard PDF from the script overview', async ({ page }) => {
  await loginAs(page, 'owner@courier.test');
  await page.goto('/projects/prj_foundation_demo/scripts/scr_pilot_demo');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-export-form] select[name="format"]').selectOption('standard');
  await page.locator('[data-export-form]').getByRole('button', { name: /export pdf/i }).click();

  const download = await downloadPromise;

  await expect(page.locator('[data-export-form] [data-form-status]')).toHaveText(
    /download started/i
  );
  await expect(download.suggestedFilename()).toMatch(/standard\.pdf$/);
});

test('reviewer can export a full mobile PDF from the editor', async ({ page }) => {
  await loginAs(page, 'reviewer@courier.test');
  await page.goto('/projects/prj_foundation_demo/scripts/scr_pilot_demo/editor');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-export-form] select[name="format"]').selectOption('mobile_9_16');
  await page.locator('[data-export-form]').getByRole('button', { name: /pdf/i }).click();

  const download = await downloadPromise;

  await expect(page.locator('[data-export-form] [data-form-status]')).toHaveText(
    /download started/i
  );
  await expect(download.suggestedFilename()).toMatch(/mobile\.pdf$/);
});

