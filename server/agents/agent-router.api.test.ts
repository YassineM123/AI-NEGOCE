import {describe,expect,it} from "vitest"
import request from "supertest"
import {bearer,makeApp} from "../../tests/qa/support/harness.js"
import {routeAnalyticalQuestion} from "./agent-router.js"
import {defaultDataset} from "../services.js"
const base="/api/v1/agentic/workspace"
describe("Cost-aware factual routing",()=>{
  it("returns deterministic scoped BI numbers with modelCalls=0 and no org leak",()=>{
    const data=defaultDataset()
    const direct=routeAnalyticalQuestion({agent:"director",
      question:"Quel est le CA total ?",scope:["Sfax"],dataset:data})
    expect(direct?.mode).toBe("deterministic")
    expect(direct?.modelCalls).toBe(0)
    expect(direct?.tokens).toBe(0)
    expect(direct?.content).toContain("Sfax".replace("Sfax","Source")) // provenance included
    const ambiguous=routeAnalyticalQuestion({agent:"director",
      question:"Pourquoi le CA baisse et comment augmenter la marge ?",scope:["Sfax"],dataset:data})
    expect(ambiguous).toBeNull()
    expect(routeAnalyticalQuestion({agent:"director",
      question:"Quel était le CA en octobre 2025 ?",scope:"*",dataset:data})).toBeNull()
    expect(routeAnalyticalQuestion({agent:"director",
      question:"Quel est le CA et le stock ?",scope:"*",dataset:data})).toBeNull()
    expect(routeAnalyticalQuestion({agent:"director",
      question:"Quel est le CA de Tunis Centre ?",scope:["Sfax"],dataset:data})).toBeNull()
    const scoped=routeAnalyticalQuestion({agent:"director",
      question:"Quel est le CA de Sfax ?",scope:"*",dataset:data})
    const sfax=routeAnalyticalQuestion({agent:"director",
      question:"Quel est le CA ?",scope:["Sfax"],dataset:data})
    expect(scoped?.content).toEqual(sfax?.content)
  })
  it("provides zero-token answers without any configured LLM",async()=>{
    const {app}=makeApp()
    const turnId=crypto.randomUUID()
    const response=await request(app).post(base+"/chat/financial_strategy")
      .set(bearer("dev-manager-sfax")).send({
        agency:"Sfax",turnId,message:"Combien de créances échues ?",
      })
    expect(response.status).toBe(200)
    expect(response.body.mode).toBe("deterministic")
    expect(response.body.message.usage.totalTokens).toBe(0)
    expect(response.body.message.content).toContain("Créances échues")
    const usage=await request(app).get(base+"/usage").set(bearer("dev-manager-sfax"))
    expect(usage.body.callsToday).toBe(0)
    const replay=await request(app).post(base+"/chat/financial_strategy")
      .set(bearer("dev-manager-sfax")).send({
        agency:"Sfax",turnId,message:"Combien de créances échues ?",
      })
    expect(replay.status).toBe(200)
    expect(replay.body.reused).toBe(true)
    expect((await request(app).post(base+"/chat/financial_strategy")
      .set(bearer("dev-manager-sfax")).send({
        agency:"Tunis Centre",turnId:crypto.randomUUID(),
        message:"Combien de créances échues ?",
      })).status).toBe(403)
  })
  it("does not leak another company's data into fixed answers",async()=>{
    const {app}=makeApp()
    const r=await request(app).post(base+"/chat/financial_strategy")
      .set(bearer("dev-admin-org-b")).send({
        agency:"all",turnId:crypto.randomUUID(),message:"Combien de créances échues ?",
      })
    expect(r.status).toBe(403)
    expect(r.body.error.code).toBe("ERP_SOURCE_UNAVAILABLE")
  })
})
