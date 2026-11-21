import { describe, expect, it } from "vitest"
import request from "supertest"
import { bearer, makeApp } from "../../tests/qa/support/harness.js"

const base="/api/v1/agentic/workspace"
describe("Agentic v2 — prediction, proactive detection and approved handoff",()=>{
  it("keeps the model gated by tenant/agency and DS permissions",async()=>{
    const {app}=makeApp()
    const r=await request(app).get(base+"/predictions?agency=Sfax").set(bearer("dev-manager-sfax"))
    expect(r.status).toBe(200)
    expect(r.body.model.version).toBe("ridge-trend-v1.0.0")
    expect(r.body.verifiedProduction).toBe(false)
    expect(r.body.eligibleForAutonomousActions).toBe(false)
    expect(r.body.predictions).toEqual([])
    expect((await request(app).get(base+"/predictions?agency=Tunis%20Centre")
      .set(bearer("dev-manager-sfax"))).status).toBe(403)
    expect((await request(app).get(base+"/predictions")
      .set(bearer("dev-commercial-tunis"))).status).toBe(403)
    expect((await request(app).get(base+"/predictions")
      .set(bearer("dev-admin-org-b"))).status).toBe(403)
    expect((await request(app).get(base+"/predictions?from=2026-12-31&to=2026-01-01")
      .set(bearer("dev-admin"))).status).toBe(400)
  })
  it("preserves four atomic mission steps and produces a manually transferable approved action",async()=>{
    const {app}=makeApp()
    const created=await request(app).post(base+"/missions").set(bearer("dev-admin")).send({
      agency:"Sfax",agent:"financial_strategy",title:"Revue des créances Sfax",
      objective:"Identifier les créances et proposer une action après double contrôle",
    })
    expect(created.status).toBe(201)
    const mission=created.body.mission
    expect(mission.steps).toHaveLength(4)
    expect(mission.steps.map((s:{status:string})=>s.status)).toEqual([
      "completed","active","pending","pending",
    ])
    const run=await request(app).post(base+"/missions/"+mission.id+"/run")
      .set(bearer("dev-admin")).send({expectedVersion:mission.version})
    expect(run.status).toBe(200)
    expect(run.body.mission.lastRun.prediction.eligibleForAutonomousActions).toBeUndefined()
    expect(run.body.mission.steps[1].status).toBe("completed")
    expect(run.body.approval).toBeTruthy()
    expect(run.body.mission.steps[2].status).toBe("active")
    const review=await request(app).post(base+"/approvals/"+run.body.approval.id+"/review")
      .set(bearer("dev-manager-sfax")).send({
        expectedVersion:run.body.approval.version,decision:"approved",comment:"Pièces à vérifier avant toute relance",
      })
    expect(review.status).toBe(200)
    expect(review.body.erpWriteExecuted).toBe(false)
    const list=await request(app).get(base+"/actions").set(bearer("dev-manager-sfax"))
    expect(list.status).toBe(200)
    expect(list.body.actions).toHaveLength(1)
    const packet=list.body.actions[0]
    expect(packet.approvalId).toBe(review.body.approval.id)
    expect(packet.erpWriteExecuted).toBe(false)
    expect(packet.status).toBe("approved_for_manual_handoff")
    const output=await request(app).get(base+"/actions/"+packet.id+"/export")
      .set(bearer("dev-manager-sfax"))
    expect(output.status).toBe(200)
    expect(output.body.kind).toBe("approved_action_packet")
    expect(output.body.erpWriteExecuted).toBe(false)
    const updated=(await request(app).get(base+"/missions").set(bearer("dev-admin"))).body.missions[0]
    expect(updated.steps.map((s:{status:string})=>s.status)).toEqual([
      "completed","completed","completed","completed",
    ])
    expect((await request(app).get(base+"/actions").set(bearer("dev-admin-org-b")))
      .body.actions).toEqual([])
    expect((await request(app).get(base+"/actions/"+packet.id+"/export")
      .set(bearer("dev-admin-org-b"))).status).toBe(404)
    const retry=await request(app).post(base+"/approvals/"+packet.approvalId+"/review")
      .set(bearer("dev-manager-sfax")).send({expectedVersion:1,decision:"approved"})
    expect(retry.status).toBe(409)
  })
  it("scans source-provenance alerts once, applies reviewer agency isolation and ACK",async()=>{
    const {app}=makeApp()
    const first=await request(app).post(base+"/signals/scan").set(bearer("dev-admin"))
    expect(first.status).toBe(200)
    expect(first.body.created).toBeGreaterThan(0)
    const again=await request(app).post(base+"/signals/scan").set(bearer("dev-admin"))
    expect(again.status).toBe(200)
    expect(again.body.created).toBe(0)
    const sfax=await request(app).get(base+"/signals").set(bearer("dev-manager-sfax"))
    expect(sfax.status).toBe(200)
    expect(sfax.body.signals.length).toBeGreaterThan(0)
    expect(sfax.body.signals.every((s:{agency:string})=>s.agency==="Sfax")).toBe(true)
    const signal=sfax.body.signals[0]
    const ack=await request(app).post(base+"/signals/"+signal.id+"/acknowledge")
      .set(bearer("dev-manager-sfax"))
    expect(ack.status).toBe(200)
    expect(ack.body.signal.acknowledgedBy).toBe("usr-sfax")
    expect((await request(app).get(base+"/signals").set(bearer("dev-commercial-tunis"))).status).toBe(403)
    expect((await request(app).post(base+"/signals/scan").set(bearer("dev-manager-sfax"))).status).toBe(403)
    expect((await request(app).post(base+"/signals/scan").set(bearer("dev-admin-org-b"))).status).toBe(403)
    const other=await request(app).get(base+"/signals").set(bearer("dev-admin-org-b"))
    expect(other.body.signals).toEqual([])
  })
})
