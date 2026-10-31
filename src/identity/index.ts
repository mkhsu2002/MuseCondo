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

/** Capture data descriptors once so validation never races a later property read. */
function exactSnapshot(value: unknown, fields: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length) return null;
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !fields.includes(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
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
    const snapshot = exactSnapshot(value, ['version', 'agentId', 'createdAt']);
    return snapshot !== null && snapshot.version === '0.01'
      && validAgentId(snapshot.agentId) && canonicalDate(snapshot.createdAt);
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
    const snapshot = exactSnapshot(value, payloadFields);
    return snapshot !== null && snapshot.type === 'NeoBabylonAgentIdentity'
      && snapshot.version === '0.01' && httpsOrigin(snapshot.issuer) && validAgentId(snapshot.agentId)
      && typeof snapshot.credentialId === 'string' && /^[0-9a-f]{32}$/.test(snapshot.credentialId)
      && typeof snapshot.publicName === 'string' && snapshot.publicName.trim().length > 0
      && Array.from(snapshot.publicName).length <= 80 && !/[\p{Cc}\p{Cf}]/u.test(snapshot.publicName)
      && canonicalDate(snapshot.issuedAt) && typeof snapshot.keyId === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(snapshot.keyId)
      && snapshot.verificationURL === `${snapshot.issuer}/identity/verify/${snapshot.credentialId}`;
  } catch {
    return false;
  }
}

/** Random identity has no dependency on a name, account, runtime or key. */
export function createAgentId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `mcid:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
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
  const snapshot = exactSnapshot(payload, payloadFields);
  if (!validateCredentialPayload(snapshot)) throw new TypeError('Invalid credential payload');
  if (!validKey(privateKey, 'private', 'sign')) throw new TypeError('Expected an Ed25519 signing key');
  const signature = await crypto.subtle.sign('Ed25519', privateKey, canonicalBytes(snapshot));
  return { payload: snapshot, signature: base64url(new Uint8Array(signature)) };
}

/** Validity proves an issuer signature only; it does not grant login, recovery or ownership. */
export async function verifyCredential(signed: unknown, options: CredentialVerificationOptions): Promise<boolean> {
  try {
    const envelope = exactSnapshot(signed, ['payload', 'signature']);
    if (!envelope) return false;
    const payload = exactSnapshot(envelope.payload, payloadFields);
    if (!validateCredentialPayload(payload)) return false;
    if (payload.issuer !== options.issuer) return false;
    const signature = signatureBytes(envelope.signature);
    if (!signature) return false;
    const publicKey = options.keys.get(payload.keyId);
    if (!publicKey || !validKey(publicKey, 'public', 'verify')) return false;
    return await crypto.subtle.verify('Ed25519', publicKey, signature, canonicalBytes(payload));
  } catch {
    return false;
  }
}
