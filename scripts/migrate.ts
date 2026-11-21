// Versioned PostgreSQL migrations.
//   npm run migrate                    apply every pending migrations/NNN_name.sql in order
//   npm run migrate -- --down NNN      apply migrations/down/NNN_name.down.sql for the LATEST
//                                      applied version NNN (development only; see
//                                      docs/smart-ocr/01c-data-architecture.md)
// Each migration runs in its own transaction and is recorded in schema_migrations with a
// SHA-256 checksum; an applied file that was edited afterwards stops the run.
// Migrations only need DATABASE_URL: they do not depend on the API's authentication settings.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { Pool } from "pg"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is required")
const dir = path.resolve("migrations")
const files = fs
  .readdirSync(dir)
  .filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
  .sort()
const version = (f: string) => f.slice(0, 3)
const checksum = (sql: string) => crypto.createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex")

const pool = new Pool({ connectionString: url })
const client = await pool.connect()
try {
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  )
  const applied = new Map(
    (await client.query<{ version: string; checksum: string }>("SELECT version, checksum FROM schema_migrations")).rows.map((r) => [r.version, r.checksum]),
  )
  const downIndex = process.argv.indexOf("--down")
  if (downIndex >= 0) {
    const target = process.argv[downIndex + 1]
    if (process.env.NODE_ENV === "production") throw new Error("--down is refused when NODE_ENV=production: restore from backup instead")
    const latest = [...applied.keys()].sort().at(-1)
    if (!target || target !== latest) throw new Error(`--down only reverts the latest applied version (${latest ?? "none"})`)
    const file = files.find((f) => version(f) === target)!
    const downFile = path.join(dir, "down", file.replace(/\.sql$/, ".down.sql"))
    if (!fs.existsSync(downFile)) throw new Error(`No rollback script for ${file}`)
    await client.query("BEGIN")
    await client.query(fs.readFileSync(downFile, "utf8"))
    await client.query("DELETE FROM schema_migrations WHERE version = $1", [target])
    await client.query("COMMIT")
    console.log(`Reverted ${file}`)
  } else {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), "utf8")
      const known = applied.get(version(file))
      if (known) {
        if (known !== checksum(sql)) throw new Error(`${file} was modified after being applied (checksum mismatch)`)
        continue
      }
      await client.query("BEGIN")
      try {
        await client.query(sql)
        await client.query("INSERT INTO schema_migrations(version, name, checksum) VALUES ($1, $2, $3)", [version(file), file, checksum(sql)])
        await client.query("COMMIT")
      } catch (error) {
        await client.query("ROLLBACK")
        throw new Error(`${file} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      console.log(`Applied ${file}`)
    }
    console.log("Migrations up to date")
  }
} finally {
  client.release()
  await pool.end()
}
