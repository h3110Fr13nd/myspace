import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

test('linked references retain paths, provide fallbacks, and omit empty panels', async ({ page }) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {Backlinks} from './src/components/Backlinks';
    createRoot(document.getElementById('root')).render(<>
      <Backlinks backlinks={[
        {id:'document:with-path',title:'Existing route',path:'/published-note'},
        {id:'document:without path',title:'Fallback route',excerpt:'A useful reference'},
      ]}/>
      <Backlinks backlinks={[]}/>
    </>);
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  await page.route('http://references.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root" style="width:220px"></div>' }));
  await page.goto('http://references.test/');
  await page.addStyleTag({ content: await readFile('src/styles/backlinks.css', 'utf8') });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const nav = page.getByRole('navigation', { name: 'Linked references' });
  await expect(nav).toHaveCount(1);
  await expect(nav.getByRole('link', { name: 'Existing route' })).toHaveAttribute('href', '/published-note');
  const fallback = nav.getByRole('link', { name: /Fallback route/ });
  await expect(fallback).toHaveAttribute('href', '/?doc=document%3Awithout%20path');
  await fallback.focus();
  await expect(fallback).toBeFocused();
  await fallback.press('Enter');
  await expect(page).toHaveURL('http://references.test/?doc=document%3Awithout%20path');
});
