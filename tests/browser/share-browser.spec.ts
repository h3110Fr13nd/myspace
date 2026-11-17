import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

test('sharing distinguishes unavailable access and only confirms successful clipboard writes', async ({ page }) => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {ShareModal} from './src/components/ShareModal';
    import {Toaster} from './src/components/ui/Toast';
    createRoot(document.getElementById('root')).render(<><ShareModal/><Toaster/></>);
  ` }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
  let attempts = 0;
  await page.route('http://share.test/**', async route => {
    const url = route.request().url();
    if (url.includes('/permissions/resource')) {
      attempts++;
      await route.fulfill({status: attempts === 1 ? 503 : 403, contentType:'application/json',body:'{}'});
    } else if (url.includes('/api/')) {
      await route.fulfill({contentType:'application/json',body:'{"results":[]}'});
    } else await route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
  });
  await page.goto('http://share.test/');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.waitForTimeout(50);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-share-modal', {detail:{resourceId:'document:a note',title:'A note',type:'document'}})));
  await expect(page.getByRole('alert').filter({hasText:'Failed to load permissions'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Access details are private'})).toBeVisible();
  expect(attempts).toBe(2);
  await page.evaluate(() => Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied');}}}));
  await page.getByRole('button',{name:'Copy Link'}).click();
  await expect(page.getByRole('button',{name:'Copied',exact:true})).toHaveCount(0);
  await expect(page.getByText('Could not copy the link.',{exact:false})).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as any).copiedUrl=text;}}}));
  await page.getByRole('button',{name:'Copy Link'}).click();
  await expect(page.getByRole('button',{name:'Copied',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).copiedUrl)).toBe('http://share.test/?doc=document%3Aa%20note');
});
