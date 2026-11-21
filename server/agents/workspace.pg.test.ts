import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { Pool } from "pg"
import { beforeAll, afterAll, describe, expect, it } from "vitest"
import { PostgresStore } from "../store.js"
import { AgenticWorkspace } from "./workspace.js"

const url=process.env.TEST_DATABASE_URL
const schema="agentic_"+crypto.randomBytes(6).toString("hex")
const scoped=()=>{
  const u=new URL(url!)
  u.searchParams.set("options","-c search_path="+schema)
  return u.toString()
}
const adminActor={id:"author",role:"admin",agencies:["*"]}
const reviewer={id:"reviewer",role:"manager",agencies:["Sfax"]}
const input={
  agency:"Sfax",agent:"supply_chain_intelligence" as const,
  title:"Contrôler la rupture de stock",
  objective:"Examiner les seuils de produits et le risque opérationnel",
  dueAt:"2025-11-01T10:00:00.000Z",
}
describe.skipIf(!url)("Agentic PostgreSQL durability, locks and RLS",()=>{
  let setup:Pool
  beforeAll(async()=>{
    setup=new Pool({connectionString:url})
    await setup.query("CREATE SCHEMA "+schema)
    const pool=new Pool({connectionString:scoped()})
    try{
      const migrations=fs.readdirSync("migrations")
        .filter(x=>/^\d{3}_[a-z0-9_]+\.sql$/.test(x)).sort()
      for(const m of migrations)await pool.query(fs.readFileSync(path.resolve("migrations",m),"utf8"))
      await pool.query("INSERT INTO organizations(id,name,status,is_synthetic) VALUES ('agent-org-a','A','active',true),('agent-org-b','B','active',true)")
    }finally{await pool.end()}
  })
  afterAll(async()=>{
    await setup?.query("DROP SCHEMA IF EXISTS "+schema+" CASCADE")
    await setup?.end()
  })
  it("survives a new pool, protects other tenants and keeps due reminders idempotent",async()=>{
    const first=new PostgresStore(scoped())
    const a=new AgenticWorkspace(first)
    const created=await a.createMission("agent-org-a",adminActor,input)
    expect(created.status).toBe("draft")
    await first.close()
    const second=new PostgresStore(scoped())
    try{
      const b=new AgenticWorkspace(second)
      expect((await b.listMissions("agent-org-a",adminActor)).map(m=>m.id)).toContain(created.id)
      expect(await b.listMissions("agent-org-b",adminActor)).toEqual([])
      expect(await b.scanDue("agent-org-a","2026-11-21T10:00:00.000Z")).toBe(1)
      expect(await b.scanDue("agent-org-a","2026-11-21T11:00:00.000Z")).toBe(0)
      const notes=await b.listNotifications("agent-org-a",adminActor)
      expect(notes.some(n=>n.kind==="due")).toBe(true)
      expect(await b.listNotifications("agent-org-b",adminActor)).toEqual([])
    }finally{await second.close()}
  })
  it("serializes competing reviewer transitions and enforces maker-checker",async()=>{
    const store=new PostgresStore(scoped())
    const s=new AgenticWorkspace(store)
    try{
      const created=await s.createMission("agent-org-a",adminActor,input)
      const result=await s.submitRun("agent-org-a",adminActor,created.id,1,{
        asOf:"2026-11-21",source:"QA fixture",summary:"Stock à inspecter",
        findings:1,evidence:["STK-001"],actionType:"review_purchase",
      })
      expect(result.approval?.status).toBe("pending")
      const id=result.approval!.id
      await expect(s.reviewApproval("agent-org-a",adminActor,id,1,"approved","")).rejects.toThrow()
      const responses=await Promise.allSettled([
        s.reviewApproval("agent-org-a",reviewer,id,1,"approved","Validé, sans ERP"),
        s.reviewApproval("agent-org-a",reviewer,id,1,"rejected","Refusé après revue"),
      ])
      expect(responses.filter(r=>r.status==="fulfilled")).toHaveLength(1)
      expect(responses.filter(r=>r.status==="rejected")).toHaveLength(1)
      const last=(await s.listApprovals("agent-org-a",reviewer)).find(x=>x.id===id)
      expect(last?.version).toBe(2)
      expect(last?.reviewedBy).toBe("reviewer")
      expect(await s.listApprovals("agent-org-b",reviewer)).toEqual([])
    }finally{await store.close()}
  })
  it("RLS prevents direct cross-organization access even under the application role",async()=>{
    const pool=new Pool({connectionString:scoped()})
    const client=await pool.connect()
    try{
      await client.query("BEGIN")
      await client.query("SET LOCAL ROLE ai_negoce_app")
      await client.query("SELECT set_config('app.organization_id','agent-org-b',true)")
      const count=await client.query("SELECT count(*)::int AS n FROM agentic_workspaces")
      expect(count.rows[0].n).toBe(0)
      await client.query("ROLLBACK")
    }finally{client.release();await pool.end()}
  })
})
