import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
/** Synthetic authenticator: private P-256 material stays only in test memory. None attestation
 * checks format and flags; it is not evidence of hardware or human presence/private-key possession. */
export async function identityAuthenticator() {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey),
    credentialId = crypto.getRandomValues(new Uint8Array(32));
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, isoBase64URL.toBuffer(jwk.x!)],
      [-3, isoBase64URL.toBuffer(jwk.y!)],
    ]),
  );
  return {
    keys,
    credentialId,
    async assertion(
      options: PublicKeyCredentialRequestOptionsJSON,
      origin: string,
      userHandle: string,
      overrides: {
        rpID?: string;
        challenge?: string;
        origin?: string;
        flags?: number;
        counter?: number;
        client?: Record<string, unknown>;
        userHandle?: string;
        signingKey?: CryptoKey;
        signature?: Uint8Array;
      } = {},
    ): Promise<AuthenticationResponseJSON> {
      const clientDataJSON = isoBase64URL.fromUTF8String(
        JSON.stringify({
          type: "webauthn.get",
          challenge: overrides.challenge ?? options.challenge,
          origin: overrides.origin ?? origin,
          crossOrigin: false,
          ...overrides.client,
        }),
      );
      const authData = new Uint8Array(37);
      authData.set(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(overrides.rpID ?? options.rpId!),
          ),
        ),
      );
      authData[32] = overrides.flags ?? 5;
      new DataView(authData.buffer).setUint32(33, overrides.counter ?? 1);
      const clientHash = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          isoBase64URL.toBuffer(clientDataJSON),
        ),
      );
      const signed = new Uint8Array(69);
      signed.set(authData);
      signed.set(clientHash, 37);
      const raw = new Uint8Array(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          overrides.signingKey ?? keys.privateKey,
          signed,
        ),
      );
      const integer = (v: Uint8Array) => {
        let i = 0;
        while (i < v.length - 1 && v[i] === 0) i++;
        const n = Array.from(v.slice(i));
        if (n[0] & 128) n.unshift(0);
        return [2, n.length, ...n];
      };
      const r = integer(raw.slice(0, 32)),
        s = integer(raw.slice(32));
      return {
        id: isoBase64URL.fromBuffer(credentialId),
        rawId: isoBase64URL.fromBuffer(credentialId),
        type: "public-key",
        response: {
          clientDataJSON,
          authenticatorData: isoBase64URL.fromBuffer(authData),
          signature: isoBase64URL.fromBuffer(
            new Uint8Array(
              overrides.signature ?? [48, r.length + s.length, ...r, ...s],
            ),
          ),
          userHandle: overrides.userHandle ?? userHandle,
        },
        clientExtensionResults: {},
      };
    },
    async registration(
      options: PublicKeyCredentialCreationOptionsJSON,
      origin: string,
      overrides: {
        rpID?: string;
        challenge?: string;
        origin?: string;
        flags?: number;
        counter?: number;
        client?: Record<string, unknown>;
        attStmt?: Map<string, unknown>;
        credentialId?: Uint8Array;
        publicKey?: Uint8Array;
        fmt?: string;
      } = {},
    ): Promise<RegistrationResponseJSON> {
      const id = overrides.credentialId ?? credentialId,
        pub = overrides.publicKey ?? cose;
      const rpHash = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(overrides.rpID ?? options.rp.id!),
        ),
      );
      const authData = new Uint8Array(37 + 16 + 2 + id.length + pub.length);
      authData.set(rpHash);
      authData[32] = overrides.flags ?? 0x45;
      new DataView(authData.buffer).setUint32(33, overrides.counter ?? 0);
      new DataView(authData.buffer).setUint16(53, id.length);
      authData.set(id, 55);
      authData.set(pub, 55 + id.length);
      const clientDataJSON = isoBase64URL.fromUTF8String(
        JSON.stringify({
          type: "webauthn.create",
          challenge: overrides.challenge ?? options.challenge,
          origin: overrides.origin ?? origin,
          crossOrigin: false,
          ...overrides.client,
        }),
      );
      const attestationObject = isoCBOR.encode(
        new Map<string, unknown>([
          ["fmt", overrides.fmt ?? "none"],
          ["attStmt", overrides.attStmt ?? new Map()],
          ["authData", authData],
        ]) as Parameters<typeof isoCBOR.encode>[0],
      );
      return {
        id: isoBase64URL.fromBuffer(new Uint8Array(id)),
        rawId: isoBase64URL.fromBuffer(new Uint8Array(id)),
        type: "public-key",
        response: {
          clientDataJSON,
          attestationObject: isoBase64URL.fromBuffer(attestationObject),
          transports: ["internal"],
        },
        clientExtensionResults: { credProps: { rk: true } },
      };
    },
  };
}
