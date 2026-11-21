import { describe, expect, it } from "vitest"
import type { Dataset } from "../services.js"
import { analyzeFinancialStrategy } from "./financial-strategy.js"
import { analyzeSupplyChain } from "./supply-chain.js"
import { analyzeBusinessStrategy } from "./business-strategy.js"
import { investigateWithDirector } from "./ai-director.js"

function sample(): Dataset {
  return {
    metadata: {
      adapter:"test",source:"Fixture synthétique QA",currency:"TND",
      asOf:"2026-10-31",lastUpdated:"2026-10-31T10:00:00.000Z",
    },
    sales:[
      { id:"1",invoiceId:"INV-S1",date:"2026-09-01",agency:"Sfax",customerId:"1",customer:"Client Sfax",product:"Produit A",family:"X",representative:"Rep",revenue:1000,cost:600,status:"posted" },
      { id:"2",invoiceId:"INV-S2",date:"2026-10-02",agency:"Sfax",customerId:"2",customer:"Client B",product:"Produit A",family:"X",representative:"Rep",revenue:500,cost:null,status:"posted" },
      { id:"3",invoiceId:"INV-T1",date:"2026-09-01",agency:"Tunis Centre",customerId:"1",customer:"Confidentiel Tunis",product:"Produit A",family:"X",representative:"Rep",revenue:999999,cost:30,status:"posted" },
      { id:"4",invoiceId:"INV-C",date:"2026-10-12",agency:"Sfax",customerId:"4",customer:"Annulé",product:"Produit A",family:"X",representative:"Rep",revenue:999999,cost:10,status:"cancelled" },
      { id:"5",invoiceId:"INV-F",date:"2026-11-05",agency:"Sfax",customerId:"5",customer:"Futur",product:"Produit A",family:"X",representative:"Rep",revenue:999999,cost:10,status:"posted" },
    ],
    receivables:[
      {invoiceId:"INV-S1",agency:"Sfax",customer:"Client Sfax",date:"2026-09-01",dueDate:"2026-09-30",outstanding:320.125},
      {invoiceId:"INV-S2",agency:"Sfax",customer:"Client B",date:"2026-10-02",dueDate:"2026-11-20",outstanding:120.010},
      {invoiceId:"INV-T1",agency:"Tunis Centre",customer:"Confidentiel Tunis",date:"2026-09-01",dueDate:"2026-09-30",outstanding:900000},
    ],
    inventory:[
      {reference:"STK-S1",product:"Produit A",agency:"Sfax",quantity:1,reorderPoint:10,unitCost:5.25},
      {reference:"STK-S2",product:"Produit B",agency:"Sfax",quantity:25,reorderPoint:10,unitCost:10},
      {reference:"STK-UNKNOWN",product:"Produit C",agency:"Sfax",quantity:5,reorderPoint:0,unitCost:2},
      {reference:"STK-T1",product:"Secret Tunis",agency:"Tunis Centre",quantity:0,reorderPoint:15,unitCost:100000},
    ],
  }
}

describe("New specialist agents — deterministic and scoped",()=>{
  it("Financial Strategy computes overdue balances at dataset asOf and avoids hidden agencies",()=>{
    const x=analyzeFinancialStrategy({scope:["Sfax"],dataset:sample()})
    expect(x.agent).toBe("financial_strategy")
    expect(x.status).toBe("ok")
    expect(x.metrics.outstandingTnd).toBe(440.135)
    expect(x.metrics.overdueTnd).toBe(320.125)
    expect(x.metrics.overdueInvoiceCount).toBe(1)
    expect(x.scenarios[0].valueTnd).toBe(80.031)
    expect(x.findings).toHaveLength(1)
    expect(x.findings[0].evidence[0].id).toBe("INV-S1")
    expect(JSON.stringify(x)).not.toContain("Confidentiel Tunis")
    expect(x.findings[0].action.status).toBe("draft_only")
  })
  it("Supply Chain uses existing reorder points without creating orders",()=>{
    const x=analyzeSupplyChain({scope:["Sfax"],dataset:sample()})
    expect(x.status).toBe("ok")
    expect(x.metrics.lowStockPositions).toBe(1)
    expect(x.metrics.positionsWithMissingThreshold).toBe(1)
    expect(x.metrics.indicativeReorderCostTnd).toBe(47.25)
    expect(x.findings).toHaveLength(1)
    expect(x.findings[0].evidence).toEqual([{type:"stock_position",id:"STK-S1",agency:"Sfax"}])
    expect(x.findings[0].action.requiresHumanApproval).toBe(true)
    expect(JSON.stringify(x)).not.toContain("Secret Tunis")
  })
  it("Business Strategy abstains from margin if one cost is missing",()=>{
    const x=analyzeBusinessStrategy({scope:["Sfax"],dataset:sample()})
    expect(x.status).toBe("ok")
    expect(x.metrics.revenueTnd).toBe(1500)
    expect(x.metrics.agenciesCompared).toBe(1)
    expect(x.metrics.agenciesWithMarginUnknown).toBe(1)
    expect(x.findings[0].explanation).toContain("marge indisponible")
    expect(x.scenarios[0].valueTnd).toBe(75)
    expect(JSON.stringify(x)).not.toContain("Confidentiel Tunis")
    expect(JSON.stringify(x)).not.toContain("999999")
  })
  it("No data returns no_data and never fabricates financial values",()=>{
    const dataset=sample()
    dataset.receivables=[]
    const x=analyzeFinancialStrategy({scope:"*",dataset})
    expect(x.status).toBe("no_data")
    expect(x.metrics.outstandingTnd).toBeNull()
    expect(x.scenarios[0].valueTnd).toBeNull()
    expect(x.findings).toEqual([])
  })
  it("rejects invalid limits and preserves negative/reconciled sales signs",()=>{
    expect(()=>analyzeFinancialStrategy({scope:"*",dataset:sample(),limit:0})).toThrow()
    expect(()=>analyzeSupplyChain({scope:"*",dataset:sample(),limit:101})).toThrow()
    const dataset=sample()
    dataset.sales.push({id:"CN",invoiceId:"AV-1",date:"2026-10-12",agency:"Sfax",customer:"Client Sfax",product:"Produit A",family:"X",representative:"Rep",revenue:-100,cost:-30,kind:"credit_note",status:"posted"})
    expect(analyzeBusinessStrategy({scope:["Sfax"],dataset}).metrics.revenueTnd).toBe(1400)
  })
})

describe("AI Director — bounded specialist delegation",()=>{
  it("routes a specific stock mission to the Supply Chain specialist only",()=>{
    const x=investigateWithDirector({objective:"Optimiser les seuils de stock critiques",scope:["Sfax"],dataset:sample()})
    expect(x.plan.map(p=>p.agent)).toEqual(["supply_chain_intelligence"])
    expect(x.sections[0].findings[0].evidence[0].agency).toBe("Sfax")
    expect(x.summary.erpWrites).toBe(0)
    expect(x.orchestrationMode).toBe("deterministic_read_only")
  })
  it("delegates a cross-functional mission to four distinct specialists",()=>{
    const x=investigateWithDirector({
      objective:"Fournir un diagnostic complet",scope:["Sfax"],dataset:sample(),
    })
    expect(x.plan).toHaveLength(4)
    expect(x.sections).toHaveLength(4)
    expect(x.summary.agentsInvoked).toBe(4)
    expect(x.highlights.every(h=>h.action.status==="draft_only")).toBe(true)
    expect(JSON.stringify(x)).not.toContain("Confidentiel Tunis")
  })
  it("honors explicit allowed agents and refuses invalid objectives or limits",()=>{
    const x=investigateWithDirector({
      objective:"Vérifier une mission",scope:["Sfax"],dataset:sample(),agents:["financial_strategy","business_strategy"],
    })
    expect(x.plan.map(p=>p.agent)).toEqual(["financial_strategy","business_strategy"])
    expect(()=>investigateWithDirector({objective:"x",scope:"*",dataset:sample()})).toThrow()
    expect(()=>investigateWithDirector({objective:"Diagnostic",scope:"*",dataset:sample(),limit:0})).toThrow()
  })
})
