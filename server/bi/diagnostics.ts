import type { AgencyScope } from "../auth.js"
import { ErpDatabase } from "../erp-db.js"
import {
  calcPctChange,
  round1,
  round3,
  safeDiv,
  safePct,
  resolvePeriodDates,
  buildFilterClauses,
} from "./semantic.js"
import type { BiUniversalFilters, DiagnosticsResponse } from "./types.js"

export function computeDiagnostics(
  db: ErpDatabase,
  scope: AgencyScope,
  filters: BiUniversalFilters = {},
): DiagnosticsResponse {
  const { asOf, range, previousRange } = resolvePeriodDates(db, filters.period ?? "year", filters.from, filters.to)
  const prevRange = previousRange ?? { from: "2024-01-01", to: "2024-12-31" }
  const inScope = db.scopeFilter(scope)

  const curClause = buildFilterClauses(db, scope, { ...filters, from: range.from, to: range.to }, {
    agencyCol: "s.agency_id",
    dateCol: "s.invoice_date",
  })
  const prevClause = buildFilterClauses(db, scope, { ...filters, from: prevRange.from, to: prevRange.to }, {
    agencyCol: "s.agency_id",
    dateCol: "s.invoice_date",
  })

  // 1. Diagnostic: "Pourquoi la marge a-t-elle varié ?"
  const curMarginTot = db.one<{ rev: number; cost: number }>(
    `SELECT coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END), 0) rev,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END), 0) cost
       FROM sales_invoices s
       JOIN sales_invoice_lines l ON l.sales_invoice_id = s.id
      WHERE s.status = 'posted' AND ${curClause.whereClause}`,
    ...curClause.params,
  )

  const prevMarginTot = db.one<{ rev: number; cost: number }>(
    `SELECT coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_ht ELSE l.line_ht END), 0) rev,
            coalesce(sum(CASE s.doc_type WHEN 'credit_note' THEN -l.line_cost ELSE l.line_cost END), 0) cost
       FROM sales_invoices s
       JOIN sales_invoice_lines l ON l.sales_invoice_id = s.id
      WHERE s.status = 'posted' AND ${prevClause.whereClause}`,
    ...prevClause.params,
  )

  const curMargin = round3(curMarginTot.rev - curMarginTot.cost)
  const prevMargin = round3(prevMarginTot.rev - prevMarginTot.cost)
  const marginDelta = round3(curMargin - prevMargin)

  // Top products contributing to margin drop
  const dropProducts = db.all<{
    sku: string
    name: string
    curM: number
    prevM: number
  }>(
    `SELECT p.sku, p.name,
            coalesce(sum(CASE WHEN s.invoice_date BETWEEN ? AND ? THEN CASE s.doc_type WHEN 'credit_note' THEN -(l.line_ht - l.line_cost) ELSE (l.line_ht - l.line_cost) END END), 0) curM,
            coalesce(sum(CASE WHEN s.invoice_date BETWEEN ? AND ? THEN CASE s.doc_type WHEN 'credit_note' THEN -(l.line_ht - l.line_cost) ELSE (l.line_ht - l.line_cost) END END), 0) prevM
       FROM products p
       JOIN sales_invoice_lines l ON l.product_id = p.id
       JOIN sales_invoices s ON s.id = l.sales_invoice_id
      WHERE s.status = 'posted' AND ${inScope("s.agency_id")}
      GROUP BY p.id
      HAVING (curM - prevM) < 0
      ORDER BY (curM - prevM) ASC LIMIT 5`,
    range.from, range.to, prevRange.from, prevRange.to,
  )

  // 2. Diagnostic: "Quels fournisseurs ont augmenté leurs prix ?"
  const supplierHikes = db.all<{
    supplierName: string
    productName: string
    oldCost: number
    newCost: number
    totalImpact: number
  }>(
    `SELECT sup.name supplierName, p.name productName,
            min(l.unit_cost) oldCost, max(l.unit_cost) newCost,
            sum((l.unit_cost - (SELECT min(l2.unit_cost) FROM supplier_invoice_lines l2 JOIN supplier_invoices f2 ON f2.id = l2.supplier_invoice_id WHERE l2.product_id = p.id AND f2.supplier_id = sup.id)) * l.quantity) totalImpact
       FROM supplier_invoice_lines l
       JOIN supplier_invoices f ON f.id = l.supplier_invoice_id
       JOIN suppliers sup ON sup.id = f.supplier_id
       JOIN products p ON p.id = l.product_id
      WHERE f.status != 'cancelled' AND f.invoice_date BETWEEN ? AND ? AND ${inScope("f.agency_id")}
      GROUP BY sup.id, p.id
      HAVING newCost > oldCost * 1.04
      ORDER BY totalImpact DESC LIMIT 5`,
    range.from, range.to,
  )

  // 3. Diagnostic: "Pourquoi le stock dormant augmente ?"
  const dormantSummary = db.one<{ totalDormant: number; totalItems: number }>(
    `SELECT coalesce(sum(i.current_quantity * i.unit_cost), 0) totalDormant, count(*) totalItems
       FROM inventory i
       JOIN products p ON p.id = i.product_id
      WHERE i.current_quantity > 0 AND ${inScope("i.agency_id")}
        AND (julianday(?) - julianday((
          SELECT max(m.date) FROM stock_movements m
           WHERE m.product_id = i.product_id AND m.agency_id = i.agency_id AND m.type = 'sale'
        )) > 180 OR (SELECT max(m2.date) FROM stock_movements m2 WHERE m2.product_id = i.product_id AND m2.agency_id = i.agency_id AND m2.type = 'sale') IS NULL)`,
    asOf,
  )

  const topDormantContributors = db.all<{
    sku: string
    name: string
    valuation: number
    days: number | null
  }>(
    `SELECT p.sku, p.name,
            (i.current_quantity * i.unit_cost) valuation,
            CAST(julianday(?) - julianday((SELECT max(m.date) FROM stock_movements m WHERE m.product_id = i.product_id AND m.agency_id = i.agency_id AND m.type = 'sale')) AS INTEGER) days
       FROM inventory i
       JOIN products p ON p.id = i.product_id
      WHERE i.current_quantity > 0 AND ${inScope("i.agency_id")}
        AND (julianday(?) - julianday((SELECT max(m.date) FROM stock_movements m WHERE m.product_id = i.product_id AND m.agency_id = i.agency_id AND m.type = 'sale')) > 180 OR (SELECT max(m.date) FROM stock_movements m WHERE m.product_id = i.product_id AND m.agency_id = i.agency_id AND m.type = 'sale') IS NULL)
      ORDER BY valuation DESC LIMIT 5`,
    asOf, asOf,
  )

  const diagnostics: DiagnosticsResponse["diagnostics"] = [
    {
      id: "diag_margin_variation",
      question: "Pourquoi la marge a-t-elle varié ?",
      executiveSummary: marginDelta < 0
        ? `La marge brute globale a reculé de ${round3(Math.abs(marginDelta))} DT par rapport à la période N-1 (${calcPctChange(curMargin, prevMargin)} %).`
        : `La marge brute a progressé de +${round3(marginDelta)} DT (+${calcPctChange(curMargin, prevMargin)} %) vs N-1.`,
      initialValue: prevMargin,
      finalValue: curMargin,
      variation: marginDelta,
      variationPct: calcPctChange(curMargin, prevMargin),
      contributors: dropProducts.map((dp) => {
        const drop = round3(dp.curM - dp.prevM)
        return {
          dimension: "Produit",
          name: `${dp.sku} — ${dp.name}`,
          contribution: drop,
          pctOfTotalVariation: marginDelta !== 0 ? Math.abs(round1((drop / marginDelta) * 100) ?? 0) : 0,
          explanation: `Marge passée de ${round3(dp.prevM)} DT à ${round3(dp.curM)} DT`,
        }
      }),
      methodology: "Décomposition déterministe par produit comparé à la même période de l'année précédente (N-1).",
      confidence: "deterministic",
    },
    {
      id: "diag_supplier_inflation",
      question: "Quels fournisseurs ont augmenté leurs prix d'achat ?",
      executiveSummary: supplierHikes.length > 0
        ? `${supplierHikes.length} hausses tarifaires majeures (> 4 %) ont été enregistrées sur les lignes de factures d'achat.`
        : "Stabilité des prix d'achats constatée sur l'ensemble du catalogue fournisseurs.",
      initialValue: 0,
      finalValue: round3(supplierHikes.reduce((s, h) => s + h.totalImpact, 0)),
      variation: round3(supplierHikes.reduce((s, h) => s + h.totalImpact, 0)),
      variationPct: null,
      contributors: supplierHikes.map((h) => ({
        dimension: "Fournisseur",
        name: `${h.supplierName} (${h.productName})`,
        contribution: round3(h.totalImpact),
        pctOfTotalVariation: 0,
        explanation: `Prix unitaire passé de ${round3(h.oldCost)} DT à ${round3(h.newCost)} DT (+${round1(((h.newCost - h.oldCost) / h.oldCost) * 100)} %)`,
      })),
      methodology: "Comparaison des coûts unitaires d'achat historiques enregistrés dans les factures fournisseurs de la période.",
      confidence: "deterministic",
    },
    {
      id: "diag_dormant_stock_reasons",
      question: "Pourquoi le stock dormant s'accumule-t-il ?",
      executiveSummary: `${dormantSummary.totalItems} références totalisent ${round3(dormantSummary.totalDormant)} DT d'actifs immobilisés sans vente depuis plus de 6 mois.`,
      initialValue: 0,
      finalValue: round3(dormantSummary.totalDormant),
      variation: round3(dormantSummary.totalDormant),
      variationPct: null,
      contributors: topDormantContributors.map((c) => ({
        dimension: "Article en stock",
        name: `${c.sku} — ${c.name}`,
        contribution: round3(c.valuation),
        pctOfTotalVariation: dormantSummary.totalDormant > 0 ? round1((c.valuation / dormantSummary.totalDormant) * 100) ?? 0 : 0,
        explanation: c.days !== null ? `${c.days} jours sans mouvement de vente` : "Jamais vendu depuis la création",
      })),
      methodology: "Calcul de l'ancienneté du dernier mouvement de type 'sale' dans la table stock_movements.",
      confidence: "deterministic",
    },
  ]

  return {
    asOf,
    range,
    previousRange: prevRange,
    diagnostics,
  }
}
