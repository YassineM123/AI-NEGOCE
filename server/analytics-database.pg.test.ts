import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import {Pool} from "pg"
import request from "supertest"
import {beforeAll,afterAll,describe,expect,it} from "vitest"
import {createApp} from "./app.js"
import {PostgresStore} from "./store.js"
import {loadConfig} from "./config.js"
import {DisabledOcrProvider} from "./ocr.js"
import {TestErpAdapter} from "./erp.js"
import {readAnalyticalDataset,saveAnalyticalDataset} from "./analytics-database.js"
import {defaultDataset, type Dataset} from "./services.js"
import {bearer,TEST_DEV_KEY} from "../tests/qa/support/harness.js"

const url=process.env.TEST_DATABASE_URL
const schema="analytics_"+crypto.randomBytes(6).toString("hex")
const scoped=()=>{
  const u=new URL(url!)
  u.searchParams.set("options","-c search_path="+schema)
  return u.toString()
}
const example=():Dataset=>{
  const baseline=defaultDataset()
  return {
    ...baseline,
    sales:[
      {id:"SFX-1",invoiceId:"SFX-1",date:"2026-07-13",agency:"Sfax",customer:"Client Sfax",
        customerId:"c-sfax",product:"Bureau",family:"Mobilier",representative:"QA",
        revenue:100,cost:50,status:"posted"},
      {id:"TUN-1",invoiceId:"TUN-1",date:"2026-10-04",agency:"Tunis Centre",customer:"Client Tunis",
        customerId:"c-tunis",product:"Article",family:"Mobilier",representative:"QA",
        revenue:5000,cost:2500,status:"posted"},
    ],
    receivables:[
      {invoiceId:"SFX-1",agency:"Sfax",customer:"Client Sfax",
        date:"2026-07-13",dueDate:"2026-07-30",outstanding:25},
    ],
    inventory:[{reference:"SKU-SFX",product:"Bureau",agency:"Sfax",
      quantity:2,reorderPoint:10,unitCost:50}],
    collections:[
      {id:"COL-SF",invoiceId:"SFX-1",agency:"Sfax",date:"2026-07-20",amountTnd:50},
      {id:"COL-TN",invoiceId:"TUN-1",agency:"Tunis Centre",date:"2026-10-07",amountTnd:25},
    ],
    supplierDocuments:[
      {orderId:"PO-SF",supplierId:"SUP-SF",supplier:"Fournisseur fictif Sfax",
       agency:"Sfax",orderDate:"2026-07-01",invoiceDate:"2026-07-11",
       invoiceId:"SI-SF",lagDays:10,amountTnd:300},
      {orderId:"PO-TN",supplierId:"SUP-TN",supplier:"Fournisseur fictif Tunis",
       agency:"Tunis Centre",orderDate:"2026-09-01",invoiceDate:"2026-09-11",
       invoiceId:"SI-TN",lagDays:10,amountTnd:500},
    ],
    metadata:{...baseline.metadata,source:"PostgreSQL synthetic QA",asOf:"2026-10-15",
      lastUpdated:"2026-10-15T09:00:00.000Z"},
  }
}
describe.skipIf(!url)("One PostgreSQL source: BI, Data Science, 5 Agents",()=>{
  let admin:Pool,db:PostgresStore
  beforeAll(async()=>{
    admin=new Pool({connectionString:url})
    await admin.query("CREATE SCHEMA "+schema)
    const pool=new Pool({connectionString:scoped()})
    try{
      const migrations=fs.readdirSync("migrations").filter(f=>/^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort()
      for(const m of migrations)await pool.query(fs.readFileSync(path.resolve("migrations",m),"utf8"))
    }finally{await pool.end()}
    db=new PostgresStore(scoped())
    await db.ensureOrganization({id:"demo-fictive",name:"Demo",status:"active",isSynthetic:true})
    await db.ensureOrganization({id:"tenant-other",name:"Other",status:"active",isSynthetic:true})
  })
  afterAll(async()=>{
    await db?.close()
    await admin?.query("DROP SCHEMA IF EXISTS "+schema+" CASCADE")
    await admin?.end()
  })
  it("never falls back to local fixtures for missing tenant snapshot",async()=>{
    const missing=await readAnalyticalDataset(db.forTenant("tenant-other"))
    expect(missing).toBeNull()
    const app=createApp({
      config:loadConfig({NODE_ENV:"test",AUTH_MODE:"local-dev",DATABASE_URL:scoped(),
        UNIFIED_ANALYTICS_SOURCE:"postgres",AUTH_DEV_SIGNING_KEY:TEST_DEV_KEY}),
      store:db,ocr:new DisabledOcrProvider(),erp:new TestErpAdapter(),
    })
    const result=await request(app).get("/api/v1/analytics/overview")
      .set(bearer("dev-admin"))
    expect(result.status).toBe(503)
    expect(result.body.error.code).toBe("ANALYTICS_NOT_SEEDED")
  })
  it("persists one tenant snapshot, updates BI+DS+Agentic together, retains approvals safely",async()=>{
    const t=db.forTenant("demo-fictive")
    const initial=example()
    const created=await saveAnalyticalDataset(t,initial,"synthetic")
    expect(created.revision).toBe(1)
    await expect(saveAnalyticalDataset(t,initial,"synthetic"))
      .rejects.toThrow("explicit --replace required")
    const cfg=loadConfig({NODE_ENV:"test",AUTH_MODE:"local-dev",
      DATABASE_URL:scoped(),UNIFIED_ANALYTICS_SOURCE:"postgres",AUTH_DEV_SIGNING_KEY:TEST_DEV_KEY})
    const app=createApp({config:cfg,store:db,ocr:new DisabledOcrProvider(),
      erp:new TestErpAdapter()})
    const filter={agency:"Sfax",from:"2026-07-01",to:"2026-09-30"}
    const one=await request(app).get("/api/v1/analytics/overview")
      .set(bearer("dev-manager-sfax")).query(filter)
    expect(one.status).toBe(200)
    expect(one.body.bi.data.revenue).toBe(100)
    expect(one.body.insights.summary.revenue).toBe(100)
    expect(one.body.dataScience.analysis.scenarios.basisRevenueTnd).toBe(100)
    expect(one.body.dataScience.analysis.portfolio.customers).toBe(1)
    expect(one.body.bi.data.metadata.snapshotRevision).toBe(1)
    expect(one.body.dataScience.analysis.advancedModels).toBeDefined()
    expect(one.body.dataScience.analysis.advancedModels.collections.status).toBe("insufficient_history")
    expect(one.body.dataScience.analysis.advancedModels.suppliers.events).toBe(1)
    const loaded=await readAnalyticalDataset(t)
    expect(loaded?.dataset.collections?.map(e=>e.id)).toEqual(["COL-SF","COL-TN"])
    expect(loaded?.dataset.supplierDocuments?.map(e=>e.invoiceId)).toEqual(["SI-SF","SI-TN"])
    const rev=await request(app).get("/api/v1/agentic/revenue-growth/opportunities")
      .set(bearer("dev-manager-sfax")).query(filter)
    expect(rev.status).toBe(200)
    expect(rev.body.snapshot.period).toEqual({from:filter.from,to:filter.to})
    expect(JSON.stringify(rev.body)).not.toContain("Client Tunis")
    const allPeriod={agency:"Sfax",from:"2026-01-01",to:"2026-12-31"}
    for(const endpoint of [
      "/api/v1/agentic/financial-strategy/analysis",
      "/api/v1/agentic/supply-chain/recommendations",
      "/api/v1/agentic/business-strategy/scenarios",
      "/api/v1/agentic/revenue-growth/opportunities",
    ]){
      const report=await request(app).get(endpoint).set(bearer("dev-admin")).query(allPeriod)
      expect(report.status,endpoint).toBe(200)
      expect(report.body.snapshot.period,endpoint)
        .toEqual({from:allPeriod.from,to:allPeriod.to})
      expect(JSON.stringify(report.body),endpoint).not.toContain("Client Tunis")
    }
    const director=await request(app).post("/api/v1/agentic/ai-director/investigate")
      .set(bearer("dev-admin"))
      .send({...allPeriod,objective:"Comparer ventes, finance, stocks et stratégie pour la direction"})
    expect(director.status).toBe(200)
    expect(director.body.sections).toHaveLength(4)
    expect(director.body.summary.erpWrites).toBe(0)
    expect(JSON.stringify(director.body)).not.toContain("Client Tunis")
    const mission=await request(app).post("/api/v1/agentic/workspace/missions")
      .set(bearer("dev-admin")).send({...allPeriod,agent:"supply_chain_intelligence",
        title:"Stock fictif QA à examiner",
        objective:"Étudier le seuil de stock de Sfax et préparer une demande manuelle"})
    expect(mission.status).toBe(201)
    const run=await request(app)
      .post("/api/v1/agentic/workspace/missions/"+mission.body.mission.id+"/run")
      .set(bearer("dev-admin")).send({expectedVersion:1})
    expect(run.status).toBe(200)
    expect(run.body.mission.execution.status).toBe("completed")
    expect(run.body.mission.lastRun.findings).toBeGreaterThan(0)
    expect(run.body.approval.status).toBe("pending")
    const approvalId=run.body.approval.id

    const financial=await request(app).get("/api/v1/agentic/financial-strategy/analysis")
      .set(bearer("dev-manager-sfax")).query(filter)
    expect(financial.status).toBe(200)
    expect(financial.body.metrics.outstandingTnd).toBe(25)
    const denied=await request(app).get("/api/v1/analytics/overview")
      .set(bearer("dev-manager-sfax")).query({...filter,agency:"Tunis Centre"})
    expect(denied.status).toBe(403)
    const second:Dataset={...initial,
      sales:initial.sales.map(r=>r.agency==="Sfax"?{...r,revenue:230}:r),
      metadata:{...initial.metadata,lastUpdated:"2026-10-15T10:00:00.000Z"},
    }
    expect((await saveAnalyticalDataset(t,second,"synthetic",true)).revision).toBe(2)
    const reread=await readAnalyticalDataset(t)
    expect(reread?.revision).toBe(2)
    const staleReview=await request(app)
      .post("/api/v1/agentic/workspace/approvals/"+approvalId+"/review")
      .set(bearer("dev-manager-sfax"))
      .send({expectedVersion:1,decision:"approved",comment:"Approbation périmée"})
    expect(staleReview.status).toBe(409)
    expect((await request(app).get("/api/v1/agentic/workspace/actions")
      .set(bearer("dev-admin"))).body.actions).toEqual([])
    const two=await request(app).get("/api/v1/analytics/overview")
      .set(bearer("dev-manager-sfax")).query(filter)
    expect(two.status).toBe(200)
    expect(two.body.bi.data.revenue).toBe(230)
    expect(two.body.dataScience.analysis.scenarios.basisRevenueTnd).toBe(230)
    expect(two.body.snapshotId).not.toBe(one.body.snapshotId)
    expect(two.body.bi.data.metadata.snapshotRevision).toBe(2)
    // The refreshed snapshot drives a NEW persistent decision dossier.
    // No old approval is reused, even though the mission's agency/period match.
    const refreshedDirector=await request(app).post("/api/v1/agentic/ai-director/investigate")
      .set(bearer("dev-admin")).send({...allPeriod,
        objective:"Réévaluer ventes, finance, stock et stratégie après actualisation"})
    expect(refreshedDirector.status).toBe(200)
    expect(refreshedDirector.body.sections).toHaveLength(4)
    expect(refreshedDirector.body.summary.erpWrites).toBe(0)

    const newMission=await request(app).post("/api/v1/agentic/workspace/missions")
      .set(bearer("dev-admin")).send({...allPeriod,agent:"director",
        title:"Décision après révision PostgreSQL 2",
        objective:"Réévaluer ventes, finance, stock et stratégie après actualisation"})
    expect(newMission.status).toBe(201)
    expect(newMission.body.mission.id).not.toBe(mission.body.mission.id)
    const rerun=await request(app)
      .post("/api/v1/agentic/workspace/missions/"+newMission.body.mission.id+"/run")
      .set(bearer("dev-admin")).send({expectedVersion:newMission.body.mission.version})
    expect(rerun.status).toBe(200)
    expect(rerun.body.mission.execution.status).toBe("completed")
    expect(rerun.body.mission.lastRun.findings).toBeGreaterThan(0)
    expect(rerun.body.mission.lastRun.trace.period).toEqual({
      from:allPeriod.from,to:allPeriod.to,
    })
    expect(rerun.body.mission.execution.sourceFingerprint)
      .not.toBe(run.body.mission.execution.sourceFingerprint)
    expect(rerun.body.mission.lastRun.trace.erpWrites).toBe(0)
    expect(rerun.body.approval?.id).toBeTruthy()
    expect(rerun.body.approval?.id).not.toBe(approvalId)
    const newDecision=await request(app)
      .post("/api/v1/agentic/workspace/approvals/"+rerun.body.approval.id+"/review")
      .set(bearer("dev-manager-sfax"))
      .send({expectedVersion:1,decision:"approved",comment:"Nouvelles preuves revues"})
    expect(newDecision.status).toBe(200)
    expect(newDecision.body.erpWriteExecuted).toBe(false)
    const handoffs=await request(app).get("/api/v1/agentic/workspace/actions")
      .set(bearer("dev-admin"))
    expect(handoffs.body.actions).toHaveLength(1)
    expect(handoffs.body.actions[0].missionId).toBe(newMission.body.mission.id)
    expect(JSON.stringify(handoffs.body)).not.toContain("Client Tunis")
    const blocked=await request(app).get("/api/v1/analytics/overview")
      .set(bearer("dev-admin-org-b"))
    expect(blocked.status).toBe(403)
    expect((await readAnalyticalDataset(db.forTenant("tenant-other")))).toBeNull()
  })
  it("keeps dataset access guarded by the PostgreSQL app role",async()=>{
    const pool=new Pool({connectionString:scoped()})
    const c=await pool.connect()
    try{
      await c.query("BEGIN")
      await c.query("SET LOCAL ROLE ai_negoce_app")
      await c.query("SELECT set_config('app.organization_id','tenant-other',true)")
      const q=await c.query("SELECT count(*)::int n FROM analytics_datasets")
      expect(q.rows[0].n).toBe(0)
      await c.query("ROLLBACK")
    }finally{c.release();await pool.end()}
  })
})
