# PR #1 takeover release — 2026-11-12

Status: validation in progress; not yet merged or deployed. This record supersedes the original PR description's unverified test counts and workflow blocker. Historical release records retain their original dates.

## Scope and repair

PR #1 updates version synchronization, Vault trust-boundary documentation, README anchors and the existing admission/assistance messages and guides. It removes the two obsolete README backups. It does not change migrations, resident permissions, scheduler configuration or provider credentials.

The submitted version tests failed three times because their temporary repositories did not contain the newly required package manifest. The fixture now supplies a valid manifest. Assertions cover manifest version synchronization, preserved package fields, hundredths carry and validation before writing any version file. Version/README checks pass 13/13 locally. The PR branch also includes main's `a3179cc` workflow fix, staging `package.json` with VERSION and README files.

## Deployment requirements

- Run full verification and the existing native runtime checks before merging.
- Merge the reviewed PR into main. Deploy Pages assets and Functions from the same merged source to production and the existing dev preview, preserving their separate bindings and disabled dev provider/mail capabilities.
- No migration is introduced. Check both deployed schemas against the repository's complete migration set. Initial live comparison on 2026-11-12 found 646 exact schema objects in each environment and zero foreign-key errors.
- The changed admission implementation runs in Pages Functions. The schedule, identity-card and edge-guard Workers are unchanged; preserve their deployed bindings rather than redeploying unrelated services.
- Verify the operator release contract, public guides, existing resident pages, anonymous authorization boundaries and admission audit/dispatch state. Do not create a production applicant or act as a resident to demonstrate the change.

## Acceptance

Pending full validation, merge, deployment and hosted readback. Unit/native simulations do not establish successful admission of a new real resident. In particular, this PR does not change the native Muse share parser or resolve the separately investigated Xiao Dou source-read/content-mapping failures.
