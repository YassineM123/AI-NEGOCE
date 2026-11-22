import type { AgencyScope } from "../auth.js"
import { analyzeReceivablesAging } from "./decision-support.js"
import {collectionReviewQueue} from "./specialist-action-plans.js"
import type { Dataset } from "../services.js"
import {
  amount, daysBetween, ensureLimit, finding, percent, receivablesInScope,
  snapshot, sumMoney, type AgentReport, type Evidence, type ReportPeriod,
} from "./common.js"

/**
 * FIN — deterministic financial risk review, not a cashflow forecast.
 * Receivables represent a balance at data.metadata.asOf, not bank cash.
 */
export function analyzeFinancialStrategy(input: {
  scope: AgencyScope; dataset: Dataset; limit?: number; period?:ReportPeriod
}): AgentReport {
  const limit = input.limit ?? 20
  ensureLimit(limit)
  const snap = snapshot(input.dataset, input.scope,input.period)
  const rows = receivablesInScope(input.dataset, input.scope,input.period)
  const overdue = rows.filter((r) => r.dueDate < snap.asOf)
  const totalOutstandingTnd = sumMoney(rows.map((r) => r.outstanding))
  const overdueTnd = sumMoney(overdue.map((r) => r.outstanding))
  const late90 = overdue.filter((r) => daysBetween(r.dueDate, snap.asOf) > 90)
  const overdue90Tnd = sumMoney(late90.map((r) => r.outstanding))
  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    // Customer label is not a stable ERP ID in this dataset. Never mix agencies.
    const key = row.agency + "\u0000" + row.customer
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const ranked = [...groups.values()].map((rs) => {
    const overdueRows = rs.filter((r) => r.dueDate < snap.asOf)
    return {
      agency: rs[0].agency,
      customer: rs[0].customer,
      overdueTnd: sumMoney(overdueRows.map((r) => r.outstanding)),
      outstandingTnd: sumMoney(rs.map((r) => r.outstanding)),
      invoices: overdueRows,
      maxDelay: Math.max(0, ...overdueRows.map((r) => daysBetween(r.dueDate, snap.asOf))),
    }
  }).filter((x) => x.overdueTnd > 0)
    .sort((a,b) => b.overdueTnd - a.overdueTnd || a.agency.localeCompare(b.agency) || a.customer.localeCompare(b.customer))
  const findings = ranked.slice(0,limit).map((g,index) => finding(
    "FIN-" + (index+1).toString().padStart(3,"0"),
    "Créance échue : " + g.customer + " (" + g.agency + ")",
    g.maxDelay > 90 ? "high" : g.maxDelay > 30 ? "medium" : "low",
    "Solde échu " + g.overdueTnd.toFixed(3) + " TND ; retard maximal " + g.maxDelay + " jour(s). Vérifier les litiges et règlements avant la relance.",
    "review_collection",g.invoices.map((r):Evidence => ({type:"receivable",id:r.invoiceId,agency:r.agency}))
  ))
  const scenarios = [25, 50, 75].map((rate) => ({
    id: "COLLECTION_" + rate,
    label: "Recouvrement hypothétique de " + rate + " % des échéances",
    assumption: "Hypothèse de sensibilité uniquement ; ni prévision, ni garantie d'encaissement.",
    valueTnd: rows.length ? amount(overdueTnd * rate / 100) : null,
  }))
  return {
    agent:"financial_strategy",
    status: rows.length ? "ok" : "no_data",
    executionMode:"read_only",
    snapshot:snap,
    metrics:{
      outstandingTnd:rows.length ? totalOutstandingTnd : null,
      overdueTnd:rows.length ? overdueTnd : null,
      overdue90Tnd:rows.length ? overdue90Tnd : null,
      overdueSharePercent:rows.length ? percent(overdueTnd,totalOutstandingTnd) : null,
      openInvoiceCount:rows.length,
      overdueInvoiceCount:overdue.length,
      exposedCustomers:ranked.length,
    },
    findings,
    scenarios,
    decisionSupport:{aging:analyzeReceivablesAging(input.dataset,input.scope,input.period),
      collectionQueue:collectionReviewQueue(input.dataset,input.scope,input.period,limit)},
    warnings:[
      "Créances arrêtées au "+snap.asOf+" sur des factures émises pendant la période sélectionnée, pas un solde historique à la fin de cette période.",
      "Les créances sont des soldes documentaires, pas un solde bancaire ni un cash-flow prévisionnel.",
      "Clients regroupés sur libellé + agence : confirmer l'identifiant ERP avant toute action.",
      "Les relances proposées restent des brouillons ; vérifier litiges, règlements et permissions.",
      ...(rows.length ? [] : ["Aucune créance exploitable : ne pas interpréter comme zéro dette."]),
    ],
  }
}
