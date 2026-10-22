import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ErpDatabase } from "./erp-db.js"
import { importPurchase, missingFieldsForPurchase } from "./ocr-purchases.js"

const csvDir = path.resolve("datasets/synthetic/v1/csv")
const dbFile = path.join(os.tmpdir(), `ai-negoce-ocr-purchase-${crypto.randomUUID()}.db`)
let db: ErpDatabase

beforeAll(() => {
  execFileSync(process.execPath, ["--import", "tsx", "scripts/db-seed.ts", csvDir, dbFile], { stdio: "ignore" })
  db = new ErpDatabase(dbFile)
}, 60_000)
afterAll(() => {
  db?.close()
  for (const file of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(file, { force: true })
})

describe.skipIf(!fs.existsSync(csvDir))("OCR purchase integration", () => {
  it("allows a manually selected supplier but keeps other missing fields blocking", () => {
    expect(missingFieldsForPurchase(["supplier"])).toEqual([])
    expect(missingFieldsForPurchase(["supplier", "lines", "totals"])).toEqual(["lines", "totals"])
  })
  it("creates one supplier invoice, updates stock once and is idempotent", () => {
    const supplier = db.one<{ id: string }>("SELECT id FROM suppliers LIMIT 1")
    const product = db.one<{ id: string }>("SELECT id FROM products LIMIT 1")
    const agency = db.one<{ id: string; name: string }>("SELECT id,name FROM agencies WHERE name='Tunis Centre'")
    const before = db.one<{ q: number } | undefined>("SELECT current_quantity q FROM inventory WHERE product_id=? AND agency_id=?", product.id, agency.id)?.q ?? 0
    const invoice = {
      invoiceNumber: `OCR-TEST-${Date.now()}`,
      invoiceDate: db.asOf(),
      currency: "TND",
      lines: [{ quantity: "2", unitPrice: "5.000", vatRate: "19", lineHt: "10.000", lineVat: "1.900" }],
      totals: { ht: "10.000", vat: "1.900", ttc: "11.900" },
    }
    const first = importPurchase(db, "*", "demo-fictive", "document-test", agency.name, invoice, supplier.id, [product.id])
    const second = importPurchase(db, "*", "demo-fictive", "document-test", agency.name, invoice, supplier.id, [product.id])
    const after = db.one<{ q: number }>("SELECT current_quantity q FROM inventory WHERE product_id=? AND agency_id=?", product.id, agency.id).q
    expect(first.status).toBe("integrated")
    expect(second.invoiceId).toBe(first.invoiceId)
    expect(after - before).toBe(2)
    expect(db.one<{ n: number }>("SELECT count(*) n FROM supplier_invoices WHERE id=?", first.invoiceId).n).toBe(1)
  })
})
