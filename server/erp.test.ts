import { afterAll, beforeAll, describe, expect, it } from "vitest"
import request from "supertest"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createApp } from "./app.js"
import { loadConfig } from "./config.js"
import { MemoryStore } from "./store.js"
import { DisabledOcrProvider } from "./ocr.js"
import { TestErpAdapter } from "./erp.js"
import { ErpDatabase } from "./erp-db.js"

const csvDir = path.resolve("datasets/synthetic/v1/csv")
const dbFile = path.join(os.tmpdir(), `ai-negoce-empty-${crypto.randomUUID()}.db`)
let erpDb: ErpDatabase
let app: ReturnType<typeof createApp>
const admin = { Authorization: "Bearer dev-admin" }
const today = new Date().toISOString().slice(0, 10)

beforeAll(() => {
  execFileSync(process.execPath, ["--import", "tsx", "scripts/db-seed.ts", "--empty", csvDir, dbFile], { stdio: "ignore" })
  erpDb = new ErpDatabase(dbFile)
  app = createApp({
    config: loadConfig({ NODE_ENV: "test", FRONTEND_ORIGIN: "http://localhost:8443" }),
    store: new MemoryStore(),
    ocr: new DisabledOcrProvider(),
    erp: new TestErpAdapter(),
    erpDb,
  })
}, 60_000)
afterAll(() => {
  erpDb?.close()
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true })
})

const page = async (module: string, tab?: string) =>
  (await request(app).get(`/api/v1/erp/pages/${module}?days=30${tab ? `&tab=${tab}` : ""}`).set(admin)).body

describe.skipIf(!fs.existsSync(csvDir))("ERP on an empty base", () => {
  it("starts at zero on every page", async () => {
    for (const module of ["sales", "purchases", "inventory", "finance"]) {
      const body = await page(module)
      expect(body.total).toBe(0)
      expect(body.stats.every((s: { value: number }) => s.value === 0)).toBe(true)
    }
    const dash = (await request(app).get("/api/v1/dashboard").set(admin)).body
    expect(dash.kpis.revenue).toBe(0)
    expect(dash.asOf).toBe(today)
    const bi = (await request(app).get("/api/v1/bi/360").set(admin)).body
    expect(bi.kpis.revenue).toBe(0)
    expect(bi.marginFocus).toBeNull()
  })

  it("receives a purchase, sells it, collects it and reflects it everywhere", async () => {
    const lookups = (await request(app).get("/api/v1/erp/lookups").set(admin)).body
    expect(lookups.agencies).toHaveLength(5)
    expect(lookups.products).toHaveLength(0)

    const po = await request(app).post("/api/v1/erp/purchase-orders").set(admin).send({
      agency: "Sfax",
      supplierName: "Fournisseur Test",
      date: today,
      lines: [{ productName: "Chaise test", categoryId: "CAT02", quantity: 10, unitCost: 100 }],
    })
    expect(po.status).toBe(201)
    expect((await page("purchases", "orders")).rows[0].action.id).toBe("receive")
    const received = await request(app).post(`/api/v1/erp/purchase-orders/${po.body.id}/receive`).set(admin).send({ date: today })
    expect(received.status).toBe(201)
    expect(received.body.totalTtc).toBe(1190) // 1 000 HT + 19 % TVA

    const product = (await request(app).get("/api/v1/erp/lookups").set(admin)).body.products[0]
    const invoice = await request(app).post("/api/v1/erp/sales-invoices").set(admin).send({
      agency: "Sfax",
      customerName: "Client Test",
      date: today,
      lines: [{ productId: product.id, quantity: 4, unitPrice: 150, discountPct: 0 }],
    })
    expect(invoice.status).toBe(201)
    expect(invoice.body.totalHt).toBe(600)
    expect(invoice.body.totalTtc).toBe(715) // 600 + 114 TVA + 1 timbre

    const stock = await page("inventory")
    expect(stock.rows[0].cells[3]).toBe(6)
    expect(stock.stats[0].value).toBe(600)

    expect((await request(app).post("/api/v1/erp/payments").set(admin).send({ salesInvoiceId: invoice.body.id, amount: 9999, method: "chèque", date: today })).status).toBe(422)
    const pay = await request(app).post("/api/v1/erp/payments").set(admin).send({ salesInvoiceId: invoice.body.id, amount: 715, method: "virement", date: today })
    expect(pay.status).toBe(201)
    expect(pay.body.outstanding).toBe(0)

    const sales = await page("sales")
    expect(sales.rows[0].status.label).toBe("Payée")
    expect(sales.stats[0].value).toBe(600)
    const dash = (await request(app).get("/api/v1/dashboard").set(admin)).body
    expect(dash.kpis.revenue).toBe(600)
    expect(dash.kpis.grossMargin).toBe(200)
    expect(dash.kpis.receivables).toBe(0)
    const copilotData = (await request(app).get("/api/v1/bi/overview").set(admin)).body
    expect(copilotData.revenue).toBe(600)
  })

  it("rejects writes outside the user's agencies and invalid input", async () => {
    const sfax = { Authorization: "Bearer dev-manager-sfax" }
    const res = await request(app).post("/api/v1/erp/stock-movements").set(sfax).send({
      agency: "Sousse", productName: "Test", categoryId: "CAT01", date: today, type: "receipt", quantity: 1, unitCost: 1,
    })
    expect(res.status).toBe(403)
    expect((await request(app).post("/api/v1/erp/sales-invoices").set(admin).send({ agency: "Sfax", date: today, lines: [] })).status).toBe(400)
    const commercial = { Authorization: "Bearer dev-commercial-tunis" }
    expect((await request(app).post("/api/v1/erp/purchase-orders").set(commercial).send({})).status).toBe(403)
  })
})
