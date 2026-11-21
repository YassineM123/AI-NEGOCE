import {describe,expect,it,vi,afterEach} from "vitest"
import request from "supertest"
import {bearer,makeApp} from "../../tests/qa/support/harness.js"
import {AgenticWorkspace,WorkspaceBudgetExceeded,WorkspaceConflict} from "./workspace.js"
import type {LlmProvider} from "../llm/types.js"
import {defaultDataset} from "../services.js"

const base="/api/v1/agentic/workspace"
afterEach(()=>vi.useRealTimers())
describe("Agentic governance: cost, approval freshness and alert policy",()=>{
  it("limits tenant-wide LLM calls atomically in addition to per-user budgets",async()=>{
    const {store}=makeApp(),svc=new AgenticWorkspace(store)
    const a={id:"usr-a",role:"admin",agencies:["*"]}
    const b={id:"usr-b",role:"admin",agencies:["*"]}
    expect((await svc.reserveLlmCall("demo-fictive",a,10,"2026-11-21T12:00:00Z",2))
      .organizationCallsToday).toBe(1)
    expect((await svc.reserveLlmCall("demo-fictive",b,10,"2026-11-21T12:01:00Z",2))
      .organizationCallsToday).toBe(2)
    await expect(svc.reserveLlmCall("demo-fictive",a,10,"2026-11-21T12:02:00Z",2))
      .rejects.toBeInstanceOf(WorkspaceBudgetExceeded)
    expect((await svc.getLlmUsage("demo-fictive",a,"2026-11-21T12:03:00Z"))
      .organizationCallsToday).toBe(2)
    expect((await svc.reserveLlmCall("demo-fictive",a,10,"2026-11-22T12:00:00Z",2))
      .organizationCallsToday).toBe(1)
    expect((await svc.reserveLlmCall("org-b",a,10,"2026-11-22T12:00:00Z",2))
      .organizationCallsToday).toBe(1)
  })
  it("prevents duplicate model calls on concurrent identical turn IDs",async()=>{
    const {store}=makeApp(),svc=new AgenticWorkspace(store)
    const actor={id:"usr",role:"admin",agencies:["*"]}
    const turn={turnId:crypto.randomUUID(),agent:"financial_strategy" as const,
      agency:"Sfax",question:"Pourquoi ces retards ?"}
    await svc.reserveLlmCall("demo-fictive",actor,5,"2026-11-21T10:00:00Z",10,turn)
    await expect(svc.reserveLlmCall("demo-fictive",actor,5,
      "2026-11-21T10:00:01Z",10,turn)).rejects.toBeInstanceOf(WorkspaceConflict)
    await svc.releaseLlmTurn("demo-fictive",actor,turn.turnId)
    expect((await svc.reserveLlmCall("demo-fictive",actor,5,
      "2026-11-21T10:00:02Z",10,turn)).callsToday).toBe(2)
    await svc.releaseLlmTurn("demo-fictive",actor,turn.turnId)
  })
  it("rejects changed text on reused chat id before sending another LLM call",async()=>{
    let calls=0
    const llm:LlmProvider={name:"qa-llm",isConfigured:()=>true,
      async chat(){calls++;return {model:"qa-model",content:"Factures à examiner."}}}
    const {app}=makeApp({llm})
    const turnId=crypto.randomUUID()
    const payload={agency:"Sfax",turnId,message:"Analyse des créances échues"}
    const first=await request(app).post(base+"/chat/financial_strategy")
      .set(bearer("dev-admin")).send(payload)
    expect(first.status).toBe(200)
    const conflicting=await request(app).post(base+"/chat/financial_strategy")
      .set(bearer("dev-admin")).send({...payload,message:"Une autre question"})
    expect(conflicting.status).toBe(409)
    expect(calls).toBe(1)
  })
  it("restricts alert policy changes to tenant admins and respects disabled rules",async()=>{
    const {app}=makeApp()
    const original=await request(app).get(base+"/signals/policy")
      .set(bearer("dev-manager-sfax"))
    expect(original.status).toBe(200)
    expect(original.body.policy.enabled).toBe(true)
    const policy={enabled:false,revenueDeclinePercent:30,overdueTnd:2000,
      stockAlertEnabled:false,cooldownDays:14}
    expect((await request(app).put(base+"/signals/policy")
      .set(bearer("dev-manager-sfax")).send(policy)).status).toBe(403)
    expect((await request(app).put(base+"/signals/policy")
      .set(bearer("dev-admin")).send({...policy,overdueTnd:-1})).status).toBe(400)
    const updated=await request(app).put(base+"/signals/policy")
      .set(bearer("dev-admin")).send(policy)
    expect(updated.status).toBe(200)
    expect(updated.body.policy.cooldownDays).toBe(14)
    const scan=await request(app).post(base+"/signals/scan").set(bearer("dev-admin"))
    expect(scan.body).toMatchObject({created:0,reason:"disabled"})
    const other=await request(app).get(base+"/signals/policy").set(bearer("dev-admin-org-b"))
    expect(other.body.policy.enabled).toBe(true)
  })
  it("rejects expired human approvals, without publishing ERP actions",async()=>{
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T10:00:00Z"))
    const {store}=makeApp()
    const svc=new AgenticWorkspace(store)
    const author={id:"creator",role:"admin",agencies:["Sfax"]}
    const reviewer={id:"reviewer",role:"manager",agencies:["Sfax"]}
    const m=await svc.createMission("demo-fictive",author,{
      agency:"Sfax",agent:"financial_strategy",title:"Vérification créances",
      objective:"Examiner les retards des créances à Sfax",
    })
    const run=await svc.submitRun("demo-fictive",author,m.id,1,{
      source:"jeu de données QA",asOf:"2025-12-31",
      summary:"Une recommandation à vérifier",findings:1,
      evidence:["INV-1"],actionType:"review_collection",
    })
    const approval=run.approval!
    expect(approval.expiresAt).toBeTruthy()
    vi.setSystemTime(new Date("2026-01-05T12:00:00Z"))
    await expect(svc.reviewApproval("demo-fictive",reviewer,approval.id,1,
      "approved","Revu")).rejects.toBeInstanceOf(WorkspaceConflict)
    expect(await svc.listActions("demo-fictive",reviewer)).toHaveLength(0)
    const rejected=await svc.reviewApproval("demo-fictive",reviewer,approval.id,1,
      "rejected","Expirée")
    expect(rejected.status).toBe("rejected")
  })
  it("checks that source has not changed before approving a recommendation",async()=>{
    const {store}=makeApp()
    const svc=new AgenticWorkspace(store)
    const author={id:"creator",role:"admin",agencies:["Sfax"]}
    const reviewer={id:"reviewer",role:"manager",agencies:["Sfax"]}
    const m=await svc.createMission("demo-fictive",author,{
      agency:"Sfax",agent:"financial_strategy",title:"Revue encours Sfax",
      objective:"Valider les créances échues et le plan de recouvrement",
    })
    const result=await svc.submitRun("demo-fictive",author,m.id,1,{
      source:"dataset-A",asOf:"2026-11-21",summary:"A revoir",findings:1,
      evidence:["INV-A"],actionType:"review_collection",
    })
    await expect(svc.reviewApproval("demo-fictive",reviewer,result.approval!.id,1,
      "approved","Contrôlé",{source:"dataset-B",asOf:"2026-11-21"}))
      .rejects.toBeInstanceOf(WorkspaceConflict)
    const ok=await svc.reviewApproval("demo-fictive",reviewer,result.approval!.id,1,
      "approved","Contrôlé",{source:"dataset-A",asOf:"2026-11-21"})
    expect(ok.status).toBe("approved")
    const packets=await svc.listActions("demo-fictive",reviewer)
    expect(packets).toHaveLength(1)
    expect(packets[0].idempotencyKey).toMatch(/^[a-f0-9]{64}$/)
    expect(packets[0].erpWriteExecuted).toBe(false)
  })
})
