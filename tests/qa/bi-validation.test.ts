// BI 360 validation: real API responses vs the independent Python Decimal oracle
// (tools/qa/bi_oracle.py) over the 10,000-document synthetic dataset.
// Every numeric discrepancy is logged to reports/evidence/bi_validation_<QA_PHASE>.json.
import fs from "node:fs"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import request from "supertest"
import { AUDIENCE, ISSUER, bearer, makeApp, startIssuer } from "./support/harness.js"
import { toMillimes } from "./support/synthetic.js"

vi.mock("../../server/data.js", async () => (await import("./support/synthetic.js")).mockDataModule())

const PHASE = process.env.QA_PHASE ?? "adhoc"
const expected = JSON.parse(fs.readFileSync("reports/evidence/bi_expected.json", "utf8"))
type Disc = { scenario: string; metric: string; expected: unknown; actual: unknown; delta?: number }
const discrepancies: Disc[] = []
const comparisons: { scenario: string; metric: string; ok: boolean }[] = []
const MONEY = ["revenue", "cost", "grossMargin", "receivables", "overdue", "inventoryValue"] as const

function compare(scenario: string, exp: Record<string, unknown>, body: Record<string, unknown>) {
  for (const metric of MONEY) {
    const e = toMillimes(exp[metric] as string)
    const a = body[metric] === undefined ? undefined : toMillimes(body[metric] as number)
    const ok = a === e
    comparisons.push({ scenario, metric, ok })
    if (!ok) discrepancies.push({ scenario, metric, expected: exp[metric], actual: body[metric] ?? "NOT EXPOSED", delta: a == null || e == null ? undefined : (a - e) / 1000 })
  }
  const ep = exp.grossMarginPercent === null ? null : Number(exp.grossMarginPercent)
  const ap = body.grossMarginPercent as number | null | undefined
  const pctOk = ep === null ? ap === null : typeof ap === "number" && Math.abs(ap - ep) < 1e-3
  comparisons.push({ scenario, metric: "grossMarginPercent", ok: pctOk })
  if (!pctOk) discrepancies.push({ scenario, metric: "grossMarginPercent", expected: ep, actual: ap })
  const rcOk = body.recordCount === exp.recordCount
  comparisons.push({ scenario, metric: "recordCount", ok: rcOk })
  if (!rcOk) discrepancies.push({ scenario, metric: "recordCount (documents)", expected: exp.recordCount, actual: body.recordCount })
  return { ok: discrepancies.filter((d) => d.scenario === scenario).length === 0 }
}

let issuer: Awaited<ReturnType<typeof startIssuer>>
let app: ReturnType<typeof makeApp>["app"]
beforeAll(async () => {
  issuer = await startIssuer()
  app = makeApp({ env: { OIDC_ISSUER: ISSUER, OIDC_AUDIENCE: AUDIENCE, OIDC_JWKS_URL: issuer.jwksUrl } }).app
})
afterAll(async () => {
  await issuer.close()
  fs.mkdirSync("reports/evidence", { recursive: true })
  fs.writeFileSync(`reports/evidence/bi_validation_${PHASE}.json`, JSON.stringify({ phase: PHASE, executedAt: new Date().toISOString(), comparisons: comparisons.length, failedComparisons: comparisons.filter((c) => !c.ok).length, discrepancies }, null, 2))
})

describe("BI 360 vs independent oracle (synthetic dataset)", () => {
  for (const sc of expected.scenarios as { id: string; agencies?: string[]; from?: string; to?: string; expected: Record<string, unknown> }[]) {
    it(`scenario ${sc.id}`, async () => {
      let req
      if (sc.agencies && sc.agencies.length > 1) {
        const token = await issuer.sign({ sub: "qa-multi", role: "manager", agencies: sc.agencies })
        req = request(app).get("/api/v1/bi/overview").query({ agency: "all" }).set(bearer(token))
      } else {
        const q: Record<string, string> = { agency: sc.agencies?.[0] ?? "all" }
        if (sc.from) q.from = sc.from
        if (sc.to) q.to = sc.to
        req = request(app).get("/api/v1/bi/overview").query(q).set(bearer("dev-admin"))
      }
      const r = await req
      expect(r.status).toBe(200)
      expect(compare(sc.id, sc.expected, r.body).ok).toBe(true)
    })
  }
})

describe("BI reconciliation properties (API only)", () => {
  it("agency revenues sum to the company revenue (exact to the millime)", async () => {
    const all = (await request(app).get("/api/v1/bi/overview?agency=all").set(bearer("dev-admin"))).body
    let sum = 0
    for (const a of ["Tunis Centre", "Sfax", "Sousse", "Bizerte", "Nabeul"])
      sum += toMillimes((await request(app).get("/api/v1/bi/overview").query({ agency: a }).set(bearer("dev-admin"))).body.revenue)!
    expect(sum).toBe(toMillimes(all.revenue))
  })
  it("customer drill-down (copilot table) reconciles with the dashboard revenue", async () => {
    const all = (await request(app).get("/api/v1/bi/overview?agency=Sfax").set(bearer("dev-admin"))).body
    const t = (await request(app).post("/api/v1/copilot/query").set(bearer("dev-admin")).send({ question: "Quel client a le plus gros chiffre d'affaires ?", filters: { agency: "Sfax" } })).body
    const sum = (t.table as { revenue: number }[]).reduce((s, r) => s + toMillimes(r.revenue)!, 0)
    expect(sum).toBe(toMillimes(all.revenue))
  })
  it("an unknown agency returns an empty, well-formed result (no NaN)", async () => {
    const r = await request(app).get("/api/v1/bi/overview?agency=Atlantis").set(bearer("dev-admin"))
    expect(r.status).toBe(200)
    expect(r.body.revenue).toBe(0)
    expect(Number.isNaN(r.body.grossMarginPercent)).toBe(false)
  })
})
