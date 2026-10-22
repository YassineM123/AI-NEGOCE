import type { AgencyScope } from "../auth.js"
import { ErpDatabase } from "../erp-db.js"
import { round1, round3, safePct } from "./semantic.js"
import type { BusinessAlert } from "./types.js"

// Store acknowledged alerts in memory
const acknowledgedAlerts = new Set<string>()

export function acknowledgeAlert(alertId: string): boolean {
  acknowledgedAlerts.add(alertId)
  return true
}

export function dismissAlert(alertId: string): boolean {
  acknowledgedAlerts.add(alertId)
  return true
}

export function computeAlerts(
  db: ErpDatabase,
  scope: AgencyScope,
  includeAcknowledged = false,
): { alerts: BusinessAlert[]; totalCount: number; criticalCount: number } {
  const asOf = db.asOf()
  const inScope = db.scopeFilter(scope)
  const alerts: BusinessAlert[] = []

  // 1. Critical Receivables (> 60 days overdue or > 2,000 DT)
  const riskyReceivables = db.all<{
    customerName: string
    customerId: string
    agencyName: string
    overdueAmount: number
    daysOverdue: number
  }>(
    `SELECT c.name customerName, c.id customerId, a.name agencyName,
            sum(r.outstanding) overdueAmount,
            max(CAST(julianday(?) - julianday(r.due_date) AS INTEGER)) daysOverdue
       FROM receivables r
       JOIN customers c ON c.id = r.customer_id
       JOIN agencies a ON a.id = r.agency_id
      WHERE r.outstanding > 0 AND r.due_date < ? AND ${inScope("r.agency_id")}
      GROUP BY c.id
      HAVING overdueAmount > 1500 OR daysOverdue > 60
      ORDER BY overdueAmount DESC LIMIT 10`,
    asOf, asOf,
  )

  for (const r of riskyReceivables) {
    const id = `alert_recv_${r.customerId}`
    alerts.push({
      id,
      severity: r.daysOverdue > 90 || r.overdueAmount > 5000 ? "critical" : "warning",
      category: "receivables",
      title: "Créance client critique",
      subject: `Client ${r.customerName} (${r.agencyName})`,
      detail: `${round3(r.overdueAmount)} DT échus avec ${r.daysOverdue} jours de retard.`,
      threshold: "> 1 500 DT ou > 60 jours",
      detectedAt: asOf,
      entityType: "customer",
      entityId: r.customerId,
      acknowledged: acknowledgedAlerts.has(id),
      linkAction: { tab: "finance", filterKey: "customerId", filterValue: r.customerId },
    })
  }

  // 2. Critical Stockout / Below Reorder Point
  const lowStockItems = db.all<{
    productId: string
    sku: string
    productName: string
    agencyName: string
    qty: number
    reorderPoint: number
  }>(
    `SELECT p.id productId, p.sku, p.name productName, a.name agencyName,
            i.current_quantity qty, coalesce(i.reorder_point, p.reorder_point, 10) reorderPoint
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       JOIN agencies a ON a.id = i.agency_id
      WHERE i.current_quantity <= (coalesce(i.reorder_point, p.reorder_point, 10) / 2)
        AND ${inScope("i.agency_id")}
      ORDER BY (i.current_quantity / coalesce(i.reorder_point, p.reorder_point, 10)) ASC LIMIT 10`,
  )

  for (const item of lowStockItems) {
    const id = `alert_stock_${item.productId}_${item.agencyName}`
    alerts.push({
      id,
      severity: item.qty <= 0 ? "critical" : "warning",
      category: "stock",
      title: item.qty <= 0 ? "Rupture de stock imminente" : "Stock sous le seuil critique",
      subject: `${item.sku} — ${item.productName} (${item.agencyName})`,
      detail: `Quantité restante : ${round1(item.qty)} unités (seuil de sécurité : ${item.reorderPoint} u).`,
      threshold: "Quantité <= Seuil / 2",
      detectedAt: asOf,
      entityType: "product",
      entityId: item.productId,
      acknowledged: acknowledgedAlerts.has(id),
      linkAction: { tab: "inventory", filterKey: "productId", filterValue: item.productId },
    })
  }

  // 3. Significant Dead Stock Accumulation
  const deadStockItems = db.all<{
    productId: string
    sku: string
    productName: string
    agencyName: string
    val: number
    days: number | null
  }>(
    `SELECT p.id productId, p.sku, p.name productName, a.name agencyName,
            (i.current_quantity * i.unit_cost) val,
            CAST(julianday(?) - julianday((
              SELECT max(m.date) FROM stock_movements m
               WHERE m.product_id = i.product_id AND m.agency_id = i.agency_id AND m.type = 'sale'
            )) AS INTEGER) days
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       JOIN agencies a ON a.id = i.agency_id
      WHERE i.current_quantity > 0 AND ${inScope("i.agency_id")}
        AND (days > 180 OR days IS NULL) AND val > 2000
      ORDER BY val DESC LIMIT 8`,
    asOf,
  )

  for (const ds of deadStockItems) {
    const id = `alert_deadstock_${ds.productId}_${ds.agencyName}`
    alerts.push({
      id,
      severity: "warning",
      category: "stock",
      title: "Stock dormant de forte valeur",
      subject: `${ds.sku} — ${ds.productName} (${ds.agencyName})`,
      detail: `${round3(ds.val)} DT immobilisés sans vente depuis ${ds.days ?? "> 180"} jours.`,
      threshold: "> 180 j sans vente et valeur > 2 000 DT",
      detectedAt: asOf,
      entityType: "product",
      entityId: ds.productId,
      acknowledged: acknowledgedAlerts.has(id),
      linkAction: { tab: "inventory" },
    })
  }

  // 4. Negative Margin Sales Alert
  const negativeSales = db.all<{
    invoiceId: string
    invoiceNumber: string
    customerName: string
    loss: number
  }>(
    `SELECT s.id invoiceId, s.number invoiceNumber, c.name customerName,
            sum(l.line_cost - l.line_ht) loss
       FROM sales_invoice_lines l
       JOIN sales_invoices s ON s.id = l.sales_invoice_id
       JOIN customers c ON c.id = s.customer_id
      WHERE s.status = 'posted' AND s.doc_type = 'invoice' AND l.line_ht < l.line_cost
        AND ${inScope("s.agency_id")}
      GROUP BY s.id
      HAVING loss > 100
      ORDER BY loss DESC LIMIT 5`,
  )

  for (const ns of negativeSales) {
    const id = `alert_neg_sale_${ns.invoiceId}`
    alerts.push({
      id,
      severity: "critical",
      category: "margin",
      title: "Vente à marge négative constatée",
      subject: `Facture ${ns.invoiceNumber} — ${ns.customerName}`,
      detail: `Perte sèche de ${round3(ns.loss)} DT sur cette transaction. Prix unitaire inférieur au coût d'achat.`,
      threshold: "Marge brute < 0 (perte > 100 DT)",
      detectedAt: asOf,
      acknowledged: acknowledgedAlerts.has(id),
      linkAction: { tab: "profitability" },
    })
  }

  // Filter out acknowledged unless requested
  const visibleAlerts = includeAcknowledged ? alerts : alerts.filter((a) => !a.acknowledged)
  const criticalCount = visibleAlerts.filter((a) => a.severity === "critical").length

  return {
    alerts: visibleAlerts,
    totalCount: visibleAlerts.length,
    criticalCount,
  }
}
