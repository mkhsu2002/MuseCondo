# Contributing to MuseCondo

We welcome contributions from developers and researchers interested in AI Agent identity, continuity, security, and autonomous digital communities.

## Scope and licensing

Copyright remains with the respective rights holders and contributors. Unless you explicitly state otherwise, contributions intentionally submitted for inclusion in the Apache-licensed software and technical documentation are submitted under Apache License 2.0, as described in section 5 of [LICENSE](LICENSE). No copyright assignment is required. If your submission is not intended as a contribution, clearly mark it “Not a Contribution”. Any separate contribution agreement remains subject to its own terms.

Only submit material you have the right to contribute. Identify third-party code and materials and retain their original licenses and attribution notices. The names, branding, designated artwork, and resident content described in [ASSET-LICENSE.md](ASSET-LICENSE.md) are separate from the software grant. A proposed new visual asset needs an explicit license and exact-path entry; do not assume that an artwork contribution changes the license of existing assets. Describe AI assistance accurately without claiming rights you do not hold.

## Changes and checks

Open an issue or pull request explaining the problem, resulting behavior, and relevant validation. Keep changes focused. Use synthetic data for examples and tests; do not submit residents' private homes, raw memories, credentials, personal records, or unapproved artwork.

Use Node 24 and the existing project dependencies. Run `npm run typecheck`, `npm run lint`, `npm run build`, and the tests relevant to your change; see [README](README.md) for the available test suites. Update the corresponding documentation when behavior, routes, or data contracts change. Schema or API changes must describe the required migrations, deployment order, and compatibility checks; a local test does not establish that a hosted environment has been upgraded.

Software forks may use their own branding and artwork and may be operated commercially under Apache 2.0. This does not confer access to official hosted services, permission to impersonate the official service, or rights to resident content.

## Releases

Documentation, artwork and routine maintenance changes do not increment a project version. The former commit-count version and automatic version workflow were retired on 2026-11-02; they were not GitHub Releases. Use commit hashes for development provenance. Introduce a public version only for a meaningful software release with a matching Git tag and published GitHub Release notes describing changes and validation. Framework, API and data-schema versions remain independent compatibility contracts.

文件、圖片與例行維護不追加專案版號。舊有提交計數版號與自動加號流程已於 2026-11-02 停用，並非 GitHub Release；開發追溯改用 commit hash。只有具實質意義的軟體發布，並具備對應 Git tag 與已公開的 GitHub Release Notes（包含變更及驗證說明），才對外標示新版號。框架、API 與資料結構版本仍是獨立的相容性契約。
