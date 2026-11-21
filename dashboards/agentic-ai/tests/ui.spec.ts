import { test, expect } from "@playwright/test"

test("renders the approved ERP-style dashboard and its navigation", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Centre de commandement — Agentic AI" })).toBeVisible()
  await expect(page.getByText("Mode démonstration.")).toBeVisible()
  await expect(page.getByText("Revenue Growth", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Financial Strategy", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Supply Chain Intelligence", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Business Strategy", { exact: true }).first()).toBeVisible()
})

test("supports mission navigation, filtering and opening mission details", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Centre de missions" }).click()
  await expect(page.getByRole("heading", { name: "Centre de missions" })).toBeVisible()
  await expect(page.getByText("Tableau des missions")).toBeVisible()
  await page.getByRole("textbox", { name: "Rechercher une mission" }).fill("clients")
  await expect(page.getByText("Identifier les clients à réactiver")).toBeVisible()
  await expect(page.getByText("Optimiser les seuils de stock")).toHaveCount(0)
})

test("creates a local draft mission without a backend action", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Lancer une mission" }).click()
  await expect(page.getByRole("dialog", { name: "Nouvelle mission" })).toBeVisible()
  await page.getByRole("textbox", { name: "Objectif de mission" }).fill("Étudier les clients stratégiques de Sfax")
  await page.getByRole("button", { name: "Créer le brouillon" }).click()
  await expect(page.getByText("Étudier les clients stratégiques de Sfax").first()).toBeVisible()
  await expect(page.getByText("Aucune exécution réelle.")).toBeVisible()
})

test("offers a dedicated chat for each specialist without fabricating AI calls", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Mes agents" }).click()
  await page.getByRole("button", { name: "Parler" }).first().click()
  await expect(page.getByRole("heading", { name: "Revenue Growth Agent" })).toBeVisible()
  await page.getByRole("textbox", { name: /Message à Revenue Growth/ }).fill("Analyse les clients à risque")
  await page.getByRole("button", { name: "Envoyer" }).click()
  await expect(page.getByText("Le moteur conversationnel de cet agent n'est pas encore connecté.", { exact: false })).toBeVisible()
})

test("reviews approvals locally and preserves clear no-write safety", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /Décisions et approbations/ }).click()
  await expect(page.getByText("Aucun achat, paiement, facture ni message ERP n'est déclenché.", { exact: false })).toBeVisible()
  await page.getByRole("button", { name: "Approuver (démo)" }).click()
  await expect(page.getByText("Décision modifiée dans l'interface de démonstration.", { exact: false })).toBeVisible()
})

test("shows unconnected integrations without claiming production telemetry", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /Connexions BI/ }).click()
  await expect(page.getByRole("heading", { name: "Connexions BI / Data Science" })).toBeVisible()
  await expect(page.getByText("APIs Agentic")).toBeVisible()
  await expect(page.getByRole("button", { name: "Connecter sandbox local" })).toBeVisible()
  await expect(page.getByText("Non connectée", { exact: true }).first()).toBeVisible()
})

test("keeps the command center usable on mobile screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Centre de commandement — Agentic AI" })).toBeVisible()
  await page.getByRole("button", { name: "Mes agents" }).click()
  await expect(page.getByRole("heading", { name: "Mes agents" })).toBeVisible()
})

test("loads the Financial Strategy API and renders source-linked recommendations", async ({ page }) => {
  await page.route("**/api/v1/auth/dev-session", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "synthetic-token-ui-test" }) })
  })
  await page.route("**/api/v1/agentic/revenue-growth/opportunities?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      agent:"revenue_growth", status:"ok", executionMode:"read_only",
      snapshot:{source:"Fixture QA",asOf:"2026-10-31",period:{from:"2026-10-01",to:"2026-12-31"}},analysis:{customersAnalyzed:0,opportunitiesFound:0,returned:0},opportunities:[],warnings:[],
    }) })
  })
  await page.route("**/api/v1/agentic/financial-strategy/analysis?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      agent:"financial_strategy", status:"ok", executionMode:"read_only",
      snapshot:{source:"Fixture QA",asOf:"2026-10-31",scope:["Sfax"],currency:"TND",period:{from:"2026-10-01",to:"2026-12-31"}},
      metrics:{outstandingTnd:2500.125,overdueTnd:800.100},
      findings:[{id:"FIN-001",title:"Créance échue : TEST-CLIENT",priority:"high",
        explanation:"800.100 TND en attente de revue",
        evidence:[{type:"receivable",id:"FV-TEST",agency:"Sfax"}],
        action:{type:"review_collection",status:"draft_only",requiresHumanApproval:true}}],
      scenarios:[{id:"COLLECTION_25",label:"Recouvrement hypothétique de 25 %",assumption:"Simulation seulement",valueTnd:200.025}],
      warnings:["Fixture de test uniquement"],
    }) })
  })
  await page.route("**/api/v1/agentic/supply-chain/recommendations?*", async (route) => {
    await route.fulfill({ status: 503, contentType:"application/json",body:"{}" })
  })
  await page.route("**/api/v1/agentic/business-strategy/scenarios?*", async (route) => {
    await route.fulfill({ status: 503, contentType:"application/json",body:"{}" })
  })
  await page.goto("/")
  await page.getByRole("button", { name: /Connexions BI/ }).click()
  await page.getByRole("button", { name: "Connecter sandbox local" }).click()
  await page.getByRole("button", { name: "Mes agents" }).click()
  await page.getByRole("button", { name: "Parler" }).nth(1).click()
  await expect(page.getByText("Créance échue : TEST-CLIENT")).toBeVisible()
  await expect(page.getByText("FV-TEST")).toBeVisible()
  await expect(page.getByText("Fixture QA", { exact: false }).first()).toBeVisible()
  await expect(page.getByText("Validation humaine obligatoire", { exact: false }).first()).toBeVisible()
})

test("AI Director submits a bounded investigation and renders an auditable delegation", async ({ page }) => {
  await page.route("**/api/v1/auth/dev-session", async (route) => {
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({token:"synthetic-token-ui-test"})})
  })
  await page.route("**/api/v1/agentic/revenue-growth/opportunities?*", async (route) => {
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      agent:"revenue_growth",status:"ok",executionMode:"read_only",
      snapshot:{source:"Fixture QA",asOf:"2026-10-31",period:{from:"2026-10-01",to:"2026-12-31"}},
      analysis:{customersAnalyzed:0,opportunitiesFound:0,returned:0},opportunities:[],warnings:[],
    })})
  })
  await page.route("**/api/v1/agentic/ai-director/investigate", async (route) => {
    const body=route.request().postDataJSON() as {objective?: string;from?:string;to?:string}
    expect(body.from).toBe("2026-10-01")
    expect(body.to).toBe("2026-12-31")
    if (!body.objective?.includes("croissance")) throw new Error("Objective not sent to Director")
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      director:"ai_director", orchestrationMode:"deterministic_read_only",status:"ok",
      objective:body.objective,snapshot:{source:"Fixture QA",asOf:"2026-10-31",scope:["Sfax"]},
      plan:[{step:1,agent:"financial_strategy",action:"analyze_and_propose",status:"completed_read_only"}],
      sections:[{agent:"financial_strategy",status:"ok",metrics:{overdueTnd:1200},findings:[],warnings:[]}],
      highlights:[{id:"FIN-001",agent:"financial_strategy",title:"Revue trésorerie Sfax",priority:"high",
        explanation:"Vérifier les factures à échéance",evidence:[{type:"receivable",id:"FV-001",agency:"Sfax"}],
        action:{type:"review_collection",status:"draft_only",requiresHumanApproval:true}}],
      summary:{agentsInvoked:1,totalFindings:1,requiresHumanReview:true,erpWrites:0},
      warnings:["Aucune écriture ERP"],
    })})
  })
  await page.goto("/")
  await page.getByRole("button", {name:/Connexions BI/}).click()
  await page.getByRole("button", {name:"Connecter sandbox local"}).click()
  await page.getByRole("button", {name:"AI Director"}).click()
  await page.getByRole("button", {name:"Analyser avec AI Director"}).click()
  await expect(page.getByText("Plan de délégation confirmé")).toBeVisible()
  await expect(page.getByText("Revue trésorerie Sfax")).toBeVisible()
  await expect(page.getByText("FV-001")).toBeVisible()
  await expect(page.getByText("Aucune écriture ERP")).toBeVisible()
})
