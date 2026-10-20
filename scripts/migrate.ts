import fs from "node:fs"
import path from "node:path"
import { Pool } from "pg"
// Migrations only need the database: they do not depend on the API's authentication settings.
const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is required")
const pool = new Pool({ connectionString: url })
try {
  const sql = fs.readFileSync(
    path.resolve("migrations/001_initial.sql"),
    "utf8",
  )
  await pool.query(sql)
  console.log("Migration 001_initial applied")
} finally {
  await pool.end()
}
