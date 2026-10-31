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
    status = $("identity-status");
  const base = "/api/v1/identity/guardian/registration";
  const supported =
    typeof PublicKeyCredential !== "undefined" &&
    isSecureContext === true &&
    typeof navigator.credentials?.create === "function" &&
    typeof crypto?.getRandomValues === "function" &&
    typeof crypto?.randomUUID === "function";
  let busy = false,
    done = false,
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
    start.textContent = optionsPending ? "重試確認邀請" : "確認邀請";
    form.hidden = done;
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
    finish.textContent = completeBody ? "重試完成設定" : "完成監護設定";
    restart.hidden = done || (!current && !optionsRequest);
    restart.disabled =
      busy || !!completeBody || completePending || optionsPending;
  }
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
    invalidated("這次設定已到期。請重新確認邀請，再建立新的 Passkey。");
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
      say("結果尚未確認。請留在本頁，使用同一個重試按鈕確認結果。");
      return;
    }
    if (error.status === 429) {
      say("操作暫時較頻繁，請稍候，再按同一個按鈕重試。");
      return;
    }
    if (error.status >= 500) {
      say("暫時無法完成，請稍後使用同一筆設定重試。");
      return;
    }
    const message =
      error.status === 403
        ? "確認碼無法使用。請核對邀請與確認碼，或聯絡邀請你的住戶。"
        : error.status === 409
          ? "這次設定已到期或已變更。請重新確認邀請後再建立 Passkey。"
          : "這次設定未能確認。請重新確認邀請後再試。";
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
        say("請完整貼上邀請識別碼與初次確認碼。");
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
    say("正在確認邀請…");
    try {
      const data = await api("/options", optionsBody);
      if (
        !data ||
        !/^mcid:[a-f0-9]{64}$/.test(data.agentId) ||
        !/^[a-f0-9]{32}$/.test(data.challengeId) ||
        !Number.isFinite(Date.parse(data.expiresAt)) ||
        !data.options ||
        typeof data.options !== "object"
      )
        throw { unknown: true };
      current = data;
      optionsPending = false;
      agent.textContent = data.agentId;
      expiry.textContent = new Date(data.expiresAt).toLocaleString("zh-TW");
      if (expired()) localExpiry();
      else say("邀請已確認。準備好時，請建立 Passkey。");
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
    busy = true;
    render();
    say("請依瀏覽器提示建立 Passkey。");
    try {
      const value = await navigator.credentials.create({
        publicKey: creationOptions(current.options),
      });
      if (!value) throw { name: "NotAllowedError" };
      credential = project(value);
      offline = recoveryCode();
      downloadRequested = false;
      ack.checked = false;
      say("Passkey 已準備好。請下載並安全保存私密復原碼。");
    } catch (error) {
      clearPrepared();
      say(
        error?.name === "NotAllowedError"
          ? "已取消建立 Passkey。準備好時可以再試。"
          : "這台裝置暫時無法建立 Passkey。請使用支援 Passkey 的瀏覽器與安全連線，再試一次。",
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
          "Muse Tower 私密復原碼\n網站：" +
            location.origin +
            "\nAgent ID：" +
            current.agentId +
            "\n復原碼：" +
            offline +
            "\n請離線保存，不要公開或轉傳。\n",
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
      say("已開始下載。請確認檔案已安全保存，再勾選下方確認。");
    } catch {
      say("未能開始下載。請確認瀏覽器允許下載，再試一次。");
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
    say("正在完成監護設定…");
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
      say("監護設定完成。請保管好 Passkey 與私密復原碼。");
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
    say("請重新確認邀請，再建立新的 Passkey。");
    render();
    invitation.focus();
  });
  render();
  if (!supported) say("請使用支援 Passkey 的瀏覽器，並透過安全連線開啟本頁。");
})();
