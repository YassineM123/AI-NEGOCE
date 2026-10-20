// Phase 1 / Step 1 — fail-closed authentication.
// Explicit AUTH_MODE, no static or bundled credentials, development identities limited to this
// machine, server-side permissions, every business route authenticated, no credential in logs.
import { spawn } from "node:child_process"
import crypto from "node:crypto"
import path from "node:path"
import { Writable } from "node:stream"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import request from "supertest"
import { createApp } from "../../server/app.js"
import { isLoopbackAddress, signDevToken } from "../../server/auth.js"
import { loadConfig } from "../../server/config.js"
import { TestErpAdapter } from "../../server/erp.js"
import { DisabledOcrProvider } from "../../server/ocr.js"
import { hasPermission, type Permission } from "../../server/permissions.js"
import { AUDIENCE, ISSUER, PDF, TEST_DEV_KEY, bearer, makeApp, startIssuer } from "./support/harness.js"

let issuer: Awaited<ReturnType<typeof startIssuer>>
const oidcEnv = () => ({ AUTH_MODE: "oidc", OIDC_ISSUER: ISSUER, OIDC_AUDIENCE: AUDIENCE, OIDC_JWKS_URL: issuer.jwksUrl })
beforeAll(async () => {
  issuer = await startIssuer()
})
afterAll(() => issuer.close())

const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url")
const hs256 = (key: string, payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }) => {
  const head = `${b64(header)}.${b64(payload)}`
  return `${head}.${crypto.createHmac("sha256", key).update(head).digest("base64url")}`
}
const now = () => Math.floor(Date.now() / 1000)
const devClaims = (sub: string, extra: Record<string, unknown> = {}) => ({ sub, iss: "ai-negoce/local-dev", aud: "ai-negoce-api/local-dev", iat: now(), exp: now() + 600, ...extra })
const raw = (token: string) => ({ Authorization: `Bearer ${token}` })

describe("configuration fails closed", () => {
  const base = { NODE_ENV: "development" }
  it("requires an explicit AUTH_MODE", () => {
    expect(() => loadConfig(base)).toThrow(/AUTH_MODE is required/)
    expect(() => loadConfig({ ...base, AUTH_MODE: "dev" })).toThrow()
  })
  it("defaults the bind address to loopback", () => {
    expect(loadConfig({ ...base, AUTH_MODE: "local-dev" }).HOST).toBe("127.0.0.1")
  })
  it.each(["0.0.0.0", "::", "192.168.1.20", "10.0.0.5", "api.example.com"])("refuses local-dev on non-loopback HOST %s", (HOST) => {
    expect(() => loadConfig({ ...base, AUTH_MODE: "local-dev", HOST })).toThrow(/loopback HOST/)
  })
  it.each(["127.0.0.1", "::1", "localhost"])("accepts local-dev on loopback HOST %s", (HOST) => {
    expect(loadConfig({ ...base, AUTH_MODE: "local-dev", HOST }).AUTH_MODE).toBe("local-dev")
  })
  it("forbids local-dev in production even with every production variable set", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", AUTH_MODE: "local-dev", DATABASE_URL: "postgres://x", OIDC_ISSUER: ISSUER, OIDC_AUDIENCE: AUDIENCE, OIDC_JWKS_URL: "https://idp.invalid/jwks", ERP_BASE_URL: "https://erp.invalid", ERP_API_TOKEN: "x".repeat(20) }),
    ).toThrow(/forbidden when NODE_ENV=production/)
  })
  it("requires a complete identity provider for oidc, and never accepts a partial one", () => {
    expect(() => loadConfig({ ...base, AUTH_MODE: "oidc" })).toThrow(/AUTH_MODE=oidc requires/)
    expect(() => loadConfig({ ...base, AUTH_MODE: "local-dev", OIDC_JWKS_URL: "https://idp.invalid/jwks" })).toThrow(/Incomplete OIDC/)
  })
  it("rejects a weak development signing key", () => {
    expect(() => loadConfig({ ...base, AUTH_MODE: "local-dev", AUTH_DEV_SIGNING_KEY: "short" })).toThrow()
  })
})

describe("loopback detection", () => {
  it.each([
    ["127.0.0.1", true], ["127.10.20.30", true], ["::1", true], ["::ffff:127.0.0.1", true],
    ["10.0.0.5", false], ["192.168.1.2", false], ["::ffff:192.168.1.2", false], ["fe80::1", false], ["", false], [undefined, false],
  ])("%s -> %s", (address, expected) => {
    expect(isLoopbackAddress(address)).toBe(expected)
  })
})

describe("no static, legacy or cross-mode credential", () => {
  it.each(["dev-admin", "dev-manager-sfax", "dev-commercial-tunis", "admin", "usr-admin"])("raw token %s is refused", async (token) => {
    const { app } = makeApp()
    expect((await request(app).get("/api/v1/me").set(raw(token))).status).toBe(401)
    expect((await request(app).get("/api/v1/documents").set(raw(token))).status).toBe(401)
  })
  it("oidc mode refuses development tokens and does not expose the session endpoint", async () => {
    const { app } = makeApp({ env: oidcEnv() })
    expect((await request(app).get("/api/v1/me").set(bearer("dev-admin"))).status).toBe(401)
    expect((await request(app).post("/api/v1/auth/dev-session").send({ identity: "admin" })).status).toBe(401)
    const t = await issuer.sign({ sub: "u1", role: "admin", agencies: ["*"] })
    expect((await request(app).post("/api/v1/auth/dev-session").set(raw(t)).send({ identity: "admin" })).status).toBe(404)
    expect((await request(app).get("/api/v1/me").set(raw(t))).body.authMode).toBe("oidc")
  })
})

describe("development session endpoint (local-dev)", () => {
  it("issues a short-lived token resolved against the server-side catalogue", async () => {
    const { app, store } = makeApp()
    const r = await request(app).post("/api/v1/auth/dev-session").send({ identity: "manager-sfax" })
    expect(r.status).toBe(201)
    expect(r.headers["cache-control"]).toBe("no-store")
    expect(Date.parse(r.body.expiresAt) - Date.now()).toBeLessThanOrEqual(3600_000)
    const me = await request(app).get("/api/v1/me").set(raw(r.body.token))
    expect(me.body).toMatchObject({ id: "usr-sfax", role: "manager", agencies: ["Sfax"], authMode: "local-dev" })
    expect(store.audits.some((a) => a.action === "auth.dev_session.issued" && a.resourceId === "manager-sfax")).toBe(true)
  })
  it.each(["root", "superadmin", "__proto__", "constructor", "toString", ""])("refuses unknown identity %j", async (identity) => {
    const { app } = makeApp()
    expect((await request(app).post("/api/v1/auth/dev-session").send({ identity })).status).toBe(400)
  })
  it("accepts JSON only (no cross-site form post)", async () => {
    const { app } = makeApp()
    const r = await request(app).post("/api/v1/auth/dev-session").type("form").send("identity=admin")
    expect(r.status).toBe(415)
  })
  it("tokens from one API instance are invalid on another (per-process key)", async () => {
    const a = makeApp({ env: { AUTH_DEV_SIGNING_KEY: undefined as unknown as string } }).app
    const b = makeApp({ env: { AUTH_DEV_SIGNING_KEY: undefined as unknown as string } }).app
    const t = (await request(a).post("/api/v1/auth/dev-session").send({ identity: "admin" })).body.token
    expect((await request(a).get("/api/v1/me").set(raw(t))).status).toBe(200)
    expect((await request(b).get("/api/v1/me").set(raw(t))).status).toBe(401)
  })
})

describe("token tampering and privilege escalation", () => {
  const { app } = makeApp()
  it("rejects a token signed with another key", async () => {
    expect((await request(app).get("/api/v1/me").set(raw(signDevToken("another-key-another-key-another-key!", "admin")))).status).toBe(401)
  })
  it("rejects an expired token", async () => {
    expect((await request(app).get("/api/v1/me").set(raw(signDevToken(TEST_DEV_KEY, "admin", { now: now() - 7200 })))).status).toBe(401)
  })
  it("rejects a payload swapped onto another identity's signature", async () => {
    const [h, , s] = signDevToken(TEST_DEV_KEY, "commercial-tunis").split(".")
    expect((await request(app).get("/api/v1/me").set(raw(`${h}.${b64(devClaims("admin"))}.${s}`))).status).toBe(401)
  })
  it("rejects alg=none and wrong issuer or audience", async () => {
    expect((await request(app).get("/api/v1/me").set(raw(`${b64({ alg: "none" })}.${b64(devClaims("admin"))}.`))).status).toBe(401)
    expect((await request(app).get("/api/v1/me").set(raw(hs256(TEST_DEV_KEY, devClaims("admin", { iss: "evil" }))))).status).toBe(401)
    expect((await request(app).get("/api/v1/me").set(raw(hs256(TEST_DEV_KEY, devClaims("admin", { aud: "other" }))))).status).toBe(401)
  })
  it("rejects a correctly signed token for an identity outside the catalogue", async () => {
    expect((await request(app).get("/api/v1/me").set(raw(hs256(TEST_DEV_KEY, devClaims("root"))))).status).toBe(401)
  })
  it("ignores role and agency claims smuggled into a development token", async () => {
    const t = hs256(TEST_DEV_KEY, devClaims("commercial-tunis", { role: "admin", agencies: ["*"] }))
    const me = await request(app).get("/api/v1/me").set(raw(t))
    expect(me.body).toMatchObject({ role: "commercial", agencies: ["Tunis Centre"] })
    expect((await request(app).get("/api/v1/documents").set(raw(t))).status).toBe(403)
  })
  it("enforces document permissions per role", async () => {
    const up = await request(app).post("/api/v1/documents").set(bearer("dev-admin")).field("agency", "Sfax").attach("file", Buffer.concat([PDF, Buffer.from(crypto.randomUUID())]), { filename: "f.pdf", contentType: "application/pdf" })
    expect(up.status).toBe(201)
    const id = up.body.id
    const c = bearer("dev-commercial-tunis")
    expect((await request(app).post("/api/v1/documents").set(c).field("agency", "Tunis Centre").attach("file", PDF, { filename: "x.pdf", contentType: "application/pdf" })).status).toBe(403)
    expect((await request(app).get("/api/v1/documents").set(c)).status).toBe(403)
    expect((await request(app).get(`/api/v1/documents/${id}`).set(c)).status).toBe(403)
    expect((await request(app).post(`/api/v1/documents/${id}/approve`).set(c)).status).toBe(403)
    const m = bearer("dev-manager-sfax")
    expect((await request(app).get(`/api/v1/documents/${id}`).set(m)).status).toBe(200)
    const approve = await request(app).post(`/api/v1/documents/${id}/approve`).set(m)
    expect(approve.status).toBe(403)
    expect(approve.body.error.code).toBe("FORBIDDEN")
  })
  it("keeps agency scope for documents", async () => {
    const up = await request(app).post("/api/v1/documents").set(bearer("dev-admin")).field("agency", "Tunis Centre").attach("file", Buffer.concat([PDF, Buffer.from(crypto.randomUUID())]), { filename: "t.pdf", contentType: "application/pdf" })
    const r = await request(app).get(`/api/v1/documents/${up.body.id}`).set(bearer("dev-manager-sfax"))
    expect(r.status).toBe(403)
    expect(r.body.error.code).toBe("AGENCY_FORBIDDEN")
  })
})

describe("permission matrix", () => {
  const all: Permission[] = ["documents.read", "documents.upload", "invoice.correct", "invoice.approve", "mapping.approve", "erp.integrate"]
  it.each([
    ["admin", all],
    ["accountant", ["documents.read", "documents.upload", "invoice.correct", "invoice.approve"]],
    ["manager", ["documents.read", "documents.upload", "invoice.correct"]],
    ["commercial", []],
  ] as const)("%s", (role, granted) => {
    for (const p of all) expect(hasPermission(role, p), `${role} ${p}`).toBe((granted as readonly string[]).includes(p))
  })
  it("denies an absent role", () => {
    for (const p of all) expect(hasPermission(undefined, p)).toBe(false)
  })
})

describe("every business route requires authentication", () => {
  const PUBLIC = new Set(["GET /api/v1/livez", "GET /api/v1/readyz", "POST /api/v1/auth/dev-session"])
  const routes = (app: ReturnType<typeof makeApp>["app"]) => {
    const stack = (app as unknown as { router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] } }).router.stack
    return stack.flatMap((l) => (l.route ? Object.keys(l.route.methods).map((m) => ({ method: m.toUpperCase(), path: l.route!.path })) : []))
  }
  for (const mode of ["local-dev", "oidc"] as const) {
    it(`${mode}: no route except liveness/readiness/dev-session answers without a token`, async () => {
      const { app } = mode === "oidc" ? makeApp({ env: oidcEnv() }) : makeApp()
      const list = routes(app)
      expect(list.length).toBeGreaterThan(15)
      for (const r of list) {
        if (PUBLIC.has(`${r.method} ${r.path}`)) continue
        const url = r.path.replace(/:[a-zA-Z]+/g, (p) => (p === ":module" ? "sales" : crypto.randomUUID()))
        const res = await request(app)[r.method.toLowerCase() as "get" | "post"](url).send({})
        expect(res.status, `${r.method} ${r.path}`).toBe(401)
      }
    })
  }
})

describe("accidental network exposure", () => {
  it.each([["X-Forwarded-For", "203.0.113.7"], ["Forwarded", "for=203.0.113.7"], ["X-Real-IP", "203.0.113.7"], ["X-Forwarded-Host", "app.example.com"]])("local-dev refuses relayed requests (%s), even with a valid token", async (header, value) => {
    const { app } = makeApp()
    const me = await request(app).get("/api/v1/me").set(bearer("dev-admin")).set(header, value)
    expect(me.status).toBe(403)
    expect(me.body.error.code).toBe("LOCAL_DEV_ONLY")
    expect((await request(app).post("/api/v1/auth/dev-session").set(header, value).send({ identity: "admin" })).status).toBe(403)
  })
  it("oidc mode works behind a reverse proxy", async () => {
    const { app } = makeApp({ env: oidcEnv() })
    const t = await issuer.sign({ sub: "u1", role: "accountant", agencies: ["Sfax"] })
    expect((await request(app).get("/api/v1/me").set(raw(t)).set("X-Forwarded-For", "203.0.113.7")).status).toBe(200)
  })

  // Real process starts of server/index.ts, with an environment stripped of any auth setting.
  const tsx = path.resolve("node_modules/tsx/dist/cli.mjs")
  const cleanEnv = (extra: Record<string, string>) => ({
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(AUTH_|OIDC_|HOST$|NODE_ENV$|DATABASE_URL$|API_PORT$|VITE_)/.test(k))),
    LOG_LEVEL: "silent",
    ...extra,
  })
  const start = (env: Record<string, string>, until: RegExp) =>
    new Promise<{ code: number | null; output: string }>((resolve) => {
      const child = spawn(process.execPath, [tsx, "server/index.ts"], { env: cleanEnv(env) })
      let output = ""
      const done = (code: number | null) => resolve({ code, output })
      const onData = (d: Buffer) => {
        output += d.toString()
        if (until.test(output)) {
          child.kill()
          done(null)
        }
      }
      child.stdout.on("data", onData)
      child.stderr.on("data", onData)
      child.on("exit", (code) => done(code))
      setTimeout(() => child.kill(), 20_000)
    })
  it("refuses to start without AUTH_MODE", async () => {
    const r = await start({}, /$^/)
    expect(r.code).toBe(1)
    expect(r.output).toMatch(/AUTH_MODE is required/)
  }, 30_000)
  it("refuses to start local-dev on a public interface", async () => {
    const r = await start({ AUTH_MODE: "local-dev", HOST: "0.0.0.0" }, /$^/)
    expect(r.code).toBe(1)
    expect(r.output).toMatch(/loopback HOST/)
  }, 30_000)
  it("binds to 127.0.0.1 by default", async () => {
    const port = String(40000 + Math.floor(Math.random() * 20000))
    const r = await start({ AUTH_MODE: "local-dev", API_PORT: port }, /listening on/)
    expect(r.output).toContain(`listening on 127.0.0.1:${port} (auth: local-dev)`)
  }, 30_000)
})

describe("credentials are never logged", () => {
  it("authorization headers and issued tokens stay out of the request logs", async () => {
    let logs = ""
    const sink = new Writable({ write(chunk, _enc, cb) { logs += chunk.toString(); cb() } })
    const previous = process.env.LOG_LEVEL
    process.env.LOG_LEVEL = "info"
    try {
      const { config, store } = makeApp()
      const app = createApp({ config, store, ocr: new DisabledOcrProvider(), erp: new TestErpAdapter(), logDestination: sink })
      const session = await request(app).post("/api/v1/auth/dev-session").send({ identity: "admin" })
      const token = session.body.token as string
      await request(app).get("/api/v1/me").set(raw(token))
      await request(app).get("/api/v1/me").set(raw("forged.credential.value"))
      expect(logs).toContain("request completed")
      expect(logs).not.toContain(token)
      expect(logs).not.toContain(token.split(".")[2])
      expect(logs).not.toContain("forged.credential.value")
      expect(logs).not.toMatch(/Bearer /)
      expect(logs).toContain("[Redacted]")
    } finally {
      process.env.LOG_LEVEL = previous
    }
  })
})
