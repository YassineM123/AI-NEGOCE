import { describe, expect, it } from "vitest"
import request from "supertest"
import { bearer, makeApp } from "../../tests/qa/support/harness.js"

describe("Revenue Growth Agent HTTP permissions", () => {
  const url = "/api/v1/agentic/revenue-growth/opportunities"

  it("requires verified authentication", async () => {
    const { app } = makeApp()
    expect((await request(app).get(url)).status).toBe(401)
  })

  it("returns source-aware read-only opportunities for an authorized branch", async () => {
    const { app } = makeApp()
    const response = await request(app).get(url + "?agency=Sfax&windowDays=90&limit=10").set(bearer("dev-manager-sfax"))
    expect(response.status).toBe(200)
    expect(response.body.agent).toBe("revenue_growth")
    expect(response.body.executionMode).toBe("read_only")
    expect(response.body.snapshot.scope).toEqual(["Sfax"])
    expect(response.body.snapshot.source).toMatch(/fictif|synthétique/i)
    expect(response.body.opportunities.every((item: { agency: string }) => item.agency === "Sfax")).toBe(true)
    expect(response.body.opportunities.every((item: { proposedAction: { status: string } }) => item.proposedAction.status === "draft_only")).toBe(true)
  })

  it("blocks cross-agency requests rather than silently widening the scope", async () => {
    const { app } = makeApp()
    const response = await request(app).get(url + "?agency=Tunis%20Centre").set(bearer("dev-manager-sfax"))
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe("AGENCY_FORBIDDEN")
  })

  it("blocks access to a different organization's shared synthetic ERP dataset", async () => {
    const { app } = makeApp()
    const response = await request(app).get(url).set(bearer("dev-admin-org-b"))
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe("ERP_SOURCE_UNAVAILABLE")
  })

  it("validates limits and durations on the server", async () => {
    const { app } = makeApp()
    const response = await request(app).get(url + "?windowDays=7&limit=999").set(bearer("dev-admin"))
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe("INVALID_REQUEST")
  })

})
