import {describe,expect,it} from "vitest"
import request from "supertest"
import {bearer,makeApp} from "../../tests/qa/support/harness.js"
import {AgenticWorkspace,WorkspaceBudgetExceeded} from "./workspace.js"
import type {LlmProvider} from "../llm/types.js"
const base="/api/v1/agentic/workspace"
describe("Agentic governed efficiency and transparent tool plans",()=>{
  it("provides a no-LLM brief, respecting domain permissions and tenant",async()=>{
    const {app}=makeApp()
    const response=await request(app).get(base+"/brief/financial_strategy?agency=Sfax")
      .set(bearer("dev-manager-sfax"))
    expect(response.status).toBe(200)
    expect(response.body.modelCalls).toBe(0)
    expect(response.body.estimatedTokens).toBe(0)
    expect(response.body.erpWrites).toBe(0)
    expect(response.body.top.length).toBeLessThanOrEqual(3)
    expect((await request(app).get(base+"/brief/financial_strategy?agency=Tunis%20Centre")
      .set(bearer("dev-manager-sfax"))).status).toBe(403)
    expect((await request(app).get(base+"/brief/business_strategy")
      .set(bearer("dev-commercial-tunis"))).status).toBe(403)
    expect((await request(app).get(base+"/brief/financial_strategy")
      .set(bearer("dev-admin-org-b"))).status).toBe(403)
  })
  it("stores tools invoked, dependencies and zero model calls in a mission trace",async()=>{
    const {app}=makeApp()
    const made=await request(app).post(base+"/missions").set(bearer("dev-admin")).send({
      agency:"Sfax",agent:"director",title:"Diagnostic stratégique avec finance et stock",
      objective:"Comparer les options de trésorerie et stock à Sfax",
    })
    expect(made.status).toBe(201)
    const run=await request(app).post(base+"/missions/"+made.body.mission.id+"/run")
      .set(bearer("dev-admin")).send({expectedVersion:1})
    expect(run.status).toBe(200)
    const trace=run.body.mission.lastRun.trace
    expect(trace.version).toBe("agentic-trace-v1")
    expect(trace.modelCalls).toBe(0)
    expect(trace.erpWrites).toBe(0)
    expect(trace.toolsInvoked).toBeGreaterThanOrEqual(2)
    expect(trace.toolsInvoked).toBeLessThanOrEqual(4)
    expect(trace.steps[0].tool).toBe("auth.agency_scope")
    expect(trace.steps.at(-1).status).toBe("waiting_human")
    expect(trace.steps[1].dependencies).toEqual(["scope"])
    expect(JSON.stringify(trace)).not.toContain("Tunis Centre")
  })
  it("counts daily model calls atomically per tenant/user and allows new day",async()=>{
    const {store}=makeApp()
    const w=new AgenticWorkspace(store)
    const actor={id:"u1",role:"admin",agencies:["*"]}
    const a=await w.reserveLlmCall("demo-fictive",actor,1,"2026-11-21T00:00:00Z")
    expect(a.callsToday).toBe(1)
    await expect(w.reserveLlmCall("demo-fictive",actor,1,"2026-11-21T12:00:00Z"))
      .rejects.toBeInstanceOf(WorkspaceBudgetExceeded)
    expect((await w.reserveLlmCall("demo-fictive",actor,1,"2026-11-22T00:00:00Z"))
      .callsToday).toBe(1)
    expect((await w.reserveLlmCall("demo-fictive-b",actor,1,"2026-11-22T01:00:00Z"))
      .callsToday).toBe(1)
  })
  it("sends a compact system context, caps LLM output and records actual usage",async()=>{
    let calls=0
    const llm:LlmProvider={
      name:"fixture-provider",isConfigured:()=>true,
      async chat(messages,options){
        calls++
        expect(messages[0].content.length).toBeLessThanOrEqual(4200)
        expect(options?.maxTokens).toBe(320)
        expect(messages.length).toBeLessThanOrEqual(6)
        return {model:"qa",content:"Une revue humaine est nécessaire.",
          usage:{promptTokens:228,completionTokens:9,totalTokens:237}}
      },
    }
    const {app}=makeApp({llm})
    const id=crypto.randomUUID()
    const response=await request(app).post(base+"/chat/financial_strategy")
      .set(bearer("dev-admin")).send({agency:"Sfax",turnId:id,
        message:"Explique les retards de paiement et les pièces associées."})
    expect(response.status).toBe(200)
    expect(calls).toBe(1)
    expect(response.body.message.usage.promptTokens).toBe(228)
    expect(response.body.message.usage.completionTokens).toBe(9)
    expect(response.body.context.factsIncluded).toBeLessThanOrEqual(4)
    expect(response.body.budget.callsToday).toBe(1)
    const repeat=await request(app).post(base+"/chat/financial_strategy")
      .set(bearer("dev-admin")).send({agency:"Sfax",turnId:id,
        message:"Explique les retards de paiement et les pièces associées."})
    expect(repeat.status).toBe(200)
    expect(repeat.body.reused).toBe(true)
    expect(calls).toBe(1)
  })
})
