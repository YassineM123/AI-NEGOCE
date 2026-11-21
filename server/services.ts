import {
  datasetMetadata,
  inventory,
  receivables,
  sales,
  type InventoryItem,
  type Receivable,
  type Sale,
} from "./data.js"
import type { AgencyScope } from "./auth.js"

export type Dataset = {
  sales: Sale[]
  receivables: Receivable[]
  inventory: InventoryItem[]
  metadata: typeof datasetMetadata
}
export const defaultDataset = (): Dataset => ({
  sales,
  receivables,
  inventory,
  metadata: datasetMetadata,
})

/** agencies: "*" or undefined = every agency; a list = only those agencies. */
export type Filters = { agencies?: AgencyScope; from?: string; to?: string }

// Money is summed in integer millimes (1 TND = 1000 millimes): binary floating
// point would otherwise drift (0.1 x 10 = 0.9999999999999999).
const toM = (x: number) => Math.round(x * 1000)
const fromM = (m: number) => m / 1000
const tnd = (m: number) => fromM(m).toFixed(3)

const inScope = (agency: string, f: Filters) =>
  !f.agencies || f.agencies === "*" || f.agencies.includes(agency)
const inPeriod = (date: string, f: Filters) =>
  (!f.from || date >= f.from) && (!f.to || date <= f.to)
const asOf = (data: Dataset) =>
  data.metadata.asOf ?? new Date().toISOString().slice(0, 10)

/** Posted (non-cancelled) fact rows in scope and period. */
export function filteredSales(f: Filters = {}, data = defaultDataset()) {
  return data.sales.filter(
    (s) =>
      (s.status ?? "posted") === "posted" &&
      inScope(s.agency, f) &&
      inPeriod(s.date, f),
  )
}

function totals(rows: Sale[]) {
  let revenue = 0
  let costedRevenue = 0
  let cost = 0
  let missingCost = 0
  for (const r of rows) {
    revenue += toM(r.revenue)
    // An unknown cost is excluded from the margin, never read as 0.
    if (r.cost === null || r.cost === undefined) missingCost++
    else {
      cost += toM(r.cost)
      costedRevenue += toM(r.revenue)
    }
  }
  const margin = costedRevenue - cost
  return {
    revenue,
    cost,
    margin,
    marginPercent: costedRevenue ? (margin / costedRevenue) * 100 : null,
    missingCost,
  }
}

export function overview(f: Filters = {}, data = defaultDataset()) {
  const rows = filteredSales(f, data)
  const t = totals(rows)
  const today = asOf(data)
  let open = 0
  let overdue = 0
  for (const r of data.receivables)
    if (inScope(r.agency, f) && inPeriod(r.date, f)) {
      open += toM(r.outstanding)
      if (r.dueDate < today) overdue += toM(r.outstanding)
    }
  const inventoryValue = data.inventory
    .filter((i) => inScope(i.agency, f))
    .reduce((sum, i) => sum + i.quantity * toM(i.unitCost), 0)
  return {
    revenue: fromM(t.revenue),
    cost: fromM(t.cost),
    grossMargin: fromM(t.margin),
    grossMarginPercent: t.marginPercent,
    receivables: fromM(open),
    overdue: fromM(overdue),
    inventoryValue: fromM(inventoryValue),
    recordCount: new Set(rows.map((r) => r.invoiceId)).size,
    missingCostRecords: t.missingCost,
    marginCoverage: !t.missingCost
      ? "complete"
      : t.missingCost === rows.length
        ? "none"
        : "partial",
    filters: f,
    metadata: { ...data.metadata, asOf: today },
  }
}

function group(rows: Sale[], key: "agency" | "customer" | "product") {
  // Group by stable id when the source provides one: two customers can share a name.
  const idOf = (row: Sale) =>
    key === "customer" ? row.customerId ?? row.customer : key === "product" ? row.productId ?? row.product : row.agency
  const acc = new Map<string, Sale[]>()
  for (const row of rows) {
    const list = acc.get(idOf(row))
    if (list) list.push(row)
    else acc.set(idOf(row), [row])
  }
  return [...acc.entries()]
    .map(([id, rs]) => {
      const t = totals(rs)
      return {
        id,
        label: rs[0][key],
        revenue: fromM(t.revenue),
        cost: fromM(t.cost),
        margin: fromM(t.margin),
        marginPercent: t.marginPercent,
        records: [...new Set(rs.map((r) => r.invoiceId))],
      }
    })
    .sort((a, b) => b.revenue - a.revenue || a.label.localeCompare(b.label))
}

// ---------------- Copilot: governed, deterministic tool router ----------------

export type CopilotRequest = {
  scope: AgencyScope
  /** agency explicitly chosen in the request filters (not the default scope) */
  explicitAgency?: string
  from?: string
  to?: string
}
export type CopilotContext = { previousQuestion?: string }

// Accents are stripped before matching so that ASCII \b word boundaries are reliable.
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’`]/g, "'")
    .toLocaleLowerCase("fr")

const HR = /\b(salaires?|paie|fiches? de paie|employes?|rh|ressources humaines|remunerations?)\b/
const OUT_OF_DOMAIN = /\b(fournisseurs?|budgets?|previsionnel|previsions?|taux de change|objectifs?|meteo)\b/
const TREND = /\b(tendances?|evolutions?|mois par mois)\b/
const NATURAL_PERIOD = /\b(19|20)\d{2}\b|\b(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|semestre|trimestre)\b/
const RECEIVABLES = /\b(creances?|impayes?|non paye(?:e|s|es)?|retards?|encours|recouvrement|paiements?|doi(?:ven)?t|echu(?:e|s|es)?|echeances?|soldes? clients?)\b/
const AGING = /\b(plus de \d+ jours|anciennete|balance agee|vieillissement)\b/
const PAYMENT_DELAY = /\b(delais? (?:moyens? )?(?:de )?paiement|paiement moyen)\b/
const STOCK_VALUE = /valeur du stock|valorisation du stock|valeur de stock/
const DORMANT = /\bdormants?\b/
const LOW_STOCK = /\b(stocks?|reappro\w*|ruptures?|seuils?)\b/
const PRODUCT_LEVEL = /\b(produits?|articles?|references?)\b/
const COMPARISON = /\b(compare\w*|comparaison|agences|quelle agence|performance par agence|meilleur(?:e|es|s)? que|moins bon(?:ne|nes|s)? que)\b/
const CUSTOMERS = /\bclients?\b/
const KPI = /\b(marges?|chiffre d'affaires|chiffre d affaires|chiffre daffaires|ca|ventes?|rentabilite|resultats?)\b/
// Words that may follow "de"/"avec" and are not entity names.
const NOT_ENTITY = new Set(["Tunisie", "TND", "HT", "TTC", "TVA", "CA"])
const FOLLOW_UP = /^\s*(et|compare avec)\b/

type Intent =
  | "low_stock"
  | "inventory_value"
  | "receivables"
  | "agency_comparison"
  | "top_customers"
  | "kpi_overview"
  | "dormant"
  | "product_level"
  | "none"

function intentOf(q: string): Intent {
  if (RECEIVABLES.test(q)) return "receivables"
  if (STOCK_VALUE.test(q)) return "inventory_value"
  if (DORMANT.test(q)) return "dormant"
  if (LOW_STOCK.test(q)) return "low_stock"
  if (PRODUCT_LEVEL.test(q) && KPI.test(q)) return "product_level"
  if (COMPARISON.test(q)) return "agency_comparison"
  if (CUSTOMERS.test(q)) return "top_customers"
  if (KPI.test(q)) return "kpi_overview"
  return "none"
}

function knownAgencies(data: Dataset) {
  return [
    ...new Set([
      ...data.sales.map((s) => s.agency),
      ...data.inventory.map((i) => i.agency),
      ...data.receivables.map((r) => r.agency),
    ]),
  ]
}

/** Agencies named in the question; "Tunis" matches "Tunis Centre". */
function mentionedAgencies(q: string, agencies: string[]) {
  return agencies
    .map((a) => {
      const full = norm(a)
      const first = full.split(" ")[0]
      const at = q.indexOf(full)
      const m = at >= 0 ? at : first.length >= 4 ? q.search(new RegExp(`\\b${first}\\b`)) : -1
      return { a, at: m }
    })
    .filter((x) => x.at >= 0)
    .sort((x, y) => x.at - y.at)
    .map((x) => x.a)
}

export function groundedAnswer(
  question: string,
  req: CopilotRequest = { scope: "*" },
  data = defaultDataset(),
  context: CopilotContext = {},
) {
  const filters = { agencies: req.scope, from: req.from, to: req.to }
  const reply = (
    status: "ok" | "denied" | "unsupported",
    tool: string,
    answer: string,
    extra: { table?: unknown[]; sources?: string[] } = {},
  ) => ({
    status,
    tool,
    // Every figure states the scope it covers, so a misread question is visible.
    answer:
      status === "ok"
        ? `${answer} Périmètre : ${filters.agencies === "*" ? "toutes les agences" : filters.agencies.join(", ")} ; période : ${filters.from || filters.to ? `${filters.from ?? "début"} → ${filters.to ?? "fin"}` : "toutes dates"}.`
        : answer,
    table: extra.table ?? [],
    sources: extra.sources ?? [],
    filters,
    metadata: data.metadata,
  })
  const unsupported = (why: string) =>
    reply("unsupported", "none", `Je ne peux pas répondre à partir des données ERP autorisées : ${why}`)

  const q = norm(question)
  if (HR.test(q))
    return reply("denied", "guard", "Cette demande concerne des données RH non autorisées pour votre rôle.")

  const agencies = knownAgencies(data)
  const unknownAgency = q.match(/\bagence (?:de |d')([a-z-]+)/)?.[1]
  if (unknownAgency && !agencies.some((a) => norm(a).split(" ")[0] === unknownAgency))
    return unsupported(`l'agence « ${unknownAgency} » est inconnue.`)
  if (OUT_OF_DOMAIN.test(q))
    return unsupported("ce sujet (fournisseurs, budgets, prévisions, change, objectifs…) n'est pas exposé au Copilot.")
  if (TREND.test(q))
    return unsupported("l'analyse de tendance mensuelle n'est pas disponible ; utilisez le tableau BI 360.")
  if (NATURAL_PERIOD.test(q))
    return unsupported("précisez la période via les filtres de date (du / au) ; les périodes en texte libre ne sont pas interprétées.")
  if (AGING.test(q))
    return unsupported("la balance âgée des créances n'est pas disponible ; seuls l'encours total et la part échue sont calculés.")
  if (PAYMENT_DELAY.test(q))
    return unsupported("le délai moyen de paiement n'est pas disponible dans les données ERP exposées.")
  if (LOW_STOCK.test(q) && /\b(disponible|pour (?:les?|la|l'))\b/.test(q))
    return unsupported("le stock détaillé par produit nommé n'est pas exposé au Copilot ; utilisez le tableau BI 360.")
  // A named entity the router cannot resolve must never fall back to company-wide figures.
  for (const m of question.matchAll(/(?:\b(?:de|du|avec|chez|pour|à)\s+|\bd['’])(\p{Lu}[\p{L}-]*(?:\s+\p{Lu}[\p{L}-]*)*)/gu)) {
    const name = m[1]
    const known = agencies.some((a) => norm(a) === norm(name) || norm(a).split(" ")[0] === norm(name).split(" ")[0])
    if (!known && !NOT_ENTITY.has(name))
      return unsupported(`« ${name} » n'est ni une agence connue ni un périmètre interrogeable (les analyses par client ou produit nommé ne sont pas exposées).`)
  }

  // Minimal follow-up support: "Et la marge ?", "Et à Bizerte ?", "Compare avec Sfax".
  const prev = context.previousQuestion ? norm(context.previousQuestion) : undefined
  const followUp = !!prev && FOLLOW_UP.test(q)
  let mentioned = mentionedAgencies(q, agencies)
  let intent = intentOf(q)
  if (followUp) {
    const prevMentioned = mentionedAgencies(prev!, agencies)
    if (/^\s*compare avec\b/.test(q)) {
      mentioned = [...new Set([...prevMentioned, ...mentioned])]
      intent = "agency_comparison"
    } else {
      if (!mentioned.length) mentioned = prevMentioned
      if (intent === "none") intent = intentOf(prev!)
    }
  }

  if (req.explicitAgency && mentioned.length && !mentioned.includes(req.explicitAgency))
    return unsupported(`la question cite ${mentioned.join(", ")} alors que le filtre demande ${req.explicitAgency}. Précisez l'agence.`)
  const outside = mentioned.filter((a) => req.scope !== "*" && !req.scope.includes(a))
  if (outside.length)
    return reply("denied", "guard", `Accès refusé : ${outside.join(", ")} est hors de votre périmètre d'agences.`)
  const scope: AgencyScope = mentioned.length ? mentioned : req.scope
  const f: Filters = { agencies: scope, from: req.from, to: req.to }
  filters.agencies = scope

  if (intent === "none") return unsupported("question non reconnue. Reformulez (CA, marge, clients, agences, stock, créances).")
  if (intent === "dormant")
    return unsupported("le stock dormant n'est pas calculé (dates de dernière vente absentes du modèle BI).")
  if (intent === "product_level")
    return unsupported("l'analyse par produit n'est pas exposée au Copilot ; utilisez le tableau BI 360.")

  if (intent === "low_stock") {
    const low = data.inventory.filter((i) => inScope(i.agency, f) && i.quantity <= i.reorderPoint)
    return reply("ok", "low_stock", `${low.length} produit(s) sont au niveau ou sous le seuil de réapprovisionnement.`, {
      table: low,
      sources: low.map((x) => x.reference),
    })
  }
  if (intent === "inventory_value") {
    const k = overview(f, data)
    const items = data.inventory.filter((i) => inScope(i.agency, f))
    return reply("ok", "inventory_value", `La valeur du stock est de ${k.inventoryValue.toFixed(3)} TND (${items.length} ligne(s) de stock, coût unitaire standard).`, {
      table: items,
      sources: items.map((x) => x.reference),
    })
  }
  if (intent === "receivables") {
    const k = overview(f, data)
    const open = data.receivables
      .filter((r) => inScope(r.agency, f) && inPeriod(r.date, f) && r.outstanding > 0)
      .sort((a, b) => b.outstanding - a.outstanding || a.invoiceId.localeCompare(b.invoiceId))
    return reply("ok", "receivables", `Les créances clients s'élèvent à ${k.receivables.toFixed(3)} TND sur ${open.length} facture(s) ouverte(s), dont ${k.overdue.toFixed(3)} TND échus au ${k.metadata.asOf}.`, {
      table: open,
      sources: open.map((r) => r.invoiceId),
    })
  }

  const rows = filteredSales(f, data)
  if (intent === "agency_comparison") {
    const ranked = group(rows, "agency")
    const byMargin = /\bmarges?\b/.test(q)
    const ascending = /(plus faible|moins|pire)/.test(q)
    ranked.sort((a, b) => (byMargin ? a.margin - b.margin : a.revenue - b.revenue) * (ascending ? 1 : -1) || a.label.localeCompare(b.label))
    const lines = ranked.map((r, i) => `${i + 1}. ${r.label} — CA ${r.revenue.toFixed(3)} TND, marge ${r.margin.toFixed(3)} TND${r.marginPercent === null ? "" : ` (${r.marginPercent.toFixed(1)} %)`}`)
    return reply("ok", "agency_comparison", ranked.length ? `Comparaison sur ${new Set(rows.map((r) => r.invoiceId)).size} document(s), classée par ${byMargin ? "marge" : "chiffre d'affaires"} : ${lines.join(" ; ")}.` : "Aucune vente ne correspond aux filtres.", {
      table: ranked,
      sources: ranked.flatMap((x) => x.records),
    })
  }
  if (intent === "top_customers") {
    const ranked = group(rows, "customer")
    return reply("ok", "top_customers", ranked.length ? `${ranked[0].label} est le premier client du périmètre avec ${ranked[0].revenue.toFixed(3)} TND de chiffre d'affaires HT (${ranked[0].records.length} document(s)).` : "Aucune vente ne correspond aux filtres.", {
      table: ranked,
      sources: ranked.flatMap((x) => x.records),
    })
  }
  const t = totals(rows)
  const docs = [...new Set(rows.map((r) => r.invoiceId))]
  if (!docs.length)
    return reply("ok", "kpi_overview", `Aucune vente sur le périmètre et la période demandés (chiffre d'affaires HT ${tnd(0)} TND).`)
  return reply(
    "ok",
    "kpi_overview",
    `Chiffre d'affaires HT : ${tnd(t.revenue)} TND ; marge brute : ${tnd(t.margin)} TND${t.marginPercent === null ? "" : `, soit ${t.marginPercent.toFixed(1)} %`} (${docs.length} document(s)${t.missingCost ? `, ${t.missingCost} ligne(s) sans coût exclue(s) de la marge` : ""}).`,
    { table: group(rows, "product"), sources: docs },
  )
}
