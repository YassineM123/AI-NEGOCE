(function (global) {
  "use strict";
  // This module supports two modes:
  // 1) Same-origin Command Center: parent owns the bearer token and executes allow-listed API calls.
  // 2) Standalone localhost preview: local-dev session created explicitly by the user.
  // No bearer token is persisted or sent to a child iframe.
  const portal = global.parent !== global && (() => {
    try { return global.parent.location.origin === global.location.origin; } catch { return false; }
  })();
  const origin = global.location.origin;
  const base = (global.AI_NEGOCE_API_BASE || "").replace(/\/$/, "");
  const listeners = new Set();
  const pending = new Map();
  let token = null;
  let controller = null;
  let portalReady = false;
  let currentState = { connected: false, filters: { agency: "all", from: "2026-10-01", to: "2026-12-31" }, revision: 0 };
  let counter = 0;

  function emit() { for (const fn of listeners) fn({ ...currentState, filters: { ...currentState.filters } }); }
  global.addEventListener("message", (event) => {
    if (!portal || event.source !== global.parent || event.origin !== origin) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "AI_NEGOCE_BRIDGE_STATE") {
      if (!Number.isSafeInteger(msg.revision) || msg.revision < currentState.revision) return;
      if (msg.filters?.agency !== "all" && typeof msg.filters?.agency !== "string") return;
      if (typeof msg.filters?.from !== "string" || typeof msg.filters?.to !== "string") return;
      if (msg.revision === currentState.revision && portalReady && msg.connected === currentState.connected) return;
      portalReady = true;
      currentState = { connected: msg.connected === true, revision: msg.revision, filters: { ...msg.filters } };
      emit();
    }
    if (msg.type === "AI_NEGOCE_BRIDGE_RESPONSE" && typeof msg.id === "string") {
      const item = pending.get(msg.id);
      if (!item) return;
      pending.delete(msg.id);
      global.clearTimeout(item.timer);
      if (msg.error) item.reject(new Error(String(msg.error)));
      else item.resolve(msg.data);
    }
  });

  async function bridgeCall(operation) {
    if (!portalReady || !currentState.connected) throw new Error("Session du Command Center déconnectée");
    if (operation !== "context" && operation !== "overview") throw new Error("Opération non autorisée");
    const id = "req-" + (++counter);
    return new Promise((resolve, reject) => {
      const timer = global.setTimeout(() => {
        pending.delete(id);
        reject(new Error("Le serveur d'analytique ne répond pas"));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      global.parent.postMessage({ type: "AI_NEGOCE_BRIDGE_REQUEST", id, operation }, origin);
    });
  }
  async function directCall(path, init) {
    controller?.abort();
    controller = new AbortController();
    const response = await fetch(base + path, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message || "API indisponible (HTTP " + response.status + ")");
    return body;
  }
  function validateContext(value) {
    if (!value || value.contractVersion !== "1.0" || !value.principal ||
      !Array.isArray(value.permissions) || !value.platforms)
      throw new Error("Contrat de session commun invalide");
    return value;
  }
  function validateOverview(value) {
    if (!value || value.contractVersion !== "1.0" || value.bi?.status !== "available" ||
      !value.bi.data || typeof value.snapshotId !== "string" ||
      !value.snapshot || !value.bi.data.filters)
      throw new Error("Contrat analytique commun invalide");
    return value;
  }
  global.AINegocePlatform = Object.freeze({
    isPortal: portal,
    subscribe(fn) {
      if (typeof fn !== "function") throw new Error("Listener invalide");
      listeners.add(fn);
      if (portalReady) global.queueMicrotask(() => listeners.has(fn) && fn({ ...currentState, filters: { ...currentState.filters } }));
      return () => listeners.delete(fn);
    },
    getFilters() { return { ...currentState.filters }; },
    async connectLocalDemo() {
      if (portal) {
        if (!portalReady || !currentState.connected) throw new Error("Connectez-vous depuis Agentic Command Center");
        return this.getContext();
      }
      const session = await directCall("/api/v1/auth/dev-session", {
        method: "POST", body: JSON.stringify({ identity: "admin" }),
      });
      if (!session || typeof session.token !== "string") throw new Error("Session locale invalide");
      token = session.token;
      return this.getContext();
    },
    async getContext() {
      const value = portal ? await bridgeCall("context") : await (async () => {
        if (!token) throw new Error("Session non connectée");
        return directCall("/api/v1/platform/context");
      })();
      return validateContext(value);
    },
    async getAnalyticsOverview(filters) {
      const value = portal ? await bridgeCall("overview") : await (async () => {
        if (!token) throw new Error("Session non connectée");
        const query = new URLSearchParams(filters || {}).toString();
        return directCall("/api/v1/analytics/overview" + (query ? "?" + query : ""));
      })();
      return validateOverview(value);
    },
    disconnect() {
      controller?.abort();
      controller = null;
      token = null;
      // A portal session can only be revoked by the parent, never by an embedded app.
      if (!portal) { currentState = { ...currentState, connected: false }; emit(); }
    },
  });

  if (portal) global.parent.postMessage({ type: "AI_NEGOCE_BRIDGE_READY" }, origin);
})(window);
