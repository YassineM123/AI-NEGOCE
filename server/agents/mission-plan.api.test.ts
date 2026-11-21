import {describe,expect,it} from "vitest"
import request from "supertest"
import {bearer,makeApp} from "../../tests/qa/support/harness.js"
const base="/api/v1/agentic/workspace"
describe("Read-only Director preview route",()=>{
  it("returns an authorized deterministic plan and refuses other tenants",async()=>{
    const {app}=makeApp()
    const made=await request(app).post(base+"/missions").set(bearer("dev-admin"))
      .send({agency:"Sfax",agent:"director",title:"Plan financier et croissance",
        objective:"Augmenter le CA de 15 % en 12 mois sans dégrader la trésorerie"})
    expect(made.status).toBe(201)
    const id=made.body.mission.id
    const good=await request(app).get(base+"/missions/"+id+"/plan").set(bearer("dev-admin"))
    expect(good.status).toBe(200)
    expect(good.body.plan.planVersion).toBe("director-plan-v1")
    expect(good.body.plan.tools).toHaveLength(4)
    expect(good.body.plan.estimatedLlmCalls).toBe(0)
    expect(good.body.plan.erpWriteBudget).toBe(0)
    expect(good.body.plan.scope).toEqual(["Sfax"])
    expect((await request(app).get(base+"/missions/"+id+"/plan")
      .set(bearer("dev-manager-sfax"))).status).toBe(200)
    expect((await request(app).get(base+"/missions/"+id+"/plan")
      .set(bearer("dev-commercial-tunis"))).status).toBe(404)
    expect((await request(app).get(base+"/missions/"+id+"/plan")
      .set(bearer("dev-admin-org-b"))).status).toBe(403)
  })
})
