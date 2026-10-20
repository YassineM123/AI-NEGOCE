// PostgreSQL integration tests. Opt-in: run only when TEST_DATABASE_URL points at a disposable
// database (e.g. the docker-compose.dev.yml container). Every run applies all migrations into
// its own schema, dropped afterwards, so development data is never read or modified.
// The login role must be allowed to SET ROLE ai_negoce_app (superuser or member).
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { Pool } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PostgresStore, type DocumentRecord } from "./store.js"

const url = process.env.TEST_DATABASE_URL
const schema = `test_${crypto.randomBytes(6).toString("hex")}`
const scoped = () => {
  const u = new URL(url!)
  u.searchParams.set("options", `-c search_path=${schema}`)
  return u.toString()
}
const migrations = fs.readdirSync("migrations").filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort()
const sql = (file: string) => fs.readFileSync(path.resolve(file), "utf8")

const doc = (over: Partial<DocumentRecord> = {}): Omit<DocumentRecord, "organizationId"> => {
  const id = crypto.randomUUID()
  return {
    id,
    ownerId: "usr-test",
    agency: "Tunis Centre",
    filename: "facture.pdf",
    storageKey: `x/${id}.pdf`,
    mimeType: "application/pdf",
    size: 1234,
    sha256: crypto.randomBytes(32).toString("hex"),
    status: "needs_review",
    createdAt: new Date().toISOString(),
    ...over,
  }
}

describe.skipIf(!url)("PostgreSQL store, tenancy and migrations (TEST_DATABASE_URL)", () => {
  let admin: Pool
  beforeAll(async () => {
    admin = new Pool({ connectionString: url })
    await admin.query(`CREATE SCHEMA ${schema}`)
    const migration = new Pool({ connectionString: scoped() })
    try {
      for (const f of migrations) await migration.query(sql(`migrations/${f}`))
      await migration.query(
        "INSERT INTO organizations(id,name,status,is_synthetic) VALUES ('org-a','A','active',false),('org-b','B','active',false)",
      )
    } finally {
      await migration.end()
    }
  })
  afterAll(async () => {
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await admin?.end()
  })

  it("keeps documents, extractions and audit logs across a new connection pool", async () => {
    const d = doc()
    const first = new PostgresStore(scoped())
    await first.forTenant("org-a").createDocument(d)
    await first.forTenant("org-a").saveExtraction(d.id, { fields: {}, missingFields: ["lines"], provider: "disabled", confidence: null })
    await first.forTenant("org-a").audit({ actorId: "usr-test", action: "document.uploaded", resourceType: "document", resourceId: d.id })
    await first.close()

    const second = new PostgresStore(scoped())
    try {
      const a = second.forTenant("org-a")
      expect(await a.getDocument(d.id)).toMatchObject({ id: d.id, organizationId: "org-a", filename: "facture.pdf", status: "needs_review" })
      expect(await a.getExtraction(d.id)).toMatchObject({ provider: "disabled", missingFields: ["lines"] })
      expect((await a.findDocumentByHash(d.sha256))?.id).toBe(d.id)
      const audit = await admin.query(`SELECT action, organization_id FROM ${schema}.audit_logs WHERE resource_id = $1`, [d.id])
      expect(audit.rows).toEqual([{ action: "document.uploaded", organization_id: "org-a" }])
    } finally {
      await second.close()
    }
  })

  it("treats the same file as a duplicate inside one organization only", async () => {
    const store = new PostgresStore(scoped())
    try {
      const sha256 = crypto.randomBytes(32).toString("hex")
      await store.forTenant("org-a").createDocument(doc({ sha256, ownerId: "u1" }))
      await expect(store.forTenant("org-a").createDocument(doc({ sha256, ownerId: "u2" }))).rejects.toThrow(/uq_documents_org_sha/)
      await expect(store.forTenant("org-b").createDocument(doc({ sha256, ownerId: "u1" }))).resolves.toBeUndefined()
    } finally {
      await store.close()
    }
  })

  it("never exposes or modifies another organization's records through the store", async () => {
    const store = new PostgresStore(scoped())
    try {
      const d = doc()
      await store.forTenant("org-a").createDocument(d)
      await store.forTenant("org-a").saveExtraction(d.id, { fields: { invoiceNumber: "A-1" }, missingFields: [], provider: "x", confidence: null })
      const b = store.forTenant("org-b")
      expect(await b.getDocument(d.id)).toBeUndefined()
      expect(await b.getExtraction(d.id)).toBeUndefined()
      expect(await b.findDocumentByHash(d.sha256)).toBeUndefined()
      expect((await b.listDocuments()).map((x) => x.id)).not.toContain(d.id)
      await b.updateDocumentStatus(d.id, "approved")
      expect((await store.forTenant("org-a").getDocument(d.id))?.status).toBe("needs_review")
      // Writing an extraction for another tenant's document violates the composite key.
      await expect(b.saveExtraction(d.id, { fields: {}, missingFields: [], provider: "x", confidence: null })).rejects.toThrow()
      const conv = await store.forTenant("org-a").createConversation("usr-test", "c")
      expect(await b.getConversation(conv.id, "usr-test")).toBeUndefined()
    } finally {
      await store.close()
    }
  })

  it("row-level security confines raw SQL run as the application role", async () => {
    const store = new PostgresStore(scoped())
    const d = doc()
    await store.forTenant("org-a").createDocument(d)
    await store.close()
    const pool = new Pool({ connectionString: scoped() })
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SET LOCAL ROLE ai_negoce_app")
      // No organization set: nothing is visible.
      expect((await client.query("SELECT count(*)::int AS n FROM documents")).rows[0].n).toBe(0)
      await client.query("SELECT set_config('app.organization_id', 'org-b', true)")
      expect((await client.query("SELECT count(*)::int AS n FROM documents WHERE id = $1", [d.id])).rows[0].n).toBe(0)
      expect((await client.query("UPDATE documents SET status = 'approved' WHERE id = $1", [d.id])).rowCount).toBe(0)
      await client.query("SAVEPOINT s")
      await expect(
        client.query("INSERT INTO documents(id,organization_id,owner_id,agency,filename,storage_key,mime_type,size_bytes,sha256,status) VALUES ($1,'org-a','u','A','f','k',$2,1,$3,'needs_review')", [crypto.randomUUID(), "application/pdf", "c".repeat(64)]),
      ).rejects.toThrow(/row-level security/)
      await client.query("ROLLBACK TO SAVEPOINT s")
      // The audit trail is append-only for the application.
      await expect(client.query("UPDATE audit_logs SET action = 'x'")).rejects.toThrow(/permission denied/)
      await client.query("ROLLBACK")
    } finally {
      client.release()
      await pool.end()
    }
  })

  it("keeps pre-tenancy rows in a quarantined holding organization", async () => {
    const r = await admin.query(`SELECT status FROM ${schema}.organizations WHERE id = 'legacy-unassigned'`)
    expect(r.rows).toEqual([{ status: "quarantine" }])
  })

  const reversible = migrations.filter((f) => f !== "001_initial.sql")
  const downOf = (f: string) => `migrations/down/${f.replace(/\.sql$/, ".down.sql")}`

  it("every rollback script reverses its migration and the set re-applies cleanly", async () => {
    const fresh = `test_${crypto.randomBytes(6).toString("hex")}`
    await admin.query(`CREATE SCHEMA ${fresh}`)
    const u = new URL(url!)
    u.searchParams.set("options", `-c search_path=${fresh}`)
    const pool = new Pool({ connectionString: u.toString() })
    try {
      for (const f of migrations) await pool.query(sql(`migrations/${f}`))
      for (const f of [...reversible].reverse()) {
        expect(fs.existsSync(downOf(f)), downOf(f)).toBe(true)
        await pool.query(sql(downOf(f)))
      }
      expect((await pool.query("SELECT to_regclass('organizations') AS t")).rows[0].t).toBeNull()
      for (const f of reversible) await pool.query(sql(`migrations/${f}`))
      expect((await pool.query("SELECT to_regclass('organizations') AS t")).rows[0].t).toBe("organizations")
    } finally {
      await pool.end()
      await admin.query(`DROP SCHEMA IF EXISTS ${fresh} CASCADE`)
    }
  })

  it("a rollback that would break pre-tenancy rules aborts atomically instead of corrupting data", async () => {
    // One hash for the same owner in two organizations: valid with tenancy, impossible under
    // the pre-tenancy unique (owner_id, sha256).
    const fresh = `test_${crypto.randomBytes(6).toString("hex")}`
    await admin.query(`CREATE SCHEMA ${fresh}`)
    const u = new URL(url!)
    u.searchParams.set("options", `-c search_path=${fresh}`)
    const pool = new Pool({ connectionString: u.toString() })
    try {
      for (const f of migrations) await pool.query(sql(`migrations/${f}`))
      await pool.query("INSERT INTO organizations(id,name) VALUES ('org-a','A'),('org-b','B')")
      for (const org of ["org-a", "org-b"])
        await pool.query(
          "INSERT INTO documents(id,organization_id,owner_id,agency,filename,storage_key,mime_type,size_bytes,sha256,status) VALUES ($1,$2,'same-owner','A','f',$3,'application/pdf',1,$4,'needs_review')",
          [crypto.randomUUID(), org, `${org}/k.pdf`, "d".repeat(64)],
        )
      for (const f of [...reversible].reverse().filter((f) => f > "002_tenancy.sql")) await pool.query(sql(downOf(f)))
      await expect(pool.query(sql(downOf("002_tenancy.sql")))).rejects.toThrow(/uq_documents_sha_owner/)
      expect((await pool.query("SELECT to_regclass('organizations') AS t")).rows[0].t).toBe("organizations")
      expect((await pool.query("SELECT count(*)::int AS n FROM documents")).rows[0].n).toBe(2)
    } finally {
      await pool.end()
      await admin.query(`DROP SCHEMA IF EXISTS ${fresh} CASCADE`)
    }
  })
})
