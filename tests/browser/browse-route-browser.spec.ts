import {test,expect} from '@playwright/test';

test('empty tag and missing folder provide working next steps and keyboard skip targets',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 for(const theme of ['dark','light']){
  await page.goto('/tags/ux-no-match-7b391f');
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await expect(page.getByText('No accessible resources with this tag',{exact:true})).toBeVisible();
  const browse=page.getByRole('link',{name:'Browse tags',exact:true});
  await expect(browse).toHaveCount(1);await expect(browse).toBeVisible();
  await browse.click();await expect(page).toHaveURL(/\/tags$/);
 }
 const missing=await page.goto('/folders/ux-missing-folder-7b391f');
 expect(missing?.status()).toBe(404);
 await expect(page.getByText('Folder not found',{exact:true})).toBeVisible();
 await page.keyboard.press('Tab');
 const skip=page.getByRole('link',{name:'Skip to content',exact:true});await expect(skip).toBeFocused();
 await skip.press('Enter');await expect(page.getByRole('main')).toBeFocused();
 await page.getByRole('link',{name:'Browse workspace',exact:true}).click();await expect(page).toHaveURL('/');
 await page.goto('/tags/ux-no-match-7b391f');
 await page.keyboard.press('Tab');await skip.press('Enter');
 await expect(page.getByRole('main')).toBeFocused();
 await expect(page.locator('#main-content')).toHaveCount(1);
});
