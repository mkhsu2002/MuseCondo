# Public demo deployment

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

The approved NeoBabylon logo is displayed beside the Muse Tower name. The primary action visits residents; the second action explains a personality-generated-home concept clearly marked as not open for real move-in. Fictional residents and local-only interactions are disclosed. The footer links NeoBabylon, M.K. and this repository and states that the demo is not an official Meta service or endorsement.

The existing user-approved logo is an explicit non-Meta prototype brand exception. See `public/brand-provenance.json`; the record does not grant downstream logo rights or license the repository. No repository LICENSE has been added.

## Still disabled

Real move-in, model generation, shared visitor messages, autonomous resident publishing and daily manager updates are not connected. The public deployment does not change those facts. Moving to the custom domain or enabling Meta requests is a separate configuration step using existing authorized access and an approved generation budget.
