// Loads the canonical SYNTHETIC dataset (datasets/synthetic/v1/json) and maps it to the
// application's BI fact model. One fact row per document line; credit-note lines carry
// negative revenue/cost; cancelled documents are kept with status "cancelled" so the
// application (not the loader) is responsible for excluding them.
import fs from "node:fs"
import path from "node:path"

const DIR = path.resolve(process.env.QA_DATASET_DIR ?? "datasets/synthetic/v1")
type Row = Record<string, string | number | null>
const read = (name: string): Row[] => JSON.parse(fs.readFileSync(path.join(DIR, "json", `${name}.json`), "utf8"))
export const datasetAvailable = () => fs.existsSync(path.join(DIR, "manifest.json"))

let cache: ReturnType<typeof build> | undefined
export function synthetic() {
  return (cache ??= build())
}

function build() {
  const agencies = new Map(read("agencies").map((a) => [a.id, String(a.name)]))
  const customers = new Map(read("customers").map((c) => [c.id, c]))
  const products = new Map(read("products").map((p) => [p.id, p]))
  const categories = new Map(read("product_categories").map((c) => [c.id, String(c.name)]))
  const reps = new Map(read("representatives").map((r) => [r.id, String(r.name)]))
  const docs = new Map(read("sales_invoices").map((d) => [d.id, d]))
  const receivablesRaw = read("receivables")
  const outstanding = new Map(receivablesRaw.map((r) => [r.sales_invoice_id, Number(r.outstanding)]))
  const sales = read("sales_invoice_lines").map((l) => {
    const d = docs.get(l.sales_invoice_id)!
    const p = products.get(l.product_id)!
    const sign = d.doc_type === "credit_note" ? -1 : 1
    const invoiceForPayment = d.doc_type === "credit_note" ? d.original_invoice_id : d.id
    return {
      id: String(l.id),
      invoiceId: String(d.id),
      date: String(d.invoice_date),
      agency: agencies.get(d.agency_id)!,
      customer: String(customers.get(d.customer_id)!.name),
      customerId: String(d.customer_id),
      product: String(p.name),
      productId: String(l.product_id),
      family: categories.get(p.category_id)!,
      representative: reps.get(d.representative_id)!,
      revenue: sign * Number(l.line_ht),
      cost: sign * Number(l.line_cost),
      paid: (outstanding.get(invoiceForPayment) ?? 0) === 0,
      kind: d.doc_type === "credit_note" ? ("credit_note" as const) : ("invoice" as const),
      status: d.status as "posted" | "cancelled",
    }
  })
  const receivables = receivablesRaw.map((r) => ({
    invoiceId: String(r.sales_invoice_id),
    agency: agencies.get(r.agency_id)!,
    customer: String(customers.get(r.customer_id)!.name),
    date: String(r.invoice_date),
    dueDate: String(r.due_date),
    outstanding: Number(r.outstanding),
  }))
  const inventory = read("inventory").map((i) => {
    const p = products.get(i.product_id)!
    return {
      reference: String(p.sku),
      product: String(p.name),
      agency: agencies.get(i.agency_id)!,
      quantity: Number(i.current_quantity),
      reorderPoint: Number(i.reorder_point),
      unitCost: Number(i.unit_cost),
    }
  })
  const datasetMetadata = {
    adapter: "test" as const,
    source: "Jeu de données SYNTHÉTIQUE (tools/dataset/generate.ts)",
    currency: "TND",
    lastUpdated: "2026-06-30T00:00:00.000Z",
    asOf: "2026-06-30",
  }
  return { sales, receivables, inventory, datasetMetadata, agencies: [...agencies.values()] }
}

/** Module shape used with vi.mock("server/data.js"): superset of the legacy and current fields. */
export function mockDataModule() {
  const s = synthetic()
  return { sales: s.sales, inventory: s.inventory, receivables: s.receivables, datasetMetadata: s.datasetMetadata, agencies: s.agencies }
}

export const toMillimes = (x: number | string | null | undefined) => (x === null || x === undefined ? null : Math.round(Number(x) * 1000))
