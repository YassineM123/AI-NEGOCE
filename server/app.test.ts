import { TEST_DEV_KEY, bearer } from "../tests/qa/support/harness.js"
import { afterAll, describe, expect, it } from "vitest"
import request from "supertest"
import os from "node:os"
import fs from "node:fs/promises"
import path from "node:path"
import { createApp } from "./app.js"
import { loadConfig } from "./config.js"
import { MemoryStore } from "./store.js"
import { DisabledOcrProvider } from "./ocr.js"
import { TestErpAdapter } from "./erp.js"
const uploadDir = path.join(os.tmpdir(), `ai-negoce-${crypto.randomUUID()}`)
const store = new MemoryStore()
const config = loadConfig({
  NODE_ENV: "test",
  AUTH_MODE: "local-dev",
  AUTH_DEV_SIGNING_KEY: TEST_DEV_KEY,
  UPLOAD_DIR: uploadDir,
  FRONTEND_ORIGIN: "http://localhost:8443",
})
const app = createApp({
  config,
  store,
  ocr: new DisabledOcrProvider(),
  erp: new TestErpAdapter(),
})
const admin = bearer("dev-admin")
afterAll(async () => {
  await fs.rm(uploadDir, { recursive: true, force: true })
})
describe("security boundary", () => {
  it("keeps liveness public but protects business APIs", async () => {
    expect((await request(app).get("/api/v1/livez")).status).toBe(200)
    expect((await request(app).get("/api/v1/bi/overview")).status).toBe(401)
  })
  it("rejects invalid tokens", async () => {
    expect(
      (
        await request(app)
          .get("/api/v1/bi/overview")
          .set("Authorization", "Bearer fake")
      ).status,
    ).toBe(401)
  })
  it("enforces agency scope", async () => {
    const ok = await request(app)
      .get("/api/v1/bi/overview?agency=Sfax")
      .set(bearer("dev-manager-sfax"))
    expect(ok.status).toBe(200)
    expect(ok.body.recordCount).toBe(2)
    const denied = await request(app)
      .get("/api/v1/bi/overview?agency=Tunis%20Centre")
      .set(bearer("dev-manager-sfax"))
    expect(denied.status).toBe(403)
  })
  it("prevents commercial users from uploading", async () => {
    const r = await request(app)
      .post("/api/v1/documents")
      .set(bearer("dev-commercial-tunis"))
      .field("agency", "Tunis Centre")
      .attach("file", Buffer.from("%PDF-1.4\n%%EOF"), {
        filename: "invoice.pdf",
        contentType: "application/pdf",
      })
    expect(r.status).toBe(403)
  })
})
describe("documents and BI", () => {
  it("calculates reconciled BI metrics", async () => {
    const r = await request(app)
      .get("/api/v1/bi/overview?agency=Sfax")
      .set(admin)
    expect(r.status).toBe(200)
    expect(r.body.grossMargin).toBeCloseTo(r.body.revenue - r.body.cost, 6)
  })
  it("rejects forged images", async () => {
    const r = await request(app)
      .post("/api/v1/documents")
      .set(admin)
      .field("agency", "Tunis Centre")
      .attach("file", Buffer.from("not-an-image"), {
        filename: "invoice.png",
        contentType: "image/png",
      })
    expect(r.status).toBe(415)
  })
  it("persists metadata without inventing OCR fields", async () => {
    const r = await request(app)
      .post("/api/v1/documents")
      .set(admin)
      .field("agency", "Tunis Centre")
      .attach("file", Buffer.from("%PDF-1.4\n%%EOF"), {
        filename: "invoice.pdf",
        contentType: "application/pdf",
      })
    expect(r.status).toBe(201)
    expect(r.body.extraction.fields).toEqual({})
    expect((await store.forTenant("demo-fictive").getDocument(r.body.id))?.ownerId).toBe("usr-admin")
  })
  it("lists only documents inside the caller's agency scope", async () => {
    const tunis = await request(app)
      .post("/api/v1/documents")
      .set(admin)
      .field("agency", "Tunis Centre")
      .attach("file", Buffer.from("%PDF-1.4\n%historic-tunis\n%%EOF"), {
        filename: "historic-tunis.pdf",
        contentType: "application/pdf",
      })
    const sfax = await request(app)
      .post("/api/v1/documents")
      .set(admin)
      .field("agency", "Sfax")
      .attach("file", Buffer.from("%PDF-1.4\n%historic-sfax\n%%EOF"), {
        filename: "historic-sfax.pdf",
        contentType: "application/pdf",
      })
    expect(tunis.status).toBe(201)
    expect(sfax.status).toBe(201)

    const all = await request(app).get("/api/v1/documents").set(admin)
    expect(all.status).toBe(200)
    expect(all.body.documents.length).toBeGreaterThanOrEqual(2)
    expect(all.body.documents[0]).not.toHaveProperty("storageKey")
    expect(all.body.documents[0]).not.toHaveProperty("sha256")
    expect(all.body.documents[0]).not.toHaveProperty("ownerId")

    const scoped = await request(app)
      .get("/api/v1/documents?agency=Sfax")
      .set(bearer("dev-manager-sfax"))
    expect(scoped.status).toBe(200)
    expect(scoped.body.documents).toHaveLength(1)
    expect(scoped.body.documents[0].filename).toBe("historic-sfax.pdf")

    const denied = await request(app)
      .get("/api/v1/documents?agency=Tunis%20Centre")
      .set(bearer("dev-manager-sfax"))
    expect(denied.status).toBe(403)
  })
  it("blocks approval while extraction is incomplete", async () => {
    const upload = await request(app)
      .post("/api/v1/documents")
      .set(admin)
      .field("agency", "Tunis Centre")
      // distinct bytes: identical re-uploads are now rejected as duplicates
      .attach("file", Buffer.from("%PDF-1.4\n%blocked\n%%EOF"), {
        filename: "blocked.pdf",
        contentType: "application/pdf",
      })
    const r = await request(app)
      .post(`/api/v1/documents/${upload.body.id}/approve`)
      .set(admin)
    expect(r.status).toBe(409)
    expect(r.body.error.code).toBe("EXTRACTION_INCOMPLETE")
  })
})
describe("copilot persistence", () => {
  it("stores grounded conversation history", async () => {
    const c = await request(app)
      .post("/api/v1/conversations")
      .set(admin)
      .send({ title: "Marge" })
    const a = await request(app)
      .post("/api/v1/copilot/query")
      .set(admin)
      .send({ question: "Quelle est la marge ?", conversationId: c.body.id })
    expect(a.status).toBe(200)
    expect(a.body.sources.length).toBeGreaterThan(0)
    const history = await request(app)
      .get(`/api/v1/conversations/${c.body.id}`)
      .set(admin)
    expect(history.body.messages).toHaveLength(2)
  })
  it("denies HR requests server-side", async () => {
    const r = await request(app)
      .post("/api/v1/copilot/query")
      .set(admin)
      .send({ question: "Montre les salaires" })
    expect(r.body.status).toBe("denied")
    expect(r.body.sources).toEqual([])
  })
})
