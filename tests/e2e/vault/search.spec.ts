import { test, expect, type Page } from '@playwright/test';

/**
 * The workspace renders TWO copies of the search box and of the account menu: one
 * in the top bar, one in the sidebar/floating rail. Both stay in the DOM at all
 * times and CSS picks the active one from `data-chrome`, so switching chrome
 * modes is instant and no control is ever remounted.
 *
 * Verified in a real browser (authenticated, all three modes): exactly one copy is
 * ever laid out, and the other is `display:none` via an ancestor — so it is out of
 * the tab order and out of the accessibility tree. A keyboard or screen-reader
 * user meets each control once. The duplication is therefore a *test* concern, and
 * `:visible` picks the active copy in any mode, where naming a surface
 * (`.top-bar` / `.sidebar-search`) would hardcode one mode and break the moment the
 * preference changed.
 */
const searchInput = (page: Page) => page.locator('[data-testid="search-input"]:visible');

test('a delayed old search cannot replace the current query results', async ({ page }) => {
  let releaseOld!: () => void;
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  let oldStarted!: () => void;
  const started = new Promise<void>((resolve) => { oldStarted = resolve; });
  let oldFinished!: () => void;
  const finished = new Promise<void>((resolve) => { oldFinished = resolve; });
  const result = (title: string) => ({ results: [{
    id: `document:${title}`, type: 'document', title, path: '',
    url: '/', category: 'Note', summary: '', tags: [],
  }] });
  await page.route('**/api/v1/search?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === 'older query') {
      oldStarted();
      await oldGate;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(result(query === 'older query' ? 'Old result' : 'Current result')),
    }).catch(() => {}); // The old browser request is intentionally aborted.
    if (query === 'older query') oldFinished();
  });
  await page.goto('/login');
  await expect(searchInput(page)).toHaveAttribute('data-search-ready', 'true');
  await searchInput(page).fill('older query');
  await started;
  await searchInput(page).fill('current query');
  await expect(page.getByTestId('search-result')).toHaveText(/Current result/);
  releaseOld();
  await finished;
  await expect(searchInput(page)).toHaveValue('current query');
  await expect(page.getByTestId('search-result')).toHaveText(/Current result/);
  await expect(page.getByText('Old result', { exact: true })).toHaveCount(0);
});

test('failed search can be retried without retyping the query', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/v1/search?*', async (route) => {
    attempts++;
    await route.fulfill({
      status: attempts === 1 ? 503 : 200,
      contentType: 'application/json',
      body: JSON.stringify(attempts === 1 ? { error: 'Unavailable' } : { results: [] }),
    });
  });
  await page.goto('/login');
  await expect(searchInput(page)).toHaveAttribute('data-search-ready', 'true');
  await searchInput(page).fill('retry search');
  await expect(page.getByText('Search is unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('No matches', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('No matches', { exact: true })).toBeVisible();
  await expect(searchInput(page)).toHaveValue('retry search');
  expect(attempts).toBe(2);
});

async function searchFor(page: Page, query: string): Promise<void> {
  const input = searchInput(page);
  await expect(input).toHaveAttribute('data-search-ready', 'true');
  const response = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return url.pathname === '/api/v1/search' && url.searchParams.get('q') === query;
  });
  // `fill` focuses and types as one browser action, avoiding a separate click
  // racing React's focus handler while the idle island hydrates in dev.
  await input.fill(query);
  await response;
}

test('Escape closes search and Enter cannot open its hidden result', async ({ page }) => {
  await page.route('**/api/v1/search?*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ results: [{
      id: 'document:keyboard-result', type: 'document', title: 'Keyboard result',
      url: '/?doc=document%3Akeyboard-result', path: '', category: 'Note', summary: '', tags: [],
    }] }),
  }));
  await page.goto('/login');
  await expect(searchInput(page)).toHaveAttribute('data-search-ready', 'true');
  await searchInput(page).fill('keyboard result');
  await expect(page.getByTestId('search-result')).toBeVisible();
  await searchInput(page).press('Escape');
  await expect(page.getByTestId('search-result')).toHaveCount(0);
  await searchInput(page).press('Enter');
  await expect(page).toHaveURL(/\/login$/);
  await expect(searchInput(page)).toHaveAttribute('aria-expanded', 'false');
  await searchInput(page).press('ArrowDown');
  await expect(page.getByTestId('search-result')).toBeVisible();
});

/**
 * Press Ctrl+K until the visible input takes focus.
 *
 * The shortcut is bound by the visible search island after hydration. The
 * readiness attribute ensures this test only presses it after the listener is
 * attached; the retry still covers the focus timer and keeps the assertion
 * independent of browser scheduling.
 *
 * Retrying the press rather than sleeping a fixed time keeps the fast path fast
 * and makes the test independent of browser scheduling. The press is idempotent.
 */
async function pressSearchShortcutUntilFocused(page: Page): Promise<void> {
  await expect(searchInput(page)).toHaveAttribute('data-search-ready', 'true');
  await expect(async () => {
    await page.keyboard.press('Control+k');
    await expect(searchInput(page)).toBeFocused({ timeout: 250 });
  }).toPass({ timeout: 10_000 });
}

test.describe('Search Modal', () => {
  test('search API returns the seeded public document', async ({ request }) => {
    const response = await request.get('/api/v1/search?q=Hello');
    expect(response.ok()).toBeTruthy();
    const payload = await response.json();
    expect(payload.results.some((item: { id: string }) => item.id === 'document:public_hello')).toBeTruthy();
  });

  test('Ctrl+K opens search modal', async ({ page }) => {
    await page.goto('/');
    await pressSearchShortcutUntilFocused(page);
  });

  test('Ctrl+K focuses the visible search after switching chrome modes', async ({ page }) => {
    await page.goto('/');
    await expect(searchInput(page)).toHaveAttribute('data-search-ready', 'true');
    await page.evaluate(() => document.documentElement.setAttribute('data-chrome', 'header'));
    await expect(searchInput(page)).toHaveAttribute('data-search-ready', 'true');
    await page.evaluate(() => document.documentElement.setAttribute('data-chrome', 'rail'));
    await pressSearchShortcutUntilFocused(page);
  });

  test('typing in search returns results from Meilisearch', async ({ page }) => {
    await page.goto('/');

    await searchFor(page, 'Hello');

    // At least one result should appear for "Hello World" (seeded public resource)
    const results = page.locator('[data-testid="search-result"]');
    await expect(results.first()).toBeVisible({ timeout: 5_000 });
  });

  test('clicking a search result navigates to the document', async ({ page }) => {
    await page.goto('/');

    await searchFor(page, 'Hello');

    const firstResult = page.locator('[data-testid="search-result"]').first();
    await expect(firstResult).toBeVisible({ timeout: 5_000 });

    const resourceId = await firstResult.getAttribute('data-resource-id');
    await firstResult.click();

    // Should navigate to /?doc=<resourceId>
    await expect(page).toHaveURL(new RegExp(`doc=${encodeURIComponent(resourceId ?? '')}`));
  });

  test('Escape key closes search modal', async ({ page }) => {
    await page.goto('/');
    await pressSearchShortcutUntilFocused(page);

    await page.keyboard.press('Escape');
    // Modal should close — input may lose focus
    await expect(page.locator('[data-testid="search-result"]')).not.toBeVisible();
  });

  test('query with no results shows empty state', async ({ page }) => {
    await page.goto('/');
    await searchFor(page, 'xyzqrstuvwxyz_no_match_ever');

    // Results list should be empty or show a no-results message
    const results = page.locator('[data-testid="search-result"]');
    const count = await results.count();
    expect(count).toBe(0);
  });
});
