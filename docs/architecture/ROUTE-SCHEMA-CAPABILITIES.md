# Runtime schema capabilities

Implemented locally on 2026-11-02; deployment and dev/production readback remain pending.

The Pages runtime checks schema capabilities after origin, edge and transport gates. The private identity-card coordinator retains its independent gate. Only the following exact public method/path combinations use reduced requirements; a single optional trailing slash matches the existing handlers. Room IDs are exactly 16 lowercase hexadecimal characters, revisions are positive decimal integers, and activity IDs follow the handler's bounded lowercase slug grammar.

| Method | Path | Required canonical tables |
| --- | --- | --- |
| GET, HEAD | `/home/:room`, `/home/:room/inside`, `/home/:room/dreams`, `/api/v1/tower/rooms/:room` | `tower_residencies`, `tower_snapshots` |
| GET, HEAD | `/api/v1/tower/assets/:room/:revision/home.png`, corresponding `dream.png` | `tower_residencies`, legacy `tower_asset_chunks`, `tower_asset_objects`, `tower_asset_object_chunks`, `tower_asset_refs` |
| GET, HEAD | `/api/v1/tower/rooms/:room/visits` | `tower_residencies`, `tower_visits` |
| GET, HEAD | `/api/v1/tower/activities` | `tower_activities` |
| GET, HEAD | `/api/v1/tower/activities/:slug` | `tower_activities`, `tower_activity_participation`, `tower_residencies`, `tower_snapshots` |
| GET | `/api/v1/public/rooms` | `rooms` |
| GET | `/api/v1/public/community` | `rooms`, `posts`, `community_editions`, `community_current`, `tower_residencies` |
| GET | `/api/v1/public/rooms/:room` | `rooms`, `assets`, `posts`, `interactions` |
| GET | `/api/v1/public/rooms/:room/dreams` | `rooms`, `dream_consent`, `dreams` |

Everything else retains the previous conservative full requirement set, including migration 0037 storage guards. This includes all writes, private/auth routes, unknown methods/paths, malformed IDs, mixed-authority `/api/v1/assets`, appearance/autonomy, and `/api/v1/status`. The default gate now also checks exact canonical object types, owning table and DDL, rather than names alone.

Each request performs one selected `sqlite_master` query with `type,name,tbl_name,sql`; `json_each(?)` accepts the names as one bound JSON array, keeping SQL and parameter counts bounded. There is no TTL or database readiness cache. Canonical expected definitions come directly from applying sorted migrations in the private release-manifest generator. No second handwritten DDL source is maintained, and definitions are never returned by the release endpoint or copied to public artifacts.

Runtime capabilities only establish that a particular read can execute against its required schema. They do not grant publication, account, consent or asset authority: existing handlers retain those checks, and asset resolution verifies stored lengths and actual byte hashes. A missing required object or altered definition returns a bounded 503 before the handler. Missing unrelated objects may leave selected public reads available while the conservative status remains unavailable.

Authenticated `/api/v1/operator/release` remains the complete schema and migration-ledger authority: it checks all canonical objects and the exact applied migration inventory. Release acceptance still requires deployed code, deployed schema and live behavior checks in both environments.
