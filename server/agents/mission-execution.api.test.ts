import {describe,expect,it} from "vitest"
import request from "supertest"
import {bearer,makeApp} from "../../tests/qa/support/harness.js"
import {AgenticWorkspace,WorkspaceConflict} from "./workspace.js"
const base="/api/v1/agentic/workspace"

describe("Durable bounded missions — concurrency, resumption and tenant isolation",()=>{
  it("persists actual specialist checkpoints before requesting human approval",async()=>{
    const {app}=makeApp()
    const created=await request(app).post(base+"/missions")
      .set(bearer("dev-admin")).send({agency:"Sfax",agent:"director",
        title:"Diagnostic finance et stock",objective:"Comparer trésorerie et stock à Sfax"})
    expect(created.status).toBe(201)
    const id=created.body.mission.id
    const result=await request(app).post(base+"/missions/"+id+"/run")
      .set(bearer("dev-admin")).send({expectedVersion:1})
    expect(result.status).toBe(200)
    const execution=result.body.mission.execution
    expect(execution.status).toBe("completed")
    expect(execution.maxToolCalls).toBe(4)
    expect(execution.steps.map((s:{agent:string})=>s.agent))
      .toEqual(["financial_strategy","supply_chain_intelligence","business_strategy"])
    expect(execution.steps.every((s:{status:string})=>["completed","no_data"].includes(s.status)))
      .toBe(true)
    expect(execution.steps.every((s:{attemptedAt:string})=>Boolean(s.attemptedAt))).toBe(true)
    expect(result.body.mission.version).toBe(2)
    expect(result.body.erpWrites).toBe(0)
    const saved=await request(app).get(base+"/missions").set(bearer("dev-admin"))
    expect(saved.body.missions[0].execution.status).toBe("completed")
    expect((await request(app).get(base+"/missions")
      .set(bearer("dev-admin-org-b"))).body.missions).toEqual([])
  })
  it("locks concurrent runs; resumes only failed work on identical data",async()=>{
    const {store}=makeApp()
    const svc=new AgenticWorkspace(store)
    const actor={id:"actor",role:"admin",agencies:["Sfax"]}
    const m=await svc.createMission("demo-fictive",actor,{
      agency:"Sfax",agent:"director",title:"Test checkpoint et reprise",
      objective:"Analyser finance et supply chain",
    })
    const tools=[
      {id:"analysis.1",agent:"financial_strategy" as const,tool:"finance.receivable_diagnosis"},
      {id:"analysis.2",agent:"supply_chain_intelligence" as const,tool:"inventory.reorder_review"},
    ]
    const input={source:"fixture",asOf:"2026-10-15",sourceFingerprint:"fp1",tools}
    const first=await svc.beginExecution("demo-fictive",actor,m.id,1,input,
      "2026-11-21T09:00:00.000Z")
    await expect(svc.beginExecution("demo-fictive",actor,m.id,1,input,
      "2026-11-21T09:01:00.000Z")).rejects.toBeInstanceOf(WorkspaceConflict)
    await svc.checkpointExecution("demo-fictive",actor,m.id,first.execution.id,
      "analysis.1",{status:"completed",findings:1,facts:[{
        title:"C1",explanation:"Facture",actionType:"review_collection",evidence:["INV-1"],
      }]},"2026-11-21T09:00:15.000Z")
    await svc.checkpointExecution("demo-fictive",actor,m.id,first.execution.id,
      "analysis.2",{status:"failed",findings:0,errorCode:"TOOL_EXECUTION_FAILED"})
    await svc.pauseExecution("demo-fictive",actor,m.id,first.execution.id)
    await expect(svc.beginExecution("demo-fictive",actor,m.id,1,{
      ...input,sourceFingerprint:"changed",
    })).rejects.toBeInstanceOf(WorkspaceConflict)
    const second=await svc.beginExecution("demo-fictive",actor,m.id,1,input)
    expect(second.resumed).toBe(true)
    expect(second.execution.attempts).toBe(2)
    expect(second.execution.steps[0].status).toBe("completed")
    await expect(svc.checkpointExecution("demo-fictive",actor,m.id,second.execution.id,
      "analysis.1",{status:"completed",findings:1})).rejects.toBeInstanceOf(WorkspaceConflict)
    await svc.checkpointExecution("demo-fictive",actor,m.id,second.execution.id,
      "analysis.2",{status:"no_data",findings:0})
    await svc.submitRun("demo-fictive",actor,m.id,1,{
      asOf:"2026-10-15",source:"fixture",summary:"Résultats vérifiés",findings:1,
      evidence:["INV-1"],actionType:"review_collection",
    },second.execution.id)
    const done=await svc.getMission("demo-fictive",actor,m.id)
    expect(done.execution?.status).toBe("completed")
    expect(done.execution?.steps[0].facts[0].evidence).toContain("INV-1")
    expect(done.status).toBe("awaiting_approval")
    expect(done.version).toBe(2)
  })
})
