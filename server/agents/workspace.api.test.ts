import { describe, expect, it } from "vitest"
import request from "supertest"
import { bearer, makeApp } from "../../tests/qa/support/harness.js"
import type { LlmProvider } from "../llm/types.js"
import { AgenticWorkspace } from "./workspace.js"

const base="/api/v1/agentic/workspace"
const mission={agency:"Sfax",agent:"supply_chain_intelligence",
  title:"Examiner les ruptures sur Sfax",
  objective:"Évaluer les seuils des produits critiques à Sfax"}
const create=(app:ReturnType<typeof makeApp>["app"]) =>
  request(app).post(base+"/missions").set(bearer("dev-admin")).send(mission)
describe("Advanced Agentic workspace — authenticated and scoped",()=>{
  it("requires authentication and validates roles, agencies and payloads",async()=>{
    const {app}=makeApp()
    expect((await request(app).get(base+"/missions")).status).toBe(401)
    expect((await request(app).post(base+"/missions").send(mission)).status).toBe(401)
    expect((await request(app).post(base+"/missions").set(bearer("dev-manager-sfax"))
      .send({...mission,agency:"Tunis Centre"})).status).toBe(403)
    expect((await request(app).post(base+"/missions").set(bearer("dev-commercial-tunis"))
      .send(mission)).status).toBe(403)
    expect((await request(app).post(base+"/missions").set(bearer("dev-admin"))
      .send({...mission,title:"x"})).status).toBe(400)
  })
  it("persists a mission on the store and restricts other organizations and agencies",async()=>{
    const {app}=makeApp()
    const made=await create(app)
    expect(made.status).toBe(201)
    expect(made.body.mission.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(made.body.mission.status).toBe("draft")
    const mine=await request(app).get(base+"/missions").set(bearer("dev-admin"))
    expect(mine.body.missions).toHaveLength(1)
    const sfax=await request(app).get(base+"/missions").set(bearer("dev-manager-sfax"))
    expect(sfax.body.missions).toHaveLength(1)
    const other=await request(app).get(base+"/missions").set(bearer("dev-admin-org-b"))
    expect(other.body.missions).toEqual([])
    const notifs=await request(app).get(base+"/notifications").set(bearer("dev-admin"))
    expect(notifs.body.unread).toBe(1)
  })
  it("turns a deterministic investigation into a reviewer-only draft approval",async()=>{
    const {app}=makeApp()
    const made=await create(app)
    expect(made.status).toBe(201)
    const id=made.body.mission.id
    const run=await request(app).post(base+"/missions/"+id+"/run").set(bearer("dev-admin"))
      .send({expectedVersion:1})
    expect(run.status).toBe(200)
    expect(run.body.executionMode).toBe("read_only")
    expect(run.body.erpWrites).toBe(0)
    expect(run.body.mission.version).toBe(2)
    expect(run.body.mission.lastRun.source).toBeTruthy()
    if(run.body.approval){
      const pending=await request(app).get(base+"/approvals").set(bearer("dev-manager-sfax"))
      expect(pending.body.approvals[0].id).toBe(run.body.approval.id)
      const self=await request(app).post(base+"/approvals/"+run.body.approval.id+"/review")
        .set(bearer("dev-admin")).send({expectedVersion:1,decision:"approved"})
      expect(self.status).toBe(403)
      const approved=await request(app).post(base+"/approvals/"+run.body.approval.id+"/review")
        .set(bearer("dev-manager-sfax")).send({expectedVersion:1,decision:"approved",comment:"Revu"})
      expect(approved.status).toBe(200)
      expect(approved.body.erpWriteExecuted).toBe(false)
      expect(approved.body.approval.reviewedBy).toBe("usr-sfax")
      const replay=await request(app).post(base+"/approvals/"+run.body.approval.id+"/review")
        .set(bearer("dev-manager-sfax")).send({expectedVersion:1,decision:"approved"})
      expect(replay.status).toBe(409)
    }
    const stale=await request(app).post(base+"/missions/"+id+"/run").set(bearer("dev-admin"))
      .send({expectedVersion:1})
    expect(stale.status).toBe(409)
  })
  it("protects approval list and forbids changing another organization's mission",async()=>{
    const {app}=makeApp()
    const created=await create(app)
    expect(created.status).toBe(201)
    expect((await request(app).get(base+"/approvals").set(bearer("dev-commercial-tunis"))).status).toBe(403)
    const outsider=await request(app).post(base+"/missions/"+created.body.mission.id+"/run")
      .set(bearer("dev-admin-org-b")).send({expectedVersion:1})
    expect(outsider.status).toBe(403) // ERP_SOURCE_UNAVAILABLE (no shared source)
  })
  it("does not pretend to offer a real LLM without a configured provider",async()=>{
    const {app}=makeApp()
    const r=await request(app).post(base+"/chat/financial_strategy").set(bearer("dev-admin"))
      .send({agency:"Sfax",turnId:crypto.randomUUID(),message:"Explique les créances échues."})
    expect(r.status).toBe(503)
    expect(r.body.error.code).toBe("AGENT_LLM_UNCONFIGURED")
    const history=await request(app).get(base+"/chat/financial_strategy?agency=Sfax").set(bearer("dev-admin"))
    expect(history.body.messages).toEqual([])
  })
  it("persists real-provider-style grounded conversation and resists duplicate turn IDs",async()=>{
    let calls=0
    const llm:LlmProvider={name:"test-genuine-provider",isConfigured:()=>true,async chat(messages){
      calls++
      expect(messages[0].role).toBe("system")
      expect(messages[0].content).toContain("date arrêtée")
      return {model:"qa-model",content:"Les pièces citées doivent être vérifiées avant décision."}
    }}
    const {app}=makeApp({llm})
    const turnId=crypto.randomUUID()
    const payload={agency:"Sfax",turnId,message:"Quels dossiers dois-je contrôler ?"}
    const first=await request(app).post(base+"/chat/financial_strategy")
      .set(bearer("dev-admin")).send(payload)
    expect(first.status).toBe(200)
    expect(first.body.mode).toBe("llm_grounded")
    expect(first.body.erpWrites).toBe(0)
    expect(first.body.message.model).toBe("qa-model")
    const repeat=await request(app).post(base+"/chat/financial_strategy")
      .set(bearer("dev-admin")).send(payload)
    expect(repeat.status).toBe(200)
    expect(repeat.body.reused).toBe(true)
    expect(calls).toBe(1)
    const history=await request(app).get(base+"/chat/financial_strategy?agency=Sfax")
      .set(bearer("dev-admin"))
    expect(history.body.messages).toHaveLength(2)
    expect((await request(app).get(base+"/chat/financial_strategy?agency=Sfax")
      .set(bearer("dev-admin-org-b"))).body.messages).toEqual([])
    expect((await request(app).get(base+"/chat/business_strategy?agency=Tunis%20Centre")
      .set(bearer("dev-manager-sfax"))).status).toBe(403)
  })
  it("automatically generates one due notification per day and tracks reads per user",async()=>{
    const {app,store}=makeApp()
    const created=await request(app).post(base+"/missions").set(bearer("dev-admin"))
      .send({...mission,dueAt:"2026-01-02T09:00:00.000Z"})
    expect(created.status).toBe(201)
    const svc=new AgenticWorkspace(store)
    expect(await svc.scanDue("demo-fictive","2026-11-21T10:00:00.000Z")).toBe(1)
    expect(await svc.scanDue("demo-fictive","2026-11-21T14:00:00.000Z")).toBe(0)
    const before=await request(app).get(base+"/notifications").set(bearer("dev-admin"))
    expect(before.body.unread).toBe(2)
    const due=before.body.notifications.find((n:{kind:string})=>n.kind==="due")
    const read=await request(app).post(base+"/notifications/"+due.id+"/read")
      .set(bearer("dev-admin"))
    expect(read.status).toBe(200)
    const after=await request(app).get(base+"/notifications").set(bearer("dev-admin"))
    expect(after.body.unread).toBe(1)
    expect((await request(app).post(base+"/notifications/"+due.id+"/read")
      .set(bearer("dev-admin-org-b"))).status).toBe(404)
  })
})
