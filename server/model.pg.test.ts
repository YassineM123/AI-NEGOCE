// Smart OCR data model constraints (migration 003), checked as the application role with
// row-level security active. Opt-in: requires TEST_DATABASE_URL (disposable database).
import crypto from "node:crypto"
import fs from "node:fs"
import { Pool, type PoolClient } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const url = process.env.TEST_DATABASE_URL
const schema = `test_${crypto.randomBytes(6).toString("hex")}`
const migrations = fs.readdirSync("migrations").filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort()

describe.skipIf(!url)("Smart OCR model constraints (TEST_DATABASE_URL)", () => {
  let admin: Pool
  let pool: Pool
  const ids: Record<string, Record<string, string>> = { "org-a": {}, "org-b": {} }

  /** One transaction as ai_negoce_app for one organization; committed unless it throws. */
  const asTenant = async <T>(org: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> => {
    const c = await pool.connect()
    try {
      await c.query("BEGIN")
      await c.query("SET LOCAL ROLE ai_negoce_app")
      if (org) await c.query("SELECT set_config('app.organization_id', $1, true)", [org])
      const r = await fn(c)
      await c.query("COMMIT")
      return r
    } catch (e) {
      await c.query("ROLLBACK")
      throw e
    } finally {
      c.release()
    }
  }
  const q = (org: string | null, sql: string, params: unknown[] = []) => asTenant(org, (c) => c.query(sql, params))
  const one = async (org: string, sql: string, params: unknown[] = []) => (await q(org, sql, params)).rows[0]

  const mapping = (org: string, over: Record<string, unknown> = {}) => {
    const m = { supplier_id: ids[org].supplier, ref: "CBL-25", product: ids[org].product, approved_by: "u1", version: 1, active: true, status: "valid", factor: "100", ...over }
    return q(
      org,
      "INSERT INTO product_mappings(organization_id,supplier_id,supplier_reference,normalized_reference,erp_product_id,purchase_unit,stock_unit,conversion_factor,approved_by,mapping_version,catalog_version,active,status) VALUES ($1,$2,$3,$4,$5,'rouleau','m',$6,$7,$8,1,$9,$10) RETURNING id",
      [org, m.supplier_id, m.ref, m.ref.toLowerCase(), m.product, m.factor, m.approved_by, m.version, m.active, m.status],
    )
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: url })
    await admin.query(`CREATE SCHEMA ${schema}`)
    const u = new URL(url!)
    u.searchParams.set("options", `-c search_path=${schema}`)
    pool = new Pool({ connectionString: u.toString() })
    for (const f of migrations) await pool.query(fs.readFileSync(`migrations/${f}`, "utf8"))
    await pool.query("INSERT INTO organizations(id,name) VALUES ('org-a','A'),('org-b','B')")
    for (const org of ["org-a", "org-b"]) {
      await q(org, "INSERT INTO users(organization_id,id,display_name,role) VALUES ($1,'u1','U','accountant')", [org])
      ids[org].supplier = (await one(org, "INSERT INTO erp_suppliers(organization_id,external_id,name,source,catalog_version) VALUES ($1,'F1','Fournisseur','sandbox',1) RETURNING id", [org])).id
      ids[org].product = (await one(org, "INSERT INTO erp_products(organization_id,external_id,designation,stock_unit,source,catalog_version) VALUES ($1,'P1','Câble 2,5 mm²','m','sandbox',1) RETURNING id", [org])).id
      ids[org].document = crypto.randomUUID()
      await q(org, "INSERT INTO documents(id,organization_id,owner_id,agency,filename,storage_key,mime_type,size_bytes,sha256,status) VALUES ($1,$2,'u1','A','f.pdf',$3,'application/pdf',1,$4,'needs_review')", [ids[org].document, org, `${org}/k`, crypto.randomBytes(32).toString("hex")])
      ids[org].invoice = (await one(org, "INSERT INTO invoice_headers(organization_id,document_id,supplier_id,invoice_number) VALUES ($1,$2,$3,'FA-001') RETURNING id", [org, ids[org].document, ids[org].supplier])).id
      ids[org].line = (await one(org, "INSERT INTO invoice_lines(organization_id,invoice_id,line_no,quantity,unit_price) VALUES ($1,$2,1,'2.5','19.900') RETURNING id", [org, ids[org].invoice])).id
    }
  })
  afterAll(async () => {
    await pool?.end()
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await admin?.end()
  })

  describe("product mappings", () => {
    it("allows only one active mapping per supplier reference; a new version needs the old one retired", async () => {
      const first = (await mapping("org-a")).rows[0].id
      await expect(mapping("org-a", { version: 2 })).rejects.toThrow(/uq_product_mappings_active/)
      await q("org-a", "UPDATE product_mappings SET active = false, status = 'superseded' WHERE id = $1", [first])
      await expect(mapping("org-a", { version: 2 })).resolves.toBeTruthy()
      await expect(mapping("org-a", { version: 2, active: false, status: "superseded" })).rejects.toThrow(/duplicate key/)
    })
    it("requires a positive conversion factor and an approver known in the same organization", async () => {
      await expect(mapping("org-a", { ref: "X1", factor: "0" })).rejects.toThrow(/check constraint/)
      await expect(mapping("org-a", { ref: "X2", factor: "-1" })).rejects.toThrow(/check constraint/)
      await expect(mapping("org-a", { ref: "X3", approved_by: "ghost" })).rejects.toThrow(/foreign key/)
    })
    it("cannot be active unless valid", async () => {
      await expect(mapping("org-a", { ref: "X4", status: "revoked", active: true })).rejects.toThrow(/check constraint/)
    })
    it("can never be deleted by the application", async () => {
      await expect(q("org-a", "DELETE FROM product_mappings")).rejects.toThrow(/permission denied/)
    })
    it("cannot reference another organization's supplier or product", async () => {
      await expect(mapping("org-b", { ref: "X5", supplier_id: ids["org-a"].supplier })).rejects.toThrow(/foreign key/)
      await expect(mapping("org-b", { ref: "X6", product: ids["org-a"].product })).rejects.toThrow(/foreign key/)
    })
  })

  describe("OCR values and corrections", () => {
    it("keeps original observations immutable and corrections append-only", async () => {
      const obs = await one("org-a", "INSERT INTO invoice_field_observations(organization_id,invoice_id,field,raw_value,confidence,page,bbox,provider) VALUES ($1,$2,'invoiceNumber','FA-0O1',NULL,1,'{\"x\":0.1}','test') RETURNING id", ["org-a", ids["org-a"].invoice])
      await q("org-a", "INSERT INTO invoice_field_corrections(organization_id,invoice_id,observation_id,field,previous_value,corrected_value,corrected_by,invoice_version) VALUES ($1,$2,$3,'invoiceNumber','FA-0O1','FA-001','u1',1)", ["org-a", ids["org-a"].invoice, obs.id])
      await expect(q("org-a", "UPDATE invoice_field_observations SET raw_value = 'x'")).rejects.toThrow(/permission denied/)
      await expect(q("org-a", "UPDATE invoice_field_corrections SET corrected_value = 'x'")).rejects.toThrow(/permission denied/)
      await expect(q("org-a", "DELETE FROM invoice_field_corrections")).rejects.toThrow(/permission denied/)
      const both = await one("org-a", "SELECT o.raw_value AS ocr, c.corrected_value AS human FROM invoice_field_observations o JOIN invoice_field_corrections c ON c.observation_id = o.id")
      expect(both).toEqual({ ocr: "FA-0O1", human: "FA-001" })
    })
    it("rejects an out-of-range confidence and malformed field names", async () => {
      const base = "INSERT INTO invoice_field_observations(organization_id,invoice_id,field,raw_value,confidence,provider) VALUES ($1,$2,$3,'v',$4,'test')"
      await expect(q("org-a", base, ["org-a", ids["org-a"].invoice, "total", "1.2"])).rejects.toThrow(/check constraint/)
      await expect(q("org-a", base, ["org-a", ids["org-a"].invoice, "drop table;", null])).rejects.toThrow(/check constraint/)
    })
  })

  describe("matching decisions", () => {
    const decide = (status: string, extra: Record<string, unknown> = {}) =>
      q("org-a", "INSERT INTO matching_decisions(organization_id,invoice_line_id,status,erp_product_id,mapping_id,decided_by) VALUES ($1,$2,$3,$4,$5,$6)", ["org-a", ids["org-a"].line, status, extra.product ?? null, extra.mapping ?? null, extra.by ?? null])
    it("enforces evidence for verified and manual decisions", async () => {
      await expect(decide("verified_mapping", { product: ids["org-a"].product })).rejects.toThrow(/check constraint/)
      await expect(decide("manually_confirmed", { product: ids["org-a"].product })).rejects.toThrow(/check constraint/)
      await expect(decide("recommended")).resolves.toBeTruthy()
    })
    it("keeps a single current decision per line", async () => {
      await expect(decide("ambiguous")).rejects.toThrow(/uq_matching_decisions_current/)
      await q("org-a", "UPDATE matching_decisions SET current = false WHERE invoice_line_id = $1", [ids["org-a"].line])
      await expect(decide("manually_confirmed", { product: ids["org-a"].product, by: "u1" })).resolves.toBeTruthy()
    })
  })

  describe("invoices", () => {
    it("cannot be approved without approver, timestamp and approved version", async () => {
      await expect(q("org-a", "UPDATE invoice_headers SET status = 'approved' WHERE id = $1", [ids["org-a"].invoice])).rejects.toThrow(/check constraint/)
    })
    it("approves a supplier invoice number only once per organization (case-insensitive)", async () => {
      await q("org-a", "UPDATE invoice_headers SET status='approved', approved_by='u1', approved_at=now(), approved_version=1 WHERE id=$1", [ids["org-a"].invoice])
      const doc = crypto.randomUUID()
      await q("org-a", "INSERT INTO documents(id,organization_id,owner_id,agency,filename,storage_key,mime_type,size_bytes,sha256,status) VALUES ($1,'org-a','u1','A','g.pdf','org-a/g','application/pdf',1,$2,'needs_review')", [doc, crypto.randomBytes(32).toString("hex")])
      const dup = await one("org-a", "INSERT INTO invoice_headers(organization_id,document_id,supplier_id,invoice_number) VALUES ('org-a',$1,$2,'fa-001') RETURNING id", [doc, ids["org-a"].supplier])
      await expect(q("org-a", "UPDATE invoice_headers SET status='approved', approved_by='u1', approved_at=now(), approved_version=1 WHERE id=$1", [dup.id])).rejects.toThrow(/uq_invoice_headers_approved_number/)
      // Another organization can hold the same supplier number.
      await expect(q("org-b", "UPDATE invoice_headers SET status='approved', approved_by='u1', approved_at=now(), approved_version=1 WHERE id=$1", [ids["org-b"].invoice])).resolves.toBeTruthy()
    })
    it("stores amounts and quantities exactly", async () => {
      const r = await one("org-a", "SELECT ($1::numeric(20,6) + $1::numeric(20,6) + $1::numeric(20,6))::text AS s, $2::numeric(20,6)::text AS p", ["0.1", "1234.567891"])
      expect(r).toEqual({ s: "0.300000", p: "1234.567891" })
      const line = await one("org-a", "SELECT quantity::text, unit_price::text FROM invoice_lines WHERE id = $1", [ids["org-a"].line])
      expect(line).toEqual({ quantity: "2.500000", unit_price: "19.900000" })
    })
  })

  describe("isolation of the new tables", () => {
    it("shows nothing without a tenant and nothing of the other tenant", async () => {
      for (const t of ["users", "erp_suppliers", "erp_products", "product_mappings", "invoice_headers", "invoice_lines", "invoice_field_observations", "matching_decisions"]) {
        expect((await one("org-a", `SELECT count(*)::int AS n FROM ${t}`)).n, t).toBeGreaterThan(0)
        expect((await q(null, `SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, `${t} without tenant`).toBe(0)
      }
      expect((await one("org-b", "SELECT count(*)::int AS n FROM invoice_lines WHERE id = $1", [ids["org-a"].line])).n).toBe(0)
    })
    it("bounds job attempts", async () => {
      await expect(q("org-a", "INSERT INTO processing_jobs(organization_id,document_id,kind,attempts,max_attempts) VALUES ('org-a',$1,'ocr_extraction',4,3)", [ids["org-a"].document])).rejects.toThrow(/check constraint/)
    })
  })
})
