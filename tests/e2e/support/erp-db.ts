// Throwaway ERP database for the E2E stack.
//
// Copying the developer's seeded database and pinning as_of to the dataset manifest keeps the
// journey deterministic on any calendar day, and leaves var/ai-negoce.db (which may hold manual
// data) untouched. The copy is page-for-page valid because the server only reads it: the WAL is
// flushed to the main file (TRUNCATE checkpoint) before the copy, so `cp -r` semantics suffice.
import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

const target = path.resolve(process.env.ERP_DB_FILE ?? "var/e2e-ai-negoce.db")
const source = path.resolve("var/ai-negoce.db")
const manifest = path.resolve("datasets/synthetic/v1/manifest.json")

if (!fs.existsSync(source)) {
  console.error(`Base ERP introuvable: ${source} (lancez npm run db:seed)`)
  process.exit(1)
}
fs.mkdirSync(path.dirname(target), { recursive: true })
for (const f of [target, `${target}-wal`, `${target}-shm`]) fs.rmSync(f, { force: true })

const db = new DatabaseSync(source)
db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
db.close()
fs.copyFileSync(source, target)

const asOf = fs.existsSync(manifest)
  ? JSON.parse(fs.readFileSync(manifest, "utf8"))?.scenario?.asOf
  : null
if (!asOf) {
  console.error(`as_of introuvable dans ${manifest}`)
  process.exit(1)
}
const copy = new DatabaseSync(target)
copy.exec("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
copy.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('as_of', ?)").run(asOf)
copy.close()
console.log(`Base E2E prête: ${target} (as_of ${asOf})`)
