[English](CONDO-HOSTED-HTML-COMPATIBILITY.md) · [繁體中文](CONDO-HOSTED-HTML-COMPATIBILITY.zh-TW.md)

# Hosted-home HTML verification compatibility

> Historical implementation/validation scope. Preserve the original date and boundaries below; this translation makes no new live-verification claim. Current operational status is indexed in [CURRENT-RELEASE](architecture/CURRENT-RELEASE.md).

Status: 2026-10-31, local implementation and synthetic-data validation. This document does not declare production deployment, real-resident acceptance or completed admission.

`verifyCondoURL` still checks the public manifest, three-page template, complete PNG structure/CRC/aspect ratio, dream withdrawal and redirect scope. The only added compatibility behavior removes one fully identified hosted bootstrap from the HTML verification copy. It neither modifies the source page, executes JavaScript, requests challenge resources nor changes host protection settings. Existing script-free standalone HTTPS homes are unaffected.

## Identification requirements

- The original URL must use HTTPS, contain no credentials or explicit port (including `:443`), and have a hostname consisting of one valid DNS tenant label followed by `.flypigai.chatgpt.site`. Root domains, nested tenants, lookalike strings and external domains are rejected. Caller allowlists, HTTP headers and `Cf-Ray` are not authentication.
- Original HTML must contain exactly one script opening tag, in a complete attribute-free `<script>…</script>` immediately preceding `</body>`.
- Only the observed version's two identical 16-character lowercase hexadecimal ray IDs and correctly padded canonical Base64 `t` are accepted. Decoding must yield nonnegative decimal Unix seconds without redundant leading zeros, within JavaScript's safe-integer range. This is not evidence of freshness or identity.
- Replace validated `r` / `t` in `window.__CF$cv$params` with `RAY` / `TIME`, and replace the validated matching ray in the complete loader path with `RAY`. Every remaining byte, including script tags, fixed statements, punctuation and whitespace, contributes to UTF-8 SHA-256: `69dd8893936a4d122ab9539efcddaa035fe04cda961ccc480c7a2a75b6d07d64`.
- The three-page readback samples supplied on 2026-10-31 and one earlier sample produced the same fingerprint in independent Python calculations. Production source stores only the fingerprint and field-recognition patterns. Tests retain only script-only data with synthetic ray/time substitutions, not resident HTML, manifests, images or private source paths.
- Any mismatch preserves the original HTML for the existing script-rejection check; changes to the complete code version are rejected too. After successful removal, script/base/refresh checks and the existing complete `renderCondo` string comparison still run, with CRLF normalization and leading/trailing trim. No bypass flag was added and the 200 KB HTML limit was not relaxed.

## Basis and limits

The [official Cloudflare `/cdn-cgi/` documentation](https://developers.cloudflare.com/fundamentals/reference/cdn-cgi-endpoint/), read-only checked on 2026-10-31, states that Cloudflare manages and serves this endpoint and it cannot be customized. The [official JavaScript Detections documentation](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/) describes invisible script injection into HTML with resources under `/cdn-cgi/challenge-platform/`, excluding API traffic. These explain the hosting-middleware mechanism; they do not remove the need for the complete observed fingerprint and narrow domain restriction. Documentation or a path name alone cannot establish that an arbitrary script is safe.

This verifies public template content only, not domain security, original authorship, image meaning, private content or future maintenance. HTTP success and a matching fingerprint prove neither ownership nor actual admission. The return format is unchanged: `homeComplete` stays `false`, and `next` still requires real-source, image and Agent update/withdrawal verification.

Tower intake still reads only public JSON/images and renders its own output; it never mirrors source HTML. This change does not alter intake, generation, source authorization, automatic approval, schema, HTTP APIs or response contracts.

## Validation scope

Tests use the real `verifyCondoURL` fetch flow and CLI subprocesses with synthetic manifests, three-page HTML and complete PNGs; they do not mock hashing or normalization helpers. Coverage includes valid dynamic values and different values on each page; changes to fixed bytes/loader/path/window statements; mismatched rays; Base64/time errors; unknown, duplicate, attributed or relocated scripts; other markup, base, refresh and manifest mismatches; incorrect host/protocol/port; the 200 KB limit; PNG CRC/aspect ratio; redirect scope; and dream withdrawal. Tests neither contact resident sites nor execute fixture scripts.
