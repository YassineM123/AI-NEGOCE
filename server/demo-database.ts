/**
 * Read-only, opt-in Phase 2 demonstration adapter for pseudonymized IAINEG CSV
 * extracts. Source SQL is NOT reconciled with an official ERP closing report.
 *
 * Never add currencies together or manufacture COGS, invoice due dates, agency
 * mapping, product-to-invoice joins, or stock unit costs not present in source.
 * The source files in Database/extractions are not modified by this adapter.
 */
import fs from "node:fs"
import path from "node:path"
import type { Dataset } from "./services.js"
import type { Sale } from "./data.js"

export const DEMO_EXTRACT_ROOT = path.resolve("Database/extractions")
export const UNATTRIBUTED_AGENCY = "Non ventilée (extraction)"
export const DEMO_EXTRACT_SOURCE =
  "IAINEG / Database/extractions — pseudonymisé, SQL à rapprocher, ventes TND seules"

function parseCsv(text: string): Array<Record<string, string>> {
  const records: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  const input = text.replace(/^\uFEFF/, "")
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (c === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (c === ";" && !quoted) {
      row.push(cell); cell = ""
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && input[i + 1] === "\n") i++
      row.push(cell)
      if (row.some((v) => v.length)) records.push(row)
      row = []; cell = ""
    } else {
      cell += c
    }
  }
  if (quoted) throw new Error("Demo CSV: unclosed quoted field")
  if (cell || row.length) { row.push(cell); records.push(row) }
  const headings = records.shift()
  if (!headings || new Set(headings).size !== headings.length)
    throw new Error("Demo CSV: missing or duplicate column names")
  return records.map((values, index) => {
    if (values.length !== headings.length)
      throw new Error("Demo CSV: invalid column count on record " + (index + 2))
    return Object.fromEntries(headings.map((key, i) => [key, values[i]]))
  })
}

function readTable(root: string, relative: string, required: string[]) {
  // Fixed allow-listed paths; never accept an API-supplied file name.
  const records = parseCsv(fs.readFileSync(path.join(root, relative), "utf8"))
  if (!records.length) throw new Error("Empty demo source: " + relative)
  for (const col of required)
    if (!Object.prototype.hasOwnProperty.call(records[0], col))
      throw new Error("Missing column " + col + " in " + relative)
  return records
}

function milli(raw: string, label: string): number {
  // No binary floating-point accumulation; 1 TND = 1000 millimes.
  const match = /^(-?)(\d+)(?:[,.](\d{1,3}))?$/.exec(raw.trim())
  if (!match) throw new Error("Invalid decimal in demo source: " + label)
  const value = (Number(match[2]) * 1000 + Number((match[3] ?? "").padEnd(3, "0"))) *
    (match[1] ? -1 : 1)
  if (!Number.isSafeInteger(value)) throw new Error("Unsafe decimal in demo source: " + label)
  return value
}

export interface ExtractQuality {
  schemaVersion: 1
  demoOnly: true
  source: "IAINEG_pseudonymized_csv"
  sqlReconciled: false
  dateOfExtraction: "2026-11-19"
  asOf: string
  sales: {
    totalDocuments: number
    distinctDocuments: number
    currencies: Record<string, { documents: number; totalHt: string }>
    tndDocumentsUsedForSharedAnalytics: number
    clients: number
    agencyAttributionAvailable: false
    invoiceLineCostsAvailable: false
  }
  inventory: {
    rows: number
    rowsWithoutPmpValue: number
    rowsWithoutAvailableQuantity: number
  }
  receivables: {
    agingRows: number
    clients: number
    dueDatesAtInvoiceGrainAvailable: false
  }
  profit: { monthDepotRows: number; invoiceLevelMarginAvailable: false }
  syntheticComplements: string[]
  warnings: string[]
}

export function loadExtractedDemo(root = DEMO_EXTRACT_ROOT): {
  dataset: Dataset
  quality: ExtractQuality
} {
  const journal = readTable(root, "ventes/journal_ventes_2026_demo.csv", [
    "date_facture", "document_id", "client_id", "montant_ht", "devise",
  ])
  const clients = readTable(root, "ventes/ca_clients_2026.csv", ["client_id"])
  const stock = readTable(root, "stock/stock_disponible_demo.csv", [
    "depot_id", "article_id", "disponible_calcule", "valeur_pmp",
  ])
  const aging = readTable(root, "recouvrement/creances_agees_demo.csv", [
    "client_id", "tranche_age", "solde",
  ])
  const margin = readTable(root, "marge/marge_mensuelle_2026.csv", [
    "mois", "depot_id", "marge_brute",
  ])
  const ids = new Set<string>()
  const grouped = new Map<string, { count: number; milliHt: number }>()
  const sales: Sale[] = []
  let asOf = ""
  for (const row of journal) {
    if (!/^[0-9a-f]{16}$/i.test(row.document_id) || ids.has(row.document_id))
      throw new Error("Duplicate or invalid pseudonymized document_id")
    ids.add(row.document_id)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date_facture) ||
      Number.isNaN(Date.parse(row.date_facture + "T00:00:00Z")))
      throw new Error("Invalid sales date")
    asOf = row.date_facture > asOf ? row.date_facture : asOf
    const htMilli = milli(row.montant_ht, "montant_ht")
    const ccy = row.devise.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(ccy)) throw new Error("Invalid currency code")
    const prev = grouped.get(ccy) ?? { count: 0, milliHt: 0 }
    prev.count++; prev.milliHt += htMilli
    grouped.set(ccy, prev)
    if (ccy !== "TND") continue
    if (!/^[0-9a-f]{12}$/i.test(row.client_id))
      throw new Error("Invalid pseudonymized client_id")
    sales.push({
      id: row.document_id,
      invoiceId: row.document_id,
      date: row.date_facture,
      agency: UNATTRIBUTED_AGENCY,
      customer: "Client " + row.client_id.slice(0, 8),
      customerId: row.client_id,
      product: "Article inconnu (grain document)",
      family: "Non renseignée",
      representative: "Non renseigné",
      revenue: htMilli / 1000,
      cost: null,
    })
  }
  const currencies = Object.fromEntries([...grouped].sort(([a], [b]) =>
    a.localeCompare(b)).map(([ccy, v]) => [ccy, {
    documents: v.count, totalHt: (v.milliHt / 1000).toFixed(3),
  }]))
  const knownClientIds = new Set(clients.map((r) => r.client_id))
  const absentCustomers = new Set(journal.filter((r) => !knownClientIds.has(r.client_id))
    .map((r) => r.client_id)).size
  const warnings = [
    "Démonstration : chiffres IAINEG pseudonymisés, SQL à rapprocher avec les éditions officielles.",
    "Le journal contient EUR/USD/TND ; seuls les documents TND alimentent les KPI et agents communs.",
    "Pas de dépôt/agence dans le journal : aucune ventilation par agence n'est inventée.",
    "Coûts par ligne, dates d'échéance par facture et PMP de stock non disponibles : pas de marge, DSO ou valeur de stock fictifs.",
    "Les scénarios du sous-dossier demonstration sont synthétiques et ne sont pas joints aux identifiants IAINEG.",
  ]
  if (absentCustomers) warnings.push(absentCustomers + " clients du journal absents de ca_clients_2026")
  const quality: ExtractQuality = {
    schemaVersion: 1,
    demoOnly: true,
    source: "IAINEG_pseudonymized_csv",
    sqlReconciled: false,
    dateOfExtraction: "2026-11-19",
    asOf,
    sales: {
      totalDocuments: journal.length,
      distinctDocuments: ids.size,
      currencies,
      tndDocumentsUsedForSharedAnalytics: sales.length,
      clients: knownClientIds.size,
      agencyAttributionAvailable: false,
      invoiceLineCostsAvailable: false,
    },
    inventory: {
      rows: stock.length,
      rowsWithoutPmpValue: stock.filter((r) => !r.valeur_pmp.trim()).length,
      rowsWithoutAvailableQuantity: stock.filter((r) => !r.disponible_calcule.trim()).length,
    },
    receivables: {
      agingRows: aging.length,
      clients: new Set(aging.map((r) => r.client_id)).size,
      dueDatesAtInvoiceGrainAvailable: false,
    },
    profit: { monthDepotRows: margin.length, invoiceLevelMarginAvailable: false },
    syntheticComplements: [
      "demonstration/commandes_devis_demo.csv",
      "demonstration/paquets_demo.csv",
      "demonstration/promotions_prix_demo.csv",
      "demonstration/scoring_demo.csv",
      "demonstration/fournisseurs_livraisons_demo_synthetique.csv",
      "demonstration/plan_tresorerie_demo_synthetique.csv",
    ],
    warnings,
  }
  const dataset: Dataset = {
    sales,
    // The raw extracts only contain aging aggregates and almost no PMP.
    // Never fabricate invoice dates or unit costs to satisfy existing agent contracts.
    receivables: [],
    inventory: [],
    metadata: {
      adapter: "test",
      source: DEMO_EXTRACT_SOURCE,
      currency: "TND",
      lastUpdated: "2026-11-19T00:00:00.000Z",
      asOf,
    },
  }
  return { dataset, quality }
}

/** Independently validate fictional purchasing/cash-flow scenarios.
 * They are deliberately NOT merged into the IAINEG analytics Dataset. */
export function verifySyntheticComplements(root = DEMO_EXTRACT_ROOT) {
  const deliveries = readTable(root,
    "demonstration/fournisseurs_livraisons_demo_synthetique.csv",
    ["commande_id", "quantite_commandee", "quantite_recue", "date_reception", "etat"])
  const treasury = readTable(root,
    "demonstration/plan_tresorerie_demo_synthetique.csv",
    ["mois", "scenario", "solde_initial_tnd", "encaissements_prevus_tnd",
      "decaissements_prevus_tnd", "solde_final_tnd"])
  const orders = new Set<string>()
  for (const row of deliveries) {
    if (orders.has(row.commande_id)) throw new Error("Duplicate fictional purchase order")
    orders.add(row.commande_id)
    const ordered = milli(row.quantite_commandee, "ordered quantity")
    const received = milli(row.quantite_recue, "received quantity")
    if (received < 0 || ordered < received) throw new Error("Invalid fictional delivery quantities")
    if (row.etat === "attente" && (received !== 0 || row.date_reception))
      throw new Error("Pending fictional delivery has already been received")
    if (row.etat !== "attente" && !row.date_reception)
      throw new Error("Fictional delivery has no receipt date")
  }
  let priorMonth = ""
  let priorClose: number | null = null
  for (const row of treasury) {
    if (row.scenario !== "hypothese_base" || row.mois <= priorMonth)
      throw new Error("Fictional cash plan must be sorted and isolated to one scenario")
    const opening = milli(row.solde_initial_tnd, "opening cash")
    const inflows = milli(row.encaissements_prevus_tnd, "cash inflows")
    const outflows = milli(row.decaissements_prevus_tnd, "cash outflows")
    const closing = milli(row.solde_final_tnd, "closing cash")
    if (opening + inflows - outflows !== closing ||
      (priorClose !== null && opening !== priorClose))
      throw new Error("Fictional cash plan does not reconcile")
    priorMonth = row.mois
    priorClose = closing
  }
  return { demoOnly: true as const, source: "synthetic_scenarios" as const,
    supplierDeliveries: deliveries.length, cashPlanMonths: treasury.length }
}
