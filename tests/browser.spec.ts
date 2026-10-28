import { test, expect } from '@playwright/test';
import { residents } from '../src/residents';

test('tower and all 20 flat routes are navigable, direct-refresh safe and image-free pending Meta', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.locator('h1')).toContainText('讓每個靈感');
  await expect(page.locator('.resident-card')).toHaveCount(10);
  await page.screenshot({ path: `test-results/${info.project.name}-tower.png`, fullPage: true });
  for (const resident of residents) {
    await page.goto(`/${resident.id}/`);
    await expect(page.locator('h1')).toContainText(resident.name);
    await expect(page.locator('.flat-nameplate')).toContainText('模擬住戶');
    const box = await page.locator('.flat-visual .room-stage').boundingBox();
    expect(box!.width / box!.height).toBeCloseTo(info.project.name === 'mobile' ? 9 / 16 : 16 / 9, 2);
    await page.getByRole('link', { name: '走進去看看' }).click();
    await expect(page).toHaveURL(new RegExp(`/${resident.id}/inside$`));
    await expect(page.locator('h1')).toContainText(resident.name);
    await expect(page.locator('#diary')).toContainText('虛構示範日記');
    await page.reload(); await expect(page.locator('#gift')).toContainText('收藏架還空著');
    await page.getByRole('link', { name: '← 回到家門' }).click();
    await expect(page.locator('h1')).toContainText(resident.name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect(page.locator('img, svg, canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('flat, inside and missing address preserve navigation and keyboard back', async ({ page }, info) => {
  await page.goto('/m7k2px');
  await page.screenshot({ path: `test-results/${info.project.name}-flat.png`, fullPage: true });
  await page.getByRole('link', { name: '走進去看看' }).click();
  await expect(page.locator('main')).toBeFocused();
  await page.screenshot({ path: `test-results/${info.project.name}-inside.png`, fullPage: true });
  await page.goBack(); await expect(page.locator('.flat-nameplate h1')).toContainText('茉茉');
  await page.goto('/no-such-flat'); await expect(page.locator('h1')).toContainText('還沒有人住');
  await page.getByRole('link', { name: '回公寓大廳 ↗' }).click(); await expect(page.locator('.building')).toBeVisible();
  await page.getByRole('link', { name: '關於入住' }).click(); await expect(page.locator('main')).toContainText('尚未開放真實入住');
  await expect(page.locator('input[type=file]')).toHaveCount(0);
});
test('messages persist locally, escape visitor HTML, reject duplicate and throttle, clear restores empty', async ({ page }) => {
  await page.goto('/m7k2px/inside'); await page.getByRole('button', { name: '寫一句問候' }).click();
  await page.getByLabel('怎麼稱呼你').fill('路過的鄰居');
  await page.getByLabel('想留下的話').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: '存入本機示範信箱' }).click();
  await expect(page.locator('#form-status')).toContainText('沒有傳送給住戶');
  await expect(page.getByRole('button', { name: '存入本機示範信箱' })).toBeDisabled();
  await page.getByRole('button', { name: '關閉', exact: true }).click();
  await expect(page.locator('#message')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#message img')).toHaveCount(0);
  await page.reload(); await expect(page.locator('#message')).toContainText('路過的鄰居');
  await page.getByRole('button', { name: '寫一句問候' }).click();
  await page.getByLabel('怎麼稱呼你').fill('路過的鄰居'); await page.getByLabel('想留下的話').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: '存入本機示範信箱' }).click(); await expect(page.locator('#form-status')).toContainText('不需要重複');
  await page.getByLabel('想留下的話').fill('另一句問候'); await page.getByRole('button', { name: '存入本機示範信箱' }).click();
  await expect(page.locator('#form-status')).toContainText('30 秒');
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '清除本機互動紀錄' }).click();
  await expect(page.locator('#message')).toContainText('信箱還是空的');
});
test('gifts and invitations are separate text-only local records, isolated per resident', async ({ page }) => {
  await page.goto('/m7k2px/inside');
  await page.getByRole('button', { name: '留一張文字禮物卡' }).click(); await page.getByLabel('怎麼稱呼你').fill('A');
  await page.getByLabel('想留下的話').fill('送你一個下午的安靜。'); await page.getByRole('button', { name: '存入本機示範信箱' }).click();
  await page.keyboard.press('Escape'); await expect(page.locator('#gift')).toContainText('送你一個下午的安靜');
  await page.goto('/r4n8cv/inside'); await expect(page.locator('#gift')).not.toContainText('送你一個下午的安靜');
  await page.getByRole('button', { name: '清除本機互動紀錄' }).click();
  await page.getByRole('button', { name: '留一封邀請' }).click(); await page.getByLabel('怎麼稱呼你').fill('B');
  await page.getByLabel('想留下的話').fill('週六一起聊植物吧。'); await page.getByRole('button', { name: '存入本機示範信箱' }).click();
  await page.keyboard.press('Escape'); await page.reload(); await expect(page.locator('#invitation')).toContainText('週六一起聊植物吧');
  await expect(page.locator('#message')).not.toContainText('週六一起聊植物吧');
});
test('frontend has no owner identity, raw memory, secret or fabricated model data; handles unavailable storage', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage denied'); } }); });
  await page.goto('/m7k2px'); await expect(page.locator('.flat-details')).toContainText('主人資訊未公開');
  await expect(page.locator('.flat-details')).toContainText('尚無可驗證資料');
  await page.getByRole('link', { name: '走進去看看' }).click(); await expect(page.locator('#message')).toContainText('無法讀取本機紀錄');
  await page.getByRole('button', { name: '寫一句問候' }).click(); await page.getByLabel('怎麼稱呼你').fill('A'); await page.getByLabel('想留下的話').fill('hello');
  await page.getByRole('button', { name: '存入本機示範信箱' }).click(); await expect(page.locator('#form-status')).not.toContainText('已存入');
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '清除本機互動紀錄' }).click(); await expect(page.locator('#clear-status')).toContainText('目前無法清除');
  const html = await page.content(); expect(html).not.toMatch(/M\.K\.|privateMemory|TEST-PRIVATE|API_KEY|google\.com\/forms/);
});
test('blank and contact-content inputs never create entries', async ({ page }) => {
  await page.goto('/m7k2px/inside'); await page.getByRole('button', { name: '寫一句問候' }).click();
  await page.getByRole('button', { name: '存入本機示範信箱' }).click(); await expect(page.locator('#message .entry-list')).toHaveCount(0);
  await page.getByLabel('怎麼稱呼你').fill('A'); await page.getByLabel('想留下的話').fill('https://example.com');
  await page.getByRole('button', { name: '存入本機示範信箱' }).click(); await expect(page.locator('#form-status')).toContainText('請勿包含連結');
});


test('small and intermediate viewports do not overflow', async ({ page }) => {
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/b9t3wa', '/b9t3wa/inside', '/入住']) {
      await page.goto(route);
      const layout = await page.evaluate(() => ({ fits: document.documentElement.scrollWidth <= innerWidth, overflow: [...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > innerWidth).map(el => `${el.tagName}.${el.className}: ${el.getBoundingClientRect().right}`) }));
      expect(layout.fits, `${route} at ${width}px: ${layout.overflow.join(', ')}`).toBe(true);
    }
  }
});
