import {createHash} from 'node:crypto';

// Fingerprint covers the entire observed plain <script> block, including tags.
// Only the two equal ray IDs and canonical numeric timestamp become sentinels.
const bootstrapFingerprint='69dd8893936a4d122ab9539efcddaa035fe04cda961ccc480c7a2a75b6d07d64';

/** Verification-copy compatibility only; never executes or mirrors hosted HTML. */
export function normalizeCondoHostedHTML(html:string,sourceURL:string):string{
 // Match the original authority, so URL's default-port normalization cannot admit :443.
 if(!/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.flypigai\.chatgpt\.site\//i.test(sourceURL))return html;
 if((html.match(/<script\b/gi)||[]).length!==1)return html;
 const start=html.indexOf('<script>'),end=html.indexOf('</script>',start);
 if(start<0||end<0||html.slice(end+9,end+16)!=='</body>')return html;
 const script=html.slice(start,end+9);
 const params=/window\.__CF\$cv\$params=\{r:'([a-f0-9]{16})',t:'([A-Za-z0-9+/]+={0,2})'\}/.exec(script);
 const loader=/\/cdn-cgi\/challenge-platform\/scripts\/jsd\/main\.js\?ray=([a-f0-9]{16})'/.exec(script);
 if(!params||!loader||params[1]!==loader[1])return html;
 const timestamp=Buffer.from(params[2],'base64');
 const seconds=timestamp.toString('latin1');
 if(timestamp.toString('base64')!==params[2]||!/^(0|[1-9][0-9]*)$/.test(seconds)||!Number.isSafeInteger(Number(seconds)))return html;
 const normalized=script.replace(params[0],"window.__CF$cv$params={r:'RAY',t:'TIME'}").replace(loader[0],"/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=RAY'");
 if(createHash('sha256').update(normalized,'utf8').digest('hex')!==bootstrapFingerprint)return html;
 return html.slice(0,start)+html.slice(end+9);
}
