import { expect, test } from '@playwright/test';

const PROJECT_ID = 'prj_foundation_demo';
const SCRIPT_ID = 'scr_pilot_demo';
const SCENE_ID = 'scn_intro_demo';
const OWNER_NOTE_ID = 'nte_owner_demo';

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
  await expect(page.locator('[data-notes-panel]')).toBeVisible();
};

const openNote = async (page, noteId) => {
  await page.locator(`[data-note-open="${noteId}"]`).click();
  await expect(page.locator('[data-note-editor]')).toBeVisible();
};

const acceptConfirm = async (page, trigger) => {
  const dialogPromise = page.waitForEvent('dialog').then((dialog) => dialog.accept());
  await trigger.click();
  await dialogPromise;
};

test('two editors collaborate live on a note and reload into the persisted head text', async ({
  browser
}) => {
  const token = `NOTE-${Date.now()}`;

  const ownerPage = await browser.newPage();
  const editorPage = await browser.newPage();

  await openSceneEditor(ownerPage, 'owner@courier.test');
  await openSceneEditor(editorPage, 'editor@courier.test');

  await openNote(ownerPage, OWNER_NOTE_ID);
  await openNote(editorPage, OWNER_NOTE_ID);

  await ownerPage.locator('[data-note-editor]').fill(token);

  await expect(editorPage.locator('[data-note-editor]')).toHaveValue(token, {
    timeout: 10_000
  });
  await expect(ownerPage.locator('[data-note-detail-status]')).toContainText('Saved', {
    timeout: 10_000
  });

  await ownerPage.reload();
  await expect(ownerPage.locator('[data-editor-page]')).toBeVisible();
  await openNote(ownerPage, OWNER_NOTE_ID);
  await expect(ownerPage.locator('[data-note-editor]')).toHaveValue(token);

  await ownerPage.close();
  await editorPage.close();
});

test('owner can create, compare, and restore note versions from the notes panel', async ({ page }) => {
  const baselineToken = `NOTE-MAJOR-${Date.now()}`;
  const followupToken = `NOTE-DIFF-${Date.now()}`;

  await openSceneEditor(page, 'owner@courier.test');
  await openNote(page, OWNER_NOTE_ID);

  await page.locator('[data-note-editor]').fill(baselineToken);
  await expect(page.locator('[data-note-detail-status]')).toContainText('Saved', {
    timeout: 10_000
  });

  const noteMajorSaveResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/versions/major-save') &&
      response.request().method() === 'POST' &&
      response.status() === 201
  );
  await page.locator('[data-note-major-save]').click();
  const noteMajorSavePayload = await (await noteMajorSaveResponse).json();
  const noteVersionId = noteMajorSavePayload.data.version.id;
  await expect(page.locator('[data-note-version-restore]').first()).toBeVisible({
    timeout: 10_000
  });

  await page.locator('[data-note-editor]').fill(followupToken);

  const leftSelect = page.locator('[data-note-compare-form] select[name="left"]');
  await leftSelect.selectOption('currentHead');
  await leftSelect.selectOption(`version:${noteVersionId}`);

  await expect(page.locator('[data-note-diff-output] .bg-amber-200')).toContainText(
    followupToken,
    {
      timeout: 10_000
    }
  );
  await expect(page.locator('[data-note-diff-output] .line-through')).toContainText(
    baselineToken,
    {
      timeout: 10_000
    }
  );

  const noteRestoreResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/restore') &&
      response.request().method() === 'POST' &&
      response.status() === 200
  );
  await acceptConfirm(
    page,
    page.locator(`[data-note-version-restore="${noteVersionId}"]`)
  );
  await noteRestoreResponse;
  await expect(page.locator('[data-note-editor]')).toHaveValue(baselineToken, {
    timeout: 10_000
  });
  await expect(page.locator('[data-note-version-list]')).toContainText('restore', {
    timeout: 10_000
  });
});
