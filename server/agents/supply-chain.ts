import type { AgencyScope } from "../auth.js"
import type { Dataset } from "../services.js"
import {
  amount, ensureLimit, finding, inventoryInScope, snapshot, sumMoney,
  type AgentReport, type Evidence,
} from "./common.js"

/**
 * SCA — position-level reorder review.
 * Reorder point is an input from the dataset, NOT an ML forecast.
 */
export function analyzeSupplyChain(input: {
  scope: AgencyScope; dataset: Dataset; limit?: number
}): AgentReport {
  const limit = input.limit ?? 20
  ensureLimit(limit)
  const snap = snapshot(input.dataset, input.scope)
  const rows = inventoryInScope(input.dataset,input.scope)
  const validThreshold = rows.filter((r) =>
    Number.isFinite(r.quantity) && Number.isFinite(r.reorderPoint) && r.reorderPoint > 0
  )
  const lowStock = validThreshold.filter((r) => r.quantity < r.reorderPoint)
    .sort((a,b) => {
      const aRisk = a.quantity <= 0 ? 2 : a.quantity <= a.reorderPoint / 2 ? 1 : 0
      const bRisk = b.quantity <= 0 ? 2 : b.quantity <= b.reorderPoint / 2 ? 1 : 0
      return bRisk-aRisk || a.agency.localeCompare(b.agency) || a.reference.localeCompare(b.reference)
    })
  const availableInventory = rows.filter((r) => Number.isFinite(r.quantity) && r.quantity >= 0 && Number.isFinite(r.unitCost) && r.unitCost >= 0)
  const missingCost = lowStock.filter((r) => !Number.isFinite(r.unitCost) || r.unitCost < 0)
  const scenarios = [
    {
      id:"RESTORE_MINIMUM",
      label:"Coût indicatif : revenir au seuil de commande",
      assumption:"Simple écart au point de réapprovisionnement, sans lead time, MOQ, disponibilité fournisseur, TVA ni transport.",
      valueTnd:lowStock.every((r)=>Number.isFinite(r.unitCost)&&r.unitCost>=0)
        ? sumMoney(lowStock.map((r)=> Math.ceil(r.reorderPoint-r.quantity)*r.unitCost))
        : null,
    },
  ]
  const findings = lowStock.slice(0,limit).map((row,index) => {
    const missingQty=Math.max(0,Math.ceil(row.reorderPoint-row.quantity))
    const priority = row.quantity <= 0 ? "high" : row.quantity <= row.reorderPoint/2 ? "high" : "medium"
    const evidence:Evidence[]=[{type:"stock_position",id:row.reference,agency:row.agency}]
    return finding(
      "SCA-"+(index+1).toString().padStart(3,"0"),
      "Réapprovisionnement à étudier : "+row.product+" ("+row.agency+")",
      priority,
      "Disponible source : "+row.quantity+" ; seuil : "+row.reorderPoint+
      " ; écart minimal : "+missingQty+". Contrôler les mouvements, les réservations et les commandes en cours avant achat.",
      "prepare_purchase_request",evidence
    )
  })
  return {
    agent:"supply_chain_intelligence",
    status:rows.length?"ok":"no_data",
    executionMode:"read_only",
    snapshot:snap,
    metrics:{
      stockPositions:rows.length,
      lowStockPositions:lowStock.length,
      emptyStockPositions:validThreshold.filter((r)=>r.quantity<=0).length,
      positionsWithMissingThreshold:rows.length-validThreshold.length,
      indicativeStockValueTnd:availableInventory.length
        ? sumMoney(availableInventory.map((r)=>r.quantity*r.unitCost))
        : null,
      indicativeReorderCostTnd:scenarios[0].valueTnd,
    },
    findings,
    scenarios,
    warnings:[
      "Réapprovisionnement calculé sur seuil existant ; pas de prévision de demande, de délai fournisseur ou de disponibilité réservée.",
      "Aucun bon de commande ERP n'est créé : chaque proposition reste un brouillon.",
      ...(rows.length-validThreshold.length > 0 ? ["Certaines positions sans seuil valide sont exclues du classement."] : []),
      ...(missingCost.length > 0 ? ["Coût des achats incomplet : valeur de réapprovisionnement indisponible."] : []),
      ...(rows.length===0 ? ["Aucune position stock disponible : ne pas conclure à l'absence de rupture."] : []),
    ],
  }
}
