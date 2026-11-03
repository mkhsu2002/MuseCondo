import { isMuseShareURL, readNativeHome, readNativeClaim, validateHomeSnapshot, homeSourceMapping, HomeSourceError } from './home-source.ts';
import { validatePNG } from './png.ts';
import { sanitizePublicPNG } from '../framework/png-public.ts';
import { fail, TowerError, validateTowerSnapshot } from './tower-contract.ts';
import { hash } from './tower-crypto.ts';
/** Preserve image pixels and essential transparency only; metadata never reaches a public asset. */
export async function cleanPNG(bytes: Uint8Array, purpose: "home" | "dream") {
    let dimensions;
    try {
        dimensions = await validatePNG(bytes);
    }
    catch {
        fail(400, "invalid_source_image");
    }
    const expected = purpose === "home" ? 16 / 9 : 1;
    if ((purpose === "dream" && dimensions!.width !== dimensions!.height) ||
        Math.abs(dimensions!.width / dimensions!.height - expected) > 0.01)
        fail(400, "image_ratio_rejected");
    return sanitizePublicPNG(bytes);
}
/** Construction is side-effect free. Source admission is the caller's responsibility. */
export function createTowerSourceReader(fetcher: typeof fetch = fetch) {
    async function remote(url: URL, mime: string, max: number) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
        try {
            const response = await (fetcher)(url.href, {
                redirect: "manual",
                signal: controller.signal,
                headers: {
                    Accept: mime, "User-Agent": "MuseCondo-Tower-Intake/1.0", "Cache-Control": "no-cache"
                },
            });
            if (!response.ok)
                fail(400, "source_http_" + response.status);
            if (response.headers.get("Content-Type")?.split(";")[0].trim() !== mime)
                fail(400, "source_type_rejected");
            if (Number(response.headers.get("Content-Length") ?? 0) > max)
                fail(413, "source_too_large");
            const reader = response.body?.getReader();
            if (!reader)
                fail(400, "source_unavailable");
            const parts: Uint8Array[] = [];
            let size = 0;
            for (;;) {
                const { done, value } = await reader!.read();
                if (done)
                    break;
                size += value.length;
                if (size > max) {
                    await reader!.cancel();
                    fail(413, "source_too_large");
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
        catch (e) {
            if (e instanceof TowerError)
                throw e;
            fail(400, controller.signal.aborted ? "source_timeout" : "source_network_unavailable");
        }
        finally {
            clearTimeout(timer);
        }
    }
    async function claimProof(url: URL): Promise<unknown> {
        if (!isMuseShareURL(url.href))
            return remoteJSON(new URL("./muse-tower-claim.json", url), 4096);
        try {
            return await readNativeClaim(url.href, fetcher);
        }
        catch {
            return fail(403, "claim_rejected");
        }
    }
    async function remoteJSON(url: URL, max = 128000): Promise<unknown> {
        const bytes = await remote(url, "application/json", max);
        try {
            return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        }
        catch {
            fail(400, "invalid_source_json");
        }
    }
    async function nativeHome(url: URL, residentId: string) {
        try {
            return await readNativeHome(url.href, fetcher, residentId);
        }
        catch (error) {
            if (error instanceof HomeSourceError)
                return fail(400, error.code);
            return fail(400, "source_native_rejected");
        }
    }
    function staticHome(value: unknown, residentId: string) {
        try {
            return validateHomeSnapshot(value, residentId);
        }
        catch (error) {
            if (error instanceof HomeSourceError)
                fail(error.code === "source_identity_changed" ? 409 : 400, error.code);
            throw error;
        }
    }
    async function snapshot(url: URL, residentId: string) {
        const native = isMuseShareURL(url.href) ? await nativeHome(url, residentId) : null;
        const source = native ? native.site : await remoteJSON(url);
        const normalized = native ? native.site : staticHome(source, residentId);
        const mapping = native ? native.normalization : homeSourceMapping(source);
        const site = validateTowerSnapshot(normalized, residentId), images: {
            purpose: "home" | "dream";
            bytes: Uint8Array;
            digest: string;
        }[] = [];
        for (const purpose of (site.dream ? ["home", "dream"] : ["home"]) as ("home" | "dream")[]) {
            const imageURL = new URL(mapping.assets[purpose] ?? `./assets/${purpose}.png`, url);
            const bytes = await cleanPNG(native ? await native.readAsset(purpose) : await remote(imageURL, "image/png", 8 * 1024 * 1024), purpose);
            images.push({
                purpose, bytes, digest: await hash(bytes)
            });
        }
        if (images.reduce((n, image) => n + image.bytes.length, 0) > 12 * 1024 * 1024)
            fail(413, "source_images_too_large");
        return { site, images };
    }
    return {
        remote, remoteJSON, claimProof, snapshot, nativeHome, staticHome
    };
}
