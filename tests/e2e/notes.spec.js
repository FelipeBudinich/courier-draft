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
