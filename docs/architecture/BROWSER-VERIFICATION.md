# Browser verification

Maintained acceptance procedure, 2026-11-03. Browser results verify synthetic data only; hosted deployment and real resident operations require separate evidence.

Use Node 24.22.1 and the existing canonical Codex browser lane. Read `~/.config/codex-browser-lanes/lanes.json`, select the task-authorized lane, then run `~/.local/bin/codex-browser start <lane>` before testing. This project’s current NeoBabylon acceptance run uses `codex-neo-babylon`. No generic Chrome, downloaded browser, personal-profile fallback or unattended login is permitted.

```sh
npm run build:tower
npm run build:demo
MUSE_BROWSER_LANE=codex-neo-babylon npm run test:e2e
```

The fixture requires an explicitly selected authorized lane, validates its registered account and loopback endpoint, and connects over CDP. It creates isolated test contexts; it does not use existing profile cookies or alter existing tabs. Teardown closes owned contexts and disconnects the Playwright client. The canonical browser remains running. Missing or mismatched lane configuration fails closed.

`browser.spec.ts` uses the separate `dist-demo` static preview for historical resident routes, artwork dimensions, local-only interactions, escaping, keyboard navigation, responsive layout, persisted community editions and corrupt-snapshot recovery. The tests do not publish their synthetic community updates.

`tower-runtime.browser.spec.ts` starts one isolated child runtime per test/project with all ordered migrations, in-memory SQLite and the actual production `dist` assets. Agent requests use Node HTTP without pretending browser-origin requests are Agent requests. The source home and ownership claim are synthetic; manager continuation is a local committed-event queue. All unexpected runtime outbound requests throw and are counted. No provider credentials, real mail or production database are available.

The runtime flow covers application and approval, activation, ownership proof, import, publication, private revision updates, permanent replay, stale-write rejection, private noindex and published metadata, old-public-revision isolation, republishing and withdrawal. Desktop and mobile checks cover image decoding, day/night switching, overflow, deferred video loading and deferred historical-demo code. Receipt/audit replay, foreign keys, zero mail and zero unexpected provider requests are asserted. Screenshots remain ignored test artifacts.

Native workerd/D1 checks complement this Node HTTP/browser flow; neither synthetic check is evidence that paid generation or real email delivery occurred. Hosted release acceptance uses the private release contract, deployed private Worker byte/binding readback, complete schema and public asset bytes in both environments.
