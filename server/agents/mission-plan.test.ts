import {describe,it,expect} from "vitest"
import {previewMissionPlan} from "./mission-plan.js"
import {investigateWithDirector} from "./ai-director.js"
import {defaultDataset} from "../services.js"
describe("Director planning before execution",()=>{
  it("routes a quantified +15% revenue goal to all four specialists",()=>{
    const objective="Augmenter notre CA de 15 % en 12 mois avec une marge et une trésorerie minimales"
    const p=previewMissionPlan({agent:"director",objective,scope:["Sfax"],dataset:defaultDataset()})
    expect(p.plannedTools).toBe(4)
    expect(p.tools.map(t=>t.agent)).toEqual([
      "revenue_growth","financial_strategy","supply_chain_intelligence","business_strategy",
    ])
    expect(p.tools.every(t=>t.dependencies.includes("scope"))).toBe(true)
    expect(p.toolCallsBudget).toBe(4)
    expect(p.estimatedLlmCalls).toBe(0)
    expect(p.erpWriteBudget).toBe(0)
    const r=investigateWithDirector({objective,scope:["Sfax"],dataset:defaultDataset()})
    expect(r.plan.map(x=>x.agent)).toEqual(p.tools.map(x=>x.agent))
  })
  it("does not request unrelated specialists for a stock-only task",()=>{
    const p=previewMissionPlan({agent:"director",objective:"Contrôler le stock à Sfax",
      scope:["Sfax"],dataset:defaultDataset()})
    expect(p.tools.map(x=>x.agent)).toEqual(["supply_chain_intelligence"])
    expect(p.tools[0].tool).toBe("inventory.reorder_review")
  })
  it("blocks missing inputs and labels unknown margins honestly",()=>{
    const data=defaultDataset()
    data.receivables=[]
    const p=previewMissionPlan({agent:"financial_strategy",objective:"Diagnostiquer les retards",
      scope:["Sfax"],dataset:data})
    expect(p.status).toBe("blocked_data")
    expect(p.tools[0].availableRecords).toBe(0)
    const audit=defaultDataset()
    audit.sales=audit.sales.map(x=>({...x,cost:null}))
    const b=previewMissionPlan({agent:"business_strategy",objective:"Comparer la marge",
      scope:"*",dataset:audit})
    expect(b.tools[0].caveats.join(" ")).toContain("Marge partielle")
  })
})
