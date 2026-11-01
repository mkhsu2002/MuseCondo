/* global document, navigator, PublicKeyCredential, isSecureContext, location, crypto, fetch, Blob, atob, btoa, AbortController, setTimeout, clearTimeout, addEventListener */
(() => {
  "use strict";
  const $ = (id) => document.querySelector("#" + id),
    form = $("recovery-form");
  if (!form) return;
  const request = $("request-id"),
    load = $("load-context"),
    details = $("recovery-details"),
    fingerprintAck = $("fingerprint-confirmed"),
    continueChoice = $("decision-continue"),
    newChoice = $("decision-new"),
    passkeyChoice = $("method-passkey"),
    offlineChoice = $("method-offline"),
    oldCode = $("current-offline-code"),
    show = $("show-offline-code"),
    prepare = $("prepare-recovery"),
    verify = $("verify-guardian"),
    download = $("download-recovery"),
    backupAck = $("backup-confirmed"),
    finish = $("complete-recovery"),
    restart = $("restart-recovery"),
    status = $("recovery-status");
  const base = "/api/v1/identity/guardian/recovery";
  const supported =
    typeof PublicKeyCredential !== "undefined" &&
    isSecureContext === true &&
    typeof navigator.credentials?.get === "function" &&
    typeof navigator.credentials?.create === "function" &&
    typeof crypto?.getRandomValues === "function" &&
    typeof crypto?.randomUUID === "function";
  let busy = false,
    done = false,
    closed = false,
    context = null,
    contextBody = null,
    current = null,
    optionsRequest = null,
    optionsBody = null,
    optionsPending = false,
    credential = null,
    backupCode = "",
    downloaded = false,
    completeBody = null,
    activeController = null,
    objectURL = null;
  const say = (text) => {
    status.textContent = text;
  };
  const chosenDecision = () =>
    continueChoice.checked ? "continue" : newChoice.checked ? "new" : null;
  const chosenMethod = () => (offlineChoice.checked ? "offline" : "passkey");
  const needsBackup = () =>
    !!optionsRequest &&
    (optionsRequest.decision === "continue" ||
      "currentOfflineRecoveryCode" in optionsRequest);
  const method = () =>
    optionsRequest && "currentOfflineRecoveryCode" in optionsRequest
      ? "offline"
      : "passkey";
  function render() {
    const locked = busy || done || closed || !!optionsBody;
    request.disabled = locked || !!context || !!contextBody;
    load.disabled = busy || done || closed || !!context;
    form.hidden = done || closed;
    details.hidden = !context;
    $("choice-section").hidden = done || closed || context?.state !== "pending";
    for (const field of [
      fingerprintAck,
      continueChoice,
      newChoice,
      passkeyChoice,
      offlineChoice,
      oldCode,
      show,
    ])
      field.disabled = locked;
    $("offline-section").hidden = !offlineChoice.checked;
    prepare.disabled =
      !supported ||
      busy ||
      done ||
      closed ||
      !context ||
      context.state !== "pending" ||
      !!current ||
      (!optionsBody && (!fingerprintAck.checked || !chosenDecision()));
    prepare.textContent =
      optionsBody && !current ? "Retry verification preparation" : "Confirm choice and prepare verification";
    $("verification-section").hidden = !current || done || closed;
    verify.disabled =
      !supported ||
      busy ||
      done ||
      closed ||
      !current ||
      !!credential ||
      !!completeBody;
    verify.textContent =
      method() === "offline" ? "Create a new Passkey" : "Verify with Passkey";
    $("backup-section").hidden =
      !credential || !needsBackup() || done || closed;
    $("finish-section").hidden = !credential || done || closed;
    download.disabled = busy || done || closed || !credential || !backupCode;
    backupAck.disabled =
      busy || done || closed || !downloaded || !!completeBody;
    finish.disabled =
      busy ||
      done ||
      closed ||
      (!completeBody &&
        (!credential ||
          (needsBackup() &&
            (!backupCode || !downloaded || !backupAck.checked))));
    finish.textContent = completeBody ? "Retry the original completion" : "Confirm and complete";
    restart.hidden = done || closed || (!contextBody && !context);
    restart.disabled = busy || closed || !!completeBody || optionsPending;
  }
  function revoke() {
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
  }
  function clearPrepared() {
    revoke();
    credential = null;
    backupCode = "";
    downloaded = false;
    backupAck.checked = false;
    completeBody = null;
  }
  function clearOperation() {
    clearPrepared();
    fingerprintAck.checked = false;
    continueChoice.checked = newChoice.checked = false;
    current = null;
    optionsRequest = null;
    optionsBody = null;
    optionsPending = false;
    oldCode.value = "";
    oldCode.type = "password";
    show.checked = false;
  }
  function invalidated(text) {
    clearOperation();
    context = null;
    contextBody = null;
    say(text);
    render();
    restart.hidden = false;
    status.focus();
  }
  function expired() {
    return (
      !!context &&
      (Date.now() >= Date.parse(context.expiresAt) ||
        (current && Date.now() >= Date.parse(current.challengeExpiresAt)))
    );
  }
  function localExpiry() {
    invalidated(
      "This request or verification expired. Review it again; if the unfinished request expired or no longer exists, ask the Agent to create a new request and key.",
    );
  }
  function encode(value) {
    if (!(value instanceof ArrayBuffer)) throw Error("invalid_credential");
    let binary = "";
    for (const b of new Uint8Array(value)) binary += String.fromCharCode(b);
    return btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
  }
  function decode(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value))
      throw Error("invalid_options");
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer;
  }
  const record = (value) =>
    !!value && typeof value === "object" && !Array.isArray(value);
  function optionBytes(value, maximum) {
    const bytes = decode(value);
    return (
      bytes.byteLength > 0 &&
      bytes.byteLength <= maximum &&
      encode(bytes) === value
    );
  }
  function validOptions(value, offline) {
    try {
      if (
        !record(value) ||
        !optionBytes(value.challenge, 1024) ||
        (value.timeout !== undefined &&
          (!Number.isFinite(value.timeout) || value.timeout <= 0)) ||
        (value.extensions !== undefined && !record(value.extensions))
      )
        return false;
      const descriptors = offline
        ? value.excludeCredentials
        : value.allowCredentials;
      if (
        descriptors !== undefined &&
        (!Array.isArray(descriptors) ||
          !descriptors.every(
            (v) =>
              record(v) && v.type === "public-key" && optionBytes(v.id, 1023),
          ))
      )
        return false;
      if (!offline)
        return (
          value.rpId === location.hostname &&
          value.userVerification === "required"
        );
      return (
        record(value.rp) &&
        value.rp.id === location.hostname &&
        typeof value.rp.name === "string" &&
        value.rp.name.length > 0 &&
        record(value.user) &&
        optionBytes(value.user.id, 64) &&
        typeof value.user.name === "string" &&
        value.user.name.length > 0 &&
        typeof value.user.displayName === "string" &&
        Array.isArray(value.pubKeyCredParams) &&
        value.pubKeyCredParams.length === 1 &&
        value.pubKeyCredParams[0]?.type === "public-key" &&
        value.pubKeyCredParams[0].alg === -7 &&
        record(value.authenticatorSelection) &&
        value.authenticatorSelection.residentKey === "required" &&
        value.authenticatorSelection.userVerification === "required" &&
        value.attestation === "none"
      );
    } catch {
      return false;
    }
  }
  function nativeOptions(value, offline) {
    const parser = offline
      ? PublicKeyCredential.parseCreationOptionsFromJSON
      : PublicKeyCredential.parseRequestOptionsFromJSON;
    if (typeof parser === "function")
      return parser.call(PublicKeyCredential, value);
    const descriptors = offline ? "excludeCredentials" : "allowCredentials";
    return {
      ...value,
      challenge: decode(value.challenge),
      ...(offline
        ? { user: { ...value.user, id: decode(value.user.id) } }
        : {}),
      ...(value[descriptors]
        ? {
            [descriptors]: value[descriptors].map((v) => ({
              ...v,
              id: decode(v.id),
            })),
          }
        : {}),
    };
  }
  function project(value, offline) {
    if (!value || value.type !== "public-key" || !value.response)
      throw Error("invalid_credential");
    const rawId = encode(value.rawId);
    if (rawId !== value.id || !rawId) throw Error("invalid_credential");
    const clientExtensionResults = {},
      response = { clientDataJSON: encode(value.response.clientDataJSON) };
    if (offline) {
      response.attestationObject = encode(value.response.attestationObject);
      const transports = value.response.getTransports?.() ?? [];
      if (
        !Array.isArray(transports) ||
        transports.some(
          (t) =>
            ![
              "ble",
              "cable",
              "hybrid",
              "internal",
              "nfc",
              "smart-card",
              "usb",
            ].includes(t),
        )
      )
        throw Error("invalid_credential");
      response.transports = transports;
      const extensions = value.getClientExtensionResults?.() ?? {};
      if (typeof extensions.credProps?.rk === "boolean")
        clientExtensionResults.credProps = { rk: extensions.credProps.rk };
    } else {
      response.authenticatorData = encode(value.response.authenticatorData);
      response.signature = encode(value.response.signature);
      response.userHandle =
        value.response.userHandle == null
          ? null
          : encode(value.response.userHandle);
    }
    return {
      id: value.id,
      rawId,
      type: "public-key",
      response,
      clientExtensionResults,
      ...(["platform", "cross-platform"].includes(value.authenticatorAttachment)
        ? { authenticatorAttachment: value.authenticatorAttachment }
        : {}),
    };
  }
  function newBackup() {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      if (code !== optionsRequest.currentOfflineRecoveryCode) return code;
    }
    throw Error("random_failed");
  }
  async function api(path, body) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 20000);
    activeController = controller;
    try {
      const response = await fetch(base + path, {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body,
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw { status: response.status };
      return data;
    } catch (error) {
      if (Number.isInteger(error?.status)) throw error;
      throw { unknown: true };
    } finally {
      clearTimeout(timer);
      if (activeController === controller) activeController = null;
    }
  }
  function known(error, phase) {
    if (closed) return;
    if (error.unknown) {
      if (phase === "options") optionsPending = true;
      say(
        "The result is not yet confirmed. Stay on this page and use the same retry button to check the original operation; do not create another.",
      );
    } else if (error.status === 429) {
      if (phase === "options") optionsPending = true;
      say("Too many requests. Wait, then retry with the same button.");
    } else if (error.status >= 500) {
      if (phase === "options") optionsPending = true;
      say("Temporarily unavailable. Retry the original operation with the same button later.");
    } else {
      invalidated(
        error.status === 409
          ? "This request or verification expired, completed or changed. Review the request again before proceeding."
          : error.status === 403 || error.status === 404
            ? "This request or recovery code could not be verified. Check the input; if the unfinished request expired or no longer exists, ask the Agent to create a new request and key."
            : "This operation could not be confirmed. Review the request again and check your input.",
      );
    }
  }
  function validContext(data) {
    return (
      record(data) &&
      data.requestId === JSON.parse(contextBody).requestId &&
      /^mcid:[a-f0-9]{64}$/.test(data.agentId) &&
      /^[a-f0-9]{64}$/.test(data.candidateFingerprint) &&
      ["pending", "continued", "new-admission-required"].includes(data.state) &&
      Number.isFinite(Date.parse(data.expiresAt))
    );
  }
  function terminal(state) {
    return state === "continued"
      ? "This request previously completed identity continuation. This historical result does not prove current access; ask the Agent to check its current authority."
      : "This request chose new admission; no new identity has been created. The Agent must separately create a new household and enroll an identity. The old identity, home and private data do not transfer.";
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || done || closed || context) return;
    if (!contextBody) {
      if (!/^[a-f0-9]{32}$/.test(request.value.trim())) {
        say("Paste the complete 32-character lowercase hexadecimal recovery request ID supplied by the Agent. It is not an Agent ID or Invitation ID.");
        request.focus();
        return;
      }
      contextBody = JSON.stringify({ requestId: request.value.trim() });
    }
    let nextFocus;
    busy = true;
    render();
    say("Reviewing the request…");
    try {
      const data = await api("/context", contextBody);
      if (closed) return;
      if (!validContext(data)) throw { unknown: true };
      clearOperation();
      context = data;
      $("agent-id").textContent = data.agentId;
      $("context-request-id").textContent = data.requestId;
      $("candidate-fingerprint").textContent = data.candidateFingerprint;
      $("request-expiry").textContent = new Date(data.expiresAt).toLocaleString(
        "en", {timeZone:"UTC"},
      );
      if (data.state !== "pending") {
        done = true;
        clearOperation();
        say(terminal(data.state));
        status.focus();
      } else if (expired()) localExpiry();
      else {
        say(
          supported
            ? "Compare the full fingerprint through a trusted channel, then choose what should happen."
            : "Use a browser that supports Passkeys and open this page over a secure connection.",
        );
        nextFocus = fingerprintAck;
      }
    } catch (error) {
      known(error, "context");
    } finally {
      busy = false;
      render();
      load.textContent = contextBody && !context ? "Retry request lookup" : "Review request";
      if (!closed) nextFocus?.focus();
    }
  });
  for (const field of [continueChoice, newChoice, passkeyChoice, offlineChoice])
    field.addEventListener("change", () => {
      if (optionsBody || busy || done || closed) return;
      if (field === continueChoice && field.checked) newChoice.checked = false;
      if (field === newChoice && field.checked) continueChoice.checked = false;
      if (field === passkeyChoice && field.checked)
        offlineChoice.checked = false;
      if (field === offlineChoice && field.checked)
        passkeyChoice.checked = false;
      render();
    });
  fingerprintAck.addEventListener("change", render);
  show.addEventListener("change", () => {
    oldCode.type = show.checked ? "text" : "password";
  });
  prepare.addEventListener("click", async () => {
    if (
      !supported ||
      busy ||
      done ||
      closed ||
      !context ||
      context.state !== "pending" ||
      current
    )
      return;
    if (!optionsBody) {
      if (!fingerprintAck.checked || !chosenDecision()) {
        say("Compare the full fingerprint and explicitly choose what should happen first.");
        return;
      }
      if (expired()) {
        localExpiry();
        return;
      }
      const offline = chosenMethod() === "offline",
        code = oldCode.value.trim();
      if (offline && !/^[a-f0-9]{64}$/.test(code)) {
        say("Enter the complete current private recovery code, not the initial confirmation code.");
        oldCode.focus();
        return;
      }
      optionsRequest = {
        requestKey: "recovery-options-" + crypto.randomUUID(),
        requestId: context.requestId,
        decision: chosenDecision(),
        ...(offline
          ? { currentOfflineRecoveryCode: code }
          : { method: "passkey" }),
      };
      optionsBody = JSON.stringify(optionsRequest);
      oldCode.type = "password";
      show.checked = false;
    }
    let nextFocus;
    busy = true;
    render();
    say("Preparing Guardian verification…");
    try {
      const data = await api(
        method() === "offline" ? "/offline/options" : "/options",
        optionsBody,
      );
      if (closed) return;
      if (
        !record(data) ||
        data.requestId !== context.requestId ||
        data.agentId !== context.agentId ||
        data.candidateFingerprint !== context.candidateFingerprint ||
        data.expiresAt !== context.expiresAt ||
        data.state !== "pending" ||
        data.decision !== optionsRequest.decision ||
        data.method !== method() ||
        !/^[a-f0-9]{32}$/.test(data.challengeId) ||
        !Number.isFinite(Date.parse(data.challengeExpiresAt)) ||
        Date.parse(data.challengeExpiresAt) > Date.parse(context.expiresAt) ||
        !validOptions(data.options, method() === "offline")
      )
        throw { unknown: true };
      current = data;
      optionsPending = false;
      $("challenge-expiry").textContent = new Date(
        data.challengeExpiresAt,
      ).toLocaleString("en", {timeZone:"UTC"});
      $("decision-summary").textContent =
        optionsRequest.decision === "continue"
          ? "Completion keeps the original identity and home address, revokes old operating access and replaces the private recovery code."
          : "Completion requires the Agent to follow new admission separately. It does not issue a new ID or take over the old home or private data.";
      $("verification-help").textContent =
        method() === "offline"
          ? "Create a new Passkey yourself in the browser. Final completion replaces this Guardian’s verification method and private recovery code."
          : "Use the existing Passkey yourself when the browser prompts. Access does not transfer until final confirmation succeeds.";
      if (expired()) localExpiry();
      else {
        say("When ready, complete Passkey verification yourself.");
        nextFocus = verify;
      }
    } catch (error) {
      known(error, "options");
    } finally {
      busy = false;
      render();
      if (!closed) nextFocus?.focus();
    }
  });
  verify.addEventListener("click", async () => {
    if (
      !supported ||
      busy ||
      done ||
      closed ||
      !current ||
      credential ||
      completeBody
    )
      return;
    if (expired()) {
      localExpiry();
      return;
    }
    let publicKey, nextFocus;
    try {
      publicKey = nativeOptions(current.options, method() === "offline");
    } catch {
      current = null;
      known({ unknown: true }, "options");
      render();
      return;
    }
    busy = true;
    render();
    say("Follow the browser prompt and complete verification yourself.");
    try {
      const value = await navigator.credentials[
        method() === "offline" ? "create" : "get"
      ]({ publicKey });
      if (closed) return;
      if (!value) throw { name: "NotAllowedError" };
      credential = project(value, method() === "offline");
      if (expired()) {
        localExpiry();
        return;
      }
      if (needsBackup()) backupCode = newBackup();
      say(
        needsBackup()
          ? "Verification prepared. Download and securely save the new private recovery code, then complete final confirmation."
          : "Verification prepared. Confirm the decision to follow new admission, then complete final confirmation.",
      );
      nextFocus = needsBackup() ? download : finish;
    } catch (error) {
      clearPrepared();
      if (!closed)
        say(
          error?.name === "NotAllowedError"
            ? "Passkey verification was cancelled. Retry with the same verification button when ready."
            : "This device cannot complete Passkey verification. Use a supported browser and secure connection, then retry verification.",
        );
    } finally {
      busy = false;
      render();
      if (!closed) nextFocus?.focus();
    }
  });
  download.addEventListener("click", () => {
    if (busy || done || closed || !credential || !backupCode || !current)
      return;
    if (!completeBody && expired()) {
      localExpiry();
      return;
    }
    const link = document.createElement("a");
    try {
      const file = new Blob(
        [
          "Muse Tower private recovery code\nWebsite: " +
            location.origin +
            "\nAgent ID: " +
            context.agentId +
            "\nRecovery code: " +
            backupCode +
            "\nStore securely offline. After completion use this new code; the old code becomes invalid.\nNever publish, forward, paste in chat or give this file to an Agent. Keep it separate from public cards.\n",
        ],
        { type: "text/plain;charset=utf-8" },
      );
      revoke();
      objectURL = URL.createObjectURL(file);
      link.href = objectURL;
      link.download =
        "muse-tower-private-recovery-" +
        current.challengeId.slice(0, 8) +
        ".txt";
      document.body.append(link);
      link.click();
      downloaded = true;
      say("Download started. Confirm the file is securely saved before checking the box.");
    } catch {
      say("The download could not start. Allow downloads in your browser, then retry the download.");
    } finally {
      link.remove();
      revoke();
      render();
    }
  });
  backupAck.addEventListener("change", () => {
    if (!downloaded) backupAck.checked = false;
    render();
  });
  finish.addEventListener("click", async () => {
    if (busy || done || closed) return;
    if (!completeBody) {
      if (
        !credential ||
        !current ||
        (needsBackup() && (!backupCode || !downloaded || !backupAck.checked))
      )
        return;
      if (expired()) {
        localExpiry();
        return;
      }
      completeBody = JSON.stringify({
        requestKey: "recovery-complete-" + crypto.randomUUID(),
        requestId: context.requestId,
        challengeId: current.challengeId,
        ...(method() === "offline"
          ? {
              currentOfflineRecoveryCode:
                optionsRequest.currentOfflineRecoveryCode,
            }
          : {}),
        response: credential,
        ...(needsBackup()
          ? { offlineRecoveryCode: backupCode, backupConfirmed: true }
          : {}),
      });
    }
    busy = true;
    render();
    say("Confirming the original operation…");
    try {
      const data = await api(
        method() === "offline" ? "/offline/complete" : "/complete",
        completeBody,
      );
      if (closed) return;
      const continuing = optionsRequest.decision === "continue";
      if (
        !record(data) ||
        data.requestId !== context.requestId ||
        data.agentId !== context.agentId ||
        data.state !== (continuing ? "continued" : "new-admission-required") ||
        (continuing &&
          (!Number.isSafeInteger(data.authorityEpoch) ||
            data.authorityEpoch < 1 ||
            !/^[a-f0-9]{32}$/.test(data.instanceId)))
      )
        throw { unknown: true };
      done = true;
      context.state = data.state;
      clearOperation();
      contextBody = null;
      request.value = "";
      say(terminal(data.state));
      status.focus();
    } catch (error) {
      known(error, "complete");
    } finally {
      busy = false;
      render();
    }
  });
  restart.addEventListener("click", () => {
    if (busy || done || closed || completeBody || optionsPending) return;
    clearOperation();
    context = null;
    contextBody = null;
    fingerprintAck.checked = false;
    continueChoice.checked = newChoice.checked = false;
    passkeyChoice.checked = true;
    offlineChoice.checked = false;
    for (const id of [
      "agent-id",
      "context-request-id",
      "candidate-fingerprint",
      "request-expiry",
      "challenge-expiry",
      "decision-summary",
    ])
      $(id).textContent = "";
    say("Review the request again and compare the full fingerprint.");
    render();
    request.focus();
  });
  addEventListener("pagehide", () => {
    closed = true;
    activeController?.abort();
    clearOperation();
    contextBody = null;
    oldCode.value = "";
    render();
  });
  render();
  if (!supported) say("Use a browser that supports Passkeys and open this page over a secure connection.");
})();
