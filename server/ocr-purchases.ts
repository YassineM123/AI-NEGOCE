import crypto from "node:crypto"
import type { InvoiceInput } from "./invoice-validation.js"
import { ErpDatabase, shiftDays } from "./erp-db.js"
import { agencyId, moveStock, ErpError } from "./erp-writes.js"
import type { AgencyScope } from "./auth.js"

export function purchaseSubmission(db: ErpDatabase | null | undefined, organizationId: string, documentId: string) {
  const row = db?.one<{ supplier_invoice_id: string } | undefined>("SELECT supplier_invoice_id FROM ocr_purchase_imports WHERE organization_id = ? AND document_id = ?", organizationId, documentId)
  return row ? { status: "integrated", adapter: "local-purchases", invoiceId: row.supplier_invoice_id } : null
}

/** Only reviewed catalogue identities are accepted; never creates products or a fictitious PO. */
export function importPurchase(db: ErpDatabase, scope: AgencyScope, org: string, doc: string, agency: string, invoice: InvoiceInput, supplierId: string, productIds: string[]) {
  return db.transaction(() => {
    const agencyKey = agencyId(db, scope, agency)
    const previous = purchaseSubmission(db, org, doc)
    if (previous) return previous
    const supplier = db.one<{ payment_terms_days: number | null } | undefined>("SELECT payment_terms_days FROM suppliers WHERE id = ?", supplierId)
    if (!supplier) throw new ErpError("Choisissez un fournisseur du catalogue")
    if (!invoice.lines?.length || invoice.lines.length !== productIds.length) throw new ErpError("Chaque ligne doit être rapprochée avec un article")
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
      const product = db.one("SELECT id FROM products WHERE id = ?", productIds[i])
      if (!product) throw new ErpError(`Article inconnu à la ligne ${i + 1}`)
      const [quantity, price, rate, ht, vat] = [line.quantity, line.unitPrice, line.vatRate, line.lineHt, line.lineVat].map(Number)
      if (![quantity, price, rate, ht, vat].every(Number.isFinite) || quantity <= 0 || price < 0 || ht < 0 || vat < 0) throw new ErpError(`Valeurs invalides à la ligne ${i + 1}`)
      db.run("INSERT INTO supplier_invoice_lines (id, supplier_invoice_id, product_id, quantity, unit_cost, vat_rate, line_ht, line_vat) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", `${id}-${i}`, id, productIds[i], quantity, ht / quantity, rate, ht, vat)
      moveStock(db, { productId: productIds[i], agencyId: agencyKey, date: invoice.invoiceDate!, type: "receipt", quantity, unitCost: ht / quantity, reference: id })
    })
    db.run("INSERT INTO ocr_purchase_imports (organization_id, document_id, supplier_invoice_id) VALUES (?, ?, ?)", org, doc, id)
    return { status: "integrated", adapter: "local-purchases", invoiceId: id }
  })
}
