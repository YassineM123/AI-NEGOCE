/**
 * Real PostgreSQL 17 E2E — all five scenarios and revision invalidation share
 * one persisted tenant snapshot. Never touches a customer ERP.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import {Pool} from "pg"
import request from "supertest"
import {afterAll,beforeAll,describe,expect,it} from "vitest"
import {createApp} from "../app.js"
import {PostgresStore} from "../store.js"
import {loadConfig} from "../config.js"
import {DisabledOcrProvider} from "../ocr.js"
import {TestErpAdapter} from "../erp.js"
import {readAnalyticalDataset,saveAnalyticalDataset} from "../analytics-database.js"
import {applySyntheticDemoEvent} from "../demo-live-simulator.js"
import {bearer,TEST_DEV_KEY} from "../../tests/qa/support/harness.js"
import {finalDemoDataset,finalDemoScope,finalDemoDirectorObjective} from "./final-demo-fixture.js"

const url=process.env.TEST_DATABASE_URL
const schema="five_recipe_"+crypto.randomBytes(6).toString("hex")
const isolated=()=>{
 const u=new URL(url!)
 u.searchParams.set("options","-c search_path="+schema)
 return u.toString()
}
const api="/api/v1/agentic"
const workspace=api+"/workspace"
describe.skipIf(!url)("REAL POSTGRES — five-scenario reproducible decision recipe",()=>{
 let admin:Pool,store:PostgresStore
 beforeAll(async()=>{
  admin=new Pool({connectionString:url})
  await admin.query("CREATE SCHEMA "+schema)
  const pool=new Pool({connectionString:isolated()})
  try {
   for(const filename of fs.readdirSync("migrations")
     .filter(x=>/^\d{3}_[a-z0-9_]+\.sql$/.test(x)).sort()){
    await pool.query(fs.readFileSync(path.resolve("migrations",filename),"utf8"))
   }
  }finally{await pool.end()}
  store=new PostgresStore(isolated())
  await store.ensureOrganization({id:"demo-fictive",name:"Synthetic Test",status:"active",isSynthetic:true})
  await store.ensureOrganization({id:"tenant-other",name:"Isolated Test",status:"active",isSynthetic:true})
 })
 afterAll(async()=>{
  await store?.close()
  await admin?.query("DROP SCHEMA IF EXISTS "+schema+" CASCADE")
  await admin?.end()
 })
 it("one persisted PG snapshot drives BI, Data Science, all specialists, CEO dossier and safe revisions",async()=>{
  const tenant=store.forTenant("demo-fictive")
  const fixture=finalDemoDataset()
  const v1=await saveAnalyticalDataset(tenant,fixture,"synthetic")
  expect(v1.revision).toBe(1)
  const app=createApp({
   config:loadConfig({NODE_ENV:"test",AUTH_MODE:"local-dev",DATABASE_URL:isolated(),
     UNIFIED_ANALYTICS_SOURCE:"postgres",AUTH_DEV_SIGNING_KEY:TEST_DEV_KEY}),
   store,ocr:new DisabledOcrProvider(),erp:new TestErpAdapter(),
  })
  const adminToken=bearer("dev-admin")
  const filter={agency:"Sfax",...finalDemoScope}
  const all=await request(app).get("/api/v1/analytics/overview").set(adminToken).query(finalDemoScope)
  expect(all.status).toBe(200)
  expect(all.body.snapshot.storage).toBe("postgres")
  expect(all.body.bi.data.revenue).toBe(6500)
  expect(all.body.dataScience.analysis.scenarios.basisRevenueTnd).toBe(6500)
  const hypothetical=all.body.dataScience.analysis.scenarios.options.find((s:{id:string})=>s.id==="ambitious")
  expect(hypothetical.revenueTnd).toBe(7475)
  expect(hypothetical.feasible).toBeNull()
  // The CDC AG-02 / AG-03 parameterized examples also run against the
  // PostgreSQL-backed API with identical tenant and agency authorization.
  const liquidity=await request(app).post(api+"/simulations/explain").set(adminToken).send({
    kind:"liquidity",agency:"Sfax",
    inputs:{asOf:"2026-10-20",days:30,openingCashTnd:650000,
      inflowsTnd:300000,outflowsTnd:800000,floorTnd:250000},
  })
  expect(liquidity.status).toBe(200)
  expect(liquidity.body.result).toMatchObject({
    projectedCashTnd:150000,shortfallToFloorTnd:100000,breachesFloor:true,
  })
  expect(liquidity.body.sourceContext).toMatchObject({
    source:fixture.metadata.source,usedForCalculations:false,
  })
  const demandCoverage=await request(app).post(api+"/simulations/explain").set(adminToken).send({
    kind:"stock_coverage",agency:"Sfax",
    inputs:{asOf:"2026-10-20",sku:"SKU-A",availableUnits:120,
      dailyDemandUnits:20,replenishmentLeadDays:10},
  })
  expect(demandCoverage.status).toBe(200)
  expect(demandCoverage.body.result).toMatchObject({
    coverageDays:6,shortfallDays:4,shortageUnits:80,
  })
  expect(demandCoverage.body.erpWrites).toBe(0)
  const snapshotId=all.body.snapshotId
  const growth=await request(app).get(api+"/revenue-growth/opportunities")
    .set(adminToken).query(filter)
  expect(growth.status).toBe(200)
  const customer=growth.body.opportunities.find((r:{customerId:string})=>r.customerId==="CL-GROW")
  expect(customer.metrics.growthPercent).toBe(50)
  expect(customer.evidence.invoiceIds).toEqual(["F-SF-PREV","F-SF-CUR"])
  expect(growth.body.decisionSupport.accountPlans.method).toBe("observed_category_peer_penetration_not_affinity_ml")
  const finance=await request(app).get(api+"/financial-strategy/analysis")
    .set(adminToken).query(filter)
  expect(finance.status).toBe(200)
  expect(finance.body.metrics.overdueTnd).toBe(9000)
  expect(finance.body.metrics.overdueSharePercent).toBe(90)
  expect(finance.body.findings[0].evidence[0].id).toBe("D-SF-LATE")
  expect(finance.body.decisionSupport.collectionQueue.plans[0]).toMatchObject({
    invoiceId:"D-SF-LATE",outstandingTnd:9000,requiresHumanApproval:true,
  })
  const stock=await request(app).get(api+"/supply-chain/recommendations")
    .set(adminToken).query(filter)
  expect(stock.status).toBe(200)
  expect(stock.body.metrics.emptyStockPositions).toBe(1)
  expect(stock.body.metrics.indicativeReorderCostTnd).toBe(600)
  expect(stock.body.decisionSupport.replenishment.proposals[0]).toMatchObject({
    sku:"SKU-A",minimumUnits:10,purchaseBudgetEstimateTnd:600,
    proposedAction:{status:"draft_only",requiresHumanApproval:true},
  })
  const allStock=await request(app).get(api+"/supply-chain/recommendations")
    .set(adminToken).query(finalDemoScope)
  expect(allStock.status).toBe(200)
  expect(allStock.body.decisionSupport.transferCandidates.candidates[0].proposedUnits).toBe(10)
  const strategy=await request(app).get(api+"/business-strategy/scenarios")
    .set(adminToken).query(finalDemoScope)
  expect(strategy.status).toBe(200)
  expect(strategy.body.metrics.agenciesCompared).toBe(2)
  expect(strategy.body.metrics.revenueTnd).toBe(6500)
  expect(strategy.body.decisionSupport.expansionReadiness.openingNewAgencyValidated).toBe(false)
  expect(strategy.body.decisionSupport.strategicScenarios.scenarios.every(
    (s:{feasible:null;capexTnd:null})=>s.feasible===null&&s.capexTnd===null)).toBe(true)
  const director=await request(app).post(api+"/ai-director/investigate")
    .set(adminToken).send({...finalDemoScope,objective:finalDemoDirectorObjective})
  expect(director.status).toBe(200)
  expect(director.body.sections.map((s:{agent:string})=>s.agent)).toEqual([
   "revenue_growth","financial_strategy","supply_chain_intelligence","business_strategy",
  ])
  expect(director.body.summary.erpWrites).toBe(0)
  expect(director.body.decisionDossier.domainCoverage).toHaveLength(4)
  expect(director.body.decisionDossier.safeguards.erpWrites).toBe(0)
  const created=await request(app).post(workspace+"/missions")
    .set(adminToken).send({agency:"Sfax",agent:"director",
     title:"Recette PostgreSQL CEO croissance 15%",
     objective:finalDemoDirectorObjective,...finalDemoScope})
  expect(created.status).toBe(201)
  const executed=await request(app)
    .post(workspace+"/missions/"+created.body.mission.id+"/run")
    .set(adminToken).send({expectedVersion:1})
  expect(executed.status).toBe(200)
  expect(executed.body.mission.execution.status).toBe("completed")
  expect(executed.body.approval?.status).toBe("pending")
  expect(executed.body.erpWrites).toBe(0)
  const oldApprovalId=executed.body.approval.id
  const replacement={
   ...fixture,
   sales:fixture.sales.map(s=>s.id==="F-SF-CUR"?{...s,revenue:1650}:s),
   metadata:{...fixture.metadata,lastUpdated:"2026-10-20T11:00:00.000Z"},
  }
  expect((await saveAnalyticalDataset(tenant,replacement,"synthetic",true)).revision).toBe(2)
  const refreshed=await request(app).get("/api/v1/analytics/overview")
    .set(adminToken).query(finalDemoScope)
  expect(refreshed.status).toBe(200)
  expect(refreshed.body.snapshotId).not.toBe(snapshotId)
  expect(refreshed.body.bi.data.revenue).toBe(6650)
  expect(refreshed.body.dataScience.analysis.scenarios.basisRevenueTnd).toBe(6650)
  expect(refreshed.body.dataScience.analysis.scenarios.options.find((x:{id:string})=>
    x.id==="ambitious").revenueTnd).toBe(7647.5)
  const stale=await request(app).post(workspace+"/approvals/"+oldApprovalId+"/review")
    .set(bearer("dev-manager-sfax"))
    .send({expectedVersion:1,decision:"approved",comment:"Ancienne décision périmée"})
  expect(stale.status).toBe(409)
  const newMission=await request(app).post(workspace+"/missions")
    .set(adminToken).send({agency:"Sfax",agent:"director",
     title:"Révision 2 CEO : nouveau dossier",objective:finalDemoDirectorObjective,...finalDemoScope})
  expect(newMission.status).toBe(201)
  const newRun=await request(app)
    .post(workspace+"/missions/"+newMission.body.mission.id+"/run")
    .set(adminToken).send({expectedVersion:1})
  expect(newRun.status).toBe(200)
  expect(newRun.body.approval?.id).toBeTruthy()
  expect(newRun.body.approval.id).not.toBe(oldApprovalId)
  expect(newRun.body.mission.execution.sourceFingerprint)
    .not.toBe(executed.body.mission.execution.sourceFingerprint)
  const approved=await request(app).post(workspace+"/approvals/"+newRun.body.approval.id+"/review")
    .set(bearer("dev-manager-sfax"))
    .send({expectedVersion:1,decision:"approved",comment:"Nouvelle révision revue"})
  expect(approved.status).toBe(200)
  expect(approved.body.erpWriteExecuted).toBe(false)
  const packets=await request(app).get(workspace+"/actions").set(adminToken)
  expect(packets.status).toBe(200)
  expect(packets.body.actions).toHaveLength(1)
  expect(packets.body.actions[0].missionId).toBe(newMission.body.mission.id)
  // Payment-evidence revision alone invalidates an open approval.
  const pendingEvidence=await request(app).post(workspace+"/missions").set(adminToken)
    .send({agency:"Sfax",agent:"financial_strategy",
      title:"Contrôle règlement pour approbation",
      objective:"Examiner les créances et les règlements de Sfax",...finalDemoScope})
  expect(pendingEvidence.status).toBe(201)
  const evidenceRun=await request(app)
    .post(workspace+"/missions/"+pendingEvidence.body.mission.id+"/run")
    .set(adminToken).send({expectedVersion:1})
  expect(evidenceRun.status).toBe(200)
  expect(evidenceRun.body.approval?.status).toBe("pending")
  const third={...replacement,
    collections:[{id:"PAY-NEW",agency:"Sfax",invoiceId:"D-SF-LATE",
      date:"2026-08-01",amountTnd:250}],
    metadata:{...replacement.metadata,lastUpdated:"2026-10-20T12:00:00.000Z"},
  }
  expect((await saveAnalyticalDataset(tenant,third,"synthetic",true)).revision).toBe(3)
  const stalePayment=await request(app)
    .post(workspace+"/approvals/"+evidenceRun.body.approval.id+"/review")
    .set(bearer("dev-manager-sfax"))
    .send({expectedVersion:1,decision:"approved",comment:"Historique règlement modifié"})
  expect(stalePayment.status).toBe(409)
  const foreign=await readAnalyticalDataset(store.forTenant("tenant-other"))
  expect(foreign).toBeNull()
 })
 it("publishes four living events to PostgreSQL and refreshes BI, DS and governed Agentic",async()=>{
  const tenant=store.forTenant("demo-fictive")
  const source=finalDemoDataset()
  source.inventory=source.inventory.map(x=>({...x,quantity:x.agency==="Sfax"?20:x.quantity}))
  const seed=await saveAnalyticalDataset(tenant,source,"synthetic",true)
  const app=createApp({config:loadConfig({NODE_ENV:"test",AUTH_MODE:"local-dev",
   DATABASE_URL:isolated(),UNIFIED_ANALYTICS_SOURCE:"postgres",
   AUTH_DEV_SIGNING_KEY:TEST_DEV_KEY}),
   store,ocr:new DisabledOcrProvider(),erp:new TestErpAdapter()})
  const auth=bearer("dev-admin")
  const query={agency:"Sfax",...finalDemoScope}
  const before=await request(app).get("/api/v1/analytics/overview").set(auth).query(query)
  expect(before.status).toBe(200)
  expect(before.body.bi.data.revenue).toBe(2500)
  let revision=seed.revision
  let generated
  for(const kind of ["sale","collection","restock","supplier"] as const){
   const current=await readAnalyticalDataset(tenant)
   expect(current?.revision).toBe(revision)
   generated=applySyntheticDemoEvent(current!.dataset,{sequence:revision,agency:"Sfax",kind})
   const saved=await saveAnalyticalDataset(tenant,generated.dataset,"synthetic",true,revision)
   expect(saved.revision).toBe(++revision)
   expect(saved.sourceHash).toMatch(/^[0-9a-f]{64}$/)
   await expect(saveAnalyticalDataset(tenant,generated.dataset,"synthetic",true,revision-1))
     .rejects.toThrow("ANALYTICS_REVISION_CONFLICT")
  }
  const after=await request(app).get("/api/v1/analytics/overview").set(auth).query(query)
  expect(after.status).toBe(200)
  expect(after.body.snapshotId).not.toBe(before.body.snapshotId)
  expect(after.body.snapshot.revision).toBe(revision)
  expect(after.body.snapshot.demo.mode).toBe("synthetic_live_demo")
  expect(after.body.snapshot.demo.lastEvent.kind).toBe("supplier")
  expect(after.body.bi.data.revenue).toBeGreaterThan(before.body.bi.data.revenue)
  expect(after.body.dataScience.analysis.scenarios.basisRevenueTnd)
    .toBe(after.body.bi.data.revenue)
  const loaded=await readAnalyticalDataset(tenant)
  expect(loaded?.dataset.metadata.demoEvents).toHaveLength(4)
  expect(loaded?.dataset.collections?.some(x=>x.id.startsWith("SIM-"))).toBe(true)
  expect(loaded?.dataset.supplierDocuments?.some(x=>x.invoiceId.startsWith("SI-SIM-"))).toBe(true)
  const finance=await request(app).get(api+"/financial-strategy/analysis").set(auth).query(query)
  const supply=await request(app).get(api+"/supply-chain/recommendations").set(auth).query(query)
  const director=await request(app).post(api+"/ai-director/investigate").set(auth)
   .send({...query,objective:finalDemoDirectorObjective})
  for(const res of [finance,supply,director])expect(res.status).toBe(200)
  expect(director.body.summary.erpWrites).toBe(0)
  const otherAgency=await request(app).get("/api/v1/analytics/overview").set(auth)
    .query({agency:"Tunis Centre",...finalDemoScope})
  expect(otherAgency.status).toBe(200)
  expect(otherAgency.body.snapshot.demo.lastEvent).toBeUndefined()
  expect(JSON.stringify(otherAgency.body)).not.toContain("SIM-")
  const earlierPeriod=await request(app).get("/api/v1/analytics/overview").set(auth)
    .query({agency:"Sfax",from:"2026-07-01",to:"2026-09-30"})
  expect(earlierPeriod.status).toBe(200)
  expect(earlierPeriod.body.snapshot.demo.lastEvent).toBeUndefined()
  const otherTenant=await readAnalyticalDataset(store.forTenant("tenant-other"))
  expect(otherTenant).toBeNull()
 })

})
