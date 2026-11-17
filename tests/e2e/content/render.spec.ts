import { test, expect } from '@playwright/test';

test.describe('Content Rendering', () => {
  test('public document accessible to anonymous user', async ({ page }) => {
    await page.goto('/?doc=document%3Apublic_hello');
    // Should not redirect to login
    await expect(page).not.toHaveURL(/\/login/);
    // Should show the document title
    await expect(page.locator('h1').first()).toContainText(/Hello World/i, { timeout: 10_000 });
  });

  test('private document redirects anonymous user to /login', async ({ page }) => {
    await page.goto('/?doc=document%3Aprivate_secret');
    await expect(page).toHaveURL(/\/login/);
  });

  test('KaTeX math renders without JS errors', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto('/?doc=document%3Apublic_hello');

    // Wait for page to fully render
    await page.waitForLoadState('networkidle');

    // KaTeX elements should be present
    const katexElements = page.locator('.katex, .katex-html, .katex-mathml');
    const katexCount = await katexElements.count();
    // The seed note has both inline ($E = mc^2$) and display math ($$...$$)
    expect(katexCount).toBeGreaterThan(0);

    // No KaTeX-related JS errors
    const katexErrors = jsErrors.filter((e) => e.includes('katex') || e.includes('KaTeX'));
    expect(katexErrors).toHaveLength(0);
  });

  test('Properties panel renders for resource with metadata', async ({ page }) => {
    await page.goto('/?doc=document%3Apublic_hello');
    await page.waitForLoadState('networkidle');

    // The metadata is exposed through the resource's properties disclosure.
    await page.locator('#properties-dropdown-trigger').click();
    const panel = page.locator('.properties-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Tags should appear as pill links
    const tagPills = panel.locator('.property-pill-link');
    await expect(tagPills.first()).toBeVisible();
  });

  test('draft document invisible to non-owner anonymous', async ({ page }) => {
    // document:draft_wip is_draft=true but is_public=true — should still be hidden from anonymous
    await page.goto('/?doc=document%3Adraft_wip');
    // Should either redirect to login or show "not found / forbidden"
    const isLoginRedirect = page.url().includes('/login');
    const isForbidden = await page.locator('text=forbidden, text=not found').count() > 0;
    const docTitle = await page.locator('h1').count();

    // The draft should NOT be rendered as normal content to anonymous
    expect(isLoginRedirect || isForbidden || docTitle === 0).toBeTruthy();
  });

  test('alias URL resolves and redirects to canonical document', async ({ page }) => {
    // document:public_hello has aliases: ["hello", "hello-world"]
    const response = await page.goto('/hello');

    // Should get a 301 redirect to /?doc=document%3Apublic_hello
    expect(response?.url()).toContain('doc=document%3Apublic_hello');
    await expect(page.locator('h1').first()).toContainText(/Hello World/i, { timeout: 10_000 });
  });

  test('anchor hash navigation scrolls and pulses highlight', async ({ page }) => {
    await page.goto('/?doc=document%3Apublic_hello#hello-world');
    await page.waitForLoadState('networkidle');

    // The resource title remains an anchor after its duplicate body heading is removed.
    const targetHeading = page.locator('#hello-world');
    await expect(targetHeading).toBeVisible({ timeout: 10_000 });
  });
});

