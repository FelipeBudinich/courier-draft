import { expect, test } from '@playwright/test';
import { resetE2EState } from './helpers.js';

const loginAs = async (page, email) => {
  await page.goto('/login');
  await page.selectOption('select[name="email"]', email);
  await page.getByRole('button', { name: /enter the app/i }).click();
};

const acceptPrompt = async (page, trigger, promptText) => {
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Node title').fill(promptText);
  await dialog.getByRole('button', { name: /create/i }).click();
};

test.beforeEach(async ({ request }) => {
  await resetE2EState(request);
});

test('owner can create and manage a script outline from the browser', async ({ page }) => {
  await loginAs(page, 'owner@courier.test');

  await page.goto('/projects/prj_foundation_demo');
  await page.getByRole('link', { name: /create script/i }).click();
  await expect(page).toHaveURL(/\/projects\/prj_foundation_demo\/scripts\/new$/);

  await page.getByLabel('Title').fill('Playwright Script');
  await expect(page.locator('[data-author-row]')).toBeVisible();
  await page.getByRole('button', { name: /create script/i }).click();

  await expect(page).toHaveURL(/\/projects\/prj_foundation_demo\/scripts\/scr_/);
  await expect(page.getByRole('heading', { name: 'Playwright Script' })).toBeVisible();
  await expect(page.locator('[data-outline-create][data-node-type="act"]').first()).toBeVisible();

  await acceptPrompt(
    page,
    page.locator('[data-outline-create][data-node-type="act"]').first(),
    'Act I'
  );
  await acceptPrompt(
    page,
    page.locator('[data-outline-create][data-node-type="scene"]').first(),
    'Scene One'
  );
  await acceptPrompt(
    page,
    page.locator('[data-outline-create][data-node-type="scene"]').first(),
    'Scene Two'
  );

  await expect(page.getByText('Act I')).toBeVisible();
  await expect(page.getByText('Scene One')).toBeVisible();
  await expect(page.getByText('Scene Two')).toBeVisible();

  await page.locator('select[name="sceneNumberMode"]').selectOption('frozen');
  await page.locator('[data-scene-number-form]').getByRole('button', { name: /^save$/i }).click();
  await expect(page.locator('select[name="sceneNumberMode"]')).toHaveValue('frozen');

  const openEditorLink = page.getByRole('link', { name: /open editor/i });
  const editorHref = await openEditorLink.getAttribute('href');
  await page.goto(editorHref);
  await expect(page).toHaveURL(/\/editor(\?sceneId=scn_.*)?$/);
  await expect(page.getByRole('heading', { name: /screenplay editor/i })).toBeVisible();
});
