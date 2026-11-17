import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

test('account navigation dismisses on focus exit and remains reachable on short screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 400 });
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {UserMenu} from './src/components/navigation/UserMenu';
    createRoot(document.getElementById('root')).render(<>
      <UserMenu isAuthenticated displayName="Researcher" email="dummy_mail"/>
      <button id="after">After account navigation</button>
    </>);
  ` }, bundle: true, write: false, format: 'iife' });
  await page.route('http://account.test/**', route => route.fulfill({
    contentType: route.request().url().includes('/api/') ? 'application/json' : 'text/html',
    body: route.request().url().includes('/api/') ? '{"canManageWorkspaceAccess":true}' : '<div id="root"></div>',
  }));
  await page.goto('http://account.test/');
  for (const file of ['tokens.css', 'user-menu.css']) {
    await page.addStyleTag({ content: await readFile(`src/styles/${file}`, 'utf8') });
  }
  await page.addStyleTag({ content: '.user-menu-wrapper{display:flex;justify-content:flex-end}' });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const trigger = page.getByRole('button', { name: 'Account menu for Researcher' });
  const nav = page.getByRole('navigation', { name: 'Account', exact: true });
  await trigger.click();
  await expect(nav.getByRole('link', { name: 'Workspace access' })).toBeVisible();
  await trigger.press('Tab');
  await expect(nav.getByRole('link', { name: 'Sync Obsidian Vault' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(nav).toHaveCount(0);
  await trigger.click();
  const signOut = nav.getByRole('link', { name: 'Sign Out' });
  await signOut.focus();
  await expect(signOut).toBeInViewport();
  expect(await nav.evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(400);
  await signOut.press('Tab');
  await expect(page.locator('#after')).toBeFocused();
  await expect(nav).toHaveCount(0);
});
