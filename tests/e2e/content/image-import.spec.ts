import { test, expect } from '../fixtures/auth.fixture';
import { request as playwrightRequest } from '@playwright/test';

// Valid 1 × 1 PNG; exact bytes are the persistence assertion.
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');

test('image import reads its real bytes and recovers a missing object through Retry',async({sessionPage:page,request},testInfo)=>{
 const title=`Imported image ${Date.now()}`;
 await page.evaluate(()=>window.openCreateResourceModal?.({type:'image',mode:'import'}));
 await page.locator('input[type="file"]').setInputFiles({name:'research.png',mimeType:'image/png',buffer:bytes});
 await page.getByTestId('create-resource-title').fill(title);
 let capture!:(value:any)=>void;const createdPromise=new Promise<any>(resolve=>{capture=resolve;});
 await page.route('**/api/v1/resources/create',async route=>{
  const response=await route.fetch();expect(response.status()).toBe(201);
  capture(await response.json());await route.fulfill({response});
 });
 await page.getByTestId('create-resource-submit').click();const created=await createdPromise;
 await expect(page.locator('.workspace-resource-title')).toHaveText(title);
 const image=page.locator('.image-viewer__image');await expect(image).toBeVisible();
 await expect.poll(()=>image.evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBe(1);
 const streamPath='/api/v1/assets/image/'+encodeURIComponent(created.id.replace(/^image:/,''));
 const stream=await request.get(streamPath);expect(stream.status()).toBe(200);
 expect(stream.headers()['content-type']).toBe('image/png');
 expect(stream.headers()['cache-control']).toBe('no-store, private');
 expect(await stream.body()).toEqual(bytes);
 await page.reload();await expect(image).toBeVisible();
 await expect(page.getByRole('link',{name:'Download image',exact:true})).toHaveAttribute('download','research.png');
 const anonymous=await playwrightRequest.newContext({baseURL:new URL(page.url()).origin});
 try{expect((await anonymous.get(streamPath)).status()).toBe(403);}finally{await anonymous.dispose();}
 const record=await (await request.get('/api/v1/resources/'+encodeURIComponent(created.id))).json();
 const endpoint=process.env.S3_ENDPOINT;
 if(!endpoint || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint) || process.env.S3_BUCKET_NAME!=='e2e-assets') throw new Error('Requires disposable object storage');
 const objectUrl=endpoint+'/e2e-assets/'+record.metadata.storageKey;
 await request.delete(objectUrl);await page.reload();
 await expect(page.getByRole('button',{name:'Retry image',exact:true})).toBeVisible();
 await expect(page.locator('.image-viewer').getByRole('button',{name:'Zoom In',exact:true})).toBeDisabled();
 expect((await request.get(streamPath)).status()).toBe(404);
 await page.setViewportSize({width:390,height:844});
 for(const theme of ['light','dark']) {
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.screenshot({path:testInfo.outputPath('image-error-'+theme+'-390.png'),fullPage:true});
 }
 await request.put(objectUrl,{data:bytes,headers:{'Content-Type':'image/png'}});
 await page.getByRole('button',{name:'Retry image',exact:true}).click();
 await expect(image).toBeVisible();await expect.poll(()=>image.evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBe(1);
 await expect(page.locator('.image-viewer').getByRole('button',{name:'Zoom In',exact:true})).toBeEnabled();
});
