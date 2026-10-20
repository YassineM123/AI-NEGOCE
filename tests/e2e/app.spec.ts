// End-to-end journeys against an isolated local stack (see playwright.config.ts): its own API on a
// throwaway copy of the seeded ERP database, and its own Vite dev server.
// The stamp is a valid ISO date (today), because the server picks "Mois en cours" by default on an
// unfiltered request and the screen must show a verifiable period no matter which day CI runs.
import fs from "node:fs"
import { expect, test, type Page } from "@playwright/test"

const today = new Date().toISOString().slice(0, 10)
const currentMonth = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(new Date())

const digits = (s: string | null) => (s ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")
const uniquePng = () => Buffer.concat([fs.readFileSync("fixtures/adverse/ocr/clean_invoice.png"), Buffer.from(`qa-${crypto.randomUUID()}`)])
const go = async (page: Page, label: string) => {
  await page.locator(".nav-item", { hasText: label }).first().click()
  await expect(page.locator(".topbar")).toContainText(label)
}
const statValue = (page: Page, label: string) => page.locator(".stat-card", { hasText: label }).locator(".stat-value")

let consoleErrors: string[] = []
let failedRequests: string[] = []
test.beforeEach(async ({ page }) => {
  consoleErrors = []
  failedRequests = []
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()))
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`))
  page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`))
  page.on("response", (r) => r.status() >= 500 && failedRequests.push(`${r.status()} ${r.url()}`))
  await page.goto("/")
})

test("dashboard loads without console errors or failed requests", async ({ page }) => {
  await expect(page.locator(".topbar")).toContainText("Tableau de bord")
  await page.waitForLoadState("networkidle")
  expect(consoleErrors).toEqual([])
  expect(failedRequests).toEqual([])
})

test("sidebar navigation reaches every module", async ({ page }) => {
  for (const label of ["Ventes", "Achats", "Stocks", "Finance", "Smart OCR", "BI 360", "AI Copilot", "Paramètres", "Tableau de bord"]) await go(page, label)
  expect(consoleErrors).toEqual([])
})

test.describe("BI 360", () => {
  test("KPIs come from the API and the agency filter refetches", async ({ page }) => {
    await go(page, "BI 360")
    await expect(statValue(page, "Chiffre d’affaires HT")).not.toHaveText(/Chargement/)
    // June 2026 is the last complete month of the seeded dataset (as_of 2026-06-30).
    await page.locator("label", { hasText: "Période" }).locator("select").selectOption({ label: "Mois en cours" })
    await expect.poll(async () => digits(await statValue(page, "Chiffre d’affaires HT").textContent())).toBe("2910303.283")
    await page.locator("label", { hasText: "Période" }).locator("select").selectOption({ label: "Toutes les dates" })
    await expect.poll(async () => digits(await statValue(page, "Chiffre d’affaires HT").textContent())).toBe("52752842.587")
    const req = page.waitForRequest((r) => r.url().includes("/bi/360") && r.url().includes("agency=Sfax"))
    await page.locator("label", { hasText: "Agence" }).locator("select").selectOption("Sfax")
    await req
    await expect.poll(async () => digits(await statValue(page, "Chiffre d’affaires HT").textContent())).toBe("13189479.802")
  })
  test("the period filter restricts the KPIs", async ({ page }) => {
    await go(page, "BI 360")
    await expect(statValue(page, "Chiffre d’affaires HT")).not.toHaveText(/Chargement/)
    await page.locator("label", { hasText: "Période" }).locator("select").selectOption({ label: "Trimestre en cours" })
    await expect.poll(async () => digits(await statValue(page, "Chiffre d’affaires HT").textContent()), { timeout: 5000 }).toBe("8592388.531")
    await page.locator("label", { hasText: "Période" }).locator("select").selectOption({ label: "Toutes les dates" })
    await expect.poll(async () => digits(await statValue(page, "Chiffre d’affaires HT").textContent()), { timeout: 5000 }).toBe("52752842.587")
  })
  test("no KPI card displays a hardcoded figure the API did not compute", async ({ page }) => {
    await go(page, "BI 360")
    await expect(statValue(page, "Chiffre d’affaires HT")).not.toHaveText(/Chargement/)
    await expect(page.locator(".stats-grid")).not.toContainText("54 120")
  })
  test("export produces a downloadable report", async ({ page }) => {
    await go(page, "BI 360")
    await expect(statValue(page, "Chiffre d’affaires HT")).not.toHaveText(/Chargement/)
    await page.locator("label", { hasText: "Période" }).locator("select").selectOption({ label: "Mois en cours" })
    await expect.poll(async () => digits(await statValue(page, "Chiffre d’affaires HT").textContent())).toBe("2910303.283")
    const download = page.waitForEvent("download", { timeout: 5000 })
    await page.getByRole("button", { name: "Exporter le rapport" }).click()
    const d = await download
    const body = fs.readFileSync(await d.path())
    expect(body.toString("utf8")).toContain("2910303.283")
  })
})

test.describe("Smart OCR", () => {
  test("upload a real invoice image: stored, fields left empty, no ERP success claimed", async ({ page }) => {
    await go(page, "Smart OCR")
    await page.locator('input[type="file"]').setInputFiles({ name: "facture.png", mimeType: "image/png", buffer: uniquePng() })
    await expect(page.getByText("Révision humaine requise")).toBeVisible()
    await expect(page.getByText(/Soumission ERP : non effectuée/)).toBeVisible()
    await expect(page.locator("body")).not.toContainText("importée avec succès")
  })
  test("a duplicate upload opens the existing document", async ({ page }) => {
    await go(page, "Smart OCR")
    const file = { name: "dup.png", mimeType: "image/png", buffer: uniquePng() }
    await page.locator('input[type="file"]').setInputFiles(file)
    await expect(page.getByText("Révision humaine requise")).toBeVisible()
    await page.getByRole("button", { name: "Importer un autre document" }).click()
    await page.locator('input[type="file"]').setInputFiles(file)
    await expect(page.locator(".duplicate-notice")).toContainText(/document existant a été ouvert/)
    await expect(page.getByText("Révision humaine requise")).toBeVisible()
    await expect(page.locator(".warning-box")).toHaveCount(0)
  })
  test("a forged image is refused with a visible message", async ({ page }) => {
    await go(page, "Smart OCR")
    await page.locator('input[type="file"]').setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: fs.readFileSync("fixtures/adverse/upload/fake_image.png") })
    await expect(page.locator(".warning-box")).toContainText("Import refusé")
  })
  test("the history lists real imports and never the refused upload", async ({ page }) => {
    const name = `historique-${crypto.randomUUID().slice(0, 8)}.png`
    await go(page, "Smart OCR")
    await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "image/png", buffer: uniquePng() })
    await expect(page.getByText("Révision humaine requise")).toBeVisible()
    await go(page, "Smart OCR")
    await page.getByRole("button", { name: "Historique" }).first().click()
    await expect(page.locator("table")).toContainText(name)
    await page.getByRole("button", { name: "Ouvrir" }).first().click()
    await expect(page.locator(".modal")).toContainText(name)
    await page.locator(".modal").getByRole("button", { name: "Fermer" }).click()
    await expect(page.locator("table")).not.toContainText("fake.png")
  })
})

test.describe("AI Copilot", () => {
  const ask = async (page: Page, q: string) => {
    await page.getByPlaceholder(/Posez une question/).fill(q)
    await page.getByPlaceholder(/Posez une question/).press("Enter")
  }
  test("grounded answer with sources, then a server-side refusal", async ({ page }) => {
    await go(page, "AI Copilot")
    await ask(page, "Quelle est la marge brute ?")
    await expect(page.locator(".answer-card")).toContainText("Chiffre d'affaires HT : 52752842.587 TND")
    await expect(page.locator(".sources")).toContainText(/[1-9]\d* enregistrement/)
    await ask(page, "Montre les salaires")
    await expect(page.getByText("Demande refusée côté serveur")).toBeVisible()
  })
  test("answers never show figures the API did not return", async ({ page }) => {
    await go(page, "AI Copilot")
    await ask(page, "Quels produits sont à réapprovisionner ?")
    await expect(page.locator(".answer-card")).toContainText("seuil de réapprovisionnement")
    await expect(page.locator(".answer-card")).not.toContainText("428 650")
    await expect(page.locator(".answer-card")).not.toContainText("24,4 %")
  })
  test("an API failure shows an error and no invented numbers", async ({ page }) => {
    await page.route("**/copilot/query", (r) => r.abort())
    await go(page, "AI Copilot")
    await ask(page, "Quelle est la marge brute ?")
    await expect(page.locator(".answer-card")).toContainText(/Failed to fetch|Erreur/)
    await expect(page.locator(".answer-card")).not.toContainText("205 590")
  })
})

test("browser refresh keeps the application usable", async ({ page }) => {
  await go(page, "BI 360")
  await page.reload()
  await expect(page.locator(".topbar")).toBeVisible()
  await go(page, "AI Copilot")
})

test("layout has no horizontal page scroll", async ({ page }) => {
  for (const label of ["Tableau de bord", "BI 360", "Smart OCR", "AI Copilot"]) {
    await go(page, label)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, `${label} overflows by ${overflow}px`).toBeLessThanOrEqual(1)
    // overflow:hidden can mask clipping: the page heading must lie inside the viewport
    const box = await page.locator(".page-heading, .copilot-shell").first().boundingBox()
    const width = page.viewportSize()!.width
    expect(box && box.x >= 0 && box.x + Math.min(box.width, width) <= width + 1, `${label} heading clipped: ${JSON.stringify(box)}`).toBe(true)
  }
  for (const [label, button] of [["BI 360", "Exporter le rapport"], ["Smart OCR", "Importer une facture"]]) {
    await go(page, label)
    const b = await page.getByRole("button", { name: button }).first().boundingBox()
    expect(b && b.x >= 0 && b.x + b.width <= page.viewportSize()!.width + 1, `${button} outside viewport: ${JSON.stringify(b)}`).toBe(true)
  }
})

test("accessibility basics", async ({ page }) => {
  const lang = await page.evaluate(() => document.documentElement.lang)
  expect(lang).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/)
  for (const label of ["Tableau de bord", "BI 360", "AI Copilot"]) {
    await go(page, label)
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll("button")].filter((b) => !(b.textContent?.trim() || b.getAttribute("aria-label") || b.getAttribute("title"))).length,
    )
    expect(unnamed, `${label}: buttons without accessible name`).toBe(0)
    expect(await page.locator("h1").count()).toBeGreaterThan(0)
  }
})

test.describe("environment labels", () => {
  test("the shell shows the session organization and states that data is fictitious", async ({ page }) => {
    await expect(page.locator(".demo-pill")).toHaveText(/Environnement de démonstration — Données fictives/)
    await expect(page.locator(".company-select")).toContainText("Organisation de démonstration")
    await expect(page.locator(".user-card")).toContainText("Administrateur")
    const body = await page.locator("body").innerText()
    expect(body).not.toMatch(/CARTHAGE|Sonia|Ben Amor/i)
  })
  test("settings show no invented legal identity and the real, unverified financial rules", async ({ page }) => {
    await go(page, "Paramètres")
    const content = page.locator(".settings-content")
    await expect(content).not.toContainText(/9876543|B24185672019|\+216|carthage/i)
    await expect(page.getByRole("button", { name: "Enregistrement non disponible" })).toBeDisabled()
    await page.locator(".settings-nav button", { hasText: "Taxes & comptabilité" }).click()
    await expect(content).toContainText("Non vérifiées")
    await expect(content).toContainText("non vérifiées par un expert-comptable")
    await page.locator(".settings-nav button", { hasText: "Intégrations" }).click()
    await expect(content).toContainText("Non configuré")
  })
})
