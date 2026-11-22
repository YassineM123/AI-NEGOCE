import {describe,it,expect} from "vitest"
import request from "supertest"
import {makeApp,bearer} from "../../tests/qa/support/harness.js"
import {finalDemoDataset} from "./final-demo-fixture.js"

const path="/api/v1/agentic/simulations/explain"
describe("Exact AG-02/AG-03 synthetic what-if acceptance oracles",()=>{
  it("AG-02 computes cash 650k + 300k - 800k = 150k, floor shortfall 100k",async()=>{
    const {app}=makeApp({data:finalDemoDataset()})
    const payload={kind:"liquidity",agency:"Sfax",
      inputs:{asOf:"2026-10-20",days:30,openingCashTnd:650000,
        inflowsTnd:300000,outflowsTnd:800000,floorTnd:250000}}
    const first=await request(app).post(path).set(bearer("dev-admin")).send(payload)
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({
      kind:"liquidity",status:"hypothesis_only",erpWrites:0,modelCalls:0,
      sourceContext:{usedForCalculations:false},scope:["Sfax"],
      result:{projectedCashTnd:150000,floorTnd:250000,shortfallToFloorTnd:100000,breachesFloor:true},
      evidence:{type:"user_supplied_assumptions",documentIds:[]},
      executionMode:"read_only",
    })
    expect(first.body.suggestedReviews.every((r:{requiresHumanApproval:boolean})=>r.requiresHumanApproval)).toBe(true)
    expect(first.body.warnings.join(" ")).toContain("pas une prévision de liquidité")
    const repeat=await request(app).post(path).set(bearer("dev-admin")).send(payload)
    expect(repeat.status).toBe(200)
    expect(repeat.body).toEqual(first.body)
  })
  it("AG-03 computes 120 units at 20/day => 6 days coverage against J+10",async()=>{
    const {app}=makeApp({data:finalDemoDataset()})
    const answer=await request(app).post(path).set(bearer("dev-admin")).send({
      kind:"stock_coverage",agency:"Sfax",
      inputs:{asOf:"2026-10-20",sku:"SKU-A",availableUnits:120,
        dailyDemandUnits:20,replenishmentLeadDays:10},
    })
    expect(answer.status).toBe(200)
    expect(answer.body.result).toMatchObject({
      coverageDays:6,leadTimeDays:10,shortfallDays:4,shortageUnits:80,beforeReplenishment:true,
    })
    expect(answer.body.evidence.documentIds).toEqual([])
    expect(answer.body.suggestedReviews).toHaveLength(3)
    expect(answer.body.erpWrites).toBe(0)
  })
  it("does not allow out-of-scope agencies, invalid values or real tenant to simulate",async()=>{
    const {app}=makeApp({data:finalDemoDataset()})
    const payload={kind:"liquidity",agency:"Tunis Centre",
      inputs:{asOf:"2026-10-20",days:30,openingCashTnd:650000,
        inflowsTnd:300000,outflowsTnd:800000,floorTnd:250000}}
    const forbidden=await request(app).post(path).set(bearer("dev-manager-sfax")).send(payload)
    expect(forbidden.status).toBe(403)
    expect(forbidden.body.error.code).toBe("AGENCY_FORBIDDEN")
    const invalid=await request(app).post(path).set(bearer("dev-admin"))
      .send({...payload,agency:"Sfax",inputs:{...payload.inputs,openingCashTnd:-1}})
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.code).toBe("INVALID_SIMULATION")
    const badPeriod=await request(app).post(path).set(bearer("dev-admin"))
      .send({...payload,agency:"Sfax",from:"2026-12-01",to:"2026-01-01"})
    expect(badPeriod.status).toBe(400)
    const tenant=await request(app).post(path).set(bearer("dev-admin-org-b"))
      .send({...payload,agency:"Sfax"})
    expect(tenant.status).toBe(403)
  })
})
