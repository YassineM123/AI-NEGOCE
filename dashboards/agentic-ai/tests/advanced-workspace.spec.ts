import { test, expect } from "@playwright/test"

const root="**/api/v1/agentic/workspace"
async function connect(page:import("@playwright/test").Page) {
  await page.route("**/api/v1/auth/dev-session",route=>route.fulfill({
    status:201,contentType:"application/json",body:JSON.stringify({token:"qa-workspace-session"}),
  }))
  await page.route("**/api/v1/platform/context",route=>route.fulfill({
    status:200,contentType:"application/json",body:JSON.stringify({
      contractVersion:"1.0",generatedAt:"2026-11-21T12:00:00.000Z",
      principal:{id:"reviewer-01",organizationId:"demo-fictive",role:"admin",agencies:"*"},
      permissions:["analytics.bi.read","analytics.ds.read","agentic.read"],
      platforms:{bi:{status:"available"},dataScience:{status:"not_configured",modelServingVerified:false},
        agentic:{status:"available",executionMode:"read_only"}},
    }),
  }))
  await page.goto("/")
  await page.getByRole("button",{name:"Plateformes BI / DS"}).click()
  await page.getByRole("button",{name:"Connecter la session sandbox"}).click()
}

test("creates a persistent mission through the backend instead of local demo state",async({page})=>{
  const items:Array<Record<string,unknown>>=[]
  await page.route(root+"/missions",async route=>{
    if(route.request().method()==="POST"){
      const body=route.request().postDataJSON() as Record<string,unknown>
      const row={id:"2a50abcc-47b3-41ee-b2f5-222220000001",...body,
        createdBy:"reviewer-01",status:"draft",version:1,
        createdAt:"2026-11-21T09:00:00.000Z",updatedAt:"2026-11-21T09:00:00.000Z",
        lastRun:null,dueAt:null}
      items.push(row)
      return route.fulfill({status:201,contentType:"application/json",body:JSON.stringify({mission:row})})
    }
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({missions:items})})
  })
  await connect(page)
  await page.getByRole("button",{name:"Centre de missions"}).click()
  await expect(page.getByRole("heading",{name:"Nouvelle mission"})).toBeVisible()
  await page.getByRole("textbox",{name:"Titre"}).fill("Réviser la trésorerie de Sfax")
  await page.getByRole("textbox",{name:"Objectif"}).fill("Analyser les créances et proposer une revue humaine")
  await page.getByRole("button",{name:"Créer et enregistrer"}).click()
  await expect(page.getByText("Réviser la trésorerie de Sfax")).toBeVisible()
  expect(items).toHaveLength(1)
  expect(items[0].agent).toBe("revenue_growth")
  await expect(page.getByText("Brouillon",{exact:true}).first()).toBeVisible()
})

test("uses server approvals, notifications and agent chat, with no ERP writeback",async({page})=>{
  let decision=""
  const approval={
    id:"c26fda34-9e56-4dbb-8f3c-222220000002",missionId:"2a50abcc-47b3-41ee-b2f5-222220000001",
    agency:"Sfax",agent:"financial_strategy",requestedBy:"requester-02",
    from:"2026-10-01",to:"2026-12-31",
    status:"pending",version:1,actionType:"review_collection",summary:"Revue créances Sfax",
    evidence:["INV-101"],createdAt:"2026-11-21T09:00:00.000Z",reviewedBy:null,comment:null,
  }
  await page.route(root+"/approvals",route=>route.fulfill({
    status:200,contentType:"application/json",body:JSON.stringify({approvals:[{...approval,status:decision||"pending",version:decision?2:1}]}),
  }))
  await page.route(root+"/approvals/"+approval.id+"/review",async route=>{
    const body=route.request().postDataJSON() as {decision:string}
    decision=body.decision
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      approval:{...approval,status:decision,version:2},erpWriteExecuted:false,
    })})
  })
  const note={id:"d4c649ec-cc45-4ddf-86e6-222220000003",agency:"Sfax",
    kind:"approval",title:"Approbation requise",message:"Revue créances Sfax",
    missionId:approval.missionId,createdAt:"2026-11-21T11:00:00.000Z",
    readBy:[],recipientId:null,audience:"reviewer"}
  let isRead=false
  await page.route(root+"/notifications",route=>route.fulfill({
    status:200,contentType:"application/json",
    body:JSON.stringify({notifications:[{...note,readBy:isRead?["reviewer-01"]:[]}],unread:isRead?0:1}),
  }))
  await page.route(root+"/notifications/"+note.id+"/read",route=>{
    isRead=true;return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({notification:{...note,readBy:["reviewer-01"]}})})
  })
  const messages:Array<Record<string,unknown>>=[]
  await page.route(root+"/chat/financial_strategy?*",route=>route.fulfill({
    status:200,contentType:"application/json",body:JSON.stringify({messages}),
  }))
  await page.route(root+"/chat/financial_strategy",async route=>{
    const data=route.request().postDataJSON() as {message:string}
    messages.push({id:"qa-u",role:"user",content:data.message,
      createdAt:"2026-11-21T12:00:00.000Z",sources:[],model:null})
    messages.push({id:"qa-a",role:"assistant",content:"Consultez les créances de Sfax et les justificatifs.",
      sources:["INV-101"],model:"test-provider",createdAt:"2026-11-21T12:00:01.000Z"})
    return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({message:messages[1],mode:"llm_grounded",erpWrites:0})})
  })
  await connect(page)
  await page.getByRole("button",{name:"Décisions et approbations"}).click()
  await expect(page.getByText("Revue créances Sfax")).toBeVisible()
  await page.getByRole("button",{name:"Approuver le brouillon"}).click()
  await expect(page.getByText("approved",{exact:true})).toBeVisible()
  expect(decision).toBe("approved")
  await page.getByRole("button",{name:"Notifications",exact:true}).first().click()
  await expect(page.getByText("Approbation requise")).toBeVisible()
  await page.getByRole("button",{name:"Marquer lue"}).click()
  expect(isRead).toBe(true)
  await page.getByRole("button",{name:"Mes agents"}).click()
  await page.getByRole("button",{name:"Parler"}).nth(1).click()
  await expect(page.getByRole("heading",{name:"Conversation — Financial Strategy"})).toBeVisible()
  await page.getByRole("textbox",{name:"Message à Financial Strategy"}).fill("Explique cette créance")
  await page.getByRole("button",{name:"Envoyer"}).first().click()
  await expect(page.getByText("Consultez les créances de Sfax et les justificatifs.")).toBeVisible()
  await expect(page.getByText("INV-101",{exact:false})).toBeVisible()
})
