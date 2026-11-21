/**
 * Guarded dataset export.
 *
 *   npx tsx tools/dataset/export.ts --source erp      -> real ERP export (read-only). BLOCKED until an
 *                                                         ERP read adapter exists; refuses explicitly.
 *   npx tsx tools/dataset/export.ts --source fixture  -> exports the local declared fixture
 *                                                         (server/data.ts) pseudonymised, as CSV + JSON.
 *
 * Safety rules enforced here: output only under datasets/exports/ (git-ignored); never reads or writes
 * secrets; customer names replaced by stable HMAC pseudonyms (key from EXPORT_PSEUDONYM_KEY, or a random
 * per-run key that is never written to disk); production environments refused.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { inventory, receivables, sales } from "../../server/data.js"

const args = process.argv.slice(2)
const source = args[args.indexOf("--source") + 1]
const fail = (msg: string, code = 2): never => {
  console.error(`EXPORT REFUSED: ${msg}`)
  process.exit(code)
}

if (process.env.NODE_ENV === "production") fail("exports are not run from a production environment.")
if (source === "erp") {
  // No ERP read API, schema, sandbox or credentials exist in this repository (see ERP_INTEGRATION.md).
  // server/erp.ts only declares createSupplierInvoice; there is nothing to read from. Do not fake it.
  fail("BLOCKED — no ERP read adapter/contract is available. Provide an authorised staging endpoint, read-only credentials and the entity schema; then implement ErpReadAdapter. No data was exported.", 3)
}
if (source !== "fixture") fail("use --source fixture or --source erp")

const key = process.env.EXPORT_PSEUDONYM_KEY ?? crypto.randomBytes(32).toString("hex")
const pseudo = (kind: string, value: string) => `${kind}-${crypto.createHmac("sha256", key).update(`${kind}:${value}`).digest("hex").slice(0, 10)}`
const out = path.resolve("datasets/exports", `fixture-${new Date().toISOString().replace(/[:.]/g, "-")}`)
if (!out.startsWith(path.resolve("datasets/exports"))) fail("invalid output path")
fs.mkdirSync(out, { recursive: true })

const tables: Record<string, Record<string, unknown>[]> = {
  sales: sales.map((s) => ({ ...s, customer: pseudo("CUS", s.customer), representative: pseudo("REP", s.representative) })),
  receivables: receivables.map((r) => ({ ...r, customer: pseudo("CUS", r.customer) })),
  inventory: inventory.map((i) => ({ ...i })),
}
const cell = (v: unknown) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
for (const [name, rows] of Object.entries(tables)) {
  const cols = Object.keys(rows[0] ?? {})
  fs.writeFileSync(path.join(out, `${name}.csv`), [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n")
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(rows, null, 2))
}
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ source: "server/data.ts (declared local fixture — NOT ERP data)", pseudonymised: ["customer", "representative"], keyPersisted: false, counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])) }, null, 2))
console.log(`exported ${Object.keys(tables).length} tables to ${path.relative(process.cwd(), out)}`)
