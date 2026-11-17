import { test, expect } from '../fixtures/auth.fixture';
import { PDFDocument } from 'pdf-lib';
import { request as playwrightRequest } from '@playwright/test';

test('PDF import stores the selected bytes and reader uses its registered storage key', async ({sessionPage:page,request})=>{
 const pdf=await PDFDocument.create();pdf.addPage([300,400]);
 const bytes=Buffer.from(await pdf.save());
 const title=`Imported research ${Date.now()}`;
 await page.evaluate(()=>window.openCreateResourceModal?.({type:'pdf',mode:'import'}));
 await page.locator('input[type="file"]').setInputFiles({name:'research.pdf',mimeType:'application/pdf',buffer:bytes});
 await page.getByTestId('create-resource-title').fill(title);
 let capture!:(value:any)=>void;
 const createdPromise=new Promise<any>(resolve=>{capture=resolve;});
 await page.route('**/api/v1/resources/create',async route=>{
  const response=await route.fetch();expect(response.status()).toBe(201);
  capture(await response.json());await route.fulfill({response});
 });
 await page.getByTestId('create-resource-submit').click();
 const created=await createdPromise;await expect(page).toHaveURL(url=>url.pathname===created.route || url.searchParams.get('doc')===created.id);
 await expect(page.locator('.workspace-resource-title')).toHaveText(title);
 const streamPath='/api/v1/assets/pdf/'+encodeURIComponent(created.id.replace(/^pdf:/,''));
 const stream=await request.get(streamPath);expect(stream.status()).toBe(200);
 expect(stream.headers()['x-source-storage']).toBe('R2-S3-Private-Bucket');
 expect(await stream.body()).toEqual(bytes);
 await page.reload();await expect(page.locator('iframe[title^="PDF Stream"]')).toBeVisible();
 expect(await (await request.get(streamPath)).body()).toEqual(bytes);
 const anonymous=await playwrightRequest.newContext({baseURL:new URL(page.url()).origin});
 try{expect((await anonymous.get(streamPath)).status()).toBe(403);}finally{await anonymous.dispose();}
 const record=await (await request.get('/api/v1/resources/'+encodeURIComponent(created.id))).json();
 expect(record.metadata.storageKey).toContain('/pdf/');
 // Only the disposable object-store fixture may be changed by this test.
 const endpoint=process.env.S3_ENDPOINT;
 if(!endpoint || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint) || process.env.S3_BUCKET_NAME!=='e2e-assets') throw new Error('Requires disposable object storage');
 await request.delete(endpoint+'/e2e-assets/'+record.metadata.storageKey);
 const missing=await request.get(streamPath);expect(missing.status()).toBe(404);
 expect(missing.headers()['content-type']).not.toContain('application/pdf');
 expect(await missing.text()).toBe('PDF file is unavailable.');
});
