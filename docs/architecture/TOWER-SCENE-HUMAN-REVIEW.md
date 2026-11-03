# Human review of unpublished Tower scenes

Status: implementation prepared 2026-11-03. Deployment and real replacement acceptance remain separate gates in the active NEXT board.

An independently approved image can still repeat an existing composition. An authorized operator may therefore record `duplicate_composition` against an unpublished, model-reviewed seed. The record binds the exact image SHA-256 and the ID/SHA-256 of a currently published comparison image. The approved reference masters (`seed-v1-01`, `seed-v1-02`, `seed-v1-05`), published images, weekly images, unknown results and incomplete paid work cannot use this path.

Migration `0044_tower_scene_human_review.sql` adds an append-only human review table and native guards. Human rejection leaves the original scene state, successful model verdict, provider results and all paid receipts unchanged. The rejected scene row becomes frozen, and SQL prevents its publication even if an older application or direct write attempts approval. Inserting a replacement review record, editing the record or deleting it is forbidden.

The existing protected operator scenes endpoint accepts a single `reject` action with `sceneId`, exact `sha256`, reason `duplicate_composition`, and `referenceId`. Identical replay is free and idempotent; changing a binding fails. This endpoint contains no provider credentials and makes no paid request.

After rejection, the existing explicit `replace` action may create a separately identified image in the same canonical logical slot. The original artifact and audit stay private and permanent. Replacement caps remain two per logical slot, source budget caps remain frozen, and unknown paid results never retry. The normal plan/image/independent-review stages and manual batch inspection still apply. Replacement instructions require a different camera composition while preserving the original architectural reference and fixed approved secondary reference; no later generated result becomes a new architectural master.

Deploy migration, Functions and the matching source to dev and production together. Verify native rejection/publication races, receipt preservation, unauthorized access, replay, exact artifact hashes and the actual public wall before marking the collection complete. A local test result is not evidence of a real replacement or public publication.
