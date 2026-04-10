import { expect, test } from '@playwright/test';

const loginAs = async (page, email) => {
  await page.goto('/login');
  await page.selectOption('select[name="email"]', email);
  await page.getByRole('button', { name: /enter the app/i }).click();
};

const acceptPrompt = async (page, trigger, promptText) => {
  const dialogPromise = page.waitForEvent('dialog').then((dialog) => dialog.accept(promptText));
  await trigger.click();
  await dialogPromise;
};

test('owner can create and manage a script outline from the browser', async ({ page }) => {
  await loginAs(page, 'owner@courier.test');

  await page.goto('/projects/prj_foundation_demo');
  await page.getByRole('link', { name: /create script/i }).click();
  await expect(page).toHaveURL(/\/projects\/prj_foundation_demo\/scripts\/new$/);

  await page.getByLabel('Title').fill('Playwright Script');
  await page.getByRole('button', { name: /create script/i }).click();

  await expect(page).toHaveURL(/\/projects\/prj_foundation_demo\/scripts\/scr_/);
  await expect(page.getByRole('heading', { name: 'Playwright Script' })).toBeVisible();
  const rootOutlineControls = page.locator('[data-outline-root] > div').first();

  await acceptPrompt(page, rootOutlineControls.getByRole('button', { name: /add act/i }), 'Act I');
  await acceptPrompt(page, rootOutlineControls.getByRole('button', { name: /add scene/i }), 'Scene One');
  await acceptPrompt(page, rootOutlineControls.getByRole('button', { name: /add scene/i }), 'Scene Two');

  await expect(page.getByText('Act I')).toBeVisible();
  await expect(page.getByText('Scene One')).toBeVisible();
  await expect(page.getByText('Scene Two')).toBeVisible();

  await page.locator('select[name="sceneNumberMode"]').selectOption('frozen');
  await page.locator('[data-scene-number-form]').getByRole('button', { name: /^save$/i }).click();
  await expect(page.locator('select[name="sceneNumberMode"]')).toHaveValue('frozen');

  await page.getByRole('link', { name: /open editor/i }).click();
  await expect(page).toHaveURL(/\/editor(\?sceneId=scn_.*)?$/);
  await expect(page.getByRole('heading', { name: /screenplay editor/i })).toBeVisible();
});
