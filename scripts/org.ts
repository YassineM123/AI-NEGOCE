// Organization (tenant) administration. Real customer organizations are created explicitly
// here, never implicitly by a login. The id must equal the identity provider's organization
// claim (OIDC_ORGANIZATION_CLAIM, default "org_id").
//   npm run org -- list
//   npm run org -- create <id> "<name>" [--synthetic]
//   npm run org -- suspend <id>
//   npm run org -- activate <id>
import { Pool } from "pg"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is required")
const [command, id, name] = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const ID = /^[a-z0-9][a-z0-9-]{1,62}$/
const pool = new Pool({ connectionString: url })
try {
  if (command === "list") {
    const r = await pool.query("SELECT id, name, status, is_synthetic FROM organizations ORDER BY id")
    console.table(r.rows)
  } else if (command === "create") {
    if (!id || !ID.test(id)) throw new Error("Invalid id: lowercase letters, digits and dashes (2-63 chars)")
    if (!name) throw new Error("Name required")
    await pool.query("INSERT INTO organizations(id, name, status, is_synthetic) VALUES ($1, $2, 'active', $3)", [id, name, process.argv.includes("--synthetic")])
    console.log(`Organization ${id} created`)
  } else if (command === "suspend" || command === "activate") {
    if (id === "legacy-unassigned") throw new Error("legacy-unassigned stays in quarantine")
    const r = await pool.query("UPDATE organizations SET status = $2 WHERE id = $1", [id, command === "suspend" ? "suspended" : "active"])
    if (!r.rowCount) throw new Error(`Unknown organization ${id}`)
    console.log(`Organization ${id} ${command === "suspend" ? "suspended" : "activated"} (effective within 30 s)`)
  } else {
    throw new Error("Usage: npm run org -- list | create <id> \"<name>\" [--synthetic] | suspend <id> | activate <id>")
  }
} finally {
  await pool.end()
}
