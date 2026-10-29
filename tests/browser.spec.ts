import { test, expect } from '@playwright/test';
import { residents } from '../src/residents';
import { homeArtwork, characterArtwork, prototypeArtPath } from '../src/artwork';

test('tower and all 20 flat routes preserve prototype provenance and responsive artwork', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.locator('h1')).toContainText('讓每個靈感');
  await expect(page.locator('.resident-card')).toHaveCount(10);
  await expect(page.locator('.resident-card .room-stage img')).toHaveCount(10);
  const sources = [];
  for (const image of await page.locator('.resident-card .room-stage img').all()) {
    await image.scrollIntoViewIfNeeded(); await expect(image).toHaveJSProperty('complete', true);
    expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(900);
    sources.push(await image.getAttribute('src'));
  }
  expect(new Set(sources).size).toBe(10);
  await expect(page.locator('.resident-card .character-avatar')).toHaveCount(10);
  for (const resident of residents) {
    const card = page.locator(`[data-resident-card="${resident.id}"]`);
    await expect(card).toContainText(resident.demo.city);
    await expect(card).toContainText(resident.demo.ownerAlias);
    await expect(card).toContainText(resident.role);
    const avatar = page.locator(`.resident-card [data-character-id="${resident.id}"] img`);
    await avatar.scrollIntoViewIfNeeded(); await expect(avatar).toHaveJSProperty('complete', true);
    await expect(avatar).toHaveAttribute('src', `/${prototypeArtPath(characterArtwork[resident.id].file)}`);
    expect(await avatar.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1254);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: `test-results/${info.project.name}-tower.png`, fullPage: true });
  for (const resident of residents) {
    await page.goto(`/${resident.id}/`);
    await expect(page.locator('h1')).toContainText(resident.name);
    await expect(page.locator('.flat-nameplate')).toContainText('模擬住戶');
    await expect(page.locator('.flat-details')).toContainText(resident.demo.city);
    await expect(page.locator('.flat-details')).toContainText(resident.demo.ownerAlias);
    await expect(page.locator('.flat-details')).toContainText('示範同意公開');
    await expect(page.locator('.flat-bio')).toContainText(resident.demo.personality);
    const profileImage = page.locator('.flat-nameplate .character-avatar img');
    await expect(page.locator('.flat-nameplate .character-avatar')).toHaveAttribute('data-character-id', resident.id);
    await expect(profileImage).toHaveAttribute('src', `/${prototypeArtPath(characterArtwork[resident.id].file)}`);
    await expect(profileImage).toHaveJSProperty('complete', true);
    expect(await profileImage.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1254);
    const art = homeArtwork[resident.id];
    expect(art).toBeDefined();
    if (art) {
      const image = page.locator('.flat-visual img');
      await expect(image).toBeVisible();
      await expect(image).toHaveJSProperty('complete', true);
      const source = await image.evaluate((el: HTMLImageElement) => ({ src: el.currentSrc, naturalWidth: el.naturalWidth, fit: getComputedStyle(el).objectFit }));
      expect(source.src).toContain(prototypeArtPath(info.project.name === 'mobile' ? art.mobile : art.desktop));
      expect(source.naturalWidth).toBeGreaterThan(900); expect(source.fit).toBe('contain');
      await expect(page.locator('.flat-visual')).toContainText('Codex 原型圖');
    } else await expect(page.locator('.flat-visual img')).toHaveCount(0);
    const box = await page.locator('.flat-visual .room-stage').boundingBox();
    expect(box!.width / box!.height).toBeCloseTo(info.project.name === 'mobile' ? 9 / 16 : 16 / 9, 2);
    await page.getByRole('link', { name: '走進去看看' }).click();
    await expect(page).toHaveURL(new RegExp(`/${resident.id}/inside$`));
    await expect(page.locator('h1')).toContainText(resident.name);
    await expect(page.locator('#diary')).toContainText('虛構示範日記');
    await expect(page.locator('.inside-namecard .character-avatar')).toHaveAttribute('data-character-id', resident.id);
    await expect(page.locator('.inside-namecard .character-avatar img')).toHaveAttribute('src', `/${prototypeArtPath(characterArtwork[resident.id].file)}`);
    await expect(page.locator('.inside-namecard')).toContainText('星芽族 · Codex 暫用原型');
    await expect(page.locator('.flat-details')).toHaveCount(0);
    await expect(page.locator('.inside-namecard')).toContainText(resident.demo.city);
    await expect(page.locator('.inside-namecard')).toContainText(resident.demo.ownerAlias);
    await expect(page.locator('.inside-namecard')).toContainText('虛構 · 示範同意公開');
    const contrast = await page.locator('.inside-namecard .character-source').evaluate(el => {
      const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const foreground = luminance(getComputedStyle(el).color);
      const background = luminance(getComputedStyle(el.closest('.inside-namecard')!).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await page.reload(); await expect(page.locator('#gift')).toContainText('收藏架還空著');
    await page.getByRole('link', { name: '← 回到家門' }).click();
    await expect(page.locator('h1')).toContainText(resident.name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect(page.locator('svg, canvas')).toHaveCount(0);
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
  await page.getByRole('button', { name: '留一張禮物卡' }).click(); await page.getByLabel('怎麼稱呼你').fill('A');
  await page.getByLabel('想留下的話').fill('送你一個下午的安靜。'); await page.getByRole('button', { name: '存入本機示範信箱' }).click();
  await page.keyboard.press('Escape'); await expect(page.locator('#gift')).toContainText('送你一個下午的安靜');
  await page.goto('/r4n8cv/inside'); await expect(page.locator('#gift')).not.toContainText('送你一個下午的安靜');
  await page.getByRole('button', { name: '清除本機互動紀錄' }).click();
  await page.getByRole('button', { name: '留一封邀請' }).click(); await page.getByLabel('怎麼稱呼你').fill('B');
  await page.getByLabel('想留下的話').fill('週六一起聊植物吧。'); await page.getByRole('button', { name: '存入本機示範信箱' }).click();
  await page.keyboard.press('Escape'); await page.reload(); await expect(page.locator('#invitation')).toContainText('週六一起聊植物吧');
  await expect(page.locator('#message')).not.toContainText('週六一起聊植物吧');
});
test('frontend labels fictional owner consent while isolating real private data and unavailable storage', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage denied'); } }); });
  await page.goto('/m7k2px'); await expect(page.locator('.flat-details')).toContainText('示範主人（虛構）朵晴');
  await expect(page.locator('.flat-details')).toContainText('示範同意公開');
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


test('prototype gifts persist with their real source and references are display-only', async ({ page }, info) => {
  await page.goto('/m7k2px/inside');
  await page.getByRole('button', { name: '留一張禮物卡' }).click();
  await page.getByRole('radio', { name: '晚安小雲燈' }).check();
  await page.getByLabel('怎麼稱呼你').fill('鄰居');
  await page.getByLabel('想留下的話').fill('留一盞燈給你。');
  await expect(page.locator('#gift-options img')).toHaveCount(3);
  await page.screenshot({ path: `test-results/${info.project.name}-gift-picker.png`, fullPage: false });
  await page.getByRole('button', { name: '存入本機示範信箱' }).click();
  await page.keyboard.press('Escape'); await page.reload();
  await expect(page.locator('#gift .received-gift img')).toHaveAttribute('src', '/prototype-assets/gift-cloud.png');
  await expect(page.locator('#gift .received-gift')).toContainText('本機禮物卡 · Codex 原型圖');
  await page.goto('/入住');
  await expect(page.locator('.decor-gallery img')).toHaveCount(2);
  for (const image of await page.locator('.decor-gallery img').all()) {
    await image.scrollIntoViewIfNeeded(); await expect(image).toHaveJSProperty('complete', true);
    const bounds = await image.boundingBox(); expect(bounds!.width / bounds!.height).toBeCloseTo(16 / 9, 2);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(page.locator('.decor-gallery button, .decor-gallery input')).toHaveCount(0);
  await expect(page.locator('.decor-gallery')).toContainText('不提供入住風格選擇');
  await page.screenshot({ path: `test-results/${info.project.name}-references.png`, fullPage: true });
});


test('missing character image falls back to readable resident text without breaking navigation', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/prototype-assets/character-momo.png', route => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/m7k2px');
  const avatar = page.locator('.flat-nameplate .character-avatar');
  await expect(avatar).toHaveClass(/is-unavailable/);
  await expect(avatar).toHaveAttribute('aria-label', '茉茉的角色圖暫無法載入，顯示姓名文字');
  await expect(avatar.locator('img')).toBeHidden(); await expect(avatar.locator('.character-fallback')).toHaveText('茉');
  await expect(page.locator('.flat-nameplate h1')).toContainText('茉茉');
  await page.getByRole('link', { name: '走進去看看' }).click();
  await expect(page.locator('.inside-namecard .character-avatar')).toHaveClass(/is-unavailable/);
  await expect(page.locator('#diary')).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-character-fallback.png`, fullPage: true });
  expect(errors).toEqual([]);
});
