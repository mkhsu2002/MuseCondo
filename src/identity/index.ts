export interface IdentityRecord {
  readonly version: '0.01';
  readonly agentId: string;
  readonly createdAt: string;
}

export interface CredentialPayload {
  readonly type: 'NeoBabylonAgentIdentity';
  readonly version: '0.01';
  readonly issuer: string;
  readonly agentId: string;
  readonly credentialId: string;
  readonly publicName: string;
  readonly issuedAt: string;
  readonly keyId: string;
  readonly verificationURL: string;
}

export interface SignedCredential {
  readonly payload: CredentialPayload;
  readonly signature: string;
}

export interface CredentialVerificationOptions {
  readonly issuer: string;
  /** Caller-controlled trust store; keys must never come from the credential. */
  readonly keys: ReadonlyMap<string, CryptoKey>;
}

const payloadFields = ['type', 'version', 'issuer', 'agentId', 'credentialId', 'publicName', 'issuedAt', 'keyId', 'verificationURL'] as const;

function exactObject(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && keys.every(key => typeof key === 'string'
    && fields.includes(key) && 'value' in Object.getOwnPropertyDescriptor(value, key)!);
}

function validAgentId(value: unknown): value is string {
  return typeof value === 'string' && /^mcid:[0-9a-f]{64}$/.test(value);
}

function canonicalDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

/** The portable record deliberately has no account, display, runtime or key fields. */
export function validateIdentityRecord(value: unknown): value is IdentityRecord {
  try {
    return exactObject(value, ['version', 'agentId', 'createdAt']) && value.version === '0.01'
      && validAgentId(value.agentId) && canonicalDate(value.createdAt);
  } catch {
    return false;
  }
}

function httpsOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const url = new URL(value);
  return url.protocol === 'https:' && url.origin === value && !url.username && !url.password;
}

/** All fields are public; unknown fields are rejected rather than serialized. */
export function validateCredentialPayload(value: unknown): value is CredentialPayload {
  try {
    return exactObject(value, payloadFields) && value.type === 'NeoBabylonAgentIdentity'
      && value.version === '0.01' && httpsOrigin(value.issuer) && validAgentId(value.agentId)
      && typeof value.credentialId === 'string' && /^[0-9a-f]{32}$/.test(value.credentialId)
      && typeof value.publicName === 'string' && value.publicName.trim().length > 0
      && Array.from(value.publicName).length <= 80 && !/[\p{Cc}\p{Cf}]/u.test(value.publicName)
      && canonicalDate(value.issuedAt) && typeof value.keyId === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value.keyId)
      && value.verificationURL === `${value.issuer}/identity/verify/${value.credentialId}`;
  } catch {
    return false;
  }
}

/** Random identity has no dependency on a name, account, runtime or key. */
export function createAgentId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `mcid:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function payloadSnapshot(payload: CredentialPayload): CredentialPayload {
  return Object.fromEntries(payloadFields.map(field => [field, payload[field]])) as unknown as CredentialPayload;
}

/** The v0.01 payload is flat and primitive-only: lexical key ordering is canonical. */
function canonicalBytes(payload: CredentialPayload): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(Object.fromEntries(
    [...payloadFields].sort().map(field => [field, payload[field]]),
  )));
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signatureBytes(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(value)) return null;
  const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '=='), char => char.charCodeAt(0));
  return bytes.length === 64 && base64url(bytes) === value ? bytes : null;
}

function validKey(key: CryptoKey, type: 'private' | 'public', usage: 'sign' | 'verify'): boolean {
  return key.type === type && key.algorithm.name === 'Ed25519' && key.usages.includes(usage);
}

/** The caller must authorize issuance and securely supply its trusted signing key. */
export async function signCredential(payload: CredentialPayload, privateKey: CryptoKey): Promise<SignedCredential> {
  if (!validateCredentialPayload(payload)) throw new TypeError('Invalid credential payload');
  if (!validKey(privateKey, 'private', 'sign')) throw new TypeError('Expected an Ed25519 signing key');
  const snapshot = payloadSnapshot(payload);
  const signature = await crypto.subtle.sign('Ed25519', privateKey, canonicalBytes(snapshot));
  return { payload: snapshot, signature: base64url(new Uint8Array(signature)) };
}

/** Validity proves an issuer signature only; it does not grant login, recovery or ownership. */
export async function verifyCredential(signed: unknown, options: CredentialVerificationOptions): Promise<boolean> {
  try {
    if (!exactObject(signed, ['payload', 'signature']) || !validateCredentialPayload(signed.payload)) return false;
    const payload = payloadSnapshot(signed.payload);
    if (payload.issuer !== options.issuer) return false;
    const signature = signatureBytes(signed.signature);
    if (!signature) return false;
    const publicKey = options.keys.get(payload.keyId);
    if (!publicKey || !validKey(publicKey, 'public', 'verify')) return false;
    return await crypto.subtle.verify('Ed25519', publicKey, signature, canonicalBytes(payload));
  } catch {
    return false;
  }
}
