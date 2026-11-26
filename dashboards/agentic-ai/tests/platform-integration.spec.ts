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
function overviewFixture(params: URLSearchParams,revision=1) {
  const agency = params.get("agency") ?? "all"
  const from = params.get("from") ?? ""
  const to = params.get("to") ?? ""
  const seed = ((agency === "Sfax" ? 100 : agency === "Tunis Centre" ? 200 : 300) +
    (from === "2026-07-01" ? 1000 : from === "2026-01-01" ? 2000 : 0))*revision
  const filters = { agencies: agency === "all" ? "*" : [agency], from, to }
  return {
    contractVersion: "1.0",
    snapshotId: "snap-" + agency.replace(/\s/g, "-") + "-" + from + (revision>1?"-rev-"+revision:""),
    generatedAt: "2026-11-21T12:00:00.000Z",
    scope: filters.agencies,
    snapshot: { asOf: "2026-10-31", source: "Synthetic QA", sourceKind: "sandbox", isSynthetic: true, storage:"postgres",revision,
      ...(revision>1?{demo:{mode:"synthetic_live_demo",
        lastEvent:{id:"SIM-0000010",kind:"sale",agency:"Sfax",date:"2026-10-31",
        reference:"SIM-0000010",amountTnd:150,units:1,
        description:"Vente fictive synchronisée",erpWrites:0}}}:{})},
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
    dataScience: {status:"available",modelServingVerified:false,predictions:[],
      analysis:{
        version:"ds-scoped-v1",mode:"governed_read_only",
        source:"Synthetic QA",asOf:"2026-10-31",referenceDate:"2026-10-31",
        portfolio:{status:"observed",customers:1,inactive90:1,watch30to89:0,recent0to29:0,
          scoring:"observed_recency_not_churn_probability",
          top:[{customerId:"qa-customer",name:"Client QA",revenueTnd:seed,
            documents:2,daysSinceLastPurchase:111,segment:"inactive_90"}]},
        trend:{months:[{month:from.slice(0,7),revenue:seed,documents:2,customers:1,closed:true}],
          changePercent:null,classification:"not_comparable",method:"consecutive_closed_months_only"},
        forecast:{status:"insufficient_history",modelVersion:"ridge-trend-v1.0.0",
          trainedThrough:null,trainingMonths:1,
          backtest:{holdoutMonths:0,wape:null,bias:null,thresholdWape:0.35},
          predictions:[],verifiedProduction:false,warnings:["historique insuffisant"]},
        skuDemand:{status:"pilot_not_certified",eligibleForAutonomousActions:false,quantityCoverage:{salesRows:2,withQuantity:0},evaluated:0,backtested:0,results:[],warnings:["Aucune quantité source"]},
        inventory:{status:"not_available",periodApplicable:false,positions:0,positionsWithThreshold:0,
          belowReorder:0,topBelow:[]},
        cash:{status:"not_available",asOf:"2026-10-31",
          basis:"outstanding_for_invoices_issued_in_selected_period",
          outstandingTnd:0,overdueTnd:0,buckets:[
            {key:"not_due",label:"Non échues",amountTnd:0,documents:0}]},
        scenarios:{status:"hypotheses",basisRevenueTnd:seed,
          options:[{id:"prudent",label:"Prudent",variationPercent:-10,
            revenueTnd:Math.round(seed*900)/1000,cashImpactTnd:null,netMarginTnd:null,feasible:null},
          {id:"central",label:"Central",variationPercent:0,revenueTnd:seed,
            cashImpactTnd:null,netMarginTnd:null,feasible:null},
          {id:"ambitious",label:"Ambitieux",variationPercent:15,
            revenueTnd:Math.round(seed*1150)/1000,
            cashImpactTnd:null,netMarginTnd:null,feasible:null}],
          method:"arithmetic_sensitivity_not_forecast"},
        warnings:["Données synthétiques; modèles expérimentaux"],
      },
    },
    agentic: {
      status: "available", executionMode: "read_only",
      availableAgents: ["revenue_growth", "financial_strategy", "supply_chain_intelligence", "business_strategy"],
    },
    insights: {
      currency: "TND", basis: "posted_sales_net_ht", referenceDate: "2026-10-31",
      months: [{ month: from.slice(0, 7), revenue: seed, documents: 2, customers: 1, closed: true }],
      topCustomers: [{ id: "qa-customer", name: "Client QA", revenue: seed,
        documents: 2, lastPurchase: "2026-07-12", daysSinceLastPurchase: 111, sharePercent: 100 }],
      summary: { revenue: seed, salesRows: 2, documentCount: 2, customerCount: 1,
        topFiveSharePercent: 100, monthlyChangePercent: null, historyTruncated: false },
      coverage: { costKnownRows: 2, costMissingRows: 0, receivablesAvailable: true,
        inventoryValuationAvailable: true, agencyAttributionAvailable: true,
        invoiceItemLinksAvailable: false, modelServingVerified: false },
      warnings: ["Données synthétiques de test"],
    },
    warnings: ["Données synthétiques de test"],
  }
}
test("three apps reuse one session and reconcile exact agency/period KPI snapshot", async ({ page }) => {
  test.setTimeout(120_000)
  let sessionRequests = 0
  let datasetRevision = 1
  let createdMissions = 0
  let executedMissions = 0
  let analyticsRequests: URLSearchParams[] = []
  const agentRequests:Record<string,URLSearchParams[]>={revenue:[],finance:[],supply:[],strategy:[]}
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
      body: JSON.stringify(overviewFixture(query,datasetRevision)),
    })
  })
  await page.route("**/api/v1/agentic/revenue-growth/opportunities?*", async (route) => {
    agentRequests.revenue.push(new URL(route.request().url()).searchParams)
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        agent: "revenue_growth", status: "no_data", executionMode: "read_only",
        snapshot: { asOf: "2026-10-31", source: "Synthetic QA" },
        analysis: { customersAnalyzed: 0, opportunitiesFound: 0, returned: 0 },
        opportunities: [], warnings: [],
      }),
    })
  })
  await page.route("**/api/v1/agentic/financial-strategy/analysis?*", async (route) => {
    agentRequests.finance.push(new URL(route.request().url()).searchParams)
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
  })
  await page.route("**/api/v1/agentic/supply-chain/recommendations?*", async (route) => {
    agentRequests.supply.push(new URL(route.request().url()).searchParams)
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
  })
  await page.route("**/api/v1/agentic/business-strategy/scenarios?*", async (route) => {
    agentRequests.strategy.push(new URL(route.request().url()).searchParams)
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
  })

  await page.route("**/api/v1/agentic/workspace/missions", async route=>{
    if(route.request().method()==="GET"){
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({missions:[]})})
    }
    const body=route.request().postDataJSON() as {agent:string;agency:string;from:string;to:string}
    expect(body).toMatchObject({agent:"director",agency:"Sfax",from:"2026-07-01",to:"2026-09-30"})
    createdMissions++
    return route.fulfill({status:201,contentType:"application/json",
      body:JSON.stringify({mission:{id:"00000000-0000-4000-8000-000000000011",version:1}})})
  })
  await page.route("**/api/v1/agentic/workspace/missions/*/run",async route=>{
    executedMissions++
    expect(route.request().postDataJSON()).toEqual({expectedVersion:1})
    return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({mission:{lastRun:{findings:3}},approval:{id:"approval-revision-2"}})})
  })
  await page.route("**/api/v1/agentic/simulations/explain",async route=>{
    expect(route.request().headers().authorization).toBe("Bearer qa-parent-only-token")
    const body=route.request().postDataJSON() as {kind:string;agency:string;inputs:Record<string,unknown>}
    expect(body.agency).toBe("Sfax")
    const isStock=body.kind==="stock_coverage"
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      kind:body.kind,status:"hypothesis_only",agency:body.agency,asOf:body.inputs.asOf,
      erpWrites:0,modelCalls:0,executionMode:"read_only",
      result:body.kind==="expansion_investment"?
         {upfrontInvestmentTnd:120000,monthlyNetContributionTnd:7000,
          npvTnd:48000,paybackMonth:18,cashAfterInitialInvestmentTnd:80000,
          breachesAssumedCashFloor:true}:isStock?
        {coverageDays:6,leadTimeDays:10,shortfallDays:4,shortageUnits:80,beforeReplenishment:true}:
        {projectedCashTnd:150000,shortfallToFloorTnd:100000,breachesFloor:true},
      explanation:body.kind==="expansion_investment"?"VAN hypothétique":isStock?"Couverture = disponible / consommation":"Solde = initial + entrées - sorties",
      warnings:["Hypothèses non rapprochées de l’ERP"],
      sourceContext:{source:"Synthetic QA",asOf:"2026-10-31",usedForCalculations:false},
    })})
  })
  await page.goto("/")
  await page.getByRole("button", { name: "Plateformes BI / DS" }).click()
  await page.getByRole("button", { name: "Connecter la session sandbox" }).click()
  const agentic = page.locator('[data-platform-app="agentic"]')
  const bi = page.frameLocator('iframe[title="Data Analyse"]')
  await expect(agentic.locator('[data-shared-kpi="revenue"]')).toHaveText("300.000")
  await expect(bi.locator('[data-shared-kpi="revenue"]')).toHaveText("300.000", { timeout: 30000 })
  await expect(bi.locator('[data-shared-kpi="receivables"]')).toHaveText("30.000")
  await expect(bi.locator('[data-insights-snapshot]')).toHaveAttribute("data-insights-snapshot", "snap-all-2026-10-01")
  await expect(bi.getByText("Client QA")).toBeVisible()
  await expect(agentic).toHaveAttribute("data-platform-snapshot", "snap-all-2026-10-01")
  await expect(page.getByRole("region",{name:"Pilotage transversal des trois plateformes"})).toBeVisible()
  await expect(page.getByText("Vue transversale · même source de vérité")).toBeVisible()
  const unifiedExport=page.waitForEvent("download")
  await page.getByRole("button",{name:"Exporter rapport & preuves · JSON"}).click()
  expect((await unifiedExport).suggestedFilename()).toBe("ai-negoce-snap-all-2026-10-01.json")


  await page.getByRole("combobox", { name: "Agence" }).selectOption("Sfax")
  await expect(agentic.locator('[data-shared-kpi="revenue"]')).toHaveText("100.000")
  await expect(bi.locator('[data-shared-kpi="revenue"]')).toHaveText("100.000")
  await expect(bi.locator('[data-shared-kpi="receivables"]')).toHaveText("10.000")
  await expect(bi.locator('[data-platform-app="bi"]')).toHaveAttribute("data-platform-snapshot", "snap-Sfax-2026-10-01")
  // Explicit CDC what-if: two visible calculations, read-only and exportable.
  await page.getByRole("button",{name:"Calculer et expliquer"}).click()
  await expect(page.getByText("Déficit sous le plancher")).toBeVisible()
  await expect(page.getByText("Projection de liquidité hypothétique")).toBeVisible()
  const scenarioExport=page.waitForEvent("download")
  await page.getByRole("button",{name:"Exporter le calcul et les hypothèses · JSON"}).click()
  expect((await scenarioExport).suggestedFilename()).toContain("liquidity")
  await page.getByRole("button",{name:"Couverture stock"}).click()
  await page.getByRole("button",{name:"Calculer et expliquer"}).click()
  await expect(page.getByText("Couverture de stock hypothétique")).toBeVisible()
  await expect(page.getByText("6 jours",{exact:true})).toBeVisible()
   await page.getByRole("button",{name:"Expansion · VAN / cash"}).click()
   await page.getByRole("button",{name:"Calculer et expliquer"}).click()
   await expect(page.getByText("Expansion · VAN hypothétique, sans étude de marché")).toBeVisible()
   await expect(page.getByText("Sous le plancher",{exact:true})).toBeVisible()
   await expect(page.getByText("18 mois",{exact:true})).toBeVisible()
   const investmentExport=page.waitForEvent("download")
   await page.getByRole("button",{name:"Exporter le calcul et les hypothèses · JSON"}).click()
   expect((await investmentExport).suggestedFilename()).toContain("expansion_investment")

  await bi.getByRole("button",{name:"Sources & statut"}).click()
  await expect(bi.getByText("Provenance du snapshot API partagé")).toBeVisible()
  await bi.locator("#closeDrawer").click()
  const biExport=page.waitForEvent("download")
  await bi.getByRole("button",{name:"Exporter rapport & preuves"}).click()
  expect((await biExport).suggestedFilename()).toBe("ai-negoce-bi-snap-Sfax-2026-10-01.json")


  await page.getByRole("tab", { name: "Data Science · Studio" }).click()
  const ds = page.frameLocator('iframe[title="Data Science"]')
  await expect(ds.locator('[data-shared-kpi="revenue"]')).toHaveText("100.000", { timeout: 45000 })
  await expect(ds.locator('[data-shared-kpi="receivables"]')).toHaveText("10.000")
  await expect(ds.getByText("Client QA")).toBeVisible()
  await expect(ds.locator('[data-ds-version="ds-scoped-v1"]')).toHaveCount(1)
  await expect(ds.locator('[data-ds-snapshot]')).toHaveAttribute("data-ds-snapshot","snap-Sfax-2026-10-01")
  await expect(ds.getByText("Prudent",{exact:true})).toBeVisible()
  const dsExport=page.waitForEvent("download")
  await ds.getByRole("button",{name:"Exporter preuves Data Science JSON"}).click()
  expect((await dsExport).suggestedFilename()).toBe("ai-negoce-ds-snap-Sfax-2026-10-01.json")


  await page.getByRole("combobox", { name: "Période" }).selectOption("T3 2026")
  await expect(agentic.locator('[data-shared-kpi="revenue"]')).toHaveText("1100.000")
  await expect(ds.locator('[data-shared-kpi="revenue"]')).toHaveText("1100.000", { timeout: 45000 })
  await expect(ds.locator('[data-shared-kpi="receivables"]')).toHaveText("110.000")
  await expect(ds.locator('[data-platform-app="ds"]')).toHaveAttribute("data-platform-snapshot", "snap-Sfax-2026-07-01")
  await expect(ds.locator('[data-ds-snapshot]')).toHaveAttribute("data-ds-snapshot","snap-Sfax-2026-07-01")

  await page.getByRole("tab", { name: "Data Analyse · BI" }).click()
  await expect(bi.locator('[data-shared-kpi="revenue"]')).toHaveText("1100.000", { timeout: 30000 })
  await expect(agentic).toHaveAttribute("data-platform-snapshot", "snap-Sfax-2026-07-01")
  expect(sessionRequests).toBe(1) // single sign-in; frames cannot ask for their own dev token
  expect(analyticsRequests.some((x) => x.get("agency") === "Sfax" && x.get("from") === "2026-07-01" && x.get("to") === "2026-09-30")).toBe(true)
  // All four specialist requests must use the exact same filter after T4→T3.
  await expect.poll(()=>Object.values(agentRequests).every(requests=>requests.some(q=>
    q.get("agency")==="Sfax"&&q.get("from")==="2026-07-01"&&q.get("to")==="2026-09-30"
  ))).toBe(true)

  // The same filter now reads a new PostgreSQL revision. The portal must
  // rebuild shared BI/DS metrics and offer a new persisted Director dossier.
  datasetRevision = 2
  await page.getByRole("button", { name: "Rafraîchir" }).click()
  await expect(agentic.locator('[data-shared-kpi="revenue"]')).toHaveText("2200.000")
  await expect(bi.locator('[data-shared-kpi="revenue"]')).toHaveText("2200.000")
  await expect(page.locator('[data-analytics-change="snap-Sfax-2026-07-01-rev-2"]')).toBeVisible()
  await expect(page.locator('[data-demo-live="true"]')).toContainText("Nouvelle vente")
  await expect(page.locator('[data-demo-live="true"]')).toContainText("révision 2")
  await page.getByRole("button", { name: "Créer nouveau dossier AI Director" }).click()
  await expect.poll(()=>createdMissions).toBe(1)
  await expect.poll(()=>executedMissions).toBe(1)
  // Creating a Director mission navigates to the missions workspace. Return to
  // the platform settings before using the disconnect control.
  await page.getByRole("button", { name: "Plateformes BI / DS" }).click()
  await expect(page.getByRole("button", { name: "Déconnecter les 3 plateformes" })).toBeVisible()
  await page.getByRole("button", { name: "Déconnecter les 3 plateformes" }).click()
  await expect(agentic).toHaveCount(0)
  await expect(bi.locator('[data-platform-app="bi"]')).toHaveCount(0)
})

test("direct BI route stays governed and never falls back to legacy CSV", async ({ page }) => {
  const legacyRequests: string[] = []
  await page.route("**/api/v1/auth/dev-session", async (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ token: "qa-standalone-bi-token" }),
    }))
  await page.route("**/api/v1/platform/context", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer qa-standalone-bi-token")
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(contextFixture()),
    })
  })
  await page.route("**/api/v1/analytics/overview*", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer qa-standalone-bi-token")
    const params = new URL(route.request().url()).searchParams
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(overviewFixture(params)),
    })
  })
  page.on("request", (request) => {
    if (request.url().includes("/Database/extractions/") || request.url().includes("/data/extractions/"))
      legacyRequests.push(request.url())
  })

  await page.goto("/platform/bi/")

  // The standalone route opens the local demo session by itself.
  await expect(page.locator("#platformStatus")).toContainText("source partagée", { timeout: 30000 })
  await expect(page.locator("#content")).not.toContainText("Erreur de chargement:")
  expect(legacyRequests).toEqual([])

  // Synthèse and Vue consolidée answer different questions.
  await expect(page.getByRole("heading", { name: "Points d’attention" })).toBeVisible()
  await page.locator('.nav-btn[data-page="direction"]').click()
  await expect(page.getByRole("heading", { name: "Position consolidée" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Points d’attention" })).toHaveCount(0)

  // Manual disconnect is respected and the button reconnects.
  await page.getByRole("button", { name: "Déconnecter la démo" }).click()
  await expect(page.locator("#content")).toContainText("Connectez la session démo")
  await page.getByRole("button", { name: "Connecter la démo" }).click()
  await expect(page.locator("#platformStatus")).toContainText("source partagée")
  await expect(page.locator("#content")).not.toContainText("Erreur de chargement:")
  expect(legacyRequests).toEqual([])
})

test("the unified portal does not publish legacy CSV data routes", async ({ request }) => {
  for (const url of [
    "/Database/extractions/ventes/journal_ventes_2026_demo.csv",
    "/data/extractions/ventes/journal_ventes_2026_demo.csv",
  ]) {
    const response = await request.get(url)
    expect(response.headers()["content-type"] ?? "", url).not.toContain("text/csv")
    expect(await response.text(), url).not.toContain("date_facture")
  }
})
