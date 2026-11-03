export const random = (n = 32) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
export async function hash(value: string | Uint8Array) {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(typeof value === "string" ? new TextEncoder().encode(value) : value))), (b) => b.toString(16).padStart(2, "0")).join("");
}
