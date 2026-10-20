// Phase 1 / Step 2 — tenant isolation through the API (in-memory store; the PostgreSQL
// row-level security is covered by server/store.pg.test.ts).
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import request from "supertest"
import { MemoryStore } from "../../server/store.js"
import { AUDIENCE, ISSUER, PDF, StubOcr, bearer, makeApp, startIssuer } from "./support/harness.js"

let issuer: Awaited<ReturnType<typeof startIssuer>>
let ctx: ReturnType<typeof makeApp>
beforeAll(async () => {
  issuer = await startIssuer()
  ctx = makeApp({ env: { AUTH_MODE: "oidc", OIDC_ISSUER: ISSUER, OIDC_AUDIENCE: AUDIENCE, OIDC_JWKS_URL: issuer.jwksUrl } })
})
afterAll(() => issuer.close())

const as = async (org: string | undefined, role = "admin", sub = "u1", agencies: string[] = ["*"]) => ({
  Authorization: `Bearer ${await issuer.sign(org === undefined ? { sub, role, agencies, org_id: undefined } : { sub, role, agencies, org_id: org })}`,
})
const pdf = () => Buffer.concat([PDF, Buffer.from(crypto.randomUUID())])
const upload = async (headers: Record<string, string>, file = pdf(), agency = "Tunis Centre") =>
  request(ctx.app).post("/api/v1/documents").set(headers).field("agency", agency).attach("file", file, { filename: "f.pdf", contentType: "application/pdf" })

describe("tenant identity comes only from the verified token", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["path traversal", "../client-a"],
    ["uppercase / spaces", "Client A"],
    ["too long", "a".repeat(80)],
  ])("refuses a token whose organization is %s", async (_label, org) => {
    const h = org === undefined ? await as(undefined) : await as(org)
    expect((await request(ctx.app).get("/api/v1/me").set(h)).status).toBe(401)
  })
  it("refuses unknown, suspended and quarantined organizations", async () => {
    const store = new MemoryStore()
    store.organizations.set("legacy-unassigned", { id: "legacy-unassigned", name: "L", status: "quarantine", isSynthetic: false })
    const { app } = makeApp({ store, env: { AUTH_MODE: "oidc", OIDC_ISSUER: ISSUER, OIDC_AUDIENCE: AUDIENCE, OIDC_JWKS_URL: issuer.jwksUrl } })
    for (const org of ["inconnue", "client-suspendu", "legacy-unassigned"]) {
      const r = await request(app).get("/api/v1/me").set(await as(org))
      expect(r.status, org).toBe(403)
      expect(r.body.error.code).toBe("ORGANIZATION_INACTIVE")
    }
  })
  it("reports the organization from the server, not from the request", async () => {
    const r = await request(ctx.app).get("/api/v1/me?organizationId=client-b").set(await as("client-a")).set("X-Organization-Id", "client-b")
    expect(r.body.organization).toEqual({ id: "client-a", name: "Client A (test)", isSynthetic: false })
  })
})

describe("documents are invisible across organizations", () => {
  let id = ""
  let file: ReturnType<typeof pdf>
  beforeAll(async () => {
    file = pdf()
    const r = await upload(await as("client-a"), file)
    expect(r.status).toBe(201)
    id = r.body.id
  })
  it("another organization gets 404 (no existence leak) on read, file and approve", async () => {
    const b = await as("client-b")
    for (const url of [`/api/v1/documents/${id}`, `/api/v1/documents/${id}/file`]) {
      const r = await request(ctx.app).get(url).set(b)
      expect(r.status, url).toBe(404)
    }
    expect((await request(ctx.app).post(`/api/v1/documents/${id}/approve`).set(b)).status).toBe(404)
    const list = await request(ctx.app).get("/api/v1/documents").set(b)
    expect(list.body.documents.map((d: { id: string }) => d.id)).not.toContain(id)
  })
  it("tenant hints in headers or query strings are ignored", async () => {
    const b = await as("client-b")
    const r = await request(ctx.app).get(`/api/v1/documents/${id}?organizationId=client-a&org_id=client-a`).set(b).set("X-Organization-Id", "client-a").set("X-Tenant", "client-a")
    expect(r.status).toBe(404)
  })
  it("the same user id in two organizations does not share data", async () => {
    const a1 = await as("client-a", "admin", "shared-sub")
    const b1 = await as("client-b", "admin", "shared-sub")
    const c = await request(ctx.app).post("/api/v1/conversations").set(a1).send({ title: "Analyse A" })
    expect(c.status).toBe(201)
    expect((await request(ctx.app).get(`/api/v1/conversations/${c.body.id}`).set(b1)).status).toBe(404)
    expect((await request(ctx.app).get(`/api/v1/conversations/${c.body.id}`).set(a1)).status).toBe(200)
  })
  it("duplicate detection is per organization and does not reveal other tenants' files", async () => {
    expect((await upload(await as("client-a", "admin", "other-user"), file)).status).toBe(409)
    const b = await upload(await as("client-b"), file)
    expect(b.status).toBe(201)
    expect(b.body.id).not.toBe(id)
  })
  it("stores each organization's files in its own directory", () => {
    const dir = path.resolve(ctx.config.UPLOAD_DIR)
    expect(fs.readdirSync(dir).sort()).toEqual(["client-a", "client-b"])
  })
  it("audit events are recorded in the acting organization", () => {
    const events = ctx.store.audits.filter((e) => e.resourceId === id)
    expect(events.length).toBeGreaterThan(0)
    expect(new Set(events.map((e) => e.organizationId))).toEqual(new Set(["client-a"]))
  })
})

describe("original file download", () => {
  it("serves the exact bytes inline with a sandboxing policy, and audits the read", async () => {
    const file = pdf()
    const up = await upload(await as("client-a"), file)
    const r = await request(ctx.app).get(`/api/v1/documents/${up.body.id}/file`).set(await as("client-a")).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []
      res.on("data", (c: Buffer) => chunks.push(c))
      res.on("end", () => cb(null, Buffer.concat(chunks)))
    })
    expect(r.status).toBe(200)
    expect(Buffer.compare(r.body as Buffer, file)).toBe(0)
    expect(r.headers["content-type"]).toMatch(/application\/pdf/)
    expect(r.headers["content-security-policy"]).toContain("sandbox")
    expect(r.headers["cache-control"]).toContain("no-store")
    expect(ctx.store.audits.some((e) => e.action === "document.file_read" && e.resourceId === up.body.id)).toBe(true)
  })
  it("applies permission and agency scope", async () => {
    const up = await upload(await as("client-a"), pdf(), "Tunis Centre")
    expect((await request(ctx.app).get(`/api/v1/documents/${up.body.id}/file`).set(await as("client-a", "manager", "m1", ["Sfax"]))).status).toBe(403)
    expect((await request(ctx.app).get(`/api/v1/documents/${up.body.id}/file`).set(await as("client-a", "commercial", "c1", ["Tunis Centre"]))).status).toBe(403)
  })
})

describe("the synthetic ERP sandbox belongs to the demo organization only", () => {
  const routes: [string, string, unknown?][] = [
    ["get", "/api/v1/dashboard"],
    ["get", "/api/v1/bi/overview"],
    ["get", "/api/v1/bi/360"],
    ["get", "/api/v1/erp/lookups"],
    ["get", "/api/v1/erp/pages/sales"],
    ["post", "/api/v1/copilot/query", { question: "Quel est le chiffre d'affaires ?" }],
    ["post", "/api/v1/erp/payments", {}],
  ]
  it.each(routes)("%s %s is refused to a customer organization", async (method, url, body) => {
    const r = await (request(ctx.app) as unknown as Record<string, (u: string) => request.Test>)[method](url).set(await as("client-a")).send(body ?? {})
    expect(r.status).toBe(403)
    expect(r.body.error.code).toBe("ERP_SOURCE_UNAVAILABLE")
  })
  it("the second development organization is refused too", async () => {
    const { app } = makeApp()
    const r = await request(app).get("/api/v1/bi/overview").set(bearer("dev-admin-org-b"))
    expect(r.status).toBe(403)
  })
  it("the demo organization still reads it", async () => {
    const { app } = makeApp()
    expect((await request(app).get("/api/v1/bi/overview").set(bearer("dev-admin"))).status).toBe(200)
  })
  it("development identities of different organizations do not see each other's documents", async () => {
    const { app } = makeApp()
    const up = await request(app).post("/api/v1/documents").set(bearer("dev-admin")).field("agency", "Tunis Centre").attach("file", pdf(), { filename: "f.pdf", contentType: "application/pdf" })
    expect(up.status).toBe(201)
    expect((await request(app).get(`/api/v1/documents/${up.body.id}`).set(bearer("dev-admin-org-b"))).status).toBe(404)
    expect((await request(app).get("/api/v1/me").set(bearer("dev-admin-org-b"))).body.organization.id).toBe("demo-fictive-b")
  })
})

describe("review history and user records", () => {
  it("records the approving user and an approval event in the organization", async () => {
    const { app, store } = makeApp({ ocr: new StubOcr("complete") })
    const up = await request(app).post("/api/v1/documents").set(bearer("dev-admin")).field("agency", "Tunis Centre").attach("file", pdf(), { filename: "f.pdf", contentType: "application/pdf" })
    expect(up.status).toBe(201)
    expect((await request(app).post(`/api/v1/documents/${up.body.id}/approve`).set(bearer("dev-admin"))).status).toBe(200)
    expect(store.approvalEvents).toEqual([expect.objectContaining({ organizationId: "demo-fictive", documentId: up.body.id, actorId: "usr-admin", decision: "approved" })])
    expect(store.users.get("demo-fictive|usr-admin")).toMatchObject({ role: "admin", displayName: "Administrateur (développement)" })
  })
})
