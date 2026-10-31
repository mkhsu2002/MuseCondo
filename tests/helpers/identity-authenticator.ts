import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
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
