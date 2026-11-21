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
  // The redesigned BI 360 uses API-fed .bi-kpi-card widgets, not the retired
  // .stat-card/.stat-value elements. Assert against the actual authorized
  // cockpit API payload rather than an old fixture's hard-coded KPI figures.
  const revenueCard = (page: Page) => page.locator(".bi-kpi-grid .bi-kpi-card").first()
  const filter = (page: Page, name: "Période" | "Agence") =>
    page.locator(".bi-filter-group", { hasText: name }).locator("select.bi-select")
  const apiResponse = (page: Page, wanted: { period?: string; agency?: string } = {}) =>
    page.waitForResponse((response) => {
      if (response.status() !== 200 || !response.url().includes("/api/v1/bi/360/cockpit")) return false
      const query = new URL(response.url()).searchParams
      return (!wanted.period || query.get("period") === wanted.period) &&
        (!wanted.agency || query.get("agency") === wanted.agency)
    }, { timeout: 15000 })
  const assertRevenue = async (page: Page, response: Awaited<ReturnType<typeof apiResponse>>) => {
    const data = await response.json() as {
      period: string
      range: { from: string; to: string }
      kpis: { revenueHt: { label: string; value: number } }
    }
    const card = revenueCard(page)
    await expect(card).toBeVisible()
    await expect(card.locator(".bi-kpi-title")).toHaveText(data.kpis.revenueHt.label)
    await expect.poll(async () => digits(await card.locator(".bi-kpi-value").textContent()), {
      timeout: 15000,
    }).toBe(data.kpis.revenueHt.value.toFixed(3))
    return data
  }
  test("KPIs come from the authorized API and agency filter refetches", async ({ page }) => {
    const first = apiResponse(page, { period: "year", agency: "all" })
    await go(page, "BI 360")
    await assertRevenue(page, await first)
    const month = apiResponse(page, { period: "month", agency: "all" })
    await filter(page, "Période").selectOption("month")
    await assertRevenue(page, await month)
    const all = apiResponse(page, { period: "all", agency: "all" })
    await filter(page, "Période").selectOption("all")
    await assertRevenue(page, await all)
    const sfax = apiResponse(page, { period: "all", agency: "Sfax" })
    await filter(page, "Agence").selectOption("Sfax")
    await assertRevenue(page, await sfax)
  })
  test("period filters produce the exact server-calculated KPIs", async ({ page }) => {
    const initial = apiResponse(page)
    await go(page, "BI 360")
    await assertRevenue(page, await initial)
    const quarter = apiResponse(page, { period: "quarter" })
    await filter(page, "Période").selectOption("quarter")
    const quarterData = await assertRevenue(page, await quarter)
    expect(quarterData.period).toBe("quarter")
    const full = apiResponse(page, { period: "all" })
    await filter(page, "Période").selectOption("all")
    const allData = await assertRevenue(page, await full)
    expect(allData.period).toBe("all")
    expect(allData.range).not.toEqual(quarterData.range)
  })
  test("KPI widgets show the source values and do not claim fictional real-time freshness", async ({ page }) => {
    const response = apiResponse(page)
    await go(page, "BI 360")
    const data = await assertRevenue(page, await response)
    await expect(page.locator(".bi-kpi-grid .bi-kpi-card")).toHaveCount(12)
    await expect(page.locator(".bi-header-title")).not.toContainText("15/10/2026")
    await expect(page.locator(".bi-header-title")).not.toContainText("Temps Réel ERP")
    expect(Number.isFinite(data.kpis.revenueHt.value)).toBe(true)
  })
  test("CSV and JSON exports are downloaded with the authenticated session", async ({ page }) => {
    const response = apiResponse(page)
    await go(page, "BI 360")
    const data = await assertRevenue(page, await response)
    const csvDownloaded = page.waitForEvent("download", { timeout: 15000 })
    const csvApi = page.waitForResponse((r) =>
      r.url().includes("/api/v1/bi/360/export") &&
      new URL(r.url()).searchParams.get("format") === "csv", { timeout: 15000 })
    await page.getByRole("button", { name: "Export CSV" }).click()
    const [csvFile, csvResponse] = await Promise.all([csvDownloaded, csvApi])
    expect(csvResponse.status()).toBe(200)
    expect(csvResponse.request().headers().authorization).toMatch(/^Bearer /)
    const csv = fs.readFileSync(await csvFile.path(), "utf8")
    expect(csv).toContain(`"${data.kpis.revenueHt.label}";"${data.kpis.revenueHt.value}"`)
    const jsonDownloaded = page.waitForEvent("download", { timeout: 15000 })
    const jsonApi = page.waitForResponse((r) =>
      r.url().includes("/api/v1/bi/360/export") &&
      new URL(r.url()).searchParams.get("format") === "json", { timeout: 15000 })
    await page.getByRole("button", { name: "Export JSON" }).click()
    const [jsonFile, jsonResponse] = await Promise.all([jsonDownloaded, jsonApi])
    expect(jsonResponse.status()).toBe(200)
    const report = JSON.parse(fs.readFileSync(await jsonFile.path(), "utf8")) as {
      cockpit: { kpis: { revenueHt: { value: number } } }
    }
    expect(report.cockpit.kpis.revenueHt.value).toBe(data.kpis.revenueHt.value)
  })
})

test.describe("Smart OCR", () => {
  test("the protected original is fetched with the session and rendered", async ({ page }) => {
    const name = `viewer-${crypto.randomUUID().slice(0, 8)}.png`
    await go(page, "Smart OCR")
    const fileResponse = page.waitForResponse(
      (response) =>
        /\/api\/v1\/documents\/[0-9a-f-]+\/file$/.test(response.url()) &&
        response.request().method() === "GET",
    )
    await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "image/png", buffer: uniquePng() })
    expect((await fileResponse).status()).toBe(200)
    const preview = page.locator(".so-viewer-frame img")
    await expect(preview).toBeVisible()
    await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    await expect(page.locator(".so-viewer").getByRole("link", { name: "Ouvrir" })).toHaveAttribute("href", /^blob:/)
  })

  test("upload a real invoice image: stored, fields left empty, no ERP success claimed", async ({ page }) => {
    await go(page, "Smart OCR")
    await page.locator('input[type="file"]').setInputFiles({ name: "facture.png", mimeType: "image/png", buffer: uniquePng() })
    await expect(page.getByText("Révision humaine requise")).toBeVisible()
    await expect(page.getByText(/Soumission ERP : non effectuée/)).toBeVisible()
    await expect(page.locator("body")).not.toContainText("importée avec succès")
  })
  test("missing OCR coordinates never enable source navigation", async ({ page }) => {
    await page.route("**/api/v1/documents", async (route) => {
      if (route.request().method() !== "POST") return route.continue()
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: "11111111-1111-4111-8111-111111111111",
          filename: "sans-coordonnees.png",
          mimeType: "image/png",
          size: 128,
          status: "needs_review",
          extraction: {
            fields: { invoiceNumber: "TEST-SANS-COORDONNEES" },
            missingFields: ["lines"],
            provider: "fixture-contract",
            confidence: null,
          },
          erpSubmission: { status: "not_submitted", adapter: "none" },
        }),
      })
    })
    await page.route("**/api/v1/documents/11111111-1111-4111-8111-111111111111/file", (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: uniquePng() }),
    )
    await go(page, "Smart OCR")
    await page.locator('input[type="file"]').setInputFiles({ name: "sans-coordonnees.png", mimeType: "image/png", buffer: uniquePng() })
    const source = page.getByRole("button", { name: "Voir dans le document" })
    await expect(source).toBeDisabled()
    await expect(source).toHaveAttribute("title", "Coordonnées source non fournies")
  })

  test("reduced motion keeps the workspace usable and suppresses long animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await go(page, "Smart OCR")
    const button = page.getByRole("button", { name: "Sélectionner un fichier" })
    await expect(button).toBeVisible()
    const duration = await button.evaluate((element) =>
      Math.max(
        ...getComputedStyle(element)
          .transitionDuration.split(",")
          .map((value) => Number.parseFloat(value) * (value.includes("ms") ? 1 : 1000)),
      ),
    )
    expect(duration).toBeLessThanOrEqual(1)
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
    await page.locator(".modal").getByRole("button", { name: "Fermer", exact: true }).click()
    await expect(page.locator("table")).not.toContainText("fake.png")
  })
  test("keyboard navigation and document dialog remain accessible", async ({ page }) => {
    const name = `accessible-${crypto.randomUUID().slice(0, 8)}.png`
    await go(page, "Smart OCR")
    const tablist = page.getByRole("tablist", { name: "Étapes Smart OCR" })
    const importTab = tablist.getByRole("tab", { name: /Importer/ })
    await expect(importTab).toHaveAttribute("aria-selected", "true")
    await importTab.press("ArrowRight")
    await expect(tablist.getByRole("tab", { name: /Vérifier/ })).toBeFocused()
    await expect(page.getByRole("tabpanel", { name: /Vérifier/ })).toBeVisible()
    await importTab.click()
    const chooser = page.waitForEvent("filechooser")
    await page.getByRole("button", { name: "Sélectionner un fichier" }).click()
    await (await chooser).setFiles({ name, mimeType: "image/png", buffer: uniquePng() })
    await expect(page.getByText("Révision humaine requise")).toBeVisible()
    const reviewTabs = page.getByRole("tablist", { name: "Données du document" })
    await reviewTabs.getByRole("tab", { name: /Validations/ }).click()
    await expect(page.getByRole("heading", { level: 3, name: /Aucune anomalie détectée|à corriger/ })).toBeVisible()
    await reviewTabs.getByRole("tab", { name: /Historique/ }).click()
    await expect(page.locator(".so-audit-list").getByText("Document importé", { exact: true })).toBeVisible()
    await tablist.getByRole("tab", { name: /Historique/ }).click()
    const row = page.locator("tr", { hasText: name })
    const openButton = row.getByRole("button", { name: /Ouvrir/ })
    await openButton.click()
    const dialog = page.getByRole("dialog", { name })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Fermer la fenêtre" })).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(openButton).toBeFocused()
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
    const box = await page.locator(".page-heading, .copilot-shell, .bi-header-title").first().boundingBox()
    const width = page.viewportSize()!.width
    expect(box && box.x >= 0 && box.x + Math.min(box.width, width) <= width + 1, `${label} heading clipped: ${JSON.stringify(box)}`).toBe(true)
  }
  for (const [label, button] of [["BI 360", "Export CSV"], ["Smart OCR", "Importer une facture"]]) {
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
