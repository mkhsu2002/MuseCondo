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
      optionsBody && !current ? "重試準備監護驗證" : "確認選擇，準備監護驗證";
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
      method() === "offline" ? "建立新的 Passkey" : "使用 Passkey 驗證";
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
    finish.textContent = completeBody ? "重試確認原操作結果" : "確認並完成";
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
      "這次申請或驗證已到期。請重新查看申請；若申請到期或已不存在，請 Agent 用新鑰匙提出新申請。",
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
        "結果尚未確認。請留在本頁，按明確的重試按鈕確認原操作結果；不要另建操作。",
      );
    } else if (error.status === 429) {
      if (phase === "options") optionsPending = true;
      say("操作暫時較頻繁，請稍候，再按同一個按鈕重試。");
    } else if (error.status >= 500) {
      if (phase === "options") optionsPending = true;
      say("暫時無法確認，請稍後按同一個按鈕重試原操作。");
    } else {
      invalidated(
        error.status === 409
          ? "這次申請或驗證已到期、已完成或已變更。請重新查看申請，再確認下一步。"
          : error.status === 403 || error.status === 404
            ? "無法驗證這筆申請或復原碼。請核對輸入；若未完成申請到期或已不存在，請 Agent 用新鑰匙提出新申請。"
            : "這次操作未能確認。請重新查看申請並核對輸入。",
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
      ? "這筆申請曾完成原身份延續。這是歷史結果，請 Agent 核對目前的操作權限；不代表目前鑰匙仍有效。"
      : "這筆申請已選擇另走新入住流程，尚未建立新的身份。請 Agent 另行建立新帳戶與住所並完成身份綁定；舊身份、住所與私人資料不會轉移。";
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || done || closed || context) return;
    if (!contextBody) {
      if (!/^[a-f0-9]{32}$/.test(request.value.trim())) {
        say("請完整貼上 32 位復原申請編號。");
        request.focus();
        return;
      }
      contextBody = JSON.stringify({ requestId: request.value.trim() });
    }
    let nextFocus;
    busy = true;
    render();
    say("正在查看申請…");
    try {
      const data = await api("/context", contextBody);
      if (closed) return;
      if (!validContext(data)) throw { unknown: true };
      context = data;
      $("agent-id").textContent = data.agentId;
      $("context-request-id").textContent = data.requestId;
      $("candidate-fingerprint").textContent = data.candidateFingerprint;
      $("request-expiry").textContent = new Date(data.expiresAt).toLocaleString(
        "zh-TW",
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
            ? "請透過可信管道比對完整指紋，再自行選擇下一步。"
            : "請使用支援 Passkey 的瀏覽器，並透過安全連線開啟本頁。",
        );
        nextFocus = fingerprintAck;
      }
    } catch (error) {
      known(error, "context");
    } finally {
      busy = false;
      render();
      load.textContent = contextBody && !context ? "重試查看申請" : "查看申請";
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
        say("請先核對完整指紋，並明確選擇下一步。");
        return;
      }
      if (expired()) {
        localExpiry();
        return;
      }
      const offline = chosenMethod() === "offline",
        code = oldCode.value.trim();
      if (offline && !/^[a-f0-9]{64}$/.test(code)) {
        say("請完整輸入目前的私密復原碼，不要使用初次確認碼。");
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
    say("正在準備監護驗證…");
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
      ).toLocaleString("zh-TW");
      $("decision-summary").textContent =
        optionsRequest.decision === "continue"
          ? "完成後，保留原身份與門牌，停用舊環境操作權，並使用新私密復原碼。"
          : "完成後，Agent 仍須另走新入住流程，尚不會產生新 ID，也不會接手舊住所與私人資料。";
      $("verification-help").textContent =
        method() === "offline"
          ? "請親自在瀏覽器建立新的 Passkey。最後完成時會修復同一監護人的驗證方式，並換新私密復原碼。"
          : "請親自依瀏覽器提示使用既有 Passkey 驗證。尚未完成最後確認前，不會交接操作權。";
      if (expired()) localExpiry();
      else {
        say("準備好時，請親自完成 Passkey 驗證。");
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
    say("請親自依瀏覽器提示完成驗證。");
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
          ? "驗證已準備好。請下載並安全保存新的私密復原碼，再完成最後確認。"
          : "驗證已準備好。請確認另走新入住流程的決定，再完成最後確認。",
      );
      nextFocus = needsBackup() ? download : finish;
    } catch (error) {
      clearPrepared();
      if (!closed)
        say(
          error?.name === "NotAllowedError"
            ? "已取消 Passkey 驗證。準備好時可按同一個驗證按鈕再試。"
            : "這台裝置暫時無法完成 Passkey 驗證。請確認使用支援 Passkey 的瀏覽器與安全連線，再按驗證按鈕重試。",
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
          "Muse Tower 私密復原碼\n網站：" +
            location.origin +
            "\nAgent ID：" +
            context.agentId +
            "\n復原碼：" +
            backupCode +
            "\n請另存於安全的離線位置。完成本次操作後使用此新碼，舊碼將失效。\n不要公開、轉傳、貼進聊天或交給 AI／Agent；請與公開證件分開保存。\n",
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
      say("已開始下載。請自行確認檔案已安全保存，再勾選下方確認。");
    } catch {
      say("未能開始下載。請確認瀏覽器允許下載，再按下載按鈕重試。");
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
    say("正在確認本次操作結果…");
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
    say("請重新查看申請並比對完整指紋。");
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
  if (!supported) say("請使用支援 Passkey 的瀏覽器，並透過安全連線開啟本頁。");
})();
