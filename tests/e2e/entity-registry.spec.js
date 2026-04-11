import { expect, test } from '@playwright/test';

const PROJECT_ID = 'prj_foundation_demo';
const SCRIPT_ID = 'scr_pilot_demo';
const SCENE_ID = 'scn_intro_demo';

const loginAs = async (page, email) => {
  await page.goto('/login');
  await page.selectOption('select[name="email"]', email);
  await page.getByRole('button', { name: /enter the app/i }).click();
};

const openSceneEditor = async (page, email) => {
  await loginAs(page, email);
  await page.goto(`/projects/${PROJECT_ID}/scripts/${SCRIPT_ID}/editor?sceneId=${SCENE_ID}`);
  await expect(page.locator('[data-editor-page]')).toBeVisible();
  await expect(page.locator('.ProseMirror')).toBeVisible();
};

const appendEntitySceneContent = async ({ page, slugline, character, dialogue }) => {
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await editor.press('End');
  await editor.press('Enter');
  await page.locator('[data-block-type-select]').selectOption('slugline');
  await page.keyboard.insertText(slugline);
  await editor.press('Enter');
  await page.locator('[data-block-type-select]').selectOption('character');
  await page.keyboard.insertText(character);
  await editor.press('Enter');

  const dialogueLines = String(dialogue).split('\n');
  await page.keyboard.insertText(dialogueLines[0] ?? '');

  for (const line of dialogueLines.slice(1)) {
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.insertText(line);
  }
};

test('saving editor content creates latest-draft character and location metrics on the SSR pages', async ({
  page
}) => {
  const token = `MILES-${Date.now()}`;

  await openSceneEditor(page, 'owner@courier.test');
  await appendEntitySceneContent({
    page,
    slugline: 'INT. TEST KITCHEN - DAY',
    character: token,
    dialogue: 'One line.\nTwo lines.'
  });
  await expect(page.locator('[data-save-state-badge]')).toHaveText('Persisted', {
    timeout: 10_000
  });

  await page.goto(`/projects/${PROJECT_ID}/characters`);
  await expect(page.locator('[data-entity-registry-page]')).toBeVisible();
  await expect(page.getByText(token)).toBeVisible();
  await expect(page.getByText(/1 blocks · 2 lines/i)).toBeVisible();

  await page.goto(`/projects/${PROJECT_ID}/locations`);
  await expect(page.locator('[data-entity-registry-page]')).toBeVisible();
  await expect(page.getByText('TEST KITCHEN')).toBeVisible();
});

test('registry-backed autocomplete matches aliases from the editor context', async ({
  page
}) => {
  const autocompleteSceneTitle = `INT. AUTOCOMPLETE ${Date.now()} - DAY`;

  await loginAs(page, 'owner@courier.test');
  await page.goto(`/projects/${PROJECT_ID}/characters`);

  await page.locator('[data-entity-create-form] input[name="canonicalName"]').fill('MICHAEL');
  await page.locator('[data-entity-create-form] input[name="aliases"]').fill('MIKE');
  const createEntityResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/projects/${PROJECT_ID}/entities`) &&
      response.request().method() === 'POST' &&
      response.status() === 201
  );
  await page.locator('[data-entity-create-form]').getByRole('button', { name: /create/i }).click();
  await createEntityResponse;
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-entity-registry-page]')).toBeVisible();

  const autocompleteSceneId = await page.evaluate(
    async ({ projectId, scriptId, title }) => {
      const createResponse = await window.csrfFetch(
        `/api/v1/projects/${projectId}/scripts/${scriptId}/outline/nodes`,
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'scene',
            title
          })
        }
      );
      const createPayload = await createResponse.json();

      if (!createResponse.ok || !createPayload?.ok) {
        throw new Error('Scene creation failed.');
      }

      const outlineResponse = await fetch(
        `/api/v1/projects/${projectId}/scripts/${scriptId}/outline`,
        {
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json'
          }
        }
      );
      const outlinePayload = await outlineResponse.json();

      if (!outlineResponse.ok || !outlinePayload?.ok) {
        throw new Error('Outline reload failed.');
      }

      return (
        outlinePayload.data.outline.find((node) => node.id === createPayload.data.nodeId)
          ?.sceneId ?? null
      );
    },
    {
      projectId: PROJECT_ID,
      scriptId: SCRIPT_ID,
      title: autocompleteSceneTitle
    }
  );

  expect(autocompleteSceneId).toBeTruthy();

  await page.goto(
    `/projects/${PROJECT_ID}/scripts/${SCRIPT_ID}/editor?sceneId=${autocompleteSceneId}`
  );
  const editor = page.locator('.ProseMirror');
  const suggestions = await page.evaluate(async ({ projectId }) => {
    const response = await fetch(
      `/api/v1/projects/${projectId}/entities?type=character&q=MI&autocomplete=true`,
      {
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json'
        }
      }
    );
    const payload = await response.json();

    if (!response.ok || !payload?.ok) {
      throw new Error('Autocomplete request failed.');
    }

    return payload.data.entities ?? [];
  }, { projectId: PROJECT_ID });

  expect(suggestions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        canonicalName: 'MICHAEL',
        aliases: expect.arrayContaining([
          expect.objectContaining({
            display: 'MIKE'
          })
        ])
      })
    ])
  );

  await editor.click();
  await page.keyboard.insertText('MI');
  await expect(editor).toContainText('MI');
});

test('reviewers can view registry pages but do not get mutation controls', async ({ page }) => {
  await loginAs(page, 'reviewer@courier.test');
  await page.goto(`/projects/${PROJECT_ID}/characters`);

  await expect(page.locator('[data-entity-registry-page]')).toBeVisible();
  await expect(page.locator('[data-entity-create-form]')).toHaveCount(0);
  await expect(page.locator('[data-entity-update-form]')).toHaveCount(0);
  await expect(page.locator('[data-entity-merge-form]')).toHaveCount(0);
});
