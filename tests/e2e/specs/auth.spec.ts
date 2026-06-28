import { test, expect } from '@playwright/test';

test.describe('auth', () => {
  test('shows the welcome screen on /login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test('rejects invalid credentials with a friendly message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('nobody@example.com');
    await page.getByLabel(/password/i).fill('wrong-but-long-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert')).toContainText(/incorrect/i);
  });

  test('redirects unauthenticated users from /', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});
