import {describe,expect,it} from "vitest"
import request from "supertest"
import {bearer,makeApp} from "../../tests/qa/support/harness.js"
import {AgenticWorkspace,WorkspaceConflict} from "./workspace.js"
const base="/api/v1/agentic/workspace"
describe("Controlled cancellation of Agentic missions",()=>{
  it("cancels only by owner/admin, rejects old versions and prevents approval",async()=>{
    const {app}=makeApp()
    const r=await request(app).post(base+"/missions").set(bearer("dev-admin"))
      .send({agency:"Sfax",agent:"financial_strategy",title:"Contrôle financier",
        objective:"Examen des factures échues de Sfax"})
    expect(r.status).toBe(201)
    const id=r.body.mission.id
    const execution=await request(app).post(base+"/missions/"+id+"/run")
      .set(bearer("dev-admin")).send({expectedVersion:1})
    expect(execution.status).toBe(200)
    const approval=execution.body.approval
    expect(approval).toBeTruthy()
    const refused=await request(app).post(base+"/missions/"+id+"/cancel")
      .set(bearer("dev-manager-sfax"))
      .send({expectedVersion:2,reason:"Demande annulee"})
    expect(refused.status).toBe(403)
    const cancelled=await request(app).post(base+"/missions/"+id+"/cancel")
      .set(bearer("dev-admin")).send({expectedVersion:2,reason:"Client a changé de périmètre"})
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.mission.status).toBe("cancelled")
    expect(cancelled.body.mission.version).toBe(3)
    expect(cancelled.body.mission.execution.status).toBe("cancelled")
    const pending=await request(app).get(base+"/approvals")
      .set(bearer("dev-manager-sfax"))
    expect(pending.body.approvals[0].status).toBe("rejected")
    const review=await request(app).post(base+"/approvals/"+approval.id+"/review")
      .set(bearer("dev-manager-sfax")).send({expectedVersion:1,decision:"approved"})
    expect(review.status).toBe(409)
    const rerun=await request(app).post(base+"/missions/"+id+"/run")
      .set(bearer("dev-admin")).send({expectedVersion:3})
    expect(rerun.status).toBe(409)
    expect((await request(app).get(base+"/actions").set(bearer("dev-admin"))).body.actions).toEqual([])
    expect((await request(app).post(base+"/missions/"+id+"/cancel")
      .set(bearer("dev-admin")).send({expectedVersion:2,reason:"Encore annulé"})).status).toBe(409)
  })
  it("cancels a running lease and blocks any stale checkpoint",async()=>{
    const {store}=makeApp(),svc=new AgenticWorkspace(store)
    const actor={id:"creator",role:"admin",agencies:["Sfax"]}
    const mission=await svc.createMission("demo-fictive",actor,{
      agency:"Sfax",agent:"financial_strategy",title:"Audit créances",
      objective:"Examiner les soldes des clients",
    })
    const started=await svc.beginExecution("demo-fictive",actor,mission.id,1,{
      source:"QA",asOf:"2026-11-21",sourceFingerprint:"hash",
      tools:[{id:"analysis.1",agent:"financial_strategy",tool:"finance.receivable_diagnosis"}],
    })
    const stopped=await svc.cancelMission("demo-fictive",actor,mission.id,1,
      "Stopper les analyses")
    expect(stopped.status).toBe("cancelled")
    await expect(svc.checkpointExecution("demo-fictive",actor,mission.id,
      started.execution.id,"analysis.1",{status:"completed",findings:1}))
      .rejects.toBeInstanceOf(WorkspaceConflict)
    const outsider={id:"b",role:"admin",agencies:["Sfax"]}
    await expect(svc.getMission("org-B",outsider,mission.id)).rejects.toBeDefined()
  })
})
