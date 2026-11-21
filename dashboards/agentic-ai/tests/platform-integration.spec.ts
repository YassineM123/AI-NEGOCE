import { test, expect } from "@playwright/test"

// End-to-end against the real React/BI/DS browser code.
// The HTTP backend is mocked, so this validates authentication delegation and UI
// reconciliation, not a production LAI ERP connection.
function contextFixture() {
  return {
    contractVersion: "1.0",
    generatedAt: "2026-11-21T12:00:00.000Z",
    principal: { id: "qa", organizationId: "demo-fictive", role: "admin", agencies: "*" },
    permissions: ["analytics.bi.read", "analytics.ds.read", "agentic.read"],
    platforms: {
      bi: { status: "available" },
      dataScience: { status: "not_configured", modelServingVerified: false },
      agentic: { status: "available", executionMode: "read_only" },
    },
  }
}
function overviewFixture(params: URLSearchParams) {
  const agency = params.get("agency") ?? "all"
  const from = params.get("from") ?? ""
  const to = params.get("to") ?? ""
  const seed = (agency === "Sfax" ? 100 : agency === "Tunis Centre" ? 200 : 300) +
    (from === "2026-07-01" ? 1000 : from === "2026-01-01" ? 2000 : 0)
  const filters = { agencies: agency === "all" ? "*" : [agency], from, to }
  return {
    contractVersion: "1.0",
    snapshotId: "snap-" + agency.replace(/\s/g, "-") + "-" + from,
    generatedAt: "2026-11-21T12:00:00.000Z",
    scope: filters.agencies,
    snapshot: { asOf: "2026-10-31", source: "Synthetic QA", sourceKind: "sandbox", isSynthetic: true },
    bi: {
      status: "available",
      data: {
        revenue: seed, cost: seed / 2, grossMargin: seed / 2,
        grossMarginPercent: 50, receivables: seed / 10,
        overdue: seed / 20, inventoryValue: 5000,
        recordCount: 2, missingCostRecords: 0, marginCoverage: "complete",
        filters,
        metadata: { source: "Synthetic QA", asOf: "2026-10-31", currency: "TND" },
      },
    },
    dataScience: { status: "not_configured", modelServingVerified: false, predictions: [] },
    agentic: {
      status: "available", executionMode: "read_only",
      availableAgents: ["revenue_growth", "financial_strategy", "supply_chain_intelligence", "business_strategy"],
    },
    warnings: ["Données synthétiques de test"],
  }
}
test("three apps reuse one session and reconcile exact agency/period KPI snapshot", async ({ page }) => {
  test.setTimeout(120_000)
  let sessionRequests = 0
  let analyticsRequests: URLSearchParams[] = []
  await page.route("**/api/v1/auth/dev-session", async (route) => {
    sessionRequests++
    await route.fulfill({
      status: 201, contentType: "application/json",
      body: JSON.stringify({ token: "qa-parent-only-token" }),
    })
  })
  await page.route("**/api/v1/platform/context", async (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(contextFixture()) }))
  await page.route("**/api/v1/analytics/overview?*", async (route) => {
    const request = route.request()
    expect(request.headers().authorization).toBe("Bearer qa-parent-only-token")
    const query = new URL(request.url()).searchParams
    analyticsRequests.push(new URLSearchParams(query))
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(overviewFixture(query)),
    })
  })
  await page.route("**/api/v1/agentic/revenue-growth/opportunities?*", async (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        agent: "revenue_growth", status: "no_data", executionMode: "read_only",
        snapshot: { asOf: "2026-10-31", source: "Synthetic QA" },
        analysis: { customersAnalyzed: 0, opportunitiesFound: 0, returned: 0 },
        opportunities: [], warnings: [],
      }),
    }))
  await page.route("**/api/v1/agentic/financial-strategy/analysis?*", async (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }))
  await page.route("**/api/v1/agentic/supply-chain/recommendations?*", async (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }))
  await page.route("**/api/v1/agentic/business-strategy/scenarios?*", async (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }))

  await page.goto("/")
  await page.getByRole("button", { name: "Plateformes BI / DS" }).click()
  await page.getByRole("button", { name: "Connecter la session sandbox" }).click()
  const agentic = page.locator('[data-platform-app="agentic"]')
  const bi = page.frameLocator('iframe[title="Data Analyse"]')
  await expect(agentic.locator('[data-shared-kpi="revenue"]')).toHaveText("300.000")
  await expect(bi.locator('[data-shared-kpi="revenue"]')).toHaveText("300.000", { timeout: 30000 })
  await expect(bi.locator('[data-shared-kpi="receivables"]')).toHaveText("30.000")
  await expect(agentic).toHaveAttribute("data-platform-snapshot", "snap-all-2026-10-01")

  await page.getByRole("combobox", { name: "Agence" }).selectOption("Sfax")
  await expect(agentic.locator('[data-shared-kpi="revenue"]')).toHaveText("100.000")
  await expect(bi.locator('[data-shared-kpi="revenue"]')).toHaveText("100.000")
  await expect(bi.locator('[data-shared-kpi="receivables"]')).toHaveText("10.000")
  await expect(bi.locator('[data-platform-app="bi"]')).toHaveAttribute("data-platform-snapshot", "snap-Sfax-2026-10-01")

  await page.getByRole("tab", { name: "Data Science · Studio" }).click()
  const ds = page.frameLocator('iframe[title="Data Science"]')
  await expect(ds.locator('[data-shared-kpi="revenue"]')).toHaveText("100.000", { timeout: 45000 })
  await expect(ds.locator('[data-shared-kpi="receivables"]')).toHaveText("10.000")

  await page.getByRole("combobox", { name: "Période" }).selectOption("T3 2026")
  await expect(agentic.locator('[data-shared-kpi="revenue"]')).toHaveText("1100.000")
  await expect(ds.locator('[data-shared-kpi="revenue"]')).toHaveText("1100.000", { timeout: 45000 })
  await expect(ds.locator('[data-shared-kpi="receivables"]')).toHaveText("110.000")
  await expect(ds.locator('[data-platform-app="ds"]')).toHaveAttribute("data-platform-snapshot", "snap-Sfax-2026-07-01")

  await page.getByRole("tab", { name: "Data Analyse · BI" }).click()
  await expect(bi.locator('[data-shared-kpi="revenue"]')).toHaveText("1100.000", { timeout: 30000 })
  await expect(agentic).toHaveAttribute("data-platform-snapshot", "snap-Sfax-2026-07-01")
  expect(sessionRequests).toBe(1) // single sign-in; frames cannot ask for their own dev token
  expect(analyticsRequests.some((x) => x.get("agency") === "Sfax" && x.get("from") === "2026-07-01" && x.get("to") === "2026-09-30")).toBe(true)

  await page.getByRole("button", { name: "Déconnecter les 3 plateformes" }).click()
  await expect(agentic).toHaveCount(0)
  await expect(bi.locator('[data-platform-app="bi"]')).toHaveCount(0)
})

test("the BI iframe can reach the exact Database extract paths and isolated synthetic scenarios", async ({ request }) => {
  // The legacy BI frame resolves ../../Database/extractions from /platform/bi/.
  // Both static aliases must exist so the client never sees empty BI cards.
  const checks = [
    { url: "/Database/extractions/ventes/journal_ventes_2026_demo.csv", header: "date_facture", rows: 3158 },
    { url: "/data/extractions/ventes/journal_ventes_2026_demo.csv", header: "date_facture", rows: 3158 },
    { url: "/Database/extractions/demonstration/fournisseurs_livraisons_demo_synthetique.csv", header: "commande_id", rows: 8 },
    { url: "/Database/extractions/demonstration/plan_tresorerie_demo_synthetique.csv", header: "mois", rows: 6 },
  ]
  for (const file of checks) {
    const response = await request.get(file.url)
    expect(response.status(), file.url).toBe(200)
    expect(response.headers()["content-type"], file.url).toContain("text/csv")
    const lines = (await response.text()).trim().split(/\r?\n/)
    expect(lines[0], file.url).toContain(file.header)
    expect(lines.length - 1, file.url).toBe(file.rows)
  }
})
