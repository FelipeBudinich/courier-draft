import { test, expect } from '@playwright/test';
import { resetE2EState } from './helpers.js';

const loginAs = async (page, email) => {
  await page.goto('/login');
  await page.selectOption('select[name="email"]', email);
  await page.getByRole('button', { name: /enter the app/i }).click();
};

test.beforeEach(async ({ request }) => {
  await resetE2EState(request);
});

test('owner can create a project from the dashboard', async ({ page }) => {
  await loginAs(page, 'owner@courier.test');

  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole('link', { name: /new project/i }).click();
  await expect(page).toHaveURL(/\/projects\/new$/);

  await expect(page.locator('[data-project-create-ready="true"]')).toBeVisible();
  const createProjectResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/projects') &&
      response.request().method() === 'POST' &&
      response.status() === 201
  );
  await page.getByRole('button', { name: /create project/i }).click();
  await createProjectResponse;

  await expect(page).toHaveURL(/\/projects\/prj_/);
  await expect(page.getByRole('heading', { name: 'Odyssey' })).toBeVisible();
});

test('pending invitee can accept an invite and see the project on the dashboard', async ({
  page
}) => {
  await loginAs(page, 'pending@courier.test');

  await expect(page).toHaveURL(/\/app$/);
  const invitesSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: /invites/i })
  });
  await expect(invitesSection.getByText('Courier Pilot')).toBeVisible();
  const acceptInviteResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/accept') &&
      response.request().method() === 'POST' &&
      response.status() === 200
  );
  await page.getByRole('button', { name: /accept invite/i }).click();
  await acceptInviteResponse;
  await page.waitForLoadState('networkidle');
  await page.reload();

  await expect(page.locator('a[href="/projects/prj_foundation_demo"]')).toBeVisible();
});

test('onboarding redirects to profile settings and lands on the starter project after username claim', async ({
  page
}) => {
  await loginAs(page, 'onboard@courier.test');

  await expect(page).toHaveURL(/\/settings\/profile\?onboarding=1$/);
  await page.getByLabel('Username').fill('playwright_onboard');
  await page.getByRole('button', { name: /^save$/i }).click();

  await expect(page).toHaveURL(/\/projects\/prj_/);
  await expect(page.getByRole('heading', { name: 'Iliad' })).toBeVisible();
});
