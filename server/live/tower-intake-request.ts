import { fail, object } from './tower-contract.ts';
/** Bounded request decoding shared by owner commands and delegated commands. */
export function createTowerIntakeRequest() {
    async function readBody(req: Request, max: number) {
        const reader = req.body?.getReader();
        if (!reader)
            fail(400, "body_required");
        let size = 0;
        const parts: Uint8Array[] = [];
        for (;;) {
            const { done, value } = await reader!.read();
            if (done)
                break;
            size += value.length;
            if (size > max) {
                await reader!.cancel().catch(() => {
                });
                fail(413, "body_too_large");
            }
            parts.push(value);
        }
        const bytes = new Uint8Array(size);
        let p = 0;
        for (const b of parts) {
            bytes.set(b, p);
            p += b.length;
        }
        return bytes;
    }
    function parseJSON(bytes: Uint8Array) {
        try {
            return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
        }
        catch {
            fail(400, "invalid_json");
        }
    }
    async function body(req: Request, keys?: readonly string[], max = 12000, path = "snapshot") {
        if (req.headers.get("Content-Type")?.split(";")[0].trim() !==
            "application/json")
            fail(415, "json_required");
        return object(parseJSON(await readBody(req, max)), keys ?? [
            "sourceURL",
            "residentId",
            "requestKey",
            "proof",
            "claimId",
            "expectedRevision",
            "published",
            "directoryConsent",
            "announcementConsent",
            "dreamConsent",
            "snapshotConsent",
            "rotate",
            "content",
        ], path);
    }
    async function dreamBody(req: Request) {
        const type = req.headers.get("Content-Type")?.split(";")[0].trim();
        const keys = [
            "expectedRevision",
            "requestKey",
            "sourceAuthorized",
            "dream",
        ];
        if (type === "application/json")
            return { input: await body(req, keys, 16 * 1024), image: null };
        if (type !== "multipart/form-data")
            fail(415, "dream_content_type_required");
        // Bound actual streamed bytes before invoking the multipart parser. Header sizes
        // and Content-Length are not trusted as an upload limit.
        const bytes = await readBody(req, 8 * 1024 * 1024 + 32 * 1024);
        let form: FormData;
        try {
            form = await new Response(bytes, {
                headers: { "Content-Type": req.headers.get("Content-Type")! },
            }).formData();
        }
        catch {
            fail(400, "invalid_multipart");
        }
        if (Array.from(form!.keys()).some((k) => !["metadata", "image"].includes(k)) ||
            form!.getAll("metadata").length !== 1 ||
            form!.getAll("image").length > 1)
            fail(400, "invalid_dream_upload");
        const metadata = form!.get("metadata"), image = form!.get("image");
        if (typeof metadata !== "string")
            fail(400, "metadata_required");
        const metadataBytes = new TextEncoder().encode(metadata as string);
        if (metadataBytes.length > 16 * 1024)
            fail(413, "body_too_large");
        if (image !== null &&
            (!(image instanceof File) || image.type !== "image/png"))
            fail(400, "png_file_required");
        if (image && (image as File).size > 8 * 1024 * 1024)
            fail(413, "image_too_large");
        return {
            input: object(parseJSON(metadataBytes), keys),
            image: image === null
                ? null
                : new Uint8Array(await (image as File).arrayBuffer()),
        };
    }
    return { body, dreamBody };
}
export type TowerIntakeRequest = ReturnType<typeof createTowerIntakeRequest>;
