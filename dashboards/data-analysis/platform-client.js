(function (global) {
  "use strict";
  let token = null;
  let controller = null;
  const base = (global.AI_NEGOCE_API_BASE || "").replace(/\/$/, "");
  async function call(path, init) {
    controller?.abort();
    controller = new AbortController();
    const response = await fetch(base + path, { ...init, signal: controller.signal, headers: { ...(init && init.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}) } });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message || "API plateforme indisponible (HTTP " + response.status + ")");
    return body;
  }
  function validate(value) {
    if (!value || value.contractVersion !== "1.0" || !value.principal || !Array.isArray(value.permissions) || !value.platforms) throw new Error("Contrat plateforme invalide");
    return value;
  }
  global.AINegocePlatform = Object.freeze({
    async connectLocalDemo() { const session = await call("/api/v1/auth/dev-session", { method: "POST", body: JSON.stringify({ identity: "admin" }) }); if (!session || typeof session.token !== "string") throw new Error("Session locale invalide"); token = session.token; return this.getContext(); },
    async getContext() { if (!token) throw new Error("Session non connectée"); return validate(await call("/api/v1/platform/context")); },
    async getAnalyticsOverview(filters) {
      if (!token) throw new Error("Session non connectée");
      const query = new URLSearchParams(filters || {}).toString();
      const value = await call("/api/v1/analytics/overview" + (query ? "?" + query : ""));
      if (!value || value.contractVersion !== "1.0" || value.bi?.status !== "available" || !value.bi.data || !value.snapshot) throw new Error("Contrat analytics overview invalide");
      return value;
    },
    disconnect() { controller?.abort(); controller = null; token = null; },
  });
})(window);
