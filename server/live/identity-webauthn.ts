import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  decodeCredentialPublicKey,
  isoBase64URL,
} from "@simplewebauthn/server/helpers";
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function canonical(value: unknown, max: number) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > max ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    isoBase64URL.fromBuffer(isoBase64URL.toBuffer(value)) !== value
  )
    throw new Error("invalid_webauthn_response");
  return value;
}
/** Server chooses the exact HTTPS origin/RP, supported algorithm and presence policy. */
export function registrationOptions(
  origin: string,
  agentId: string,
  homeName: string,
) {
  const url = new URL(origin);
  if (url.origin !== origin || url.protocol !== "https:")
    throw new Error("invalid_webauthn_origin");
  return generateRegistrationOptions({
    rpID: url.hostname,
    rpName: "MuseCondo",
    userID: crypto.getRandomValues(new Uint8Array(32)),
    userName: "guardian-" + agentId.slice(5, 21),
    userDisplayName: homeName + " 的監護人",
    timeout: 300000,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    supportedAlgorithmIDs: [-7],
  });
}
/** Official verifier remains authoritative. These checks enforce the narrower application contract.
 * None attestation does not cryptographically attest hardware, human presence, or key possession. */
export async function verifyGuardianRegistration(
  value: unknown,
  challenge: string,
  origin: string,
  rpID: string,
) {
  if (
    !record(value) ||
    Object.keys(value).some(
      (k) =>
        ![
          "id",
          "rawId",
          "type",
          "response",
          "clientExtensionResults",
          "authenticatorAttachment",
        ].includes(k),
    ) ||
    value.type !== "public-key" ||
    value.id !== value.rawId ||
    !record(value.response) ||
    !record(value.clientExtensionResults)
  )
    throw new Error("invalid_webauthn_response");
  if (
    (value.authenticatorAttachment !== undefined &&
      !["platform", "cross-platform"].includes(
        String(value.authenticatorAttachment),
      )) ||
    Object.keys(value.clientExtensionResults).some((k) => k !== "credProps") ||
    (value.clientExtensionResults.credProps !== undefined &&
      (!record(value.clientExtensionResults.credProps) ||
        Object.keys(value.clientExtensionResults.credProps).some(
          (k) => k !== "rk",
        ) ||
        (value.clientExtensionResults.credProps.rk !== undefined &&
          typeof value.clientExtensionResults.credProps.rk !== "boolean")))
  )
    throw new Error("invalid_webauthn_response");
  canonical(value.id, 1364);
  canonical(value.rawId, 1364);
  const response = value.response;
  if (
    Object.keys(response).some(
      (k) => !["clientDataJSON", "attestationObject", "transports"].includes(k),
    )
  )
    throw new Error("invalid_webauthn_response");
  const client = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      isoBase64URL.toBuffer(canonical(response.clientDataJSON, 8192)),
    ),
  ) as unknown;
  if (
    !record(client) ||
    (client.crossOrigin !== undefined && client.crossOrigin !== false) ||
    (client.topOrigin !== undefined && client.topOrigin !== origin)
  )
    throw new Error("invalid_webauthn_response");
  canonical(response.attestationObject, 24000);
  if (
    response.transports !== undefined &&
    (!Array.isArray(response.transports) ||
      response.transports.length > 8 ||
      response.transports.some(
        (t) =>
          typeof t !== "string" ||
          ![
            "ble",
            "cable",
            "hybrid",
            "internal",
            "nfc",
            "smart-card",
            "usb",
          ].includes(t),
      ))
  )
    throw new Error("invalid_webauthn_response");
  const result = await verifyRegistrationResponse({
    response: value as unknown as RegistrationResponseJSON,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    expectedType: "webauthn.create",
    requireUserPresence: true,
    requireUserVerification: true,
    supportedAlgorithmIDs: [-7],
  });
  const info = result.registrationInfo;
  if (
    !result.verified ||
    !info ||
    info.fmt !== "none" ||
    info.credential.id !== value.id ||
    !info.userVerified ||
    !Number.isSafeInteger(info.credential.counter) ||
    info.credential.counter < 0 ||
    info.credential.counter > 0xffffffff
  )
    throw new Error("invalid_webauthn_response");
  const key = decodeCredentialPublicKey(
      info.credential.publicKey,
    ) as unknown as Map<number, unknown>,
    x = key.get(-2),
    y = key.get(-3);
  if (
    key.size !== 5 ||
    [...key.keys()].some((k) => ![1, 3, -1, -2, -3].includes(k)) ||
    key.get(1) !== 2 ||
    key.get(3) !== -7 ||
    key.get(-1) !== 1 ||
    !(x instanceof Uint8Array) ||
    !(y instanceof Uint8Array) ||
    x.length !== 32 ||
    y.length !== 32
  )
    throw new Error("invalid_webauthn_response");
  const raw = new Uint8Array(65);
  raw[0] = 4;
  raw.set(x, 1);
  raw.set(y, 33);
  await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return {
    credentialId: info.credential.id,
    publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
    counter: info.credential.counter,
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    transports: info.credential.transports ?? [],
    aaguid: info.aaguid,
  };
}

/** Discoverable authentication never enumerates a household's credential IDs. */
export async function authenticationOptions(origin: string) {
  const url = new URL(origin);
  if (url.origin !== origin || url.protocol !== "https:")
    throw new Error("invalid_webauthn_origin");
  const { generateAuthenticationOptions } =
    await import("@simplewebauthn/server");
  return generateAuthenticationOptions({
    rpID: url.hostname,
    timeout: 300000,
    userVerification: "required",
  });
}
/** Verify immutable stored public material and exact userHandle, including for historical receipts.
 * A zero comparison counter verifies proof without confusing a legitimate receipt replay with a new use.
 * Fresh writes separately verify the current counter and atomically compare it in the DB transaction. */
export async function verifyGuardianAssertion(
  value: unknown,
  challenge: string,
  origin: string,
  rpID: string,
  credential: {
    credential_id: string;
    webauthn_user_id: string;
    public_key: string;
    counter: number;
  },
) {
  if (
    !record(value) ||
    Object.keys(value).some(
      (k) =>
        ![
          "id",
          "rawId",
          "type",
          "response",
          "clientExtensionResults",
          "authenticatorAttachment",
        ].includes(k),
    ) ||
    value.id !== credential.credential_id ||
    value.rawId !== value.id ||
    value.type !== "public-key" ||
    !record(value.response) ||
    !record(value.clientExtensionResults)
  )
    throw new Error("invalid_webauthn_response");
  canonical(value.id, 1364);
  canonical(value.rawId, 1364);
  if (
    value.authenticatorAttachment !== undefined &&
    !["platform", "cross-platform"].includes(
      String(value.authenticatorAttachment),
    )
  )
    throw new Error("invalid_webauthn_response");
  // No assertion extensions are needed. Reject nested application/private metadata.
  if (Object.keys(value.clientExtensionResults).length)
    throw new Error("invalid_webauthn_response");
  const response = value.response;
  if (
    Object.keys(response).length !== 4 ||
    Object.keys(response).some(
      (k) =>
        ![
          "clientDataJSON",
          "authenticatorData",
          "signature",
          "userHandle",
        ].includes(k),
    ) ||
    response.userHandle !== credential.webauthn_user_id
  )
    throw new Error("invalid_webauthn_response");
  const client = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      isoBase64URL.toBuffer(canonical(response.clientDataJSON, 8192)),
    ),
  ) as unknown;
  // CollectedClientData is browser-controlled and extensible. Ignore unknown members;
  // the official verifier still verifies the original, unmodified clientDataJSON bytes.
  if (
    !record(client) ||
    (client.crossOrigin !== undefined && client.crossOrigin !== false) ||
    (client.topOrigin !== undefined && client.topOrigin !== origin)
  )
    throw new Error("invalid_webauthn_response");
  canonical(response.authenticatorData, 2048);
  canonical(response.signature, 256);
  canonical(response.userHandle, 64);
  const { verifyAuthenticationResponse } =
    await import("@simplewebauthn/server");
  const result = await verifyAuthenticationResponse({
    response:
      value as unknown as import("@simplewebauthn/server").AuthenticationResponseJSON,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    expectedType: "webauthn.get",
    requireUserVerification: true,
    credential: {
      id: credential.credential_id,
      publicKey: isoBase64URL.toBuffer(credential.public_key),
      counter: credential.counter,
    },
  });
  if (
    !result.verified ||
    !result.authenticationInfo.userVerified ||
    result.authenticationInfo.credentialID !== credential.credential_id ||
    !Number.isSafeInteger(result.authenticationInfo.newCounter) ||
    result.authenticationInfo.newCounter < 0 ||
    result.authenticationInfo.newCounter > 0xffffffff
  )
    throw new Error("invalid_webauthn_response");
  return result.authenticationInfo;
}

/** Semantic EC point identity ignores equivalent COSE map ordering. Public material only. */
export function guardianPublicKeyFingerprint(publicKey: string) {
  const key = decodeCredentialPublicKey(
    isoBase64URL.toBuffer(publicKey),
  ) as unknown as Map<number, unknown>;
  const x = key.get(-2),
    y = key.get(-3);
  if (
    key.get(1) !== 2 ||
    key.get(3) !== -7 ||
    key.get(-1) !== 1 ||
    !(x instanceof Uint8Array) ||
    !(y instanceof Uint8Array) ||
    x.length !== 32 ||
    y.length !== 32
  )
    throw new Error("invalid_guardian_public_key");
  return (
    isoBase64URL.fromBuffer(new Uint8Array(x)) +
    "." +
    isoBase64URL.fromBuffer(new Uint8Array(y))
  );
}
