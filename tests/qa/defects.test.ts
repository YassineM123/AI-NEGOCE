// Defect probes: each test asserts the CORRECT behaviour. Written and executed against the
// unmodified code first (initial run) — failures there are the confirmed bugs in reports/BUG_REGISTER.csv.
// After fixes they remain as regression tests.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import request from "supertest"
import { AUDIENCE, ISSUER, PDF, StubOcr, bearer, makeApp, startIssuer } from "./support/harness.js"

let issuer: Awaited<ReturnType<typeof startIssuer>>
let oidcApp: ReturnType<typeof makeApp>["app"]
beforeAll(async () => {
  issuer = await startIssuer()
  oidcApp = makeApp({ env: { OIDC_ISSUER: ISSUER, OIDC_AUDIENCE: AUDIENCE, OIDC_JWKS_URL: issuer.jwksUrl } }).app
})
afterAll(() => issuer.close())

describe("BUG-001 / BUG-002 agency scope", () => {
  it("BUG-001 a verified token WITHOUT agencies claim must not get company-wide data", async () => {
    const token = await issuer.sign({ sub: "u-noscope", role: "manager" })
    const r = await request(oidcApp).get("/api/v1/bi/overview").set(bearer(token))
    expect(r.status).toBe(403)
  })
  it("BUG-001 an empty agencies list must not get company-wide copilot answers", async () => {
    const token = await issuer.sign({ sub: "u-empty", role: "commercial", agencies: [] })
    const r = await request(oidcApp).post("/api/v1/copilot/query").set(bearer(token)).send({ question: "Compare les agences" })
    expect(r.status).toBe(403)
  })
  it("BUG-002 a two-agency user requesting 'all' only sees those two agencies (no Sousse)", async () => {
    const token = await issuer.sign({ sub: "u-two", role: "manager", agencies: ["Tunis Centre", "Sfax"] })
    const r = await request(oidcApp).get("/api/v1/bi/overview?agency=all").set(bearer(token))
    expect(r.status).toBe(200)
    expect(r.body.recordCount).toBe(4)
    const c = await request(oidcApp).post("/api/v1/copilot/query").set(bearer(token)).send({ question: "Compare les agences" })
    expect(c.body.table.map((x: { label: string }) => x.label)).not.toContain("Sousse")
    expect(c.body.sources).not.toContain("FV-2502-0448")
  })
})

describe("BUG-003 BI date filters", () => {
  it("from/to restrict the period (Feb 2025 = 3 invoices)", async () => {
    const { app } = makeApp()
    const r = await request(app).get("/api/v1/bi/overview?from=2025-02-01&to=2025-02-28").set(bearer("dev-admin"))
    expect(r.status).toBe(200)
    expect(r.body.recordCount).toBe(3)
    expect(r.body.revenue).toBeCloseTo(7495.798 + 10285.714 + 6840, 3)
  })
  it("rejects malformed dates with 400", async () => {
    const { app } = makeApp()
    const r = await request(app).get("/api/v1/bi/overview?from=2025-13-45").set(bearer("dev-admin"))
    expect(r.status).toBe(400)
  })
})

describe("BUG-004 HTTP error mapping", () => {
  it("malformed JSON returns 400, not 500", async () => {
    const { app } = makeApp()
    const r = await request(app).post("/api/v1/copilot/query").set(bearer("dev-admin")).set("Content-Type", "application/json").send('{"question": ')
    expect(r.status).toBe(400)
  })
  it("oversized JSON returns 413, not 500", async () => {
    const { app } = makeApp()
    const r = await request(app).post("/api/v1/copilot/query").set(bearer("dev-admin")).send({ question: "x".repeat(300_000) })
    expect(r.status).toBe(413)
  })
})

describe("BUG-005 / BUG-006 / BUG-007 copilot routing", () => {
  const ask = (question: string, token = "dev-admin") => request(makeApp().app).post("/api/v1/copilot/query").set(bearer(token)).send({ question })
  it("BUG-005 a question about customer payments is not refused as HR data", async () => {
    const r = await ask("Quels clients ont des paiements en retard ?")
    expect(r.body.status).not.toBe("denied")
  })
  it("BUG-006 an out-of-domain question is declined, not answered with a margin figure", async () => {
    const r = await ask("Quelle sera la météo à Paris demain ?")
    expect(r.body.status).toBe("unsupported")
    expect(r.body.sources).toEqual([])
  })
  it("BUG-006 supplier questions are declined (no supplier data in scope)", async () => {
    const r = await ask("Quel fournisseur nous livre le plus en retard ?")
    expect(r.body.status).toBe("unsupported")
  })
  it("BUG-007 a Tunis commercial asking for Sfax figures is refused", async () => {
    const r = await ask("Quel est le chiffre d'affaires de Sfax ?", "dev-commercial-tunis")
    expect(r.body.status).toBe("denied")
    expect(r.body.sources).toEqual([])
  })
  it("BUG-007 an admin asking about Sfax gets Sfax figures only", async () => {
    const r = await ask("Quel est le chiffre d'affaires de Sfax ?")
    expect(r.body.status).toBe("ok")
    expect([...r.body.sources].sort()).toEqual(["FV-2501-0377", "FV-2502-0471"])
  })
})

describe("BUG-008..BUG-012 document workflow", () => {
  it("BUG-008 approval is refused when the configured OCR returned an incomplete extraction", async () => {
    const { app } = makeApp({ ocr: new StubOcr("incomplete") })
    const up = await request(app).post("/api/v1/documents").set(bearer("dev-admin")).field("agency", "Tunis Centre").attach("file", PDF, { filename: "a.pdf", contentType: "application/pdf" })
    expect(up.status).toBe(201)
    const r = await request(app).post(`/api/v1/documents/${up.body.id}/approve`).set(bearer("dev-admin"))
    expect(r.status).toBe(409)
  })
  it("BUG-009 an OCR failure marks the document failed (no orphan 'needs_review' record) and returns 502", async () => {
    const { app, store } = makeApp({ ocr: new StubOcr("throw") })
    const up = await request(app).post("/api/v1/documents").set(bearer("dev-admin")).field("agency", "Tunis Centre").attach("file", PDF, { filename: "a.pdf", contentType: "application/pdf" })
    expect(up.status).toBe(502)
    const docs = [...store.documents.values()]
    expect(docs.filter((d) => d.status === "needs_review")).toHaveLength(0)
  })
  it("BUG-010 re-uploading the same file is detected as a duplicate (409)", async () => {
    const { app } = makeApp()
    const send = () => request(app).post("/api/v1/documents").set(bearer("dev-admin")).field("agency", "Tunis Centre").attach("file", PDF, { filename: "dup.pdf", contentType: "application/pdf" })
    expect((await send()).status).toBe(201)
    const second = await send()
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe("DUPLICATE_DOCUMENT")
    expect(second.body.error.details.action).toBe("OPEN_EXISTING")
    expect(second.headers.location).toBe(
      `/api/v1/documents/${second.body.error.details.existingId}`,
    )
    const existing = await request(app)
      .get(`/api/v1/documents/${second.body.error.details.existingId}`)
      .set(bearer("dev-admin"))
    expect(existing.status).toBe(200)
    expect(existing.body.extraction.provider).toBe("disabled")
    expect(existing.body.extraction.missingFields).toContain("invoiceNumber")
    expect(existing.body.storageKey).toBeUndefined()
    expect(existing.body.sha256).toBeUndefined()
  })
  it("BUG-011 uploading into a foreign agency returns 403 (not 400)", async () => {
    const { app } = makeApp()
    const r = await request(app).post("/api/v1/documents").set(bearer("dev-manager-sfax")).field("agency", "Tunis Centre").attach("file", PDF, { filename: "a.pdf", contentType: "application/pdf" })
    expect(r.status).toBe(403)
  })
  it("BUG-012 a document cannot be approved twice", async () => {
    const { app } = makeApp({ ocr: new StubOcr("complete") })
    const up = await request(app).post("/api/v1/documents").set(bearer("dev-admin")).field("agency", "Tunis Centre").attach("file", PDF, { filename: "a.pdf", contentType: "application/pdf" })
    expect((await request(app).post(`/api/v1/documents/${up.body.id}/approve`).set(bearer("dev-admin"))).status).toBe(200)
    expect((await request(app).post(`/api/v1/documents/${up.body.id}/approve`).set(bearer("dev-admin"))).status).toBe(409)
  })
})

describe("BUG-031 homonymous customers", () => {
  it("two customers sharing a name are ranked separately (grouped by id, not by label)", async () => {
    const { groundedAnswer } = await import("../../server/services.js")
    const row = (id: string, customerId: string, revenue: number) => ({ id, invoiceId: id, date: "2026-01-10", agency: "Sfax", customer: "STE HOMONYME", customerId, product: "P", family: "F", representative: "R", revenue, cost: revenue / 2 })
    const data = { sales: [row("A1", "CUS-1", 600), row("A2", "CUS-2", 500), { ...row("B1", "CUS-3", 900), customer: "AUTRE CLIENT" }], receivables: [], inventory: [], metadata: { adapter: "test" as const, source: "qa", currency: "TND", lastUpdated: "2026-10-15T00:00:00.000Z", asOf: "2026-10-15" } }
    const r = groundedAnswer("Quel est le meilleur client ?", { scope: "*" }, data)
    expect(r.answer).toContain("AUTRE CLIENT") // 900 > 600: the two homonyms (600, 500) must not be summed to 1100
    expect(r.table).toHaveLength(3)
  })
})
