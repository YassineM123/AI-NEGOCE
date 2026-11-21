import {describe,expect,it} from "vitest"
import type {Dataset} from "../services.js"
import {
  analyzeCustomerConcentration,analyzeReceivablesAging,
  proposeTransferCandidates,compareThreeStrategyScenarios,
} from "./decision-support.js"
import {analyzeSupplyChain} from "./supply-chain.js"
import {analyzeFinancialStrategy} from "./financial-strategy.js"
import {analyzeBusinessStrategy} from "./business-strategy.js"
import {analyzeRevenueGrowth} from "./revenue-growth.js"
const fixture=():Dataset=>({
  metadata:{adapter:"test",source:"QA demo",currency:"TND",asOf:"2026-10-31",
    lastUpdated:"2026-10-31T12:00:00.000Z"},
  sales:[
    {id:"s1",invoiceId:"INV-S1",date:"2026-10-01",agency:"Sfax",customerId:"C1",
      customer:"A",representative:"S",product:"P",family:"F",revenue:200,cost:80},
    {id:"s2",invoiceId:"INV-S2",date:"2026-10-15",agency:"Sfax",customerId:"C2",
      customer:"B",representative:"S",product:"P",family:"F",revenue:100,cost:null},
    {id:"t1",invoiceId:"INV-T",date:"2026-10-15",agency:"Tunis Centre",customerId:"T",
      customer:"SECRET CUSTOMER",representative:"T",product:"T",family:"T",revenue:990000,cost:1},
  ],
  receivables:[
    {invoiceId:"INV-S1",agency:"Sfax",customer:"A",date:"2026-10-01",
      dueDate:"2026-10-30",outstanding:100.125},
    {invoiceId:"INV-S2",agency:"Sfax",customer:"B",date:"2026-09-01",
      dueDate:"2026-09-20",outstanding:200.375},
    {invoiceId:"INV-S3",agency:"Sfax",customer:"C",date:"2026-10-10",
      dueDate:"2026-12-31",outstanding:300.000},
    {invoiceId:"INV-T",agency:"Tunis Centre",customer:"SECRET CUSTOMER",date:"2026-09-01",
      dueDate:"2026-09-20",outstanding:999999},
  ],
  inventory:[
    {reference:"SKU-1",product:"Same SKU",agency:"Sfax",quantity:0,reorderPoint:10,unitCost:5},
    {reference:"SKU-1",product:"Same SKU",agency:"Tunis Centre",quantity:35,reorderPoint:10,unitCost:5},
    {reference:"SKU-2",product:"Other SKU",agency:"Sfax",quantity:20,reorderPoint:5,unitCost:5},
  ],
})
describe("Specialist zero-token decision support",()=>{
  it("computes stable customer concentration without leaking out-of-agency customers",()=>{
    const x=analyzeCustomerConcentration(fixture(),["Sfax"])
    expect(x.revenueTnd).toBe(300)
    expect(x.customers).toBe(2)
    expect(x.top5SharePercent).toBe(100)
    expect(x.top5.every(y=>y.agency==="Sfax")).toBe(true)
    expect(JSON.stringify(x)).not.toContain("SECRET CUSTOMER")
    expect(analyzeRevenueGrowth({dataset:fixture(),scope:["Sfax"]}).decisionSupport.portfolio.customers).toBe(2)
  })
  it("partitions outstanding balances by actual due dates and does not invent bank cash",()=>{
    const x=analyzeReceivablesAging(fixture(),["Sfax"])
    expect(x.outstandingTnd).toBe(600.5)
    expect(x.buckets.map(z=>z.amountTnd)).toEqual([300,100.125,200.375,0,0])
    expect(x.buckets.reduce((n,z)=>n+z.amountTnd,0)).toBeCloseTo(x.outstandingTnd)
    expect(JSON.stringify(x)).not.toContain("999999")
    const r=analyzeFinancialStrategy({scope:["Sfax"],dataset:fixture()})
    expect(r.decisionSupport?.aging).toBeTruthy()
  })
  it("offers only within-scope same-SKU transfer candidates, with costs and delays unknown",()=>{
    const x=proposeTransferCandidates(fixture(),"*")
    expect(x.candidates).toHaveLength(1)
    expect(x.candidates[0].proposedUnits).toBe(10)
    expect(x.candidates[0].costTnd).toBeNull()
    expect(x.candidates[0].transitDays).toBeNull()
    expect(x.candidates[0].status).toBe("candidate_unverified")
    expect(proposeTransferCandidates(fixture(),["Sfax"]).candidates).toEqual([])
    const report=analyzeSupplyChain({scope:"*",dataset:fixture()})
    expect(report.findings.some(f=>f.action.type==="review_transfer_option")).toBe(true)
    const duplicate=fixture()
    duplicate.inventory.push({...duplicate.inventory[1]})
    expect(proposeTransferCandidates(duplicate,"*").candidates).toEqual([])
  })
  it("produces three identical-assumption arithmetic scenarios, never a certified forecast",()=>{
    const s=compareThreeStrategyScenarios(fixture(),["Sfax"])
    expect(s.scenarios.map(x=>x.revenueTnd)).toEqual([270,300,345])
    expect(s.scenarios.map(x=>x.feasible)).toEqual([null,null,null])
    expect(s.scenarios.every(x=>x.cashImpactTnd===null&&x.marginTnd===null)).toBe(true)
    expect(JSON.stringify(s)).not.toContain("SECRET CUSTOMER")
    const report=analyzeBusinessStrategy({scope:["Sfax"],dataset:fixture()})
    expect(report.scenarios).toHaveLength(5)
    expect(report.decisionSupport?.strategicScenarios).toBeTruthy()
  })
})
