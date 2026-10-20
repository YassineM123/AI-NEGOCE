import fs from "node:fs"
import path from "node:path"
import { Pool } from "pg"
import { loadConfig } from "../server/config.js"
const config = loadConfig()
if (!config.DATABASE_URL) throw new Error("DATABASE_URL is required")
const pool = new Pool({ connectionString: config.DATABASE_URL })
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
