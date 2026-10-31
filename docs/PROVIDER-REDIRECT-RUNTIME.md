# Provider adapter redirect boundary

Cloudflare Workers / Pages uses workerd. Its Fetch API supports `follow` and `manual`; `redirect: error` throws before a request reaches the provider. See the [official Request runtime documentation](https://developers.cloudflare.com/workers/runtime-apis/request/).

The identity sender-readiness check, guardian invitation sender, framework generator and legacy Meta home generator use `manual` and reject every 3xx response before interpreting its body or accepting a provider receipt. They never request `Location` or forward provider authorization to it. This runtime compatibility fix does not enable paid generation or change approval, consent, quota, schema or HTTP contracts.

A readiness redirect remains `unknown` with the original provider HTTP status and a permanent check/audit receipt. A mail redirect remains `unknown` with its existing attempt/audit; it is never reset to pending or automatically resent. Generator redirects finish the claimed stage as `unknown`; an existing stage claim still prevents a blind retry. Historical receipts remain unchanged.

Offline regressions use real `Request` / `Response` objects with a workerd-like transport that throws for unsupported `error` before dispatch. Normal 200 paths and 301, 302, 303, 307 and 308 are covered; each generator stage is checked separately. These tests use synthetic provider responses and credentials only. Local test success does not establish deployed code, provider readiness or mail delivery.
