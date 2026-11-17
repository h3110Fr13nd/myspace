import { test, expect } from '@playwright/test';

test('blocked reading-status storage keeps state and permits retry', async ({ page }) => {
  await page.goto('/?doc=document:public_hello');
  await page.getByRole('button', { name: 'Mark as Read', exact: true }).click();
  const read = page.getByRole('button', { name: 'Mark as Unread', exact: true });
  await expect(read).toBeVisible();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).restoreReadingStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('foss_read_resources_')) throw new Error('Storage blocked');
      return original.call(this, key, value);
    };
  });
  await read.click();
  await expect(read).toBeVisible();
  await expect(page.getByText('Could not save reading status on this device. Please try again.', { exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).restoreReadingStorage());
  await read.click();
  await expect(page.getByRole('button', { name: 'Mark as Read', exact: true })).toBeVisible();
});

test('reader mode exposes its state when entering and leaving', async ({ page }) => {
  await page.goto('/?doc=document:public_hello');
  const toggle = page.getByRole('button', { name: 'Toggle reader mode', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('body')).toHaveClass(/reader-mode-active/);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('body')).not.toHaveClass(/reader-mode-active/);
});

test('reader properties have one disclosure and stack at mobile width', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?doc=document:public_hello');
  const toggle = page.getByRole('button', { name: 'Properties', exact: true });
  const panel = page.getByRole('region', { name: 'Note properties', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toBeVisible();
  await expect(panel.locator('summary')).toHaveCount(0);
  const row = panel.locator('.property-row').first();
  await expect(row).toBeVisible();
  const layout = await row.evaluate(element => {
    const key = element.querySelector('.property-key')!.getBoundingClientRect();
    const value = element.querySelector('.property-value')!.getBoundingClientRect();
    return { stacked: value.top >= key.bottom, width: element.getBoundingClientRect().width, viewport: innerWidth };
  });
  expect(layout.stacked).toBe(true);
  expect(layout.width).toBeLessThanOrEqual(layout.viewport);
  await page.screenshot({ path: testInfo.outputPath('reader-properties-390.png'), fullPage: true });
  await toggle.click();
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
