import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

test('manual flush waits for an older autosave and persists the latest edit serially', async ({ page }) => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {useAutosave} from './src/lib/editor/useAutosave';
      const pending=[]; const calls=[]; let active=0; let peak=0; let saved=0;
      function App(){
        const [value,setValue]=useState('initial');
        const state=useAutosave({snapshot:value, delay:10, onSaved:()=>saved++, save:()=>{
          calls.push(value); active++; peak=Math.max(peak,active);
          return new Promise((resolve,reject)=>pending.push((fail)=>{active--;fail?reject(new Error('Save unavailable')):resolve();}));
        }});
        window.harness={setValue, flush:state.flush, release:(fail=false)=>pending.shift()?.(fail), calls, get saved(){return saved},
          get peak(){return peak}, status:state.status};
        return <div>{state.status}</div>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, format: 'iife', platform: 'browser',
  });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).harness))).toBe(true);
  await page.evaluate(() => (window as any).harness.setValue('first'));
  await expect.poll(() => page.evaluate(() => (window as any).harness.calls)).toEqual(['first']);
  await page.evaluate(() => (window as any).harness.setValue('latest'));
  await expect.poll(() => page.evaluate(() => (window as any).harness.status)).toBe('pending');
  await page.evaluate(() => { (window as any).done=false; void (window as any).harness.flush().then(()=>{(window as any).done=true}); });
  expect(await page.evaluate(() => (window as any).done)).toBe(false);
  await page.evaluate(() => (window as any).harness.release());
  await expect.poll(() => page.evaluate(() => (window as any).harness.calls)).toEqual(['first','latest']);
  await page.evaluate(() => (window as any).harness.release());
  await expect.poll(() => page.evaluate(() => (window as any).done)).toBe(true);
  expect(await page.evaluate(() => (window as any).harness.peak)).toBe(1);
  const savedBeforeFailure = await page.evaluate(() => (window as any).harness.saved);
  await page.evaluate(() => (window as any).harness.setValue('after failure'));
  await expect.poll(() => page.evaluate(() => (window as any).harness.calls.length)).toBe(3);
  await page.evaluate(() => {
    (window as any).outcome='waiting';
    void (window as any).harness.flush().then(
      () => {(window as any).outcome='saved'},
      error => {(window as any).outcome=error.message},
    );
    (window as any).harness.release(true);
  });
  await expect.poll(() => page.evaluate(() => (window as any).outcome)).toBe('Save unavailable');
  expect(await page.evaluate(() => (window as any).harness.saved)).toBe(savedBeforeFailure);
  await page.evaluate(() => {
    void (window as any).harness.flush().then(()=>{(window as any).outcome='saved'});
  });
  await expect.poll(() => page.evaluate(() => (window as any).harness.calls.length)).toBe(4);
  await page.evaluate(() => (window as any).harness.release());
  await expect.poll(() => page.evaluate(() => (window as any).outcome)).toBe('saved');
  expect(await page.evaluate(() => (window as any).harness.calls.slice(-2))).toEqual(['after failure','after failure']);
  expect(await page.evaluate(() => (window as any).harness.peak)).toBe(1);
});
