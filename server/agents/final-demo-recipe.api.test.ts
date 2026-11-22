/**
 * FINAL DEMONSTRATION RECIPE — fixed fictional facts, deterministic tests.
 * 5 business stories, single scoped dataset, no ERP integration.
 *
 * Re-run: npx vitest run server/agents/final-demo-recipe.api.test.ts --reporter=verbose
 * "Expansion" is a comparison of established agencies, NOT a geographic market forecast.
 * "Cash crisis" is overdue receivables stress, NOT verified bank liquidity.
 */
import {createHash} from "node:crypto"
import {describe,it,expect} from "vitest"
import request from "supertest"
import {bearer,makeApp} from "../../tests/qa/support/harness.js"
import {finalDemoDataset,finalDemoScope,finalDemoDirectorObjective} from "./final-demo-fixture.js"

const root="/api/v1/ageconst scope=finalDemoScope
const directorObjective=finalDemoDirectorObjective
const dataset=finalDemoDataset
const jsonFingerprint=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex")

describe("FINAL DEMO — five explainable and reproducible client scenarios",()=>{
  it("01 customer growth: real posted invoices, comparable windows, explainable source IDs",async()=>{
    const data=dataset(),{app}=makeApp({data})
    const response=await request(app).get(root+"/revenue-growth/opportunities")
      .set(bearer("dev-admin")).query({agency:"Sfax",...scope})
    expect(response.status).toBe(200)
    const match=response.body.opportunities.find((x:{customerId:string})=>x.customerId==="CL-GROW")
    expect(match).toBeTruthy()
    expect(match.state).toBe("growing")
    expect(match.metrics.previousRevenueTnd).toBe(1000)
    expect(match.metrics.currentRevenueTnd).toBe(1500)
    expect(match.metrics.growthPercent).toBe(50)
    expect(match.priorityMethod).toBe("heuristic_v1_not_a_probability")
    expect(match.proposedAction).toMatchObject({status:"draft_only",requiresHumanApproval:true})
    expect(match.evidence.invoiceIds).toEqual(["F-SF-PREV","F-SF-CUR"])
    expect(JSON.stringify(response.body)).not.toContain("Client Tunis")
    expect(JSON.stringify(response.body)).not.toContain("999999")
    const replay=await request(app).get(root+"/revenue-growth/opportunities")
      .set(bearer("dev-admin")).query({agency:"Sfax",...scope})
    expect(jsonFingerprint(replay.body)).toBe(jsonFingerprint(response.body))
  })

  it("02 liquidity stress: documents justify overdue share, not fictitious bank cash",async()=>{
    const {app}=makeApp({data:dataset()})
    const response=await request(app).get(root+"/financial-strategy/analysis")
      .set(bearer("dev-admin")).query({agency:"Sfax",...scope})
    expect(response.status).toBe(200)
    expect(response.body.metrics).toMatchObject({
      outstandingTnd:10000,overdueTnd:9000,overdueSharePercent:90,
      overdueInvoiceCount:1,openInvoiceCount:2,
    })
    expect(response.body.findings[0].priority).toBe("high")
    expect(response.body.findings[0].evidence).toEqual([
      {type:"receivable",id:"D-SF-LATE",agency:"Sfax"},
    ])
    expect(response.body.scenarios.find((s:{id:string})=>s.id==="COLLECTION_50").valueTnd)
      .toBe(4500)
    expect(response.body.warnings.join(" ")).toContain("pas un solde bancaire")
    expect(response.body.executionMode).toBe("read_only")
  })

  it("03 stockout: zero units and cross-agency transfer are flagged for human review",async()=>{
    const {app}=makeApp({data:dataset()})
    const sf=await request(app).get(root+"/supply-chain/recommendations")
      .set(bearer("dev-admin")).query({agency:"Sfax",...scope})
    expect(sf.status).toBe(200)
    expect(sf.body.metrics).toMatchObject({
      stockPositions:1,lowStockPositions:1,emptyStockPositions:1,indicativeReorderCostTnd:600,
    })
    expect(sf.body.findings[0].evidence).toEqual([
      {type:"stock_position",id:"SKU-A",agency:"Sfax"},
    ])
    const all=await request(app).get(root+"/supply-chain/recommendations")
      .set(bearer("dev-admin")).query(scope)
    expect(all.status).toBe(200)
    const transfer=all.body.decisionSupport.transferCandidates.candidates[0]
    expect(transfer).toMatchObject({
      sku:"SKU-A",fromAgency:"Tunis Centre",toAgency:"Sfax",
      proposedUnits:10,status:"candidate_unverified",requiresHumanApproval:true,
    })
    expect(all.body.warnings.join(" ")).toContain("Aucun bon de commande ERP")
  })

  it("04 geographic expansion: rank factual existing agencies, abstain on ROI and CAPEX",async()=>{
    const {app}=makeApp({data:dataset()})
    const response=await request(app).get(root+"/business-strategy/scenarios")
      .set(bearer("dev-admin")).query(scope)
    expect(response.status).toBe(200)
    expect(response.body.metrics.agenciesCompared).toBe(2)
    expect(response.body.metrics.revenueTnd).toBe(6500)
    expect(response.body.findings[0].title).toContain("Tunis Centre")
    expect(response.body.findings[0].explanation).toContain("4000.000 TND")
    const strategic=response.body.decisionSupport.strategicScenarios
    expect(strategic.model).toBe("deterministic_what_if_not_forecast")
    expect(strategic.scenarios.every((s:{feasible:null;capexTnd:null;cashImpactTnd:null})=>
      s.feasible===null&&s.capexTnd===null&&s.cashImpactTnd===null)).toBe(true)
    expect(response.body.warnings.join(" ")).toContain("aucun coût d'investissement")
  })

  it("05 CEO +15%: 4 delegated agents, exact sensitivity, persisted dossier, human approval",async()=>{
    const {app}=makeApp({data:dataset()})
    const context=await request(app).get("/api/v1/analytics/overview")
      .set(bearer("dev-admin")).query(scope)
    expect(context.status).toBe(200)
    expect(context.body.bi.data.revenue).toBe(6500)
    expect(context.body.dataScience.analysis.scenarios.basisRevenueTnd).toBe(6500)
    const plus15=context.body.dataScience.analysis.scenarios.options
      .find((s:{id:string})=>s.id==="ambitious")
    expect(plus15.revenueTnd).toBe(7475)
    expect(plus15.cashImpactTnd).toBeNull()
    expect(plus15.feasible).toBeNull()

    const director=await request(app).post(root+"/ai-director/investigate")
      .set(bearer("dev-admin")).send({...scope,objective:directorObjective})
    expect(director.status).toBe(200)
    expect(director.body.sections.map((s:{agent:string})=>s.agent)).toEqual([
      "revenue_growth","financial_strategy","supply_chain_intelligence","business_strategy",
    ])
    expect(director.body.summary.agentsInvoked).toBe(4)
    expect(director.body.summary.erpWrites).toBe(0)
    expect(director.body.highlights.every((x:{evidence:unknown[]})=>x.evidence.length>0)).toBe(true)

    const created=await request(app).post(workspace+"/missions").set(bearer("dev-admin"))
      .send({agent:"director",agency:"Sfax",...scope,
        title:"Dossier de décision CEO croissance +15 %",
        objective:directorObjective})
    expect(created.status).toBe(201)
    const id=created.body.mission.id
    const planned=await request(app).get(workspace+"/missions/"+id+"/plan")
      .set(bearer("dev-admin"))
    expect(planned.status).toBe(200)
    expect(planned.body.plan.erpWriteBudget).toBe(0)
    expect(planned.body.plan.plannedTools).toBe(4)
    const run=await request(app).post(workspace+"/missions/"+id+"/run")
      .set(bearer("dev-admin")).send({expectedVersion:1})
    expect(run.status).toBe(200)
    expect(run.body.erpWrites).toBe(0)
    expect(run.body.mission.execution.status).toBe("completed")
    expect(run.body.mission.lastRun.trace.modelCalls).toBe(0)
    expect(run.body.mission.lastRun.trace.period).toEqual(scope)
    expect(run.body.approval?.status).toBe("pending")
    const approvalId=run.body.approval.id
    const auto=await request(app).post(workspace+"/approvals/"+approvalId+"/review")
      .set(bearer("dev-admin"))
      .send({expectedVersion:1,decision:"approved"})
    expect(auto.status).toBe(403)
    const approved=await request(app).post(workspace+"/approvals/"+approvalId+"/review")
      .set(bearer("dev-manager-sfax"))
      .send({expectedVersion:1,decision:"approved",
        comment:"Validé pour revue manuelle des preuves, sans exécution ERP"})
    expect(approved.status).toBe(200)
    expect(approved.body.erpWriteExecuted).toBe(false)
    const actions=await request(app).get(workspace+"/actions").set(bearer("dev-admin"))
    expect(actions.body.actions).toHaveLength(1)
    const packet=await request(app).get(workspace+"/actions/"+actions.body.actions[0].id+"/export")
      .set(bearer("dev-admin"))
    expect(packet.status).toBe(200)
    expect(packet.body.erpWriteExecuted).toBe(false)
    expect(packet.body.kind).toBe("approved_action_packet")
  })

  it("guardrail: other tenant and unauthorized agency cannot read decision data",async()=>{
    const {app}=makeApp({data:dataset()})
    const wrongScope=await request(app).get(root+"/financial-strategy/analysis")
      .set(bearer("dev-manager-sfax")).query({agency:"Tunis Centre",...scope})
    expect(wrongScope.status).toBe(403)
    const wrongTenant=await request(app).get(root+"/business-strategy/scenarios")
      .set(bearer("dev-admin-org-b")).query(scope)
    expect(wrongTenant.status).toBe(403)
  })
})
