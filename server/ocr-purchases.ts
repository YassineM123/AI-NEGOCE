import crypto from "node:crypto"
import type { InvoiceInput } from "./invoice-validation.js"
import { ErpDatabase, shiftDays } from "./erp-db.js"
import { agencyId, moveStock, resolveProduct, ErpError } from "./erp-writes.js"
import type { AgencyScope } from "./auth.js"

/** A supplier missed by OCR is resolved by the explicit catalogue choice submitted by the
 * reviewer. Every other required extraction field must still be present for posting. */
export const missingFieldsForPurchase = (missingFields: string[]) =>
  missingFields.filter((field) => field !== "supplier")

export function purchaseSubmission(db: ErpDatabase | null | undefined, organizationId: string, documentId: string) {
  const row = db?.one<{ supplier_invoice_id: string; invoice_number: string | null; supplier_name: string | null; total_ttc: number | null } | undefined>(
    `SELECT i.supplier_invoice_id, s.supplier_invoice_number invoice_number, p.name supplier_name, s.total_ttc
       FROM ocr_purchase_imports i
       LEFT JOIN supplier_invoices s ON s.id = i.supplier_invoice_id
       LEFT JOIN suppliers p ON p.id = s.supplier_id
      WHERE i.organization_id = ? AND i.document_id = ?`,
    organizationId,
    documentId,
  )
  return row
    ? {
        status: "integrated",
        adapter: "local-purchases",
        invoiceId: row.supplier_invoice_id,
        invoiceNumber: row.invoice_number ?? undefined,
        supplierName: row.supplier_name ?? undefined,
        totalTtc: row.total_ttc ?? undefined,
      }
    : null
}

/** A catalogue id, or a supplier the reviewer explicitly asked to create from the invoice. */
export type PurchaseSupplier = string | { name: string; taxId?: string }
/** A catalogue id, or an article the reviewer explicitly asked to create (name + family). */
export type PurchaseProduct = string | { name: string; categoryId: string }

const VAT_RATES = [0, 7, 13, 19]

/** Reviewed identities only: new suppliers/articles are created solely on the reviewer's
 * explicit request, inside the same transaction, so a failed import leaves no orphan. */
export function importPurchase(db: ErpDatabase, scope: AgencyScope, org: string, doc: string, agency: string, invoice: InvoiceInput, supplierRef: PurchaseSupplier, products: PurchaseProduct[]) {
  return db.transaction(() => {
    const agencyKey = agencyId(db, scope, agency)
    const previous = purchaseSubmission(db, org, doc)
    if (previous) return previous
    const supplierId = typeof supplierRef === "string" ? supplierRef : findOrCreateSupplier(db, supplierRef)
    const supplier = db.one<{ name: string; payment_terms_days: number | null } | undefined>("SELECT name, payment_terms_days FROM suppliers WHERE id = ?", supplierId)
    if (!supplier) throw new ErpError("Choisissez un fournisseur du catalogue")
    if (!invoice.lines?.length || invoice.lines.length !== products.length) throw new ErpError("Chaque ligne doit être rapprochée avec un article")
    if (invoice.currency !== "TND" || !invoice.invoiceNumber || !invoice.invoiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(invoice.invoiceDate) || !Number.isFinite(Date.parse(invoice.invoiceDate)) || new Date(invoice.invoiceDate).toISOString().slice(0, 10) !== invoice.invoiceDate) throw new ErpError("Numéro, date ou devise invalide")
    if (db.one("SELECT id FROM supplier_invoices WHERE supplier_id = ? AND lower(trim(supplier_invoice_number)) = lower(trim(?))", supplierId, invoice.invoiceNumber)) throw new ErpError("Cette facture existe déjà dans les achats", 409)
    if (invoice.purchaseOrderId) throw new ErpError("Réceptionnez la commande existante depuis les achats pour éviter un doublon")
    if (invoice.charges?.length) throw new ErpError("Les charges doivent être traitées avant cet enregistrement")
    const id = `OCR-${crypto.randomUUID()}`
    const totals = invoice.totals!
    const amounts = [totals?.ht, totals?.vat, totals?.ttc].map(Number)
    if (amounts.some(v => !Number.isFinite(v))) throw new ErpError("Totaux incomplets")
    // This schema has no stamp column: preserve TTC, without inventing a VAT line.
    db.run(`INSERT INTO supplier_invoices (id, supplier_invoice_number, supplier_id, purchase_order_id, agency_id, invoice_date, due_date, currency, total_ht, total_vat, total_ttc, status) VALUES (?, ?, ?, NULL, ?, ?, ?, 'TND', ?, ?, ?, 'posted')`, id, invoice.invoiceNumber, supplierId, agencyKey, invoice.invoiceDate, shiftDays(invoice.invoiceDate, supplier.payment_terms_days ?? 0), ...amounts)
    invoice.lines.forEach((line, i) => {
      const [quantity, price, rate, ht, vat] = [line.quantity, line.unitPrice, line.vatRate, line.lineHt, line.lineVat].map(Number)
      if (![quantity, price, rate, ht, vat].every(Number.isFinite) || quantity <= 0 || price < 0 || ht < 0 || vat < 0) throw new ErpError(`Valeurs invalides à la ligne ${i + 1}`)
      const ref = products[i]
      const productId =
        typeof ref === "string"
          ? db.one<{ id: string } | undefined>("SELECT id FROM products WHERE id = ?", ref)?.id
          : resolveProduct(db, { productName: ref.name, categoryId: ref.categoryId }, { unitCost: ht / quantity, vatRate: VAT_RATES.includes(rate) ? rate : undefined }).id
      if (!productId) throw new ErpError(`Article inconnu à la ligne ${i + 1}`)
      db.run("INSERT INTO supplier_invoice_lines (id, supplier_invoice_id, product_id, quantity, unit_cost, vat_rate, line_ht, line_vat) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", `${id}-${i}`, id, productId, quantity, ht / quantity, rate, ht, vat)
      moveStock(db, { productId, agencyId: agencyKey, date: invoice.invoiceDate!, type: "receipt", quantity, unitCost: ht / quantity, reference: id })
    })
    db.run("INSERT INTO ocr_purchase_imports (organization_id, document_id, supplier_invoice_id) VALUES (?, ?, ?)", org, doc, id)
    return {
      status: "integrated",
      adapter: "local-purchases",
      invoiceId: id,
      invoiceNumber: invoice.invoiceNumber,
      supplierName: supplier.name,
      totalTtc: amounts[2],
    }
  })
}

/** Reuses a supplier with the same tax id or name before creating one. */
function findOrCreateSupplier(db: ErpDatabase, input: { name: string; taxId?: string }) {
  const name = input.name.trim()
  if (name.length < 2) throw new ErpError("Nom du nouveau fournisseur requis")
  const existing =
    (input.taxId ? db.one<{ id: string } | undefined>("SELECT id FROM suppliers WHERE lower(trim(tax_id)) = lower(trim(?))", input.taxId) : undefined) ??
    db.one<{ id: string } | undefined>("SELECT id FROM suppliers WHERE lower(trim(name)) = lower(?)", name)
  if (existing) return existing.id
  const n = db.one<{ n: number | null }>("SELECT max(CAST(substr(id, 5) AS INTEGER)) n FROM suppliers WHERE id LIKE 'SUP-%'").n
  const id = `SUP-${String((n ?? 0) + 1).padStart(3, "0")}`
  db.run("INSERT INTO suppliers (id, name, tax_id, payment_terms_days) VALUES (?, ?, ?, 30)", id, name, input.taxId?.trim() || null)
  return id
}
