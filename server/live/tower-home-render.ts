import { renderCondo, type CondoPage } from '../../src/framework/condo-render.ts';
import type { PublicCondoSite } from '../../src/framework/condo.ts';
/** Public metadata accepts only an already consent-filtered, published projection. */
export type TowerHomeTarget = {
    kind: 'public';
    origin: string;
    roomId: string;
    revision: number;
} | {
    kind: 'private';
    prefix: string;
    revision: number;
};
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
function metadata(site: PublicCondoSite, page: CondoPage, target: TowerHomeTarget) {
    if (target.kind === 'private')
        return '<meta name="robots" content="noindex, nofollow">';
    const origin = new URL(target.origin).origin;
    const canonical = origin + '/home/' + target.roomId + (page === 'home' ? '' : '/' + page);
    const image = origin + '/api/v1/tower/assets/' + target.roomId + '/' + target.revision + '/home.png';
    return `<link rel="canonical" href="${escape(canonical)}"><meta property="og:type" content="website"><meta property="og:site_name" content="Muse Tower"><meta property="og:title" content="${escape(site.home.name)}"><meta property="og:description" content="${escape(site.home.intro)}"><meta property="og:url" content="${escape(canonical)}"><meta property="og:image" content="${escape(image)}">`;
}
export function renderTowerHome(site: PublicCondoSite, page: CondoPage, target: TowerHomeTarget, sourceURL: string) {
    const privatePrefix = target.kind === "private" ? target.prefix : undefined;
    const rev = target.revision;
    const roomId = target.kind === "public" ? target.roomId : "";
    const base = privatePrefix
        ? privatePrefix + "/preview/home"
        : `/home/${roomId}`, assets = privatePrefix
        ? `${privatePrefix}/assets/${rev}`
        : `/api/v1/tower/assets/${roomId}/${rev}`;
    const visitsWidget = !privatePrefix && page === "inside" ? `<section id="tower-visits" class="tower-visits tower-visits-widget" data-visit-room="${roomId}"><h2>Visitor corner</h2><p>Leave a greeting, send a small gift or invite this neighbor privately.</p><div data-visit-list></div><button type="button" data-visit-more hidden>Earlier visits</button><p data-visit-status role="status" aria-live="polite">Opening the guestbook…</p><p data-visit-login><a href="/move-in">Sign in to visit</a></p><form hidden><label>Visit type<select name="kind"><option value="message">Leave a message</option><option value="gift">Send a free gift</option><option value="invitation">Send a private invitation</option></select></label><label>Your name for this visit<input name="nickname" maxlength="24" autocomplete="nickname" required></label><label data-visit-gift hidden>Choose a small gift<select name="giftId"><option value="gift-sprout">A little sprout 🌱</option><option value="gift-cloud">A cloud ☁</option><option value="gift-coffee">A cup of coffee ☕</option></select></label><label>Your message<textarea name="body" maxlength="280" rows="3" required></textarea></label><p class="visit-note" data-visit-privacy></p><button type="submit">Send this visit</button></form><p><a href="/tower-visits.html">My visits and invitations</a></p></section>` : "";
    const towerRootURL = target.kind === 'public' ? new URL('/', target.origin).href : '/';
    return renderCondo({...site, home: {...site.home, towerRootURL}}, page)
        .replace("</head>", metadata(site, page, target) + "</head>")
        .replace("</head>", visitsWidget ? '<link rel="stylesheet" href="/tower-visits.css"><script src="/tower-visits.js" defer></script></head>' : "</head>")
        .replace("</main>", visitsWidget + "</main>")
        .replaceAll("./index.html", base)
        .replaceAll("./inside.html", privatePrefix ? privatePrefix + "/preview/inside" : base + "/inside")
        .replaceAll("./dreams.html", privatePrefix ? privatePrefix + "/preview/dreams" : base + "/dreams")
        .replaceAll("./assets/home.png", assets + "/home.png")
        .replaceAll("./assets/dream.png", assets + "/dream.png")
        .replaceAll("./assets/condo.css", "/condo-template.css")
        .replace("</footer>", `<p><a href="/">Back to Muse Tower</a> · <a href="/neighbors">Neighbors</a> · ${!privatePrefix && page !== "inside" ? `<a href="${base}/inside#tower-visits">Leave a greeting</a> · ` : ""}<a href="${sourceURL.replace(/condo\.json$/, "")}" target="_blank" rel="noopener noreferrer">Original home ↗</a></p></footer>`);
}
