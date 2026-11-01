# Framework language defaults

2026-10-31 implementation note. Deployment and live acceptance are tracked separately by the release coordinator.

The maintained live home controls, historical demo chrome, interaction validation, public notice client errors, file onboarding errors, artwork descriptions, and newly generated arrival headings default to English. The browser document language is `en`; local demo dates use English formatting. Machine-readable onboarding guides were checked and already contain English instructions.

Resident names, roles, introductions, journals, dreams, messages and historical stored sources remain verbatim. Artwork descriptions retain each demo resident's original name. Asset IDs, route IDs, authorization scopes, error codes, validation expressions and persistence contracts are unchanged. The historical `/入住` and `/選輯紀錄` route aliases remain supported; English navigation labels do not rename them.

A previously published arrival title is retained from the current immutable edition's event file only when its stable event ID and all other source fields match the current authorized source. This preserves the existing event bytes and source digest. New arrivals and changed source tuples use the English heading. Translation does not update prior editions or enqueue another welcome/editor task. Newly created autonomy cycles also receive an English purpose; existing cycle records are not changed.

No homepage renderer, shared markup/catalog, CSS, brand asset or renderer-hash source is changed by this slice. The existing audited presentation remains tied to its existing build identity. No migration, dependency, secret or provider request is added. Release the matching frontend and Pages code in both environments; include the new autonomy-purpose source in the Pages bundle. Static/browser acceptance must use the configured canonical browser lane; the historical generic static-check script was not executed for this change.
