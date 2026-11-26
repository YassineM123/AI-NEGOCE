import {describe,expect,it} from "vitest"
import request from "supertest"
import {bearer,makeApp} from "../../tests/qa/support/harness.js"
import {defaultDataset} from "../services.js"

describe("Snapshot to decision dossier journey",()=>{
  it("recalculates BI and DS and creates one idempotent Director dossier",async()=>{
    const data=structuredClone(defaultDataset())
    const {app}=makeApp({data})
    const before=await request(app).get("/api/v1/analytics/overview?agency=Sfax")
      .set(bearer("dev-admin"))
    expect(before.status).toBe(200)
    const originalRevenue=before.body.bi.data.revenue
    data.sales.push({...data.sales.find(x=>x.agency==="Sfax")!,id:"SNAP-CHANGE",invoiceId:"SNAP-CHANGE",
      date:data.metadata.asOf,revenue:321,cost:200,status:"posted"})
    data.metadata={...data.metadata,lastUpdated:"2026-11-21T16:00:00.000Z"}
    const body={agency:"Sfax",previousSnapshotId:before.body.snapshotId,
      objective:"Comparer les nouveaux indicateurs et élaborer un dossier de décision"}
    const response=await request(app).post("/api/v1/agentic/workspace/snapshot-dossiers")
      .set(bearer("dev-admin")).send(body)
    expect(response.status).toBe(201)
    expect(response.body.bi.revenue).toBe(originalRevenue+321)
    expect(response.body.dataScience.scenarios.basisRevenueTnd).toBe(response.body.bi.revenue)
    expect(response.body.snapshot.id).not.toBe(before.body.snapshotId)
    expect(response.body.dossier.mission.origin).toBe("snapshot_change")
    expect(response.body.dossier.mission.execution.steps).toHaveLength(4)
    expect(response.body.dossier.approval.status).toBe("pending")
    expect(response.body.erpWrites).toBe(0)
    const replay=await request(app).post("/api/v1/agentic/workspace/snapshot-dossiers")
      .set(bearer("dev-admin")).send(body)
    expect(replay.status).toBe(200)
    expect(replay.body.idempotent).toBe(true)
    expect(replay.body.dossier.mission.id).toBe(response.body.dossier.mission.id)
  })

  it("rejects unchanged snapshots and forbidden agencies",async()=>{
    const {app}=makeApp()
    const current=await request(app).get("/api/v1/analytics/overview?agency=Sfax")
      .set(bearer("dev-manager-sfax"))
    const unchanged=await request(app).post("/api/v1/agentic/workspace/snapshot-dossiers")
      .set(bearer("dev-manager-sfax")).send({agency:"Sfax",previousSnapshotId:current.body.snapshotId})
    expect(unchanged.status).toBe(409)
    expect(unchanged.body.error.code).toBe("SNAPSHOT_UNCHANGED")
    const forbidden=await request(app).post("/api/v1/agentic/workspace/snapshot-dossiers")
      .set(bearer("dev-manager-sfax")).send({agency:"Tunis Centre",previousSnapshotId:"snapshot-old"})
    expect(forbidden.status).toBe(403)
  })
})
