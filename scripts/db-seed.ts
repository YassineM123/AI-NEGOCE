// Builds the local ERP database (SQLite) from the synthetic CSV dataset.
// Usage: npm run db:seed [-- <csvDir> <dbFile>]
//        npm run db:reset   (--empty: reference tables only, all activity at zero)
import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

const empty = process.argv.includes("--empty")
const args = process.argv.slice(2).filter((a) => a !== "--empty")
const csvDir = path.resolve(args[0] ?? "datasets/synthetic/v1/csv")
const dbFile = path.resolve(args[1] ?? process.env.ERP_DB_FILE ?? "var/ai-negoce.db")
// Configuration kept by --empty so agency filters and categories still work.
const referenceTables = new Set(["agencies", "roles", "product_categories"])

// Parent tables first so foreign keys resolve.
const tables = [
  "agencies",
  "representatives",
  "roles",
  "product_categories",
  "suppliers",
  "products",
  "customers",
  "sales_invoices",
  "sales_invoice_lines",
  "payments",
  "receivables",
  "purchase_orders",
  "purchase_order_lines",
  "supplier_invoices",
  "supplier_invoice_lines",
  "stock_movements",
  "inventory",
]

/** RFC 4180 CSV: quoted fields, doubled quotes, commas/newlines inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ",") row.push(field), (field = "")
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(field), rows.push(row), (row = []), (field = "")
    } else field += c
  }
  if (field || row.length) row.push(field), rows.push(row)
  return rows.filter((r) => r.length > 1 || r[0] !== "")
}

if (!fs.existsSync(csvDir))
  throw new Error(`Dataset introuvable: ${csvDir} (lancez npm run dataset:generate)`)
fs.mkdirSync(path.dirname(dbFile), { recursive: true })
for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true })

const db = new DatabaseSync(dbFile)
db.exec("PRAGMA journal_mode = WAL")
db.exec(fs.readFileSync(path.resolve("migrations/sqlite/001_erp.sql"), "utf8"))

const started = Date.now()
db.exec("BEGIN")
try {
  for (const table of tables) {
    if (empty && !referenceTables.has(table)) continue
    const [header, ...rows] = parseCsv(
      fs.readFileSync(path.join(csvDir, `${table}.csv`), "utf8").replace(/^﻿/, ""),
    )
    const insert = db.prepare(
      `INSERT INTO ${table} (${header.join(",")}) VALUES (${header.map(() => "?").join(",")})`,
    )
    // Empty CSV cells are NULL, not empty strings (e.g. original_invoice_id).
    for (const r of rows) insert.run(...r.map((v) => (v === "" ? null : v)))
    console.log(`${table.padEnd(24)} ${rows.length}`)
  }
  // The synthetic dataset is frozen at its own date; an empty base follows the real calendar.
  const manifest = path.join(csvDir, "..", "manifest.json")
  const asOf = !empty && fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8"))?.scenario?.asOf : null
  if (asOf) db.prepare("INSERT INTO app_settings (key, value) VALUES ('as_of', ?)").run(asOf)
  db.exec("COMMIT")
} catch (error) {
  db.exec("ROLLBACK")
  throw error
}
const fkErrors = db.prepare("PRAGMA foreign_key_check").all()
if (fkErrors.length) throw new Error(`${fkErrors.length} violations de clés étrangères`)
db.exec("ANALYZE")
db.close()
console.log(`Base créée: ${dbFile} (${Date.now() - started} ms)`)
