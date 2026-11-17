import {test,expect} from '@playwright/test';

test('reader contents jump once and leave other-document and modified links native',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/');
 const nav=page.getByRole('navigation',{name:'On this page',exact:true});
 const link=nav.getByRole('link').first();await expect(link).toBeVisible();
 const name=await link.textContent();expect(name?.trim()).toBeTruthy();
 const href=await link.getAttribute('href');
 const before=await page.evaluate(()=>history.length);
 await page.evaluate(()=>{
  (window as any).scrollCalls=[];
  Element.prototype.scrollIntoView=function(options){(window as any).scrollCalls.push(options);};
 });
 await link.click();
 expect(await page.evaluate(()=>history.length)).toBe(before+1);
 expect(await page.evaluate(()=>(window as any).scrollCalls)).toEqual([{behavior:'instant',block:'start'}]);
 await expect(page.locator(href!)).toBeFocused();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const results=await page.evaluate(()=>{
  const check=(href:string,ctrlKey=false)=>{
   const a=document.createElement('a');a.href=href;a.target='_blank';document.body.append(a);
   let intercepted=false;
   const inspect=(event:MouseEvent)=>{intercepted=event.defaultPrevented;event.preventDefault();};
   document.addEventListener('click',inspect,{once:true});
   a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey}));a.remove();return intercepted;
  };
  const hash=document.querySelector('.contents-panel__link')!.getAttribute('href')!;
  return {otherNote:check('/?doc=document:another'+hash),modified:check(hash,true),malformed:check('#%E0%A4%A')};
 });
 expect(results).toEqual({otherNote:false,modified:false,malformed:false});expect(errors).toEqual([]);
});

test('same-tab reference navigation changes notes and browser history restores them',async({page})=>{
 await page.goto('/');
 const title=page.locator('.workspace-resource-title');
 const originalTitle=await title.textContent();
 const first=page.getByRole('navigation',{name:'On this page',exact:true}).getByRole('link').first();
 await expect(first).toBeVisible();
 const hash=await first.getAttribute('href');
 const graph=await (await page.request.get('/api/v1/workspace/graph')).json();
 const other=graph.nodes.find((node:any)=>node.type==='document' && node.title!==originalTitle);
 expect(other,'a second public note is required for the reader journey').toBeTruthy();
 const destination='/?doc='+encodeURIComponent(other.id)+hash;
 await page.evaluate(href=>{const a=document.createElement('a');a.href=href;a.textContent='Open another note';document.querySelector('article')!.append(a);},destination);
 await page.getByRole('link',{name:'Open another note',exact:true}).click();
 await expect(page).toHaveURL(url=>url.searchParams.get('doc')===other.id);
 await expect(page.locator('.workspace-resource-title')).toHaveText(other.title);
 await page.goBack();
 await expect(page.locator('.workspace-resource-title')).toHaveText(originalTitle!);
 await page.goForward();
 await expect(page.locator('.workspace-resource-title')).toHaveText(other.title);
});

test('skip link bypasses the explorer and focuses the reader main landmark',async({page})=>{
 await page.goto('/');
 await page.keyboard.press('Tab');
 const skip=page.getByRole('link',{name:'Skip to content',exact:true});
 await expect(skip).toBeFocused();
 await skip.press('Enter');
 await expect(page.getByRole('main')).toBeFocused();
 await expect(page.locator('#main-content')).toHaveCount(1);
 await page.keyboard.press('Tab');
 expect(await page.evaluate(()=>!!document.activeElement?.closest('.sidebar-left'))).toBe(false);
});
