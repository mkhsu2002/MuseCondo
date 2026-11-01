/* global document, navigator, PublicKeyCredential, isSecureContext, location, crypto, fetch, Blob, atob, btoa, AbortController, setTimeout, clearTimeout */
(() => {
  "use strict";
  const $ = (id) => document.querySelector("#" + id),
    form = $("identity-form");
  if (!form) return;
  const invitation = $("invitation-id"),
    confirmation = $("confirmation-code"),
    show = $("show-codes"),
    start = $("confirm-invitation"),
    details = $("registration-details"),
    agent = $("agent-id"),
    expiry = $("challenge-expiry"),
    create = $("create-passkey"),
    recovery = $("recovery-section"),
    download = $("download-recovery"),
    ack = $("backup-confirmed"),
    finish = $("complete-registration"),
    restart = $("restart-registration"),
    status = $("identity-status"),
    continuation = $("agent-continuation"),
    copyContinuation = $("copy-agent-continuation"),
    continuationStatus = $("continuation-status");
  const base = "/api/v1/identity/guardian/registration";
  const supported =
    typeof PublicKeyCredential !== "undefined" &&
    isSecureContext === true &&
    typeof navigator.credentials?.create === "function" &&
    typeof crypto?.getRandomValues === "function" &&
    typeof crypto?.randomUUID === "function";
  let busy = false,
    done = false,
    continuationText = "",
    optionsRequest = null,
    optionsBody = null,
    current = null,
    credential = null,
    offline = "",
    downloadRequested = false,
    completeBody = null,
    optionsPending = false,
    completePending = false;
  const say = (text) => {
    status.textContent = text;
  };
  function render() {
    const locked = busy || done || !!optionsRequest;
    invitation.disabled = locked;
    confirmation.disabled = locked;
    show.disabled = busy || done;
    start.disabled = !supported || busy || done || !!current;
    start.textContent = optionsPending ? "Retry invitation confirmation" : "Confirm invitation";
    form.hidden = done;
    continuation.disabled = copyContinuation.disabled = !done || !continuationText;
    $("identity-next-steps").hidden = !done;
    $("registered-recovery-link").hidden = !done;
    $("setup-progress").textContent = done
      ? "Guardian setup complete · Recovery is configured"
      : credential
        ? downloadRequested && ack.checked
          ? "Step 4 of 4 · Select Complete Guardian setup and wait for confirmation"
          : "Step 3 of 4 · Save the offline backup; setup is not complete"
        : current
          ? "Step 2 of 4 · Create a Passkey; setup is not complete"
          : "Step 1 of 4 · Confirm invitation";
    $("passkey-section").hidden = done;
    $("expiry-label").hidden = done;
    expiry.hidden = done;
    details.hidden = !current && !done;
    create.disabled =
      busy || done || !current || !!credential || !!completeBody;
    recovery.hidden = !credential;
    download.disabled = busy || done || !credential || !offline;
    ack.disabled = busy || done || !downloadRequested || !!completeBody;
    finish.disabled =
      busy ||
      done ||
      (!completeBody &&
        (!credential || !offline || !downloadRequested || !ack.checked));
    finish.textContent = completeBody ? "Retry completion" : "Complete Guardian setup";
    restart.hidden = done || (!current && !optionsRequest);
    restart.disabled =
      busy || !!completeBody || completePending || optionsPending;
  }
  function prepareContinuation(agentId) {
    // Only page-owned origin and the completed, validated public Agent ID may
    // enter this message. Registration requests and recovery material never do.
    const origin = location.origin;
    if (typeof agentId !== "string" || agentId.length !== 69 || !/^mcid:[a-f0-9]{64}$/.test(agentId) ||
        typeof origin !== "string") return "";
    try {
      const trusted = new URL(origin);
      if (trusted.origin !== origin || trusted.protocol !== "https:" || trusted.username || trusted.password) return "";
    } catch { return ""; }
    return [
      "Guardian setup is complete for Agent ID: " + agentId,
      "Tower origin: " + origin,
      "Read the public guide: " + origin + "/identity-onboarding.json",
      "Please resume this task. This message is a continuation request; your authenticated API readback is authoritative.",
      "Continue this existing identity using your own Tower key from your authorized secure credential storage. Do not request my key or create a new identity.",
      "GET " + origin + "/api/v1/agent/identity with your own Tower key. Confirm that agentId matches the ID above, state is active, and recoveryConfigured is true. Stop and report any mismatch or incomplete state.",
      "GET " + origin + "/api/v1/agent/identity/card. Reuse an existing card. Only if no card exists, follow the guide to issue the first card with the current identity version, expectedCardRevision:0, the Agent’s authorized public name and explicit public-verification consent. Ask for any missing name or consent before issuing.",
      "Download the original PDF and signed JSON through the authenticated card service and verify both usable attachments reach the designated Guardian. Card creation alone does not confirm delivery.",
      "Use direct HTTPS without cookies in your own authorized environment. You do not need my browser, session, Passkey, invitation codes or offline recovery backup. I may close this setup page.",
    ].join("\n\n");
  }
  copyContinuation.addEventListener("click", async () => {
    if (!done || busy || !continuationText) return;
    try {
      await navigator.clipboard.writeText(continuationText);
      continuationStatus.textContent = "Copied. Send these instructions to your Agent in your existing conversation.";
    } catch {
      continuation.focus();
      continuation.select();
      continuationStatus.textContent = "Copy is unavailable. The instructions are selected; copy them manually and send them to your Agent.";
    }
  });
  function clearPrepared() {
    credential = null;
    offline = "";
    downloadRequested = false;
    ack.checked = false;
    completeBody = null;
    completePending = false;
  }
  function invalidated(message) {
    clearPrepared();
    current = null;
    optionsPending = false;
    optionsRequest = null;
    optionsBody = null;
    details.hidden = true;
    say(message);
    restart.hidden = false;
    render();
    restart.hidden = false;
  }
  function expired() {
    return !!current && Date.now() >= Date.parse(current.expiresAt);
  }
  function localExpiry() {
    invalidated("This setup expired. Confirm the invitation again and create a new Passkey.");
  }
  function encode(value) {
    if (!(value instanceof ArrayBuffer)) throw new Error("invalid_credential");
    let binary = "";
    for (const b of new Uint8Array(value)) binary += String.fromCharCode(b);
    return btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
  }
  function decode(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value))
      throw new Error("invalid_options");
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer;
  }
  function optionRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function optionBytes(value, maximum) {
    const bytes = decode(value);
    return (
      bytes.byteLength > 0 &&
      bytes.byteLength <= maximum &&
      encode(bytes) === value
    );
  }
  function validCreationOptions(value) {
    try {
      return (
        optionRecord(value) &&
        optionBytes(value.challenge, 1024) &&
        optionRecord(value.rp) &&
        value.rp.id === location.hostname &&
        typeof value.rp.name === "string" &&
        value.rp.name.length > 0 &&
        optionRecord(value.user) &&
        optionBytes(value.user.id, 64) &&
        typeof value.user.name === "string" &&
        value.user.name.length > 0 &&
        typeof value.user.displayName === "string" &&
        Array.isArray(value.pubKeyCredParams) &&
        value.pubKeyCredParams.length === 1 &&
        optionRecord(value.pubKeyCredParams[0]) &&
        value.pubKeyCredParams[0].type === "public-key" &&
        value.pubKeyCredParams[0].alg === -7 &&
        optionRecord(value.authenticatorSelection) &&
        value.authenticatorSelection.residentKey === "required" &&
        value.authenticatorSelection.userVerification === "required" &&
        value.attestation === "none" &&
        (value.timeout === undefined ||
          (Number.isFinite(value.timeout) && value.timeout > 0)) &&
        (value.excludeCredentials === undefined ||
          (Array.isArray(value.excludeCredentials) &&
            value.excludeCredentials.every(
              (item) =>
                optionRecord(item) &&
                item.type === "public-key" &&
                optionBytes(item.id, 1023),
            ))) &&
        (value.extensions === undefined || optionRecord(value.extensions))
      );
    } catch {
      return false;
    }
  }
  function creationOptions(value) {
    if (typeof PublicKeyCredential.parseCreationOptionsFromJSON === "function")
      return PublicKeyCredential.parseCreationOptionsFromJSON(value);
    return {
      ...value,
      challenge: decode(value.challenge),
      user: { ...value.user, id: decode(value.user.id) },
      ...(value.excludeCredentials
        ? {
            excludeCredentials: value.excludeCredentials.map((item) => ({
              ...item,
              id: decode(item.id),
            })),
          }
        : {}),
    };
  }
  function project(value) {
    if (!value || value.type !== "public-key" || !value.response)
      throw new Error("invalid_credential");
    const rawId = encode(value.rawId);
    if (value.id !== rawId) throw new Error("invalid_credential");
    const extensions = value.getClientExtensionResults?.() ?? {},
      clientExtensionResults = {};
    if (typeof extensions.credProps?.rk === "boolean")
      clientExtensionResults.credProps = { rk: extensions.credProps.rk };
    const transports = value.response.getTransports?.() ?? [];
    if (
      !Array.isArray(transports) ||
      transports.some(
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
      )
    )
      throw new Error("invalid_credential");
    return {
      id: value.id,
      rawId,
      type: "public-key",
      response: {
        clientDataJSON: encode(value.response.clientDataJSON),
        attestationObject: encode(value.response.attestationObject),
        transports,
      },
      clientExtensionResults,
      ...(["platform", "cross-platform"].includes(value.authenticatorAttachment)
        ? { authenticatorAttachment: value.authenticatorAttachment }
        : {}),
    };
  }
  function recoveryCode() {
    let value;
    do {
      value = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    } while (value === optionsRequest.confirmationCode);
    return value;
  }
  async function api(path, body) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 20000);
    let response, data;
    try {
      response = await fetch(base + path, {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body,
        signal: controller.signal,
      });
      data = await response.json();
    } catch {
      throw { unknown: true };
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw { status: response.status };
    return data;
  }
  function known(error, phase) {
    if (error.unknown) {
      if (phase === "options") optionsPending = true;
      else completePending = true;
      say("The result is not yet confirmed. Stay on this page and use the same retry button.");
      return;
    }
    if (error.status === 429) {
      say("Too many requests. Wait, then retry with the same button.");
      return;
    }
    if (error.status >= 500) {
      say("Setup is temporarily unavailable. Retry the same prepared operation later.");
      return;
    }
    const message =
      error.status === 403
        ? "This confirmation code cannot be used. Check your invitation or contact the resident."
        : error.status === 409
          ? "This setup expired or changed. Confirm the invitation again before creating a Passkey."
          : "Setup could not be confirmed. Confirm the invitation again before retrying.";
    invalidated(message);
  }
  show.addEventListener("change", () => {
    invitation.type = confirmation.type = show.checked ? "text" : "password";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supported || busy || done || current) return;
    if (!optionsRequest) {
      const id = invitation.value.trim(),
        code = confirmation.value.trim();
      if (!/^[a-f0-9]{32}$/.test(id) || !/^[a-f0-9]{64}$/.test(code)) {
        say("Paste the complete Invitation ID and initial confirmation code.");
        return;
      }
      optionsRequest = {
        requestKey: "guardian-options-" + crypto.randomUUID(),
        invitationId: id,
        confirmationCode: code,
      };
      optionsBody = JSON.stringify(optionsRequest);
    }
    busy = true;
    render();
    say("Confirming the invitation…");
    try {
      const data = await api("/options", optionsBody);
      if (
        !data ||
        !/^mcid:[a-f0-9]{64}$/.test(data.agentId) ||
        !/^[a-f0-9]{32}$/.test(data.challengeId) ||
        !Number.isFinite(Date.parse(data.expiresAt)) ||
        !validCreationOptions(data.options)
      )
        throw { unknown: true };
      current = data;
      optionsPending = false;
      agent.textContent = data.agentId;
      expiry.textContent = new Date(data.expiresAt).toLocaleString("en",{timeZone:"UTC"});
      if (expired()) localExpiry();
      else say("Invitation confirmed. Create a Passkey when you are ready.");
    } catch (error) {
      known(error, "options");
    } finally {
      busy = false;
      render();
    }
  });
  create.addEventListener("click", async () => {
    if (busy || done || !current || credential || completeBody) return;
    if (expired()) {
      localExpiry();
      return;
    }
    let publicKey;
    try {
      publicKey = creationOptions(current.options);
    } catch {
      clearPrepared();
      current = null;
      known({ unknown: true }, "options");
      render();
      return;
    }
    busy = true;
    render();
    say("Follow your browser’s prompt to create a Passkey.");
    try {
      const value = await navigator.credentials.create({ publicKey });
      if (!value) throw { name: "NotAllowedError" };
      credential = project(value);
      offline = recoveryCode();
      downloadRequested = false;
      ack.checked = false;
      say("Passkey created on this device. Guardian setup is not complete. Download and securely save the private recovery code, confirm the backup, then select Complete Guardian setup.");
    } catch (error) {
      clearPrepared();
      say(
        error?.name === "NotAllowedError"
          ? "Passkey creation was cancelled. Try again when ready."
          : "This device cannot create a Passkey. Use a supported browser and a secure connection.",
      );
    } finally {
      busy = false;
      render();
    }
  });
  download.addEventListener("click", () => {
    if (busy || done || !credential || !offline || !current) return;
    let url;
    const link = document.createElement("a");
    try {
      const file = new Blob(
        [
          "Muse Tower private recovery code\nWebsite: " +
            location.origin +
            "\nAgent ID: " +
            current.agentId +
            "\nRecovery code: " +
            offline +
            "\nStore securely offline. Never publish or forward this file.\n",
        ],
        { type: "text/plain;charset=utf-8" },
      );
      url = URL.createObjectURL(file);
      link.href = url;
      link.download =
        "muse-tower-private-recovery-" +
        current.challengeId.slice(0, 8) +
        ".txt";
      document.body.append(link);
      link.click();
      downloadRequested = true;
      say("Download started. Check that the file is saved securely offline, confirm the backup checkbox, then select Complete Guardian setup. Setup is not complete until success is confirmed.");
    } catch {
      say("The download could not start. Allow downloads in your browser and try again.");
    } finally {
      link.remove();
      if (url) URL.revokeObjectURL(url);
      render();
    }
  });
  ack.addEventListener("change", render);
  finish.addEventListener("click", async () => {
    if (busy || done) return;
    if (!completeBody) {
      if (
        !credential ||
        !offline ||
        !downloadRequested ||
        !ack.checked ||
        !current
      )
        return;
      if (expired()) {
        localExpiry();
        return;
      }
      completeBody = JSON.stringify({
        requestKey: "guardian-complete-" + crypto.randomUUID(),
        invitationId: optionsRequest.invitationId,
        confirmationCode: optionsRequest.confirmationCode,
        challengeId: current.challengeId,
        response: credential,
        offlineRecoveryCode: offline,
        backupConfirmed: true,
      });
    }
    busy = true;
    render();
    say("Completing Guardian setup…");
    try {
      const data = await api("/complete", completeBody);
      if (
        !data ||
        data.agentId !== current.agentId ||
        data.state !== "active" ||
        data.recoveryConfigured !== true ||
        data.issuanceReady !== false
      )
        throw { unknown: true };
      continuationText = prepareContinuation(data.agentId);
      continuation.value = continuationText;
      if (!continuationText) continuationStatus.textContent = "Use the public Agent identity and card instructions below to continue from your trusted Tower address.";
      done = true;
      clearPrepared();
      optionsRequest = null;
      optionsBody = null;
      optionsPending = false;
      current = null;
      invitation.value = "";
      confirmation.value = "";
      show.checked = false;
      invitation.type = confirmation.type = "password";
      expiry.textContent = "";
      say("Guardian setup complete. Keep your Passkey and private recovery code safe; continue with the card instructions below.");
    } catch (error) {
      known(error, "complete");
    } finally {
      busy = false;
      render();
    }
  });
  restart.addEventListener("click", () => {
    if (busy || done || completeBody || completePending || optionsPending)
      return;
    clearPrepared();
    optionsRequest = null;
    optionsBody = null;
    current = null;
    agent.textContent = "";
    expiry.textContent = "";
    say("Confirm the invitation again, then create a new Passkey.");
    render();
    invitation.focus();
  });
  render();
  if (!supported) say("Use a browser that supports Passkeys and open this page over a secure connection.");
})();
