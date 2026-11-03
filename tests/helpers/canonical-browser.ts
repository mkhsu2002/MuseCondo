import {test as base, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
// Connect only to an explicitly selected, already started Codex lane. Never launch Chrome.
export const test=base.extend({
 browser:[async({playwright},use)=>{
  const laneName=process.env.MUSE_BROWSER_LANE;
  if(!laneName||laneName!=='codex-neo-babylon')throw new Error('Select an authorized canonical lane with MUSE_BROWSER_LANE; run codex-browser start first.');
  const registry=JSON.parse(readFileSync(join(homedir(),'.config/codex-browser-lanes/lanes.json'),'utf8'));
  const lane=registry.lanes[laneName];
  const expected='mksaid2025@gmail.com';
  if(!lane||lane.account!==expected||lane.cdpEndpoint!==`http://127.0.0.1:${lane.port}`)throw new Error('Canonical lane registry mismatch');
  const browser=await playwright.chromium.connectOverCDP(lane.cdpEndpoint);
  // New isolated contexts are owned by Playwright. The canonical profile/tabs remain untouched.
  try{await use(browser);}finally{await browser.close();}
 },{scope:'worker'}],
});
export {expect};
