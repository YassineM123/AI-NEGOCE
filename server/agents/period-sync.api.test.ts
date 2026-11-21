import {describe,expect,it} from "vitest"
import request from "supertest"
import {bearer,makeApp} from "../../tests/qa/support/harness.js"
import type {Dataset} from "../services.js"
import {defaultDataset,overview} from "../services.js"
import {analyzeRevenueGrowth} from "./revenue-growth.js"
import {analyzeFinancialStrategy} from "./financial-strategy.js"
import {analyzeSupplyChain} from "./supply-chain.js"
import {analyzeBusinessStrategy} from "./business-strategy.js"
import {investigateWithDirector} from "./ai-director.js"
import {previewMissionPlan} from "./mission-plan.js"

const base="/api/v1/agentic/workspace"
const t3={from:"2026-07-01",to:"2026-09-30"}
const t4={from:"2026-10-01",to:"2026-12-31"}

function fixture():Dataset{
  const original=defaultDataset()
  return {
    metadata:{...original.metadata,source:"QA synchronisation multi-agents",asOf:"2026-10-15"},
    sales:[
      {id:"a3",invoiceId:"SFX-T3",date:"2026-07-15",agency:"Sfax",customer:"A",
        customerId:"A",product:"P",family:"F",representative:"QA",revenue:100,cost:60,status:"posted"},
      {id:"a4",invoiceId:"SFX-T4",date:"2026-10-08",agency:"Sfax",customer:"A",
        customerId:"A",product:"P",family:"F",representative:"QA",revenue:300,cost:200,status:"posted"},
      {id:"b4",invoiceId:"TUN-T4",date:"2026-10-10",agency:"Tunis Centre",customer:"B",
        customerId:"B",product:"P",family:"F",representative:"QA",revenue:9000,cost:100,status:"posted"},
    ],
    receivables:[
      {invoiceId:"SFX-R3",agency:"Sfax",customer:"A",date:"2026-07-10",dueDate:"2026-07-30",outstanding:10},
      {invoiceId:"SFX-R4",agency:"Sfax",customer:"A",date:"2026-10-05",dueDate:"2026-10-10",outstanding:25},
      {invoiceId:"TUN-R4",agency:"Tunis Centre",customer:"B",date:"2026-10-05",dueDate:"2026-10-09",outstanding:9900},
    ],
    inventory:[
      {reference:"P",product:"P",agency:"Sfax",quantity:2,reorderPoint:10,unitCost:5},
      {reference:"P",product:"P",agency:"Tunis Centre",quantity:500,reorderPoint:10,unitCost:5},
    ],
  }
}

describe("Agentic agency and period applied at the data layer",()=>{
  it("keeps all specialists on exactly the same posted-sale cohort as BI",()=>{
    const data=fixture(),scope=["Sfax"]
    for(const [period,revenue,debt,stock] of [
      [t3,100,10,0],[t4,300,25,1],
    ] as const){
      const filter={agencies:scope,...period}
      const bi=overview(filter,data)
      const rev=analyzeRevenueGrowth({dataset:data,scope,period})
      const fin=analyzeFinancialStrategy({dataset:data,scope,period})
      const supply=analyzeSupplyChain({dataset:data,scope,period})
      const strategy=analyzeBusinessStrategy({dataset:data,scope,period})
      expect(bi.revenue).toBe(revenue)
      expect(rev.analysis.postedLinesAnalyzed).toBe(1)
      expect(rev.decisionSupport.portfolio.revenueTnd).toBe(revenue)
      expect(fin.metrics.totalOutstandingTnd).toBe(debt)
      expect(fin.decisionSupport?.aging).toBeTruthy()
      expect(supply.metrics.stockPositions).toBe(stock)
      expect(strategy.metrics.revenueTnd).toBe(revenue)
      expect(strategy.decisionSupport?.strategicScenarios).toBeTruthy()
      for(const report of [fin,supply,strategy])
        expect(report.snapshot.period).toEqual({from:period.from,to:period.to})
      expect(rev.snapshot.period).toEqual({from:period.from,to:period.to})
      expect(JSON.stringify({rev,fin,supply,strategy})).not.toContain("TUN-R4")
      expect(strategy.findings.every(f=>f.evidence.every(e=>e.agency==="Sfax"))).toBe(true)
    }
  })
  it("never invents stock for a period preceding its known snapshot",()=>{
    const data=fixture()
    const result=analyzeSupplyChain({dataset:data,scope:["Sfax"],period:t3})
    expect(result.status).toBe("no_data")
    expect(result.findings).toEqual([])
    expect(result.warnings.join(" ")).toContain("Stock historique non disponible")
    const current=analyzeSupplyChain({dataset:data,scope:["Sfax"],period:t4})
    expect(current.status).toBe("ok")
    expect(current.metrics.lowStockPositions).toBe(1)
  })
  it("delegates period to Director and applies it to the mission preflight",()=>{
    const data=fixture(),scope=["Sfax"]
    const result=investigateWithDirector({
      dataset:data,scope,objective:"Comparer le chiffre d'affaires, les créances, les stocks et la stratégie",
      period:t3,
    })
    expect(result.snapshot.period).toEqual({from:t3.from,to:t3.to})
    const byAgent=new Map(result.sections.map(s=>[s.agent,s]))
    expect(byAgent.get("supply_chain_intelligence")?.status).toBe("no_data")
    expect(byAgent.get("business_strategy")?.metrics.revenueTnd).toBe(100)
    const plan=previewMissionPlan({agent:"director",dataset:data,scope,
      objective:"Analyser les ventes, les créances et les stocks",period:t3})
    expect(plan.period).toEqual({from:t3.from,to:t3.to})
    expect(plan.tools.find(t=>t.agent==="supply_chain_intelligence")?.status).toBe("blocked_data")
    expect(plan.tools.find(t=>t.agent==="revenue_growth")?.availableRecords).toBe(1)
    expect(plan.tools.find(t=>t.agent==="financial_strategy")?.availableRecords).toBe(1)
  })
})

describe("Agentic HTTP filters and historical-session separation",()=>{
  it("accepts global period on 4 reports and Director and rejects reversed dates",async()=>{
    const {app}=makeApp()
    const qs={agency:"Sfax",...t3}
    for(const path of [
      "/api/v1/agentic/revenue-growth/opportunities",
      "/api/v1/agentic/financial-strategy/analysis",
      "/api/v1/agentic/supply-chain/recommendations",
      "/api/v1/agentic/business-strategy/scenarios",
    ]){
      const ok=await request(app).get(path).query(qs).set(bearer("dev-admin"))
      expect(ok.status,path).toBe(200)
      expect(ok.body.snapshot.period).toEqual(t3)
      const reversed=await request(app).get(path).query({...qs,from:t3.to,to:t3.from})
        .set(bearer("dev-admin"))
      expect(reversed.status,path).toBe(400)
    }
    const director=await request(app).post("/api/v1/agentic/ai-director/investigate")
      .set(bearer("dev-admin")).send({
        agency:"Sfax",...t3,objective:"Comparer les ventes et la stratégie de cette agence",
      })
    expect(director.status).toBe(200)
    expect(director.body.snapshot.period).toEqual(t3)
    expect((await request(app).post("/api/v1/agentic/ai-director/investigate")
      .set(bearer("dev-admin")).send({
        agency:"Sfax",from:t3.to,to:t3.from,objective:"Analyser les ventes",
      })).status).toBe(400)
    expect((await request(app).get("/api/v1/agentic/financial-strategy/analysis")
      .query({...qs,agency:"Tunis Centre"}).set(bearer("dev-manager-sfax"))).status).toBe(403)
  })
  it("stores immutable period with mission; plan and run never default back to all-time",async()=>{
    const {app}=makeApp()
    const created=await request(app).post(base+"/missions").set(bearer("dev-admin"))
      .send({agency:"Sfax",agent:"director",title:"Audit T3 contrôlé",
        objective:"Comparer ventes et créances sur T3",...t3})
    expect(created.status).toBe(201)
    expect(created.body.mission.from).toBe(t3.from)
    expect(created.body.mission.to).toBe(t3.to)
    const id=created.body.mission.id
    const plan=await request(app).get(base+"/missions/"+id+"/plan").set(bearer("dev-admin"))
    expect(plan.status).toBe(200)
    expect(plan.body.plan.period).toEqual(t3)
    const run=await request(app).post(base+"/missions/"+id+"/run")
      .set(bearer("dev-admin")).send({expectedVersion:1})
    expect(run.status).toBe(200)
    expect(run.body.mission.from).toBe(t3.from)
    expect(run.body.mission.to).toBe(t3.to)
    expect(run.body.erpWrites).toBe(0)
    expect((await request(app).post(base+"/missions").set(bearer("dev-admin"))
      .send({agency:"Sfax",agent:"director",title:"Période erronée",
        objective:"Test période inversée",from:t3.to,to:t3.from})).status).toBe(400)
  })
  it("separates factual chat history and briefs across periods, including reused turn IDs",async()=>{
    const {app}=makeApp()
    const token=bearer("dev-admin")
    const path=base+"/chat/business_strategy"
    const turnId=crypto.randomUUID()
    const q={agency:"Sfax",message:"Quel est le CA ?",turnId}
    const sent=await request(app).post(path).set(token).send({...q,...t3})
    expect(sent.status).toBe(200)
    expect(sent.body.mode).toBe("deterministic")
    expect(sent.body.message.from).toBe(t3.from)
    expect(sent.body.message.to).toBe(t3.to)
    const history3=await request(app).get(path).query({agency:"Sfax",...t3}).set(token)
    const history4=await request(app).get(path).query({agency:"Sfax",...t4}).set(token)
    expect(history3.status).toBe(200)
    expect(history3.body.messages).toHaveLength(2)
    expect(history4.body.messages).toHaveLength(0)
    expect((await request(app).post(path).set(token).send({...q,...t4})).status).toBe(409)
    const brief=await request(app).get(base+"/brief/business_strategy")
      .query({agency:"Sfax",...t4}).set(token)
    expect(brief.status).toBe(200)
    expect(brief.body.period).toEqual(t4)
    expect(brief.body.scope).toEqual(["Sfax"])
  })
})
