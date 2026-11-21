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
  await expect(page.getByText("API Revenue Growth")).toBeVisible()
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
