import {test,expect,type Page} from "@playwright/test"

/**
 * Exhaustive page-by-page UI smoke acceptance on the synthetic demonstration.
 * Test browser views; PostgreSQL decision scenarios are executed in a separate
 * real-DB Vitest job. Page screenshots and traces are uploaded by GitHub Actions.
 */
const agenticPages=[
 "Vue d'ensemble","Centre de missions","Mes agents","AI Director",
 "Décisions et approbations","Notifications","Plateformes BI / DS",
 "Connexions BI / Data Science","Historique & audit","Paramètres",
] as const
const biPages=[
 ["overview","Synthese"],["direction","Vue consolidee"],["sales","Ventes & CA"],
 ["clients","Clients"],["articles","Articles"],["stock","Stock"],
 ["debts","Creances"],["margin","Marges"],["cash","Encaissements"],
 ["quality","Qualite des donnees"],["coverage","Couverture"],
 ["orders","Commandes & devis"],["promos","Promotions & prix"],
 ["scoring","Scoring"],["packages","Paquets"],
 ["suppliersDemo","Livraisons fournisseurs (simulation)"],
 ["treasuryDemo","Plan de tresorerie (simulation)"],
 ["decisions","Centre des decisions"],["extensions","Roadmap"],
] as const
const dsPages=[
 "home","clients","tasks","churn","affinity","forecast","inventory",
 "suppliers","production","cash","optim","quality","impact","models",
 "assistant","data",
] as const

function capturePageErrors(page:Page){
 const errors:string[]=[]
 page.on("pageerror",error=>errors.push(error.message))
 return errors
}
async function snapshot(page:Page,prefix:string,id:string){
 await page.screenshot({path:`test-results/recette-${prefix}-${id}.png`,fullPage:true,animations:"disabled"})
}

test("Agentic: every command-center page renders without uncaught errors",async({page})=>{
 test.setTimeout(180_000)
 const errors=capturePageErrors(page)
 await page.goto("/")
 const nav=page.getByRole("navigation",{name:"Navigation principale"})
 await expect(nav).toBeVisible()
 for(const [index,title] of agenticPages.entries()){
  await test.step(`Agentic ${index+1}/${agenticPages.length}: ${title}`,async()=>{
   await nav.getByRole("button",{name:title,exact:true}).click()
   await expect(nav.getByRole("button",{name:title,exact:true})).toHaveClass(/active/)
   await expect(page.locator("main").first()).toBeVisible()
   await snapshot(page,"agentic",String(index+1).padStart(2,"0"))
  })
 }
 expect(errors,"Uncaught Agentic browser exceptions").toEqual([])
})

test("BI: all nineteen pages display their actual titles and render content",async({page})=>{
 test.setTimeout(240_000)
 const errors=capturePageErrors(page)
 await page.goto("/")
 await page.getByRole("navigation",{name:"Navigation principale"})
  .getByRole("button",{name:"Plateformes BI / DS",exact:true}).click()
 const bi=page.frameLocator('iframe[title="Data Analyse"]')
 await expect(bi.locator("#nav")).toBeVisible()
 for(const [index,[id,title]] of biPages.entries()){
  await test.step(`BI ${index+1}/${biPages.length}: ${title}`,async()=>{
   const button=bi.locator(`#nav button[data-page="${id}"]`)
   await expect(button).toBeVisible()
   // The BI iframe sits below the command-center cards. Dispatch inside the
   // frame so a sticky inner sidebar is not rejected as outside the parent
   // viewport by Playwright's pointer actionability check.
   await button.evaluate((element:HTMLElement)=>element.click())
   await expect(button).toHaveClass(/active/)
   await expect(bi.locator("#title")).toHaveText(title)
   await expect(bi.locator("#content")).not.toContainText("Erreur de chargement:")
   await expect(bi.locator("#content")).not.toContainText("Chargement...")
   await snapshot(page,"bi",String(index+1).padStart(2,"0"))
  })
 }
 expect(errors,"Uncaught BI browser exceptions").toEqual([])
})

test("Data Science: all sixteen navigable pages have meaningful visible output",async({page})=>{
 test.setTimeout(240_000)
 const errors=capturePageErrors(page)
 await page.goto("/")
 await page.getByRole("navigation",{name:"Navigation principale"})
  .getByRole("button",{name:"Plateformes BI / DS",exact:true}).click()
 await page.getByRole("tab",{name:/Data Science/}).click()
 const ds=page.frameLocator('iframe[title="Data Science"]')
 await expect(ds.locator("#app")).toBeVisible()
 for(const [index,id] of dsPages.entries()){
  await test.step(`Data Science ${index+1}/${dsPages.length}: ${id}`,async()=>{
   const button=ds.locator(`.nav-scroll button[data-nav="${id}"]`)
   await expect(button).toBeAttached()
   await button.click()
   await expect(ds.locator(`#content.module-${id}`)).toBeVisible()
   await expect(ds.locator(`#content.module-${id}`)).not.toBeEmpty()
   await snapshot(page,"ds",String(index+1).padStart(2,"0"))
  })
 }
 expect(errors,"Uncaught Data Science browser exceptions").toEqual([])
})

test("Responsive command-center, BI and Data Science preserve page navigation",async({page})=>{
 test.setTimeout(120_000)
 await page.setViewportSize({width:390,height:844})
 for(const [path,selector] of [
  ["/",'nav[aria-label="Navigation principale"]'],
  ["/platform/bi/","#nav"],
  ["/platform/ds/","#app"],
 ] as const){
  await page.goto(path)
  await expect(page.locator(selector)).toBeAttached()
  await expect(page.locator("body")).toBeVisible()
 }
})
