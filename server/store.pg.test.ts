// PostgreSQL persistence check. Opt-in: runs only when TEST_DATABASE_URL points at a
// disposable database (e.g. the docker-compose.dev.yml container). Every run uses its own
// schema, dropped afterwards, so development data is never read or modified.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { Pool } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PostgresStore } from "./store.js"

const url = process.env.TEST_DATABASE_URL
const schema = `test_${crypto.randomBytes(6).toString("hex")}`
const scoped = () => {
  const u = new URL(url!)
  u.searchParams.set("options", `-c search_path=${schema}`)
  return u.toString()
}

describe.skipIf(!url)("PostgresStore persistence (TEST_DATABASE_URL)", () => {
  let admin: Pool
  beforeAll(async () => {
    admin = new Pool({ connectionString: url })
    await admin.query(`CREATE SCHEMA ${schema}`)
    const migration = new Pool({ connectionString: scoped() })
    try {
      await migration.query(fs.readFileSync(path.resolve("migrations/001_initial.sql"), "utf8"))
    } finally {
      await migration.end()
    }
  })
  afterAll(async () => {
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await admin?.end()
  })

  it("keeps documents, extractions and audit logs across a new connection pool", async () => {
    const id = crypto.randomUUID()
    const first = new PostgresStore(scoped())
    await first.createDocument({
      id,
      ownerId: "usr-test",
      agency: "Tunis Centre",
      filename: "facture.pdf",
      storageKey: `${id}.pdf`,
      mimeType: "application/pdf",
      size: 1234,
      sha256: "a".repeat(64),
      status: "needs_review",
      createdAt: new Date().toISOString(),
    })
    await first.saveExtraction(id, { fields: {}, missingFields: ["lines"], provider: "disabled", confidence: null })
    await first.audit({ actorId: "usr-test", action: "document.uploaded", resourceType: "document", resourceId: id })
    await first.close()

    const second = new PostgresStore(scoped())
    try {
      expect(await second.getDocument(id)).toMatchObject({ id, filename: "facture.pdf", status: "needs_review", agency: "Tunis Centre" })
      expect(await second.getExtraction(id)).toMatchObject({ provider: "disabled", missingFields: ["lines"] })
      expect((await second.findDocumentByHash("usr-test", "a".repeat(64)))?.id).toBe(id)
      const audit = await admin.query(`SELECT action FROM ${schema}.audit_logs WHERE resource_id = $1`, [id])
      expect(audit.rows.map((r) => r.action)).toEqual(["document.uploaded"])
    } finally {
      await second.close()
    }
  })

  it("rejects a second document with the same owner and hash (database constraint)", async () => {
    const store = new PostgresStore(scoped())
    try {
      const base = { ownerId: "usr-dup", agency: "Sfax", filename: "x.pdf", mimeType: "application/pdf", size: 10, sha256: "b".repeat(64), status: "needs_review", createdAt: new Date().toISOString() }
      const a = crypto.randomUUID()
      const b = crypto.randomUUID()
      await store.createDocument({ ...base, id: a, storageKey: `${a}.pdf` })
      await expect(store.createDocument({ ...base, id: b, storageKey: `${b}.pdf` })).rejects.toThrow(/uq_documents_sha_owner/)
    } finally {
      await store.close()
    }
  })
})
