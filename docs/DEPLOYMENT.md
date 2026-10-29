# Public demo deployment

> Historical Tower prototype deployment guide. The current framework scope is defined in [README.md](../README.md), covering standalone homes and Towers. The official Tower uses `https://musetower.neobabylon.app`; current source is `main`. Old branch and expired-login notes below describe the original demo release, not current infrastructure. For the developing API deployment use [PAGES-RUNTIME.md](PAGES-RUNTIME.md).

Muse Tower is a static demonstration of ten fictional residents. Deploy only the built `dist/` directory. It contains no model credentials, raw private memories, server job storage or enabled model endpoints.

## Targets and scope

- Source repository: `mkhsu2002/MuseCondo`.
- Source branch: `codex/muse-tower-flat-prototype`.
- Preferred future domain: `musetower.neobabylon.app`.
- Existing public-host fallback: `https://mkhsu2002.github.io/MuseCondo/`.
- The NeoBabylon official site and other repositories are outside this deployment.

The existing Cloudflare Wrangler login could not be refreshed. No new token, OAuth permissions, login or DNS changes were created. The same repository's existing GitHub Pages hosting can publish the static demo without new account credentials. Its build output is kept on a separate `gh-pages` branch; `main` remains intact.

## Build

For the fallback GitHub Pages project path:

```sh
npm ci
MUSE_BASE_PATH=/MuseCondo/ npm run build
node scripts/check-static.mjs
```

For a root-domain Cloudflare Pages deployment, build with `MUSE_BASE_PATH=/`. Do not deploy the source repository root. The builder emits resident directory index files, the entry explanation, `.nojekyll` and `404.html`, so direct links and reloads do not depend on a broad SPA rewrite.

Only a normal non-force push is used. A published build should include a `build-info.json` identifying its source commit. Verify that file, the root page, a resident route, the content route, a real unknown-path 404 and the logo/character/room assets before reporting the demo as live. Preview commands are for local verification, not a public production server.

## Product presentation

The approved NeoBabylon logo is displayed beside the Muse Tower name. The homepage presents four sections of independently public community life and an announcement rail; product and move-in explanations live under `/about`. Recruitment and other towers are explicitly in preparation, with no opening dates or official affiliation claims. Fictional residents and local-only interactions are disclosed. The footer links NeoBabylon, M.K. and this repository and states that the demo is not an official Meta service or endorsement.

The existing user-approved logo is an explicit non-Meta prototype brand exception. See `public/brand-provenance.json`; the record does not grant downstream logo rights or license the repository. No repository LICENSE has been added.

## Still disabled

Real move-in, model generation, shared visitor messages, autonomous resident publishing and daily manager updates are not connected. The public deployment does not change those facts. Moving to the custom domain or enabling Meta requests is a separate configuration step using existing authorized access and an approved generation budget.


## Updating the public bulletin

Follow [COMMUNITY.md](COMMUNITY.md) to edit authorized public events and run the editor before the build. The workflow writes immutable source/edition files and publishes `community/index.json` last. Publish the entire matching `dist/`; never upload only the pointer. Browser refresh fetches already-published snapshots and verifies the source SHA-256; it does not call Meta or run the editor. Preserve event dates when editing. GitHub Pages runs neither authenticated resident publishing nor a daily scheduler.

## Cloudflare Pages: blank page with only the skip link

If the deployed HTML still contains `<script type="module" src="/src/main.ts">` and no compiled CSS link, the repository source was uploaded instead of the Vite output. Set build command `npm run build`, output directory `dist`, root directory empty, production branch `main`, `MUSE_BASE_PATH=/`, and `NODE_VERSION=24`. Vite preset is optional when these fields are explicit. Save and redeploy. Direct Upload must upload the locally built `dist` contents.

The build now runs `scripts/check-build.mjs`: it rejects raw TypeScript entrypoints, missing emitted JS/CSS and mismatched base paths. It only runs when a build is actually executed, and cannot fix a wrongly selected output folder in the dashboard. It adds no Wrangler configuration, credentials, bindings or backend deployment. See [Cloudflare build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/).
