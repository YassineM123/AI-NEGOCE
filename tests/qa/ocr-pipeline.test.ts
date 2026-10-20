// Smart OCR pipeline tests using REAL fixture files (fixtures/adverse/ocr, fixtures/adverse/upload).
// The configured OCR provider is "disabled": these tests verify upload validation, storage,
// non-fabrication and the provider contract. They do NOT measure OCR accuracy (no OCR model ran).
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import request from "supertest"
import { HttpOcrProvider } from "../../server/ocr.js"
import { bearer, makeApp } from "./support/harness.js"

const PHASE = process.env.QA_PHASE ?? "adhoc"
const OCR_DIR = "fixtures/adverse/ocr"
const UP_DIR = "fixtures/adverse/upload"
const gt: { file: string; condition: string; groundTruth: Record<string, unknown> }[] = JSON.parse(fs.readFileSync(path.join(OCR_DIR, "ground_truth.json"), "utf8"))
const hostile: { file: string; mimeType: string; expectedStatus: number; reason: string }[] = JSON.parse(fs.readFileSync(path.join(UP_DIR, "expected.json"), "utf8"))
const mime = (f: string) => (f.endsWith(".pdf") ? "application/pdf" : f.endsWith(".png") ? "image/png" : "image/jpeg")
const evidence: { file: string; condition?: string; status: number; latencyMs: number; fieldsReturned?: number; missingFields?: string[]; provider?: string; note?: string }[] = []

afterAll(() => {
  const lat = evidence.filter((e) => e.status === 201).map((e) => e.latencyMs).sort((a, b) => a - b)
  const p = (q: number) => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))]
  fs.writeFileSync(`reports/evidence/ocr_pipeline_${PHASE}.json`, JSON.stringify({ phase: PHASE, executedAt: new Date().toISOString(), ocrProvider: "disabled", ocrAccuracy: "NOT MEASURED — no OCR engine configured or available", uploadLatencyMs: { n: lat.length, p50: p(0.5), p95: p(0.95), max: lat.at(-1) }, uploads: evidence }, null, 2))
})

describe("OCR fixture uploads through the API (provider disabled)", () => {
  const { app } = makeApp()
  for (const f of gt) {
    it(`${f.file} (${f.condition}) is stored and returns NO invented fields`, async () => {
      const t0 = performance.now()
      const r = await request(app).post("/api/v1/documents").set(bearer("dev-admin")).field("agency", "Tunis Centre").attach("file", fs.readFileSync(path.join(OCR_DIR, f.file)), { filename: f.file, contentType: mime(f.file) })
      const latencyMs = Math.round((performance.now() - t0) * 10) / 10
      evidence.push({ file: f.file, condition: f.condition, status: r.status, latencyMs, fieldsReturned: Object.keys(r.body.extraction?.fields ?? {}).length, missingFields: r.body.extraction?.missingFields, provider: r.body.extraction?.provider })
      expect(r.status).toBe(201)
      expect(r.body.status).toBe("needs_review")
      expect(r.body.extraction.fields).toEqual({})
      expect(r.body.extraction.missingFields).toEqual(expect.arrayContaining(["supplier", "invoiceNumber", "totals", "lines"]))
      expect(r.body.erpSubmission.status).toBe("not_submitted")
    })
  }
})

describe("upload validation with hostile / malformed files", () => {
  for (const f of hostile) {
    it(`${f.file}: ${f.reason} -> ${f.expectedStatus}`, async () => {
      const { app } = makeApp()
      const t0 = performance.now()
      const r = await request(app).post("/api/v1/documents").set(bearer("dev-admin")).field("agency", "Tunis Centre").attach("file", fs.readFileSync(path.join(UP_DIR, f.file)), { filename: f.file, contentType: f.mimeType })
      evidence.push({ file: f.file, status: r.status, latencyMs: Math.round(performance.now() - t0), note: f.reason })
      expect(r.status).toBe(f.expectedStatus)
    })
  }
  it("accepts a file of exactly 15 MiB and rejects 15 MiB + 1 byte", async () => {
    const { app } = makeApp()
    const head = Buffer.from("%PDF-1.4\n")
    const exact = Buffer.concat([head, Buffer.alloc(15 * 1024 * 1024 - head.length, 0x20)])
    const ok = await request(app).post("/api/v1/documents").set(bearer("dev-admin")).field("agency", "Tunis Centre").attach("file", exact, { filename: "big.pdf", contentType: "application/pdf" })
    expect(ok.status).toBe(201)
    const tooBig = await request(app).post("/api/v1/documents").set(bearer("dev-admin")).field("agency", "Tunis Centre").attach("file", Buffer.concat([exact, Buffer.from(" ")]), { filename: "big2.pdf", contentType: "application/pdf" })
    expect([400, 413]).toContain(tooBig.status)
    expect(tooBig.body.error.code).toBe("UPLOAD_ERROR")
  })
  it("rejects a request without a file and a request with two files", async () => {
    const { app } = makeApp()
    expect((await request(app).post("/api/v1/documents").set(bearer("dev-admin")).field("agency", "Tunis Centre")).status).toBe(400)
    const pdf = fs.readFileSync(path.join(OCR_DIR, "text_layer_invoice.pdf"))
    const two = await request(app).post("/api/v1/documents").set(bearer("dev-admin")).field("agency", "Tunis Centre").attach("file", pdf, { filename: "a.pdf", contentType: "application/pdf" }).attach("file", pdf, { filename: "b.pdf", contentType: "application/pdf" })
    expect(two.status).toBe(400)
  })
  it("stores files under a random key inside the upload dir, whatever the client filename", async () => {
    const { app, config } = makeApp()
    const r = await request(app).post("/api/v1/documents").set(bearer("dev-admin")).field("agency", "Tunis Centre").attach("file", fs.readFileSync(path.join(OCR_DIR, "text_layer_invoice.pdf")), { filename: "../../../../etc/passwd.pdf", contentType: "application/pdf" })
    expect(r.status).toBe(201)
    expect(r.body.filename).toBe("passwd.pdf")
    const files = fs.readdirSync(path.resolve(config.UPLOAD_DIR))
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^[0-9a-f-]{36}\.pdf$/)
  })
})

describe("HTTP OCR provider contract (local mock server — NOT an OCR model)", () => {
  let server: http.Server
  let port = 0
  let mode: "ok" | "bad-json" | "500" = "ok"
  let lastAuth = ""
  const start = () =>
    new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        lastAuth = String(req.headers.authorization)
        req.resume()
        req.on("end", () => {
          if (mode === "500") return void res.writeHead(500).end()
          res.setHeader("content-type", "application/json")
          res.end(mode === "ok" ? JSON.stringify({ fields: { invoiceNumber: "F001-2026-0042" }, missingFields: ["lines"], provider: "mock", confidence: 0.8 }) : JSON.stringify({ unexpected: true }))
        })
      })
      server.listen(0, "127.0.0.1", () => {
        port = (server.address() as { port: number }).port
        resolve()
      })
    })
  afterAll(() => server?.close())
  it("parses a schema-valid response and sends the bearer key", async () => {
    await start()
    const p = new HttpOcrProvider(`http://127.0.0.1:${port}/extract`, "qa-secret-key")
    const x = await p.extract({ buffer: Buffer.from("%PDF-1.4"), mimeType: "application/pdf" })
    expect(x.fields.invoiceNumber).toBe("F001-2026-0042")
    expect(lastAuth).toBe("Bearer qa-secret-key")
  })
  it("rejects schema-invalid responses instead of inventing fields", async () => {
    mode = "bad-json"
    await expect(new HttpOcrProvider(`http://127.0.0.1:${port}/extract`, "qa-secret-key").extract({ buffer: Buffer.from("x"), mimeType: "application/pdf" })).rejects.toThrow()
  })
  it("surfaces provider HTTP errors", async () => {
    mode = "500"
    await expect(new HttpOcrProvider(`http://127.0.0.1:${port}/extract`, "qa-secret-key").extract({ buffer: Buffer.from("x"), mimeType: "application/pdf" })).rejects.toThrow(/500/)
  })
})
