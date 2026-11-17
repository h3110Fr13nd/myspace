import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('shared action and badge labels meet normal-text contrast across themes and accents', async ({page}, testInfo) => {
  await page.setContent(`<main>
    ${['primary','secondary','ghost','danger'].map(v=>`<button class="ui-button ui-button--md ui-button--${v}">${v}</button>`).join('')}
    ${['success','danger','info','warn','neutral','owner','circle','editor','user','inherited','public'].map(v=>`<span class="ui-badge ui-badge--${v}">${v}</span>`).join('')}
  </main>`);
  for(const name of ['tokens.css','primitives.css']) await page.addStyleTag({content:await readFile(`src/styles/${name}`,'utf8')});
  await page.addStyleTag({content:'body{background:var(--bg-primary);color:var(--text-primary);padding:var(--space-5)}main{display:flex;flex-wrap:wrap;gap:var(--space-3);max-width:640px}*{transition:none!important}'});
  for(const theme of ['dark','light']) for(const accent of ['default','violet','emerald','rose','ocean']) {
    await page.evaluate(({theme,accent})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.accent=accent;},{theme,accent});
    const ratios=await page.locator('.ui-button,.ui-badge').evaluateAll(elements=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
      const ctx=canvas.getContext('2d')!;
      const luminance=(rgb:number[])=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      return elements.map(el=>{
        const style=getComputedStyle(el);
        ctx.clearRect(0,0,1,1);
        ctx.fillStyle=getComputedStyle(document.body).backgroundColor;ctx.fillRect(0,0,1,1);
        ctx.fillStyle=style.backgroundColor;ctx.fillRect(0,0,1,1);
        const bg=luminance(Array.from(ctx.getImageData(0,0,1,1).data));
        ctx.fillStyle=style.color;ctx.fillRect(0,0,1,1);
        const fg=luminance(Array.from(ctx.getImageData(0,0,1,1).data));
        return {label:el.textContent,ratio:(Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05)};
      });
    });
    for(const {label,ratio} of ratios) expect(ratio,`${theme}/${accent}/${label}`).toBeGreaterThanOrEqual(4.5);
    if(accent === 'emerald') await page.screenshot({path:testInfo.outputPath(`controls-${theme}-emerald.png`)});
  }
});
