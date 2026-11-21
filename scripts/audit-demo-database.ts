// Fails fast if IAINEG demo extraction headers, IDs, currency separation or
// numeric precision are broken. Gaps in the extracts are reported, NOT filled.
import { loadExtractedDemo } from "../server/demo-database.js"

const { dataset, quality } = loadExtractedDemo()
if (quality.sales.distinctDocuments !== quality.sales.totalDocuments)
  throw new Error("Demo extraction has duplicate invoice IDs")
if (!quality.sales.currencies.TND || dataset.sales.length === 0)
  throw new Error("No valid TND invoices for the 3 shared platforms")
if (dataset.sales.some((row) => row.cost !== null))
  throw new Error("An unknown cost was fabricated from document-grain sales")
if (dataset.receivables.length || dataset.inventory.length)
  throw new Error("Source gaps must not be silently populated as facts")

console.log("PHASE 2 · IAINEG pseudonymized extractions — DEMO ONLY")
console.log(JSON.stringify(quality, null, 2))
