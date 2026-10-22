import { z } from "zod"
import type { AgencyScope } from "./auth.js"
import { ErpDatabase, round3, shiftDays } from "./erp-db.js"

/** Business rule violation: reported to the user as a 4xx with this message. */
export class ErpError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message)
  }
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const name = z.string().trim().min(2).max(120)
const vatRate = z.union([z.literal(0), z.literal(7), z.literal(13), z.literal(19)])
/** An existing product (productId) or a new one created on the fly (productName + categoryId). */
const productRef = z
  .object({
    productId: z.string().max(40).optional(),
    productName: name.optional(),
    categoryId: z.string().max(20).optional(),
  })
  .refine((p) => p.productId || (p.productName && p.categoryId), "Article ou nouvel article (nom + famille) requis")

export const salesInvoiceInput = z.object({
  agency: z.string().max(80),
  customerId: z.string().max(40).optional(),
  customerName: name.optional(),
  date: isoDate,
  dueDays: z.number().int().min(0).max(365).optional(),
  lines: z
    .array(
      productRef.and(
        z.object({
          quantity: z.number().positive().max(1_000_000),
          unitPrice: z.number().min(0).max(100_000_000),
          discountPct: z.number().min(0).max(100).default(0),
          vatRate: vatRate.optional(),
          unitCost: z.number().min(0).max(100_000_000).optional(),
        }),
      ),
    )
    .min(1)
    .max(50),
}).refine((i) => i.customerId || i.customerName, "Client requis")

export const purchaseOrderInput = z.object({
  agency: z.string().max(80),
  supplierId: z.string().max(40).optional(),
  supplierName: name.optional(),
  date: isoDate,
  received: z.boolean().default(false),
  supplierInvoiceNumber: z.string().trim().max(60).optional(),
  lines: z
    .array(
      productRef.and(
        z.object({
          quantity: z.number().positive().max(1_000_000),
          unitCost: z.number().min(0).max(100_000_000),
          vatRate: vatRate.optional(),
        }),
      ),
    )
    .min(1)
    .max(50),
}).refine((i) => i.supplierId || i.supplierName, "Fournisseur requis")

export const stockMovementInput = productRef.and(
  z.object({
    agency: z.string().max(80),
    date: isoDate,
    type: z.enum(["receipt", "adjustment"]),
    quantity: z.number().refine((q) => q !== 0 && Math.abs(q) <= 1_000_000, "Quantité invalide"),
    unitCost: z.number().min(0).max(100_000_000).optional(),
    reorderPoint: z.number().int().min(0).max(1_000_000).optional(),
  }),
)

export const paymentInput = z.object({
  salesInvoiceId: z.string().max(40),
  amount: z.number().positive().max(100_000_000),
  method: z.enum(["espèces", "chèque", "virement", "traite"]),
  date: isoDate,
})

export function lookups(db: ErpDatabase, scope: AgencyScope) {
  const inScope = db.scopeFilter(scope)
  return {
    asOf: db.asOf(),
    agencies: db.all<{ id: string; name: string }>(`SELECT id, name FROM agencies WHERE ${inScope("id")} ORDER BY id`),
    categories: db.all<{ id: string; name: string; vatRate: number }>(
      "SELECT id, name, default_vat_rate vatRate FROM product_categories ORDER BY name",
    ),
    customers: db.all<{ id: string; name: string }>(`SELECT id, name FROM customers WHERE ${inScope("agency_id")} ORDER BY name`),
    suppliers: db.all<{ id: string; name: string; taxId: string | null }>("SELECT id, name, tax_id taxId FROM suppliers ORDER BY name"),
    products: db.all<{ id: string; sku: string; name: string; categoryId: string; unitCost: number | null; listPrice: number | null; vatRate: number | null }>(
      "SELECT id, sku, name, category_id categoryId, unit_cost unitCost, list_price listPrice, vat_rate vatRate FROM products ORDER BY name",
    ),
    openInvoices: db.all<{ id: string; number: string; customer: string; outstanding: number }>(
      `SELECT r.sales_invoice_id id, s.number, c.name customer, r.outstanding
         FROM receivables r JOIN sales_invoices s ON s.id = r.sales_invoice_id JOIN customers c ON c.id = r.customer_id
        WHERE r.outstanding > 0 AND ${inScope("r.agency_id")} ORDER BY r.due_date LIMIT 500`,
    ),
  }
}

function nextId(db: ErpDatabase, table: string, column: string, prefix: string, width: number) {
  const n = db.one<{ n: number | null }>(
    `SELECT max(CAST(substr(${column}, ?) AS INTEGER)) n FROM ${table} WHERE ${column} LIKE ? || '%'`,
    prefix.length + 1,
    prefix,
  ).n
  return `${prefix}${String((n ?? 0) + 1).padStart(width, "0")}`
}

export function agencyId(db: ErpDatabase, scope: AgencyScope, agency: string) {
  const row = db.one<{ id: string } | undefined>("SELECT id FROM agencies WHERE name = ? OR id = ?", agency, agency)
  if (!row) throw new ErpError("Agence inconnue")
  if (scope !== "*" && !scope.includes(agency) && !db.all<{ name: string }>("SELECT name FROM agencies WHERE id = ?", row.id).some((a) => scope.includes(a.name)))
    throw new ErpError("Agence hors périmètre", 403)
  return row.id
}

export type ProductRef = z.infer<typeof productRef>
export function resolveProduct(db: ErpDatabase, ref: ProductRef, defaults: { unitCost?: number; listPrice?: number; vatRate?: number }) {
  if (ref.productId) {
    const p = db.one<{ id: string; unit_cost: number | null; vat_rate: number | null } | undefined>(
      "SELECT id, unit_cost, vat_rate FROM products WHERE id = ?",
      ref.productId,
    )
    if (!p) throw new ErpError(`Article inconnu : ${ref.productId}`)
    return p
  }
  const existing = db.one<{ id: string; unit_cost: number | null; vat_rate: number | null } | undefined>(
    "SELECT id, unit_cost, vat_rate FROM products WHERE lower(name) = lower(?)",
    ref.productName!,
  )
  if (existing) return existing
  const category = db.one<{ id: string; default_vat_rate: number } | undefined>(
    "SELECT id, default_vat_rate FROM product_categories WHERE id = ?",
    ref.categoryId!,
  )
  if (!category) throw new ErpError("Famille d’article inconnue")
  const id = nextId(db, "products", "id", "PRD-", 5)
  const vat = defaults.vatRate ?? category.default_vat_rate
  db.run(
    `INSERT INTO products (id, sku, name, category_id, unit_cost, list_price, vat_rate, reorder_point, uom)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'unité')`,
    id,
    `${category.id.slice(3)}-${id.slice(4)}`,
    ref.productName!,
    category.id,
    defaults.unitCost ?? 0,
    defaults.listPrice ?? null,
    vat,
  )
  return { id, unit_cost: defaults.unitCost ?? 0, vat_rate: vat }
}

/** Applies a signed quantity to the stock of one product in one agency (weighted average cost on receipts). */
export function moveStock(
  db: ErpDatabase,
  m: { productId: string; agencyId: string; date: string; type: string; quantity: number; unitCost: number; reference: string },
) {
  const row = db.one<{ current_quantity: number; unit_cost: number } | undefined>(
    "SELECT current_quantity, unit_cost FROM inventory WHERE product_id = ? AND agency_id = ?",
    m.productId,
    m.agencyId,
  )
  if (!row) {
    db.run(
      `INSERT INTO inventory (product_id, agency_id, opening_date, opening_quantity, current_quantity, unit_cost, reorder_point, as_of)
       VALUES (?, ?, ?, 0, ?, ?, (SELECT coalesce(reorder_point, 0) FROM products WHERE id = ?), ?)`,
      m.productId,
      m.agencyId,
      m.date,
      m.quantity,
      m.unitCost,
      m.productId,
      m.date,
    )
  } else {
    const qty = row.current_quantity + m.quantity
    const cost =
      m.type === "receipt" && row.current_quantity > 0 && qty > 0
        ? round3((row.current_quantity * row.unit_cost + m.quantity * m.unitCost) / qty)
        : m.type === "receipt"
          ? m.unitCost
          : row.unit_cost
    db.run(
      "UPDATE inventory SET current_quantity = ?, unit_cost = ?, as_of = ? WHERE product_id = ? AND agency_id = ?",
      qty,
      cost,
      m.date,
      m.productId,
      m.agencyId,
    )
  }
  db.run(
    "INSERT INTO stock_movements (id, date, product_id, agency_id, type, quantity, reference) VALUES (?, ?, ?, ?, ?, ?, ?)",
    nextId(db, "stock_movements", "id", "MV-", 6),
    m.date,
    m.productId,
    m.agencyId,
    m.type,
    m.quantity,
    m.reference,
  )
}

export function createSalesInvoice(db: ErpDatabase, scope: AgencyScope, input: z.infer<typeof salesInvoiceInput>) {
  return db.transaction(() => {
    const agency = agencyId(db, scope, input.agency)
    let customer = input.customerId
      ? db.one<{ id: string; payment_terms_days: number | null } | undefined>("SELECT id, payment_terms_days FROM customers WHERE id = ?", input.customerId)
      : db.one<{ id: string; payment_terms_days: number | null } | undefined>("SELECT id, payment_terms_days FROM customers WHERE lower(name) = lower(?)", input.customerName!)
    if (!customer && input.customerId) throw new ErpError("Client inconnu")
    if (!customer) {
      customer = { id: nextId(db, "customers", "id", "CUS-", 4), payment_terms_days: input.dueDays ?? 30 }
      db.run(
        "INSERT INTO customers (id, name, agency_id, segment, payment_terms_days, customer_discount_pct) VALUES (?, ?, ?, 'PME', ?, 0)",
        customer.id,
        input.customerName!,
        agency,
        customer.payment_terms_days,
      )
    }
    const id = nextId(db, "sales_invoices", "id", "SV-", 5)
    const number = nextId(db, "sales_invoices", "number", `FV-${input.date.slice(2, 4)}${input.date.slice(5, 7)}-`, 5)
    let ht = 0, vat = 0, discount = 0, cost = 0
    const lines = input.lines.map((l, i) => {
      const product = resolveProduct(db, l, { unitCost: l.unitCost, listPrice: l.unitPrice, vatRate: l.vatRate })
      const gross = l.quantity * l.unitPrice
      const lineHt = round3(gross * (1 - l.discountPct / 100))
      const rate = l.vatRate ?? product.vat_rate ?? 19
      const unitCost = l.unitCost ?? product.unit_cost ?? 0
      const line = {
        id: `${id}-L${i + 1}`,
        productId: product.id,
        lineHt,
        rate,
        lineVat: round3((lineHt * rate) / 100),
        unitCost,
        lineCost: round3(l.quantity * unitCost),
        l,
      }
      ht += lineHt
      vat += line.lineVat
      discount += gross - lineHt
      cost += line.lineCost
      return line
    })
    const stamp = 1
    const ttc = round3(ht + vat + stamp)
    const due = shiftDays(input.date, input.dueDays ?? customer.payment_terms_days ?? 30)
    db.run(
      `INSERT INTO sales_invoices (id, number, doc_type, customer_id, agency_id, invoice_date, due_date, status, currency,
         total_discount, total_ht, total_vat, stamp_duty, total_ttc, total_cost)
       VALUES (?, ?, 'invoice', ?, ?, ?, ?, 'posted', 'TND', ?, ?, ?, ?, ?, ?)`,
      id, number, customer.id, agency, input.date, due, round3(discount), round3(ht), round3(vat), stamp, ttc, round3(cost),
    )
    for (const line of lines) {
      db.run(
        `INSERT INTO sales_invoice_lines (id, sales_invoice_id, product_id, quantity, unit_price, discount_pct, line_ht, vat_rate, line_vat, unit_cost, line_cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        line.id, id, line.productId, line.l.quantity, line.l.unitPrice, line.l.discountPct, line.lineHt, line.rate, line.lineVat, line.unitCost, line.lineCost,
      )
      moveStock(db, { productId: line.productId, agencyId: agency, date: input.date, type: "sale", quantity: -line.l.quantity, unitCost: line.unitCost, reference: id })
    }
    db.run(
      `INSERT INTO receivables (sales_invoice_id, customer_id, agency_id, invoice_date, due_date, total_ttc, credited_ttc, paid, outstanding, days_overdue, status)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 0, 'open')`,
      id, customer.id, agency, input.date, due, ttc, ttc,
    )
    return { id, number, totalHt: round3(ht), totalTtc: ttc, dueDate: due }
  })
}

export function createPurchaseOrder(db: ErpDatabase, scope: AgencyScope, input: z.infer<typeof purchaseOrderInput>) {
  return db.transaction(() => {
    const agency = agencyId(db, scope, input.agency)
    let supplier = input.supplierId
      ? db.one<{ id: string } | undefined>("SELECT id FROM suppliers WHERE id = ?", input.supplierId)
      : db.one<{ id: string } | undefined>("SELECT id FROM suppliers WHERE lower(name) = lower(?)", input.supplierName!)
    if (!supplier && input.supplierId) throw new ErpError("Fournisseur inconnu")
    if (!supplier) {
      supplier = { id: nextId(db, "suppliers", "id", "SUP-", 3) }
      db.run("INSERT INTO suppliers (id, name, payment_terms_days) VALUES (?, ?, 30)", supplier.id, input.supplierName!)
    }
    const id = nextId(db, "purchase_orders", "id", "PO-", 5)
    // Header first (lines reference it); the total is set once lines are known.
    db.run(
      "INSERT INTO purchase_orders (id, supplier_id, agency_id, order_date, status, total_ht) VALUES (?, ?, ?, ?, 'ordered', 0)",
      id, supplier.id, agency, input.date,
    )
    let total = 0
    input.lines.forEach((l, i) => {
      const product = resolveProduct(db, l, { unitCost: l.unitCost, vatRate: l.vatRate })
      const lineTotal = round3(l.quantity * l.unitCost)
      total += lineTotal
      db.run(
        "INSERT INTO purchase_order_lines (id, purchase_order_id, product_id, quantity, unit_cost, line_total) VALUES (?, ?, ?, ?, ?, ?)",
        `${id}-L${i + 1}`, id, product.id, l.quantity, l.unitCost, lineTotal,
      )
    })
    db.run("UPDATE purchase_orders SET total_ht = ? WHERE id = ?", round3(total), id)
    const receipt = input.received ? receive(db, id, input.date, input.supplierInvoiceNumber) : null
    return { id, totalHt: round3(total), received: receipt }
  })
}

export function receivePurchaseOrder(db: ErpDatabase, scope: AgencyScope, id: string, input: { date: string; supplierInvoiceNumber?: string }) {
  return db.transaction(() => {
    const po = db.one<{ agency_id: string } | undefined>("SELECT agency_id FROM purchase_orders WHERE id = ?", id)
    if (!po) throw new ErpError("Commande introuvable", 404)
    agencyId(db, scope, po.agency_id)
    return receive(db, id, input.date, input.supplierInvoiceNumber)
  })
}

/** Goods receipt + supplier invoice for an ordered PO (inside the caller's transaction). */
function receive(db: ErpDatabase, poId: string, date: string, invoiceNumber?: string) {
  const po = db.one<{ supplier_id: string; agency_id: string; status: string; order_date: string }>(
    "SELECT supplier_id, agency_id, status, order_date FROM purchase_orders WHERE id = ?",
    poId,
  )
  if (po.status !== "ordered") throw new ErpError("Cette commande n’est plus à réceptionner", 409)
  if (date < po.order_date) throw new ErpError("La réception ne peut pas précéder la commande")
  const lines = db.all<{ product_id: string; quantity: number; unit_cost: number; line_total: number; vat_rate: number | null }>(
    `SELECT l.product_id, l.quantity, l.unit_cost, l.line_total, p.vat_rate
       FROM purchase_order_lines l JOIN products p ON p.id = l.product_id WHERE l.purchase_order_id = ?`,
    poId,
  )
  const terms = db.one<{ t: number | null }>("SELECT payment_terms_days t FROM suppliers WHERE id = ?", po.supplier_id).t ?? 30
  const id = nextId(db, "supplier_invoices", "id", "SI-", 5)
  const number = invoiceNumber || nextId(db, "supplier_invoices", "supplier_invoice_number", `FF-${date.slice(2, 4)}${date.slice(5, 7)}-`, 4)
  // Header first (lines reference it); totals are set once lines are known.
  db.run(
    `INSERT INTO supplier_invoices (id, supplier_invoice_number, supplier_id, purchase_order_id, agency_id, invoice_date, due_date, currency, total_ht, total_vat, total_ttc, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'TND', 0, 0, 0, 'posted')`,
    id, number, po.supplier_id, poId, po.agency_id, date, shiftDays(date, terms),
  )
  let ht = 0, vat = 0
  lines.forEach((l, i) => {
    const rate = l.vat_rate ?? 19
    const lineVat = round3((l.line_total * rate) / 100)
    ht += l.line_total
    vat += lineVat
    db.run(
      `INSERT INTO supplier_invoice_lines (id, supplier_invoice_id, product_id, quantity, unit_cost, vat_rate, line_ht, line_vat)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      `${id}-L${i + 1}`, id, l.product_id, l.quantity, l.unit_cost, rate, l.line_total, lineVat,
    )
    moveStock(db, { productId: l.product_id, agencyId: po.agency_id, date, type: "receipt", quantity: l.quantity, unitCost: l.unit_cost, reference: id })
  })
  db.run(
    "UPDATE supplier_invoices SET total_ht = ?, total_vat = ?, total_ttc = ? WHERE id = ?",
    round3(ht), round3(vat), round3(ht + vat), id,
  )
  db.run("UPDATE purchase_orders SET status = 'invoiced' WHERE id = ?", poId)
  return { supplierInvoiceId: id, number, totalTtc: round3(ht + vat) }
}

export function createStockMovement(db: ErpDatabase, scope: AgencyScope, input: z.infer<typeof stockMovementInput>) {
  if (input.type === "receipt" && input.quantity < 0) throw new ErpError("Une réception doit être positive")
  return db.transaction(() => {
    const agency = agencyId(db, scope, input.agency)
    const product = resolveProduct(db, input, { unitCost: input.unitCost })
    const reference = nextId(db, "stock_movements", "reference", input.type === "receipt" ? "REC-" : "ADJ-", 5)
    moveStock(db, {
      productId: product.id,
      agencyId: agency,
      date: input.date,
      type: input.type,
      quantity: input.quantity,
      unitCost: input.unitCost ?? product.unit_cost ?? 0,
      reference,
    })
    if (input.reorderPoint !== undefined)
      db.run("UPDATE inventory SET reorder_point = ? WHERE product_id = ? AND agency_id = ?", input.reorderPoint, product.id, agency)
    return { reference, productId: product.id }
  })
}

export function createPayment(db: ErpDatabase, scope: AgencyScope, input: z.infer<typeof paymentInput>) {
  return db.transaction(() => {
    const r = db.one<{ agency_id: string; customer_id: string; outstanding: number; paid: number; invoice_date: string } | undefined>(
      "SELECT agency_id, customer_id, outstanding, paid, invoice_date FROM receivables WHERE sales_invoice_id = ?",
      input.salesInvoiceId,
    )
    if (!r) throw new ErpError("Facture introuvable", 404)
    agencyId(db, scope, r.agency_id)
    const amount = round3(input.amount)
    if (amount > round3(r.outstanding)) throw new ErpError(`Montant supérieur au reste dû (${r.outstanding.toFixed(3)} DT)`)
    if (input.date < r.invoice_date) throw new ErpError("Le règlement ne peut pas précéder la facture")
    const id = nextId(db, "payments", "id", "PAY-", 5)
    db.run(
      "INSERT INTO payments (id, sales_invoice_id, customer_id, payment_date, amount, method) VALUES (?, ?, ?, ?, ?, ?)",
      id, input.salesInvoiceId, r.customer_id, input.date, amount, input.method,
    )
    const outstanding = round3(r.outstanding - amount)
    db.run(
      "UPDATE receivables SET paid = ?, outstanding = ?, status = ? WHERE sales_invoice_id = ?",
      round3(r.paid + amount),
      outstanding,
      outstanding <= 0 ? "settled" : "partially_paid",
      input.salesInvoiceId,
    )
    return { id, outstanding }
  })
}
