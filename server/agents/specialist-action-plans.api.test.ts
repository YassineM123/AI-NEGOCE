import {describe,it,expect} from "vitest"
import request from "supertest"
import {defaultDataset,type Dataset} from "../services.js"
import {commercialAccountPlans,collectionReviewQueue,replenishmentReviewPlan,expansionReadinessReview} from "./specialist-action-plans.js"
import {analyzeRevenueGrowth} from "./revenue-growth.js"
import {analyzeFinancialStrategy} from "./financial-strategy.js"
import {analyzeSupplyChain} from "./supply-chain.js"
import {analyzeBusinessStrategy} from "./business-strategy.js"
import {investigateWithDirector} from "./ai-director.js"
import {makeApp,bearer} from "../../tests/qa/support/harness.js"
import {finalDemoDataset,finalDemoScope} from "./final-demo-fixture.js"

function businessFixture():Dataset{
 const d=finalDemoDataset()
 const make=(id:string,client:string,family:string,revenue:number,date="2026-09-10")=>({
   id,invoiceId:id,date,agency:"Sfax",customer:client,customerId:client,
   product:family,productId:family,quantity:1,family,
   representative:"Test",revenue,cost:revenue*0.6,status:"posted" as const})
 return {...d,
  sales:[
   ...d.sales,
   make("INV-C1-A","C1","Papeterie",100),
   make("INV-C2-A","C2","Papeterie",200),
   make("INV-C2-B","C2","Hygiène",50),
   make("INV-C3-A","C3","Papeterie",300),
   make("INV-C3-B","C3","Hygiène",80),
   {...make("INV-TN-SECRET","Tunis Secret","Hygiène",900),"agency":"Tunis Centre"},
  ],
  collections:[
   {id:"PAY-SF",invoiceId:"D-SF-LATE",agency:"Sfax",date:"2026-07-10",amountTnd:2000},
   {id:"PAY-TN",invoiceId:"D-TUN",agency:"Tunis Centre",date:"2026-09-24",amountTnd:500},
  ],
 }
}
describe("CDC — commercial, financial, stock and expansion action plans",()=>{
 it("REV-05/07/01: peer category suggestion cites purchase invoices, with no fake conversion",()=>{
  const d=businessFixture()
  const out=commercialAccountPlans(d,["Sfax"],finalDemoScope)
  expect(out.status).toBe("observed_peer_gap")
  const client=out.plans.find(x=>x.customerId==="C1")
  expect(client).toBeTruthy()
  expect(client!.crossSellCandidates[0]).toMatchObject({family:"Hygiène",peerCustomers:2,
    status:"investigate_only",sampleInvoiceIds:["INV-C2-B","INV-C3-B"]})
  expect(client!.proposedAction).toMatchObject({status:"draft_only",requiresHumanApproval:true})
  expect(JSON.stringify(out)).not.toContain("Tunis Secret")
  const noPeers=commercialAccountPlans(d,["Tunis Centre"],finalDemoScope)
  expect(noPeers.status).toBe("insufficient_peer_history")
  expect(commercialAccountPlans(d,["Sfax"],finalDemoScope)).toEqual(out)
 })
 it("FIN-14/16: linked collections are evidence only, do not erase remaining receivable",()=>{
  const d=businessFixture()
  const out=collectionReviewQueue(d,["Sfax"],finalDemoScope)
  expect(out.openInvoices).toBe(2)
  expect(out.overdueInvoices).toBe(1)
  const late=out.plans.find(x=>x.invoiceId==="D-SF-LATE")
  expect(late).toMatchObject({outstandingTnd:9000,overdueDays:141,linkedCollectionsTnd:2000,
    linkedPaymentIds:["PAY-SF"],status:"draft_only",requiresHumanApproval:true})
  expect(out.totalOutstandingTnd).toBe(10000)
  expect(JSON.stringify(out)).not.toContain("PAY-TN")
  const absent=collectionReviewQueue({...d,collections:undefined},["Sfax"],finalDemoScope)
  expect(absent.plans[0].linkedCollectionsTnd).toBeNull()
 })
 it("SCA-07/10: minimum purchase draft respects period, no supplier/lead time invention",()=>{
  const d=businessFixture()
  const output=replenishmentReviewPlan(d,["Sfax"],finalDemoScope)
  expect(output.proposals[0]).toMatchObject({
    sku:"SKU-A",minimumUnits:10,purchaseBudgetEstimateTnd:600,
    supplier:null,expectedDeliveryDate:null,moqUnits:null,
    reservationsVerified:false,proposedAction:{status:"draft_only",requiresHumanApproval:true},
  })
  expect(output.proposals[0].evidence).toEqual([{type:"stock_position",id:"SKU-A",agency:"Sfax"}])
  expect(replenishmentReviewPlan(d,["Sfax"],{from:"2025-01-01",to:"2025-12-31"}).proposals)
    .toHaveLength(0)
 })
 it("BSA-01/04: compare authorized agencies and abstain on new-site ROI",()=>{
  const d=businessFixture()
  const single=expansionReadinessReview(d,["Sfax"],finalDemoScope)
  expect(single.agencies).toHaveLength(1)
  expect(single.agencies[0].blockers).toContain("site_capex_missing")
  expect(single.openingNewAgencyValidated).toBe(false)
  expect(JSON.stringify(single)).not.toContain("Tunis Secret")
  expect(expansionReadinessReview(d,["Tunis Centre"],finalDemoScope).agencies)
    .toHaveLength(1)
 })
 it("all four specialists return governed decision support through current APIs",()=>{
  const d=businessFixture()
  const period=finalDemoScope
  expect(analyzeRevenueGrowth({dataset:d,scope:["Sfax"],period}).decisionSupport.accountPlans.status)
    .toBe("observed_peer_gap")
  expect(analyzeFinancialStrategy({dataset:d,scope:["Sfax"],period}).decisionSupport?.collectionQueue)
    .toBeDefined()
  expect(analyzeSupplyChain({dataset:d,scope:["Sfax"],period}).decisionSupport?.replenishment)
    .toBeDefined()
  expect(analyzeBusinessStrategy({dataset:d,scope:["Sfax"],period}).decisionSupport?.expansionReadiness)
    .toBeDefined()
  const director=investigateWithDirector({dataset:d,scope:["Sfax"],period,
    objective:"Objectif CEO +15% croissance avec finance cash, stock et expansion"})
  expect(director.summary.erpWrites).toBe(0)
  expect(director.sections).toHaveLength(4)
  expect(JSON.stringify(director)).not.toContain("Tunis Secret")
 })
 it("AG-04: investment VAN and payback sensitivity use only user supplied assumptions",async()=>{
  const {app}=makeApp({data:businessFixture()})
  const payload={kind:"expansion_investment",agency:"Sfax",from:"2026-01-01",to:"2026-12-31",
    inputs:{asOf:"2026-10-20",locationName:"Sousse Démo",
      capexTnd:100000,additionalWorkingCapitalTnd:20000,
      monthlyIncrementalRevenueTnd:30000,expectedGrossMarginPercent:40,
      monthlyOperatingCostTnd:4000,monthlyCannibalizedMarginTnd:1000,
      annualDiscountRatePercent:0,horizonMonths:24,
      cashAvailableForInvestmentTnd:200000,cashFloorTnd:100000}}
  const output=await request(app).post("/api/v1/agentic/simulations/explain")
    .set(bearer("dev-admin")).send(payload)
  expect(output.status).toBe(200)
  expect(output.body.result).toMatchObject({
    upfrontInvestmentTnd:120000,monthlyGrossContributionTnd:12000,
    monthlyNetContributionTnd:7000,npvTnd:48000,paybackMonth:18,
    cashAfterInitialInvestmentTnd:80000,breachesAssumedCashFloor:true,reviewRequired:true,
  })
  expect(output.body).toMatchObject({
    status:"hypothesis_only",executionMode:"read_only",erpWrites:0,modelCalls:0,
    evidence:{type:"user_supplied_assumptions",documentIds:[]},
    sourceContext:{usedForCalculations:false},
  })
  const replay=await request(app).post("/api/v1/agentic/simulations/explain")
    .set(bearer("dev-admin")).send(payload)
  expect(replay.body).toEqual(output.body)
  const forbidden=await request(app).post("/api/v1/agentic/simulations/explain")
    .set(bearer("dev-manager-sfax")).send({...payload,agency:"Tunis Centre"})
  expect(forbidden.status).toBe(403)
  const invalid=await request(app).post("/api/v1/agentic/simulations/explain")
    .set(bearer("dev-admin")).send({...payload,inputs:{...payload.inputs,expectedGrossMarginPercent:140}})
  expect(invalid.status).toBe(400)
 })
})
