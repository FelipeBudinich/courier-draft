import { expect, test } from '@playwright/test';

const PROJECT_ID = 'prj_foundation_demo';
const SCRIPT_ID = 'scr_pilot_demo';
const SCENE_ID = 'scn_intro_demo';
const modUndo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

const sceneEditorUrl = `/projects/${PROJECT_ID}/scripts/${SCRIPT_ID}/editor?sceneId=${SCENE_ID}`;

const loginAs = async (page, email) => {
  await page.goto('/login');
  await page.selectOption('select[name="email"]', email);
  await page.getByRole('button', { name: /enter the app/i }).click();
};

const openSceneEditor = async (page, email) => {
  await loginAs(page, email);
  await page.goto(sceneEditorUrl);
  await expect(page.locator('[data-editor-page]')).toBeVisible();
  await expect(page.locator('.ProseMirror')).toBeVisible();
};

const appendActionLine = async (page, text) => {
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await editor.press('End');
  await editor.press('Enter');
  await page.keyboard.insertText(text);
};

const acceptConfirm = async (page, trigger) => {
  const dialogPromise = page.waitForEvent('dialog').then((dialog) => dialog.accept());
  await trigger.click();
  await dialogPromise;
};

test('two editors collaborate live, show presence, and reload into persisted scene content', async ({
  browser
}) => {
  const ownerToken = `OWNER-${Date.now()}`;
  const editorToken = `EDITOR-${Date.now()}`;

  const ownerPage = await browser.newPage();
  const editorPage = await browser.newPage();

  await openSceneEditor(ownerPage, 'owner@courier.test');
  await expect(ownerPage.locator('[data-script-connection-state]')).toHaveAttribute(
    'data-connection-state',
    'connected'
  );

  await openSceneEditor(editorPage, 'editor@courier.test');
  await expect(editorPage.locator('[data-script-connection-state]')).toHaveAttribute(
    'data-connection-state',
    'connected'
  );

  await expect(ownerPage.locator('[data-collaborator-summary]')).toBeVisible();
  await expect(editorPage.locator('[data-collaborator-summary]')).toBeVisible();

  await appendActionLine(ownerPage, ownerToken);
  await expect(ownerPage.locator('[data-save-state-badge]')).toHaveText(
    'Unsaved collaborative changes'
  );
  await expect(editorPage.locator('.ProseMirror')).toContainText(ownerToken);

  await appendActionLine(editorPage, editorToken);
  await expect(ownerPage.locator('.ProseMirror')).toContainText(editorToken);

  await expect(ownerPage.locator('[data-save-state-badge]')).toHaveText('Persisted', {
    timeout: 10_000
  });

  await ownerPage.reload();
  await expect(ownerPage).toHaveURL(sceneEditorUrl);
  await expect(ownerPage.locator('.ProseMirror')).toContainText(ownerToken);
  await expect(ownerPage.locator('.ProseMirror')).toContainText(editorToken);

  await ownerPage.close();
  await editorPage.close();
});

test('reviewer sees live scene updates but stays read-only', async ({ browser }) => {
  const reviewToken = `REVIEW-${Date.now()}`;

  const ownerPage = await browser.newPage();
  const reviewerPage = await browser.newPage();

  await openSceneEditor(ownerPage, 'owner@courier.test');
  await openSceneEditor(reviewerPage, 'reviewer@courier.test');

  await expect(reviewerPage.locator('[data-read-only-badge]')).toBeVisible();
  await expect(reviewerPage.locator('[data-block-type-select]')).toBeDisabled();
  await expect(reviewerPage.locator('[data-scene-major-save]')).toHaveCount(0);
  await expect(reviewerPage.locator('[data-scene-version-restore]')).toHaveCount(0);
  await expect(reviewerPage.locator('.ProseMirror')).toHaveAttribute(
    'contenteditable',
    'false'
  );
  await appendActionLine(ownerPage, reviewToken);
  await expect(reviewerPage.locator('.ProseMirror')).toContainText(reviewToken);

  await ownerPage.close();
  await reviewerPage.close();
});

test('collaborative undo only removes the local user change', async ({ browser }) => {
  const ownerToken = `UNDO-OWNER-${Date.now()}`;
  const editorToken = `UNDO-EDITOR-${Date.now()}`;

  const ownerPage = await browser.newPage();
  const editorPage = await browser.newPage();

  await openSceneEditor(ownerPage, 'owner@courier.test');
  await openSceneEditor(editorPage, 'editor@courier.test');

  await appendActionLine(ownerPage, ownerToken);
  await expect(editorPage.locator('.ProseMirror')).toContainText(ownerToken);

  await appendActionLine(editorPage, editorToken);
  await expect(ownerPage.locator('.ProseMirror')).toContainText(editorToken);

  await ownerPage.locator('.ProseMirror').click();
  await ownerPage.keyboard.press(modUndo);

  await expect(ownerPage.locator('.ProseMirror')).not.toContainText(ownerToken, {
    timeout: 10_000
  });
  await expect(editorPage.locator('.ProseMirror')).not.toContainText(ownerToken, {
    timeout: 10_000
  });
  await expect(ownerPage.locator('.ProseMirror')).toContainText(editorToken);
  await expect(editorPage.locator('.ProseMirror')).toContainText(editorToken);

  await ownerPage.close();
  await editorPage.close();
});

test('scene restore keeps collaborators converged from the version sidebar', async ({
  browser
}) => {
  const baselineToken = `SCENE-MAJOR-${Date.now()}`;
  const liveToken = `SCENE-RESTORE-${Date.now()}`;

  const ownerPage = await browser.newPage();
  const editorPage = await browser.newPage();

  await openSceneEditor(ownerPage, 'owner@courier.test');
  await openSceneEditor(editorPage, 'editor@courier.test');

  await appendActionLine(ownerPage, baselineToken);
  await expect(editorPage.locator('.ProseMirror')).toContainText(baselineToken, {
    timeout: 10_000
  });

  const sceneMajorSaveResponse = ownerPage.waitForResponse(
    (response) =>
      response.url().includes('/versions/major-save') &&
      response.request().method() === 'POST' &&
      response.status() === 201
  );
  await ownerPage.locator('[data-scene-major-save]').click();
  const sceneMajorSavePayload = await (await sceneMajorSaveResponse).json();
  const sceneVersionId = sceneMajorSavePayload.data.version.id;

  await appendActionLine(ownerPage, liveToken);
  await expect(editorPage.locator('.ProseMirror')).toContainText(liveToken, {
    timeout: 10_000
  });

  const sceneRestoreResponse = ownerPage.waitForResponse(
    (response) =>
      response.url().includes('/restore') &&
      response.request().method() === 'POST' &&
      response.status() === 200
  );
  await acceptConfirm(
    ownerPage,
    ownerPage.locator(`[data-scene-version-restore="${sceneVersionId}"]`)
  );
  await sceneRestoreResponse;

  await ownerPage.reload();
  await editorPage.reload();
  await expect(ownerPage.locator('.ProseMirror')).toBeVisible();
  await expect(editorPage.locator('.ProseMirror')).toBeVisible();
  await expect(ownerPage.locator('.ProseMirror')).not.toContainText(liveToken, {
    timeout: 10_000
  });
  await expect(editorPage.locator('.ProseMirror')).not.toContainText(liveToken, {
    timeout: 10_000
  });
  await expect(ownerPage.locator('[data-scene-version-list]')).toContainText('RESTORE', {
    timeout: 10_000
  });

  await ownerPage.close();
  await editorPage.close();
});
