import { describe, expect, it } from "vitest"
import request from "supertest"
import { bearer, makeApp } from "../../tests/qa/support/harness.js"

const base="/api/v1/agentic"
describe("Agentic suite HTTP authorization and enterprise boundaries",()=>{
  it("requires authentication for each specialist and Director",async()=>{
    const {app}=makeApp()
    for(const path of [
      "/financial-strategy/analysis","/supply-chain/recommendations",
      "/business-strategy/scenarios",
    ]) expect((await request(app).get(base+path)).status).toBe(401)
    expect((await request(app).post(base+"/ai-director/investigate").send({objective:"Analyser le stock"})).status).toBe(401)
  })
  it("enforces agency separation for specialists",async()=>{
    const {app}=makeApp()
    const r=await request(app).get(base+"/financial-strategy/analysis?agency=Sfax")
      .set(bearer("dev-manager-sfax"))
    expect(r.status).toBe(200)
    expect(r.body.snapshot.scope).toEqual(["Sfax"])
    expect(r.body.executionMode).toBe("read_only")
    expect(r.body.findings.every((f:{evidence:{agency:string}[]})=>f.evidence.every(e=>e.agency==="Sfax"))).toBe(true)
    expect((await request(app).get(base+"/supply-chain/recommendations?agency=Tunis%20Centre").set(bearer("dev-manager-sfax"))).status).toBe(403)
    expect((await request(app).get(base+"/business-strategy/scenarios?agency=Tunis%20Centre").set(bearer("dev-manager-sfax"))).status).toBe(403)
  })
  it("limits finance and strategy to authorized roles",async()=>{
    const {app}=makeApp()
    expect((await request(app).get(base+"/financial-strategy/analysis").set(bearer("dev-commercial-tunis"))).status).toBe(403)
    expect((await request(app).get(base+"/business-strategy/scenarios").set(bearer("dev-commercial-tunis"))).status).toBe(403)
    expect((await request(app).post(base+"/ai-director/investigate")
      .set(bearer("dev-commercial-tunis")).send({objective:"Analyser la stratégie"})).status).toBe(403)
  })
  it("does not leak another tenant's shared ERP sandbox",async()=>{
    const {app}=makeApp()
    for(const path of [
      "/financial-strategy/analysis","/supply-chain/recommendations",
      "/business-strategy/scenarios",
    ]){
      const r=await request(app).get(base+path).set(bearer("dev-admin-org-b"))
      expect(r.status).toBe(403)
      expect(r.body.error.code).toBe("ERP_SOURCE_UNAVAILABLE")
    }
    const r=await request(app).post(base+"/ai-director/investigate")
      .set(bearer("dev-admin-org-b")).send({objective:"Analyser toutes les agences"})
    expect(r.status).toBe(403)
  })
  it("rejects malformed params and unknown agents",async()=>{
    const {app}=makeApp()
    expect((await request(app).get(base+"/financial-strategy/analysis?limit=101").set(bearer("dev-admin"))).status).toBe(400)
    expect((await request(app).post(base+"/ai-director/investigate").set(bearer("dev-admin"))
      .send({objective:"Analyser les clients",agents:["hacker"]})).status).toBe(400)
    expect((await request(app).post(base+"/ai-director/investigate").set(bearer("dev-admin"))
      .send({objective:"x"})).status).toBe(400)
  })
  it("routes Director to approved read-only agents and logs no ERP writes",async()=>{
    const {app,store}=makeApp()
    const res=await request(app).post(base+"/ai-director/investigate")
      .set(bearer("dev-manager-sfax"))
      .send({objective:"Analyser trésorerie et stock",agency:"Sfax",agents:["financial_strategy","supply_chain_intelligence"]})
    expect(res.status).toBe(200)
    expect(res.body.director).toBe("ai_director")
    expect(res.body.plan.map((p:{agent:string})=>p.agent)).toEqual(["financial_strategy","supply_chain_intelligence"])
    expect(res.body.snapshot.scope).toEqual(["Sfax"])
    expect(res.body.summary.erpWrites).toBe(0)
    expect(res.body.sections.every((section:{findings:{action:{status:string}}[]})=>section.findings.every(f=>f.action.status==="draft_only"))).toBe(true)
  })
})
