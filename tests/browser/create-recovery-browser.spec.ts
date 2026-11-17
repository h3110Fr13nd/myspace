import {test,expect} from '@playwright/test';
import {build} from 'esbuild';

test('creation recovers unavailable save locations without losing entered details', async ({page})=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import{CreateResourceModal}from'./src/components/CreateResourceModal';
 import{openCreateResourceModal}from'./src/lib/createResourceEvents';
 createRoot(document.getElementById('root')).render(<><button onClick={()=>openCreateResourceModal({type:'document'})}>New note</button><CreateResourceModal currentUser="user:test"/></>);
 `},bundle:true,write:false,format:'iife',loader:{'.css':'empty'}});
 let attempts=0;let payload:any;
 await page.route('http://create.test/**',async route=>{
  const url=route.request().url();
  if(url.includes('/resources/folders')){
   attempts++;
   await route.fulfill({status:attempts===1?503:200,contentType:'application/json',body:JSON.stringify({containers:[{id:'folder:personal',type:'folder',title:'Personal notes',isPersonalRoot:true}]})});
  }else if(url.includes('/resources/create')){
   payload=route.request().postDataJSON();
   await route.fulfill({status:503,contentType:'application/json',body:'{"error":"Save service unavailable. Try again."}'});
  }else await route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
 });
 await page.goto('http://create.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await expect(page.getByRole('button',{name:'Retry locations'})).toBeVisible();
 const title=page.getByTestId('create-resource-title');await title.fill('Research draft');
 const submit=page.getByTestId('create-resource-submit');await expect(submit).toBeDisabled();
 await page.getByRole('button',{name:'Retry locations'}).click();
 await expect(page.getByLabel('Save to')).toHaveValue('folder:personal');
 await expect(title).toHaveValue('Research draft');await expect(submit).toBeEnabled();
 await submit.click();
 await expect(page.getByRole('alert')).toContainText('Save service unavailable');
 await expect(title).toHaveValue('Research draft');await expect(page.getByLabel('Save to')).toHaveValue('folder:personal');
 expect(payload.parent_folder).toBe('folder:personal');expect(payload.title).toBe('Research draft');
});

test('failed import keeps its file and title, and pending import cannot change or duplicate',async({page})=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import{CreateResourceModal}from'./src/components/CreateResourceModal';
 import{openCreateResourceModal}from'./src/lib/createResourceEvents';
 createRoot(document.getElementById('root')).render(<><button onClick={()=>openCreateResourceModal({type:'pdf',mode:'import'})}>Import PDF</button><CreateResourceModal currentUser="user:test"/></>);
 `},bundle:true,write:false,format:'iife',loader:{'.css':'empty'}});
 let requests=0;const payloads:any[]=[];let release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve;});
 await page.route('http://create.test/**',async route=>{
  const url=route.request().url();
  if(url.includes('/resources/folders')) await route.fulfill({contentType:'application/json',body:'{"containers":[{"id":"folder:personal","type":"folder","title":"Personal notes","isPersonalRoot":true}]}'});
  else if(url.includes('/resources/create')){
   requests++;payloads.push(route.request().postDataJSON());
   if(requests===1){await pending;await route.fulfill({status:503,contentType:'application/json',body:'{"error":"Import unavailable. Try again."}'});}
   else await route.fulfill({status:201,contentType:'application/json',body:'{"route":"/imported-resource"}'});
  }else await route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
 });
 await page.goto('http://create.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.getByRole('button',{name:'Import PDF',exact:true}).click();
 await page.locator('input[type="file"]').setInputFiles({name:'research-paper.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nfixture')});
 const title=page.getByTestId('create-resource-title');await expect(title).toHaveValue('research paper');await title.fill('Reviewed paper');
 const submit=page.getByTestId('create-resource-submit');await expect(submit).toBeEnabled();await submit.click();
 await expect.poll(()=>requests).toBe(1);await expect(title).toBeDisabled();
 await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeDisabled();
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toBeVisible();
 await page.locator('#create-resource-form').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 expect(requests).toBe(1);release();
 await expect(page.getByRole('alert')).toContainText('Import unavailable');
 await expect(title).toBeEnabled();await expect(title).toHaveValue('Reviewed paper');
 await expect(page.getByText('research-paper.pdf',{exact:true})).toBeVisible();
 await submit.click();await expect(page).toHaveURL('http://create.test/imported-resource');
 expect(requests).toBe(2);expect(payloads[1]).toEqual(payloads[0]);
 expect(payloads[1].import_source.data).toContain('base64,');
});
