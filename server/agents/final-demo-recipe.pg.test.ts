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
  const finance=await request(app).get(api+"/financial-strategy/analysis")
    .set(adminToken).query(filter)
  expect(finance.status).toBe(200)
  expect(finance.body.metrics.overdueTnd).toBe(9000)
  expect(finance.body.metrics.overdueSharePercent).toBe(90)
  expect(finance.body.findings[0].evidence[0].id).toBe("D-SF-LATE")
  const stock=await request(app).get(api+"/supply-chain/recommendations")
    .set(adminToken).query(filter)
  expect(stock.status).toBe(200)
  expect(stock.body.metrics.emptyStockPositions).toBe(1)
  expect(stock.body.metrics.indicativeReorderCostTnd).toBe(600)
  const allStock=await request(app).get(api+"/supply-chain/recommendations")
    .set(adminToken).query(finalDemoScope)
  expect(allStock.status).toBe(200)
  expect(allStock.body.decisionSupport.transferCandidates.candidates[0].proposedUnits).toBe(10)
  const strategy=await request(app).get(api+"/business-strategy/scenarios")
    .set(adminToken).query(finalDemoScope)
  expect(strategy.status).toBe(200)
  expect(strategy.body.metrics.agenciesCompared).toBe(2)
  expect(strategy.body.metrics.revenueTnd).toBe(6500)
  expect(strategy.body.decisionSupport.strategicScenarios.scenarios.every(
    (s:{feasible:null;capexTnd:null})=>s.feasible===null&&s.capexTnd===null)).toBe(true)
  const director=await request(app).post(api+"/ai-director/investigate")
    .set(adminToken).send({...finalDemoScope,objective:finalDemoDirectorObjective})
  expect(director.status).toBe(200)
  expect(director.body.sections.map((s:{agent:string})=>s.agent)).toEqual([
   "revenue_growth","financial_strategy","supply_chain_intelligence","business_strategy",
  ])
  expect(director.body.summary.erpWrites).toBe(0)
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
  const foreign=await readAnalyticalDataset(store.forTenant("tenant-other"))
  expect(foreign).toBeNull()
 })
})
