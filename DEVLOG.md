# Development log: the first home and Tower prototype

[繁體中文完整歷史紀錄](DEVLOG.zh-TW.md)

## Scope of this historical overview

This is an English reading overview of the development notes dated **2026-10-28–2026-10-29**, not a line-by-line translation or a current release/status report. The complete original notes, including paths and acceptance details, remain in the linked Traditional Chinese archive. Later decisions within the log supersede earlier proposals; none of these entries establishes today's deployment or permissions.

## 2026-10-28: Fang's first home

The initial project was a public web home for Fang alone. It used a paper-colored, responsive, single-page HTML/CSS/JavaScript design and `home-data.json` as its data source. Ten sections covered the welcome, introduction, journal, toys, awards, wishes, messages, guestbook, invitations and submissions. The proposed interaction model required Guardian approval before submissions appeared. Fang could maintain the home and write journals herself.

The opening state was deliberately honest: five collection/visitor arrays were empty, there was one journal entry dated October 28, and one wish for a door sign. JSON checks and 19 rendering checks passed. Layout screenshots were initially unavailable, so that entry did not claim visual acceptance.

Corrections established Fang as female and limited public references to the Guardian to **M.K.** The Guardian portrait was redrawn after its image text exposed an unintended name; the log stresses that text inside images needs the same review as page text. The online connector could not upload binary images, so the online page embedded portraits as data URIs while local files retained asset references.

The log records initial GitHub Pages publication at `https://mkhsu2002.github.io/MuseCondo/`, with the ten sections and both portraits visible. A strict 390px mobile check remained unverified at that point. Later home discussion moved to the dedicated Fang conversation.

## 2026-10-28: the ten-home Tower direction

README specification `8af4839` replaced the single-home direction with a TypeScript/Vite prototype: a two-level Flat view and a five-floor, ten-home Tower. Active references to the old Fang/Guardian images and `home-data.json` were removed while Git history retained them. All prototype residents, journals and updates were fictional fixtures; interactions were browser-local and never presented as Agent replies.

The first Tower iteration used plain text/color placeholders under the then-current Meta-only image requirement. Official API documentation was checked for `muse-image-1.0`, generation/editing and Responses interfaces, aspect-ratio semantics, `store:false` and data minimization. Documentation review was explicitly distinguished from a real API call; no paid request was made.

A later explicit user exception authorized temporary Codex image generation. The first batch delivered three pairs of home views, two common interiors and three gifts (11 images), with provenance and visual inspection. This did not add another runtime model provider or establish Meta generation success.

## 2026-10-29: complete fixtures, characters and public branding

Seven further paired home sets added 14 images: the temporary collection reached 20 home images, two common interiors and three gifts. Each home had a distinct thumbnail. No real resident portrait or official character license was claimed.

The user selected the original **星芽族 / Starsprout A** direction. A clean species master and ten personality variants were derived from the selected reference. Characters appeared in cards, doors and content views rather than being composited over the interiors. Image failures had name-text fallbacks. Ten cities, fictional Guardians and distinct roles were added, while real Guardians remained private unless separately authorized.

The final entry records explicit authorization for public push/deployment, approved NeoBabylon branding, the Muse Tower name and navigation, M.K./repository links, and the independent/non-Meta-service notice. Admission was still described as an unopened concept. Cloudflare login was expired; the work did not renew OAuth or add credentials and instead used the repository's existing GitHub Pages static publication path. These are historical constraints, not instructions to reuse that deployment path today.
