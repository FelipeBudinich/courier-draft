import { expect, test } from '@playwright/test';

const loginAs = async (page, email) => {
  await page.goto('/login');
  await page.selectOption('select[name="email"]', email);
  await page.getByRole('button', { name: /enter the app/i }).click();
};

const acceptPrompt = async (page, trigger, promptText) => {
  const dialogPromise = page
    .waitForEvent('dialog')
    .then((dialog) => dialog.accept(promptText));
  await trigger.click();
  await dialogPromise;
};

test('owner can edit a scene draft and reviewer stays read-only', async ({ browser }) => {
  const ownerPage = await browser.newPage();
  await loginAs(ownerPage, 'owner@courier.test');

  await ownerPage.goto('/projects/prj_foundation_demo');
  await ownerPage.getByRole('link', { name: /create script/i }).click();
  await ownerPage.getByLabel('Title').fill('Editor Review Script');
  await ownerPage.getByRole('button', { name: /create script/i }).click();

  const rootOutlineControls = ownerPage.locator('[data-outline-root] > div').first();
  await acceptPrompt(
    ownerPage,
    rootOutlineControls.getByRole('button', { name: /add scene/i }),
    'Review Scene'
  );
  await expect(ownerPage.getByText('Review Scene')).toBeVisible();

  await ownerPage.getByRole('link', { name: /open editor/i }).click();
  await expect(ownerPage).toHaveURL(/\/editor(\?sceneId=scn_.*)?$/);
  await expect(ownerPage.locator('[data-editor-page]')).toBeVisible();

  await ownerPage.selectOption('[data-block-type-select]', 'slugline');
  const editor = ownerPage.locator('.ProseMirror');
  await editor.click();
  await editor.pressSequentially('INT. KITCHEN - DAY');
  await editor.press('Enter');
  await editor.pressSequentially('Maria waits at the sink.');

  await expect(ownerPage.locator('[data-save-state-badge]')).toHaveText(
    /Unsaved changes|Saving…/
  );

  const saveResponsePromise = ownerPage.waitForResponse(
    (response) =>
      response.url().includes('/head') &&
      response.request().method() === 'PUT' &&
      response.status() === 200
  );
  await ownerPage.locator('[data-save-now]').click();

  await saveResponsePromise;
  await expect(ownerPage.locator('[data-save-state-badge]')).toHaveText('Saved');

  const sceneUrl = ownerPage.url();
  await ownerPage.reload();
  await expect(ownerPage).toHaveURL(sceneUrl);
  await expect(ownerPage.locator('.ProseMirror')).toContainText('INT. KITCHEN - DAY');
  await expect(ownerPage.locator('.ProseMirror')).toContainText('Maria waits at the sink.');

  const reviewerPage = await browser.newPage();
  await loginAs(reviewerPage, 'reviewer@courier.test');
  await reviewerPage.goto(sceneUrl);

  await expect(reviewerPage.locator('[data-read-only-badge]')).toBeVisible();
  await expect(reviewerPage.locator('[data-block-type-select]')).toBeDisabled();
  await expect(reviewerPage.locator('[data-save-now]')).toBeDisabled();
  await expect(reviewerPage.locator('.ProseMirror')).toHaveAttribute(
    'contenteditable',
    'false'
  );
});

test('switching scenes flushes dirty state before loading the next scene', async ({ page }) => {
  await loginAs(page, 'owner@courier.test');

  await page.goto('/projects/prj_foundation_demo');
  await page.getByRole('link', { name: /create script/i }).click();
  await page.getByLabel('Title').fill('Editor Switch Script');
  await page.getByRole('button', { name: /create script/i }).click();

  const rootOutlineControls = page.locator('[data-outline-root] > div').first();
  await acceptPrompt(
    page,
    rootOutlineControls.getByRole('button', { name: /add scene/i }),
    'Scene One'
  );
  await acceptPrompt(
    page,
    rootOutlineControls.getByRole('button', { name: /add scene/i }),
    'Scene Two'
  );

  await page.getByRole('link', { name: /open editor/i }).click();
  await expect(page.locator('[data-editor-page]')).toBeVisible();

  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.insertText('Draft before switch');
  await expect(page.locator('[data-save-state-badge]')).toHaveText(
    'Unsaved changes'
  );

  const saveRequestPromise = page.waitForRequest(
    (request) =>
      request.url().includes('/head') &&
      request.method() === 'PUT' &&
      request.postData()?.includes('Draft before switch')
  );

  await page.locator('[data-scene-link]').filter({ hasText: 'Scene Two' }).click();
  await saveRequestPromise;
  await expect(page).toHaveURL(/sceneId=scn_/);
  await expect(page.locator('[data-scene-title]')).toContainText('Scene Two');

  await page.locator('[data-scene-link]').filter({ hasText: 'Scene One' }).click();
  await expect(page.locator('.ProseMirror')).toContainText('Draft before switch');
});
