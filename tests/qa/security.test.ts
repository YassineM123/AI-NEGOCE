// Non-destructive security tests against in-process local app instances only.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import request from "supertest"
import { generateKeyPair } from "jose"
import { MemoryStore } from "../../server/store.js"
import { AUDIENCE, ISSUER, PDF, bearer, makeApp, startIssuer } from "./support/harness.js"

let issuer: Awaited<ReturnType<typeof startIssuer>>
let oidc: () => ReturnType<typeof makeApp>
beforeAll(async () => {
  issuer = await startIssuer()
  oidc = () => makeApp({ env: { OIDC_ISSUER: ISSUER, OIDC_AUDIENCE: AUDIENCE, OIDC_JWKS_URL: issuer.jwksUrl } })
})
afterAll(() => issuer.close())

describe("authentication", () => {
  it("rejects missing, non-bearer and garbage credentials", async () => {
    const { app } = makeApp()
    expect((await request(app).get("/api/v1/me")).status).toBe(401)
    expect((await request(app).get("/api/v1/me").set("Authorization", "Basic YWRtaW46YWRtaW4=")).status).toBe(401)
    expect((await request(app).get("/api/v1/me").set(bearer("dev-root"))).status).toBe(401)
  })
  it("development tokens are refused when NODE_ENV=production", async () => {
    const { app } = makeApp({ env: { NODE_ENV: "production", AUTH_MODE: "oidc", HOST: "0.0.0.0", DATABASE_URL: "postgres://unused", OIDC_ISSUER: ISSUER, OIDC_AUDIENCE: AUDIENCE, OIDC_JWKS_URL: issuer.jwksUrl, ERP_BASE_URL: "https://erp.invalid", ERP_API_TOKEN: "x".repeat(20) } })
    expect((await request(app).get("/api/v1/me").set(bearer("dev-admin"))).status).toBe(401)
    expect((await request(app).get("/api/v1/me").set("Authorization", "Bearer dev-admin")).status).toBe(401)
  })
  it("accepts a valid OIDC token and maps claims", async () => {
    const t = await issuer.sign({ sub: "u1", name: "QA", role: "accountant", agencies: ["Sfax"] })
    const r = await request(oidc().app).get("/api/v1/me").set(bearer(t))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ id: "u1", role: "accountant", agencies: ["Sfax"] })
  })
  it.each([
    ["expired", async () => issuer.sign({ sub: "u", role: "admin", agencies: ["*"] }, { expiresIn: Math.floor(Date.now() / 1000) - 60 })],
    ["wrong audience", async () => issuer.sign({ sub: "u", role: "admin", agencies: ["*"] }, { audience: "other-api" })],
    ["wrong issuer", async () => issuer.sign({ sub: "u", role: "admin", agencies: ["*"] }, { issuer: "https://evil.example/" })],
    ["foreign signing key", async () => issuer.sign({ sub: "u", role: "admin", agencies: ["*"] }, { key: (await generateKeyPair("RS256")).privateKey })],
    ["unknown role", async () => issuer.sign({ sub: "u", role: "superadmin", agencies: ["*"] })],
    ["alg=none", async () => `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "u", role: "admin", agencies: ["*"], iss: ISSUER, aud: AUDIENCE })).toString("base64url")}.`],
  ])("rejects a token with %s", async (_n, make) => {
    expect((await request(oidc().app).get("/api/v1/me").set(bearer(await make()))).status).toBe(401)
  })
})

describe("authorization and isolation", () => {
  it("role matrix: commercial cannot upload or read documents; manager cannot approve", async () => {
    const { app } = makeApp()
    const up = await request(app).post("/api/v1/documents").set(bearer("dev-admin")).field("agency", "Sfax").attach("file", PDF, { filename: "a.pdf", contentType: "application/pdf" })
    expect((await request(app).get(`/api/v1/documents/${up.body.id}`).set(bearer("dev-commercial-tunis"))).status).toBe(403)
    expect((await request(app).post(`/api/v1/documents/${up.body.id}/approve`).set(bearer("dev-manager-sfax"))).status).toBe(403)
  })
  it("cross-agency document access is refused", async () => {
    const { app } = makeApp()
    const up = await request(app).post("/api/v1/documents").set(bearer("dev-admin")).field("agency", "Tunis Centre").attach("file", PDF, { filename: "a.pdf", contentType: "application/pdf" })
    expect((await request(app).get(`/api/v1/documents/${up.body.id}`).set(bearer("dev-manager-sfax"))).status).toBe(403)
  })
  it("cross-user conversation access returns 404 (no existence oracle)", async () => {
    const { app } = makeApp()
    const c = await request(app).post("/api/v1/conversations").set(bearer("dev-admin")).send({ title: "privé" })
    expect((await request(app).get(`/api/v1/conversations/${c.body.id}`).set(bearer("dev-manager-sfax"))).status).toBe(404)
    const q = await request(app).post("/api/v1/copilot/query").set(bearer("dev-manager-sfax")).send({ question: "Quelle est la marge ?", conversationId: c.body.id })
    expect(q.status).toBe(404)
    expect((await request(app).get(`/api/v1/conversations/${c.body.id}`).set(bearer("dev-admin"))).body.messages).toHaveLength(0)
  })
  it("unknown / malformed ids do not error", async () => {
    const { app } = makeApp()
    expect((await request(app).get(`/api/v1/documents/${crypto.randomUUID()}`).set(bearer("dev-admin"))).status).toBe(404)
    expect([400, 404]).toContain((await request(app).get("/api/v1/documents/..%2F..%2Fetc%2Fpasswd").set(bearer("dev-admin"))).status)
    expect([400, 404]).toContain((await request(app).get("/api/v1/conversations/not-a-uuid").set(bearer("dev-admin"))).status)
  })
})

describe("injection, XSS, CSRF, CORS, headers", () => {
  it("SQL-like agency values are treated as data", async () => {
    const { app } = makeApp()
    const r = await request(app).get("/api/v1/bi/overview").query({ agency: "' OR 1=1 --" }).set(bearer("dev-admin"))
    expect(r.status).toBe(200)
    expect(r.body.revenue).toBe(0)
    expect((await request(app).get("/api/v1/bi/overview").query({ agency: "' OR 1=1 --" }).set(bearer("dev-manager-sfax"))).status).toBe(403)
  })
  it("script payloads are returned as JSON data, never reflected as HTML", async () => {
    const { app } = makeApp()
    const c = await request(app).post("/api/v1/conversations").set(bearer("dev-admin")).send({ title: "<img src=x onerror=alert(1)>" })
    expect(c.headers["content-type"]).toMatch(/application\/json/)
    const q = await request(app).post("/api/v1/copilot/query").set(bearer("dev-admin")).send({ question: "<script>alert(1)</script> marge ?" })
    expect(q.headers["content-type"]).toMatch(/application\/json/)
    expect(q.body.answer).not.toContain("<script>")
  })
  it("no cookies are issued (bearer-only API: CSRF not applicable)", async () => {
    const { app } = makeApp()
    const r = await request(app).get("/api/v1/me").set(bearer("dev-admin"))
    expect(r.headers["set-cookie"]).toBeUndefined()
  })
  it("CORS only allows the configured frontend origin", async () => {
    const { app } = makeApp()
    const evil = await request(app).options("/api/v1/me").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "GET")
    expect(evil.headers["access-control-allow-origin"]).not.toBe("https://evil.example")
    const good = await request(app).options("/api/v1/me").set("Origin", "http://localhost:8443").set("Access-Control-Request-Method", "GET")
    expect(good.headers["access-control-allow-origin"]).toBe("http://localhost:8443")
  })
  it("security headers present, framework banner absent", async () => {
    const r = await request(makeApp().app).get("/api/v1/livez")
    expect(r.headers["x-content-type-options"]).toBe("nosniff")
    expect(r.headers["x-powered-by"]).toBeUndefined()
    expect(r.headers["x-frame-options"]).toBeDefined()
  })
})

describe("input validation, errors, rate limiting", () => {
  it("validates copilot and conversation payloads", async () => {
    const { app } = makeApp()
    expect((await request(app).post("/api/v1/copilot/query").set(bearer("dev-admin")).send({ question: "ok" })).status).toBe(400)
    expect((await request(app).post("/api/v1/copilot/query").set(bearer("dev-admin")).send({ question: "x".repeat(1001) })).status).toBe(400)
    expect((await request(app).post("/api/v1/copilot/query").set(bearer("dev-admin")).send({ question: "marge ?", filters: { agency: "a".repeat(81) } })).status).toBe(400)
    expect((await request(app).post("/api/v1/conversations").set(bearer("dev-admin")).send({ title: "   " })).status).toBe(400)
    expect((await request(app).post("/api/v1/copilot/query").set(bearer("dev-admin")).send({ question: "marge ?", conversationId: "nope" })).status).toBe(400)
  })
  it("internal errors do not leak stack traces or messages", async () => {
    const store = new MemoryStore()
    store.createConversation = async () => {
      throw new Error("SECRET connection string postgres://user:pass@db")
    }
    const r = await request(makeApp({ store }).app).post("/api/v1/conversations").set(bearer("dev-admin")).send({ title: "x" })
    expect(r.status).toBe(500)
    expect(JSON.stringify(r.body)).not.toMatch(/SECRET|postgres:|at .*\.ts/)
    expect(r.body.error.code).toBe("INTERNAL_ERROR")
  })
  it("unknown API routes answer with the JSON error envelope", async () => {
    const r = await request(makeApp().app).get("/api/v1/does-not-exist").set(bearer("dev-admin"))
    expect(r.status).toBe(404)
    expect(r.body?.error?.code).toBe("NOT_FOUND")
  })
  it("rate limiting returns 429 after the per-minute budget", async () => {
    const { app } = makeApp()
    let last = 0
    for (let i = 0; i < 125; i++) last = (await request(app).get("/api/v1/livez")).status
    expect(last).toBe(429)
  })
})
