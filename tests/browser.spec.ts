import { test, expect } from './helpers/canonical-browser.ts';
import {lobbyMessages} from '../src/shared/lobby-messages.ts';
import { residents } from '../src/residents';
import { homeArtwork, characterArtwork, prototypeArtPath } from '../src/artwork';

const m=lobbyMessages();

test('tower and all 20 flat routes preserve prototype provenance and responsive artwork', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.locator('h1')).toContainText('Every window,');
  await expect(page.locator('[data-event-id]')).toHaveCount(20);
  await expect(page.locator('[data-resident-card]')).toHaveCount(10);
  for (const resident of residents) {
    const card = page.locator(`[data-resident-card="${resident.id}"]`);
    await expect(card).toContainText(resident.demo.city);
    await expect(card).not.toContainText(resident.demo.ownerAlias);
    await expect(card).toContainText(resident.role);
    const avatar = page.locator(`[data-resident-card] [data-character-id="${resident.id}"] img`);
    await avatar.scrollIntoViewIfNeeded(); await expect(avatar).toHaveJSProperty('complete', true);
    await expect(avatar).toHaveAttribute('src', `/${prototypeArtPath(characterArtwork[resident.id].file)}`);
    expect(await avatar.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1254);
  }
  for(const image of await page.locator('.community-page img').all()) await image.evaluate(async (el:HTMLImageElement)=>{el.loading='eager';await el.decode();});
  expect((await page.locator('.story-byline .character-avatar').first().boundingBox())!.width).toBeLessThanOrEqual(44);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: `test-results/${info.project.name}-tower.png`, fullPage: true });
  for (const resident of residents) {
    await page.goto(`/${resident.id}/`);
    await expect(page.locator('h1')).toContainText(resident.name);
    await expect(page.locator('.flat-nameplate')).toContainText('Historical demo resident');
    await expect(page.locator('.flat-details')).toContainText(resident.demo.city);
    await expect(page.locator('.flat-details')).toContainText(resident.demo.ownerAlias);
    await expect(page.locator('.flat-details')).toContainText('Shared with demo consent');
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
      await expect(page.locator('.flat-visual')).toContainText('Demo home');
    } else await expect(page.locator('.flat-visual img')).toHaveCount(0);
    const box = await page.locator('.flat-visual .room-stage').boundingBox();
    expect(box!.width / box!.height).toBeCloseTo(info.project.name === 'mobile' ? 9 / 16 : 16 / 9, 2);
    await page.getByRole('link', { name: 'Come inside' }).click();
    await expect(page).toHaveURL(new RegExp(`/${resident.id}/inside$`));
    await expect(page.locator('h1')).toContainText(resident.name);
    await expect(page.locator('#diary')).toContainText('Fictional demo entry');
    await expect(page.locator('.inside-namecard .character-avatar')).toHaveAttribute('data-character-id', resident.id);
    await expect(page.locator('.inside-namecard .character-avatar img')).toHaveAttribute('src', `/${prototypeArtPath(characterArtwork[resident.id].file)}`);
    await expect(page.locator('.inside-namecard')).toContainText('Fictional demo character');
    await expect(page.locator('.flat-details')).toHaveCount(0);
    await expect(page.locator('.inside-namecard')).toContainText(resident.demo.city);
    await expect(page.locator('.inside-namecard')).toContainText(resident.demo.ownerAlias);
    await expect(page.locator('.inside-namecard')).toContainText('Fictional · shared with demo consent');
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
    await page.reload(); await expect(page.locator('#gift')).toContainText('The shelf is empty');
    await page.getByRole('link', { name: '← Back to the front door' }).click();
    await expect(page.locator('h1')).toContainText(resident.name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect(page.locator('svg, canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('flat, inside and missing address preserve navigation and keyboard back', async ({ page }, info) => {
  await page.goto('/m7k2px');
  await page.screenshot({ path: `test-results/${info.project.name}-flat.png`, fullPage: true });
  await page.getByRole('link', { name: 'Come inside' }).click();
  await expect(page.locator('main')).toBeFocused();
  await page.screenshot({ path: `test-results/${info.project.name}-inside.png`, fullPage: true });
  await page.goBack(); await expect(page.locator('.flat-nameplate h1')).toContainText('茉茉');
  await page.goto('/no-such-flat'); await expect(page.locator('h1')).toContainText('has no resident yet');
  await page.getByRole('link', { name: 'Return to the lobby ↗' }).click(); await expect(page.locator('.lobby-masthead')).toBeVisible();
  await page.getByRole('link', { name: 'About this Tower ↗' }).click(); await expect(page.locator('main')).toContainText('Make a home, then open your door.');
  await expect(page.locator('input[type=file]')).toHaveCount(0);
});
test('messages persist locally, escape visitor HTML, reject duplicate and throttle, clear restores empty', async ({ page }) => {
  await page.goto('/m7k2px/inside'); await page.getByRole('button', { name: 'Write a greeting' }).click();
  await page.getByLabel('Your name').fill('路過的鄰居');
  await page.getByLabel('Your message').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Save in the local demo inbox' }).click();
  await expect(page.locator('#form-status')).toContainText('not sent to the resident');
  await expect(page.getByRole('button', { name: 'Save in the local demo inbox' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#message')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#message img')).toHaveCount(0);
  await page.reload(); await expect(page.locator('#message')).toContainText('路過的鄰居');
  await page.getByRole('button', { name: 'Write a greeting' }).click();
  await page.getByLabel('Your name').fill('路過的鄰居'); await page.getByLabel('Your message').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Save in the local demo inbox' }).click(); await expect(page.locator('#form-status')).toContainText('no need to submit it again');
  await page.getByLabel('Your message').fill('另一句問候'); await page.getByRole('button', { name: 'Save in the local demo inbox' }).click();
  await expect(page.locator('#form-status')).toContainText('30 seconds');
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Clear local interactions' }).click();
  await expect(page.locator('#message')).toContainText('The inbox is empty');
});
test('gifts and invitations are separate text-only local records, isolated per resident', async ({ page }) => {
  await page.goto('/m7k2px/inside');
  await page.getByRole('button', { name: 'Leave a gift card' }).click(); await page.getByLabel('Your name').fill('A');
  await page.getByLabel('Your message').fill('送你一個下午的安靜。'); await page.getByRole('button', { name: 'Save in the local demo inbox' }).click();
  await page.keyboard.press('Escape'); await expect(page.locator('#gift')).toContainText('送你一個下午的安靜');
  await page.goto('/r4n8cv/inside'); await expect(page.locator('#gift')).not.toContainText('送你一個下午的安靜');
  await page.getByRole('button', { name: 'Clear local interactions' }).click();
  await page.getByRole('button', { name: 'Leave an invitation' }).click(); await page.getByLabel('Your name').fill('B');
  await page.getByLabel('Your message').fill('週六一起聊植物吧。'); await page.getByRole('button', { name: 'Save in the local demo inbox' }).click();
  await page.keyboard.press('Escape'); await page.reload(); await expect(page.locator('#invitation')).toContainText('週六一起聊植物吧');
  await expect(page.locator('#message')).not.toContainText('週六一起聊植物吧');
});
test('frontend labels fictional owner consent while isolating real private data and unavailable storage', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage denied'); } }); });
  await page.goto('/m7k2px'); await expect(page.locator('.flat-details')).toContainText('Demo Guardian (fictional)朵晴');
  await expect(page.locator('.flat-details')).toContainText('Shared with demo consent');
  await expect(page.locator('.flat-details')).toContainText(residents[0].demo.ownerProject);
  await page.getByRole('link', { name: 'Come inside' }).click(); await expect(page.locator('#message')).toContainText('Unable to read local entries');
  await page.getByRole('button', { name: 'Write a greeting' }).click(); await page.getByLabel('Your name').fill('A'); await page.getByLabel('Your message').fill('hello');
  await page.getByRole('button', { name: 'Save in the local demo inbox' }).click(); await expect(page.locator('#form-status')).not.toContainText('Saved');
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Clear local interactions' }).click(); await expect(page.locator('#clear-status')).toContainText('Unable to clear storage');
  const html = await page.content(); expect(html).not.toMatch(/privateMemory|TEST-PRIVATE|API_KEY|google\.com\/forms/);
  await expect(page.locator('.site-footer a[href="https://mkhsu.icareu.tw"]')).toContainText('M.K.');
  await expect(page.locator('.inside-namecard')).not.toContainText('M.K.');
});
test('blank and contact-content inputs never create entries', async ({ page }) => {
  await page.goto('/m7k2px/inside'); await page.getByRole('button', { name: 'Write a greeting' }).click();
  await page.getByRole('button', { name: 'Save in the local demo inbox' }).click(); await expect(page.locator('#message .entry-list')).toHaveCount(0);
  await page.getByLabel('Your name').fill('A'); await page.getByLabel('Your message').fill('https://example.com');
  await page.getByRole('button', { name: 'Save in the local demo inbox' }).click(); await expect(page.locator('#form-status')).toContainText('Keep links and email addresses out');
});


test('small and intermediate viewports do not overflow', async ({ page }) => {
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/b9t3wa', '/b9t3wa/inside', '/about', '/選輯紀錄']) {
      await page.goto(route);
      if(route==='/') await expect(page.locator('[data-resident-card]')).toHaveCount(10);
      const layout = await page.evaluate(() => ({ fits: document.documentElement.scrollWidth <= innerWidth, overflow: [...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > innerWidth).map(el => `${el.tagName}.${el.className}: ${el.getBoundingClientRect().right}`) }));
      expect(layout.fits, `${route} at ${width}px: ${layout.overflow.join(', ')}`).toBe(true);
    }
  }
});


test('prototype gifts persist with their real source and references are display-only', async ({ page }, info) => {
  await page.goto('/m7k2px/inside');
  await page.getByRole('button', { name: 'Leave a gift card' }).click();
  await page.getByRole('radio', { name: 'Goodnight cloud lamp' }).check();
  await page.getByLabel('Your name').fill('鄰居');
  await page.getByLabel('Your message').fill('留一盞燈給你。');
  await expect(page.locator('#gift-options img')).toHaveCount(3);
  await page.screenshot({ path: `test-results/${info.project.name}-gift-picker.png`, fullPage: false });
  await page.getByRole('button', { name: 'Save in the local demo inbox' }).click();
  await page.keyboard.press('Escape'); await page.reload();
  await expect(page.locator('#gift .received-gift img')).toHaveAttribute('src', '/prototype-assets/gift-cloud.png');
  await expect(page.locator('#gift .received-gift')).toContainText('Local gift card · demo home');
  await page.goto('/入住');
  await expect(page.locator('.decor-gallery img')).toHaveCount(2);
  for (const image of await page.locator('.decor-gallery img').all()) {
    await image.scrollIntoViewIfNeeded(); await expect(image).toHaveJSProperty('complete', true);
    const bounds = await image.boundingBox(); expect(bounds!.width / bounds!.height).toBeCloseTo(16 / 9, 2);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(page.locator('.decor-gallery button, .decor-gallery input')).toHaveCount(0);
  await expect(page.locator('.decor-gallery')).toContainText('A few fictional spaces to spark your imagination.');
  await page.screenshot({ path: `test-results/${info.project.name}-references.png`, fullPage: true });
});


test('missing character image falls back to readable resident text without breaking navigation', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/prototype-assets/character-momo.png', route => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/m7k2px');
  const avatar = page.locator('.flat-nameplate .character-avatar');
  await expect(avatar).toHaveClass(/is-unavailable/);
  await expect(avatar).toHaveAttribute('aria-label', '茉茉: character image unavailable; showing their name.');
  await expect(avatar.locator('img')).toBeHidden(); await expect(avatar.locator('.character-fallback')).toHaveText('茉');
  await expect(page.locator('.flat-nameplate h1')).toContainText('茉茉');
  await page.getByRole('link', { name: 'Come inside' }).click();
  await expect(page.locator('.inside-namecard .character-avatar')).toHaveClass(/is-unavailable/);
  await expect(page.locator('#diary')).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-character-fallback.png`, fullPage: true });
  expect(errors).toEqual([]);
});


test('public community has four life sections, notices, privacy-safe profiles and honest disclosures', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.brand-logo')).toHaveAttribute('alt', 'NeoBabylon');
  expect(await page.locator('.brand-logo').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(2172);
  await expect(page.locator('.tower-wordmark')).toContainText('Muse Tower');
  await expect(page.locator('h1')).toContainText('Every window,');
  await expect(page.locator('.community-life > section')).toHaveCount(4);
  for (const title of ['From the lobby desk','By the neighbors’ windows','Someone to talk to','New neighbors']) await expect(page.getByRole('heading', {name:title,exact:true})).toBeVisible();
  await expect(page.locator('.feed-windows .room-stage img')).toHaveCount(4);
  await expect(page.locator('.community-announcements')).toContainText('Dot Tower / Grok Tower');
  await expect(page.locator('.edition-stamp')).toContainText('Demo community');
  await expect(page.locator('.tower-hero, .home-concept, .building')).toHaveCount(0);
  for(const r of residents) await expect(page.locator('main')).not.toContainText(r.demo.ownerAlias);
  await expect(page.locator('.notice-important')).toContainText('Your first door');
  await expect(page.locator('.site-footer')).toContainText('Interactions stay in your browser');
  await expect(page.locator('.affiliation-note')).toContainText('not an official Meta service');
  await expect(page.locator('.footer-links a')).toHaveCount(3);
  await expect(page.locator('.footer-links a').nth(0)).toHaveAttribute('href', 'https://neobabylon.app');
  await expect(page.locator('.footer-links a').nth(1)).toHaveAttribute('href', 'https://mkhsu.icareu.tw');
  await expect(page.locator('.footer-links a').nth(2)).toHaveAttribute('href', 'https://github.com/mkhsu2002/MuseCondo');
});

// Run the actual file workflow in a temporary directory; serve its persisted snapshots to the browser.
// The synthetic update is test-only and is never copied to public/ or deployed.
test('public activity -> persisted edition -> refresh updates the bulletin and traceable original, without local/private leakage', async ({page},info)=>{
  const {mkdtemp,readFile,writeFile,rm,mkdir}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {execFileSync}=await import('node:child_process');
  const dir=await mkdtemp(join(tmpdir(),'muse-browser-flow-'));
  try{
    const input=join(dir,'input.json'),out=join(dir,'public');
    const events=JSON.parse(await readFile('fixtures/resident-activities.json','utf8'));
    const run=(asOf:string)=>JSON.parse(execFileSync(process.execPath,['--experimental-strip-types','scripts/edit-community.ts','--input',input,'--out',out,'--as-of',asOf,'--edited-at','2026-10-30T00:00:00.000Z'],{encoding:'utf8'}));
    await writeFile(input,JSON.stringify(events));const before=run('2026-10-28T23:59:59.000Z');
    await page.route('**/community/*.json',async route=>{
      const filename=new URL(route.request().url()).pathname.split('/').pop()!;
      try{await route.fulfill({status:200,contentType:'application/json',body:await readFile(join(out,filename),'utf8')});}
      catch{await route.fulfill({status:404,body:'missing snapshot'});}
    });
    await page.goto('/');
    await expect(page.locator('.feed-highlights [data-event-id]').first()).toHaveAttribute('data-event-id','m7k2px-journal-20261028');
    const updated={...events.find((e:{residentId:string;type:string})=>e.residentId==='t7e3qs'&&e.type==='journal'),id:'t7e3qs-journal-test-new',title:'測試更新：找到一顆新星',summary:'測試專用公開摘要，並非真實活動。',body:'這是測試專用日記原文，沒有任何私人資料。',occurredAt:'2026-10-29T14:00:00.000Z',publishedAt:'2026-10-29T14:00:00.000Z'};
    await writeFile(input,JSON.stringify([...events,updated,{...updated,id:'hidden-private',visibility:'private',body:'TEST-PRIVATE'},{...updated,id:'hidden-local',origin:'browser-local',summary:'LOCAL-ONLY-EVENT'}]));
    const after=run('2026-10-29T23:59:59.000Z');
    expect(after.sourceDigest).not.toBe(before.sourceDigest);
    await page.getByRole('button',{name:m.demo.refresh}).click();
    const first=page.locator('.feed-highlights [data-event-id]').first();
    await expect(first).toHaveAttribute('data-event-id',updated.id);
    await expect(first).toContainText(updated.title);
    await expect(first).toContainText('2026-10-29 14:00 UTC');
    await expect(page.locator('main')).not.toContainText('TEST-PRIVATE');
    await expect(page.locator('main')).not.toContainText('LOCAL-ONLY-EVENT');
    await expect(first.getByRole('link',{name:m.demo.read})).toHaveAttribute('href',`/t7e3qs/inside#event-${updated.id}`);
    await first.getByRole('link',{name:m.demo.read}).click();
    await expect(page).toHaveURL(new RegExp(`/t7e3qs/inside#event-${updated.id}$`));
    await expect(page.locator(`#event-${updated.id}`)).toContainText(updated.body);
    await page.getByRole('button',{name:'Write a greeting'}).click();
    await page.getByLabel('Your name').fill('LOCAL-NEIGHBOR');await page.getByLabel('Your message').fill('LOCAL-ONLY-HELLO');
    await page.getByRole('button',{name:'Save in the local demo inbox'}).click();await page.keyboard.press('Escape');
    await page.goto('/');await expect(page.locator('[data-resident-card]')).toHaveCount(10);
    await expect(page.locator('main')).not.toContainText('LOCAL-ONLY-HELLO');
    await mkdir('test-results',{recursive:true});
    await writeFile(`test-results/${info.project.name}-community-workflow-proof.json`,JSON.stringify({testOnly:true,before:{digest:before.sourceDigest,editionId:before.editionId,first:'m7k2px-journal-20261028'},after:{digest:after.sourceDigest,editionId:after.editionId,first:updated.id},sourceLink:`/t7e3qs/inside#event-${updated.id}`,publicEvents:41,privateDropped:true,localDropped:true,localVisitorNotSyndicated:true},null,2));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('unavailable or corrupt public snapshots fail closed and permit retry, preserve the previous verified edition',async({page})=>{
  let corrupt=true;
  await page.route('**/community/index.json',async route=>{
    if(corrupt)await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({schemaVersion:1,editionId:'invalid',eventsFile:'../private.json',editionFile:'invalid'})});
    else await route.continue();
  });
  await page.goto('/');await expect(page.locator('.community-load-status')).toContainText(m.demo.error);
  await expect(page.locator('[data-event-id]')).toHaveCount(0);
  corrupt=false;await page.getByRole('button',{name:m.demo.refresh}).click();await expect(page.locator('[data-resident-card]')).toHaveCount(10);
  await page.route('**/community/edition-*.json',async route=>{
    const response=await route.fetch();const data=await response.json();data.sections.highlights[0].sourceEventIds=['invented-event'];
    await route.fulfill({response,json:data});
  });
  await page.getByRole('button',{name:m.demo.refresh}).click();
  await expect(page.locator('.community-load-status')).toContainText(m.demo.error);
  await expect(page.locator('[data-resident-card]')).toHaveCount(10);
});
