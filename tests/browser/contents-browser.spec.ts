import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

test('contents navigation updates location and respects reduced motion', async ({ page }) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {TableOfContents} from './src/components/TableOfContents';
    createRoot(document.getElementById('contents')).render(<TableOfContents/>);
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  await page.route('http://contents.test/', route => route.fulfill({ contentType: 'text/html', body: `
    <article class="prose-content"><h2 id="first">First section</h2>
    <h2 id="second">A long section heading that should wrap within the contents panel</h2></article>
    <div id="contents" style="width:220px"></div>` }));
  await page.goto('http://contents.test/');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addStyleTag({ content: await readFile('src/styles/table-of-contents.css', 'utf8') });
  await page.evaluate(() => {
    (window as any).scrollOptions = null;
    Element.prototype.scrollIntoView = function(options) { (window as any).scrollOptions=options; };
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const nav = page.getByRole('navigation', { name: 'On this page' });
  const link = nav.getByRole('link', { name: /A long section heading/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/#second$/);
  await expect(link).toHaveAttribute('aria-current', 'location');
  await expect(page.locator('#second')).toBeFocused();
  expect(await page.evaluate(() => (window as any).scrollOptions.behavior)).toBe('instant');
  expect(await nav.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
