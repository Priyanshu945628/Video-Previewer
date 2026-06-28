/**
 * Share-link viewer — happy path + the most important sad paths.
 *
 * We seed the API in beforeAll with a fresh share link rather than
 * driving the editor UI, because we want the share-link contract
 * itself under test, not the click-path that produced it.
 */
import { test, expect, request } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:4000';

test.describe('share link viewer', () => {
  let slug: string;
  let url: string;

  test.beforeAll(async () => {
    // Sign in editor + create a share link via the API.
    const api = await request.newContext({ baseURL: API });
    const login = await api.post('/auth/login', {
      data: { email: 'editor@vsp.local', password: 'EditorPass!42' },
    });
    expect(login.ok()).toBeTruthy();

    const r = await api.post('/share-links', {
      data: {
        projectId: '00000000-0000-0000-0000-000000000001',
        password: 'open-sesame-9000',
        expiry: '24h',
        allowComments: true,
        allowDownload: false,
        requireEmail: false,
      },
    });
    const link = (await r.json()).data as { publicSlug: string; url: string };
    slug = link.publicSlug;
    url = link.url;
  });

  test('renders the gate with a password prompt', async ({ page }) => {
    await page.goto(`/share/${slug}`);
    await expect(page.getByRole('heading', { name: /open this review/i })).toBeVisible();
  });

  test('rejects a wrong password', async ({ page }) => {
    await page.goto(`/share/${slug}`);
    await page.getByRole('button', { name: /open review/i }).click();
    await page.getByLabel(/password/i).fill('not-the-right-one');
    await page.getByRole('button', { name: /open review/i }).click();
    await expect(page.getByText(/wrong password/i)).toBeVisible();
  });

  test('unlocks with the right password and shows the player', async ({ page }) => {
    await page.goto(`/share/${slug}`);
    await page.getByRole('button', { name: /open review/i }).click();
    await page.getByLabel(/password/i).fill('open-sesame-9000');
    await page.getByRole('button', { name: /open review/i }).click();
    await expect(page.locator('video')).toBeVisible({ timeout: 15_000 });
  });
});
