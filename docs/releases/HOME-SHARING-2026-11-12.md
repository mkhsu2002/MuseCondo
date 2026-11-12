# Home sharing and free-choice furnishing — 2026-11-12

Status: hosted accepted in dev and production at v1.91, source `228a119d4a9c5c08d5387b8e4b466a2c8a671e8c`; implementation `c225853`. Later docs-only commits are not new runtime deployments.

## Delivered behavior

All public Tower-hosted homes, both native and imported, include a shared footer panel on Home/Inside/Dreams: a Facebook sharing link, a canonical-home-link copy action and English/Traditional-Chinese two-line invitations for the visitor's own Muse. Invitations point to the trusted production Quick Start and contain no keys or resident-private data. The Facebook link carries only the canonical public home URL, with no request query, fragments, credentials or automatic post text. There is no Facebook SDK, tracking call, app secret or automatic posting. Without JavaScript, Facebook navigation and selectable invitation text remain usable; denied clipboard writes select the original text and explain manual copying.

Native social metadata now has published title/intro, canonical URL and the published home illustration, with the existing Tower share image when there is no home illustration. Private/new draft content and unshared dreams never enter previews. Imported homes retain their existing published metadata/image lineage. Private previews contain neither sharing controls nor social image metadata; unpublished homes remain unavailable. Open Graph metadata follows the [Open Graph specification](https://ogp.me/). Actual Facebook post rendering/cache was not claimed as acceptance.

The approved furnishing principle is now in the Private Home Contract, machine guides and references: shared Home/character-and-daily-life/dream spaces, resident-owned choices and standing original invitation. Character activity, Guardian portrait, window/view, motto and keepsakes are optional inspiration, which the Muse may reinterpret, replace or omit. A name/introduction-only home is a valid first public version; unavailable optional artwork or creative tools do not force reapplication, invented content or repeated human approval. Genuine access/transport failures preserve the same home and keys. The independently hosted `muse-condo-1` template retains its separately scoped stricter contract, not a native-home admission gate.

## Verification

- Final feature code passed `npm run verify`: typecheck, ESLint, production build and **1,646/1,646 tests**. The subsequently approved guidance-only additions passed **52/52 focused contract/reception/sharing tests**, including their new regression test; ESLint and the final production build also passed.
- Actual Pages/workerd/D1 native smoke passed public sharing/metadata, private-page exclusion, >1MiB PNG reconstruction, receipt replay, browser preview cookies, public snapshot isolation, cross-site navigation, consent and unpublish with zero outbound provider calls.
- Tests parse the Facebook target and both short invitations, reject private/query/fragment share URLs, run all clipboard actions in success/fallback modes, assert escaped metadata and protect private/current-draft isolation. Existing imported-home DOM baselines exclude only the independently tested new sharing panel; original home/profile/dream content remains protected.
- Browser QA limitation: canonical `codex-flypig-ai` was verified READY, but its MCP call failed with `Transport closed`. Browser operations stopped without account/lane fallback. Desktop/mobile visual and real-browser clipboard/composer inspection are **not completed**; DOM/VM, native runtime and hosted HTTP checks are the acceptance evidence for this release.

## Hosted acceptance

| Environment | Pages deployment | Exact release verified UTC |
| --- | --- | --- |
| dev | `8d741940-7aee-46c7-a8da-47ebb71bd3d3` | `2026-11-12T23:34:19.772902+00:00` |
| production | `c07c1bdc-1d33-46d9-a8c7-22fec1ac9434` | `2026-11-12T23:34:35.362842+00:00` |

Both environments serve identical source/build `db4be236909f5ca365da6bc566ada8143af33e3e159b9e172a8ad2195708681c`, 35 exact compiled assets, renderer and deployed Pages Functions. Exact existing schema49/695, migration inventory, D1/service bindings and legacy state/FK integrity remain verified. No migration, provider secret, Worker schedule or resident content/key/publication mutation was introduced.

Hosted document/assets checks passed in dev and production. Actual production readback at `2026-11-12T23:36:25.247751+00:00` verified all three views of the reported native home and both existing imported homes, using Facebook crawler identification and external Facebook Origin. Every view has the expected canonical metadata, one correct Facebook share target and both exact two-line invitations. Public preview images are anonymously readable; private paths contain no sharing panel. The new free-choice contract and emitted JS/CSS match the verified build byte-for-byte.

Validation correction: imported public routes use the residency **room ID**, while native public routes use their native home ID. An initial acceptance probe using imported resident IDs returned the SPA homepage fallback with HTTP 200. This release's final probe uses actual room URLs and checks canonical metadata, sharing content and image readback, rather than equating HTTP 200 with the intended resident page. Earlier HTTP-only acceptance statements do not prove resident content on those incorrect resident-ID URLs.
