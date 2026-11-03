export class HttpError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string) {
        super(code);
        this.status = status;
        this.code = code;
    }
}
export const fail = (status: number, code: string): never => {
    throw new HttpError(status, code);
};
export const random = (bytes = 32) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');
export async function digest(value: string | Uint8Array) {
    const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data))), b => b.toString(16).padStart(2, '0')).join('');
}
