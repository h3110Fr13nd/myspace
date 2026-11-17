import { test, expect } from '@playwright/test';

test.describe('Tag pages', () => {
  test('shows resources with an exact public tag', async ({ page }) => {
    let graphApiRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/workspace/graph')) graphApiRequests += 1;
    });

    await page.goto('/tags/test');

    await expect(page.locator('[data-testid="tag-index-title"]')).toContainText('#test');
    await expect(page.locator('.prose-content a', { hasText: 'Hello World' })).toBeVisible();
    await expect(page.locator('.prose-content')).not.toContainText('Private Note');
    await expect(page.locator('aside.sidebar-right canvas, aside.sidebar-right svg').first())
      .toBeVisible({ timeout: 15_000 });
    expect(graphApiRequests).toBe(0);
  });

  test('does not treat a partial tag as a match', async ({ page }) => {
    await page.goto('/tags/tes');

    await expect(page.locator('[data-testid="tag-index-title"]')).toContainText('#tes');
    await expect(page.locator('.prose-content a')).toHaveCount(0);
  });
});
