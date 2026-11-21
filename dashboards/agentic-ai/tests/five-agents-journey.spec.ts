import {test,expect} from "@playwright/test"

/**
 * Browser contract test: real React screens and navigation with an explicitly
 * mocked synthetic HTTP backend. Real API/DB lifecycle is separately covered
 * by server/agents/five-agents-journey.api.test.ts.
 */
test("five Agentic screens show scoped findings and each chat uses its own identity",async({page})=>{
  test.setTimeout(120_000)
  const year={from:"2026-01-01",to:"2026-12-31"}
  const snapshot={source:"SYNTHETIC-FIVE-AGENTS-UI",asOf:"2026-10-15",
    scope:["Sfax"],currency:"TND",period:year}
  const agentNames=[
    ["revenue_growth","Revenue Growth","Client dormance QA"],
    ["financial_strategy","Financial Strategy","Créance QA échue"],
    ["supply_chain_intelligence","Supply Chain Intelligence","Réapprovisionnement QA"],
    ["business_strategy","Business Strategy","Performance QA Sfax"],
    ["director","AI Director","Plan de délégation confirmé"],
  ] as const
  const questions=new Map<string,Array<Record<string,unknown>>>()
  const requests=new Map<string,URLSearchParams[]>()
  const record=(key:string,params:URLSearchParams)=>{
    requests.set(key,[...(requests.get(key)??[]),params])
  }
  await page.route("**/api/v1/auth/dev-session",route=>route.fulfill({
    status:200,contentType:"application/json",body:JSON.stringify({token:"qa-browser-only"}),
  }))
  await page.route("**/api/v1/platform/context",route=>route.fulfill({
    status:200,contentType:"application/json",body:JSON.stringify({
      contractVersion:"1.0",generatedAt:"2026-11-21T10:00:00.000Z",
      principal:{id:"qa-user",organizationId:"demo-fictive",role:"admin",agencies:"*"},
      permissions:["analytics.bi.read","analytics.ds.read","agentic.read"],
      platforms:{bi:{status:"available"},dataScience:{status:"not_configured",modelServingVerified:false},
        agentic:{status:"available",executionMode:"read_only"}},
    }),
  }))
  await page.route("**/api/v1/agentic/revenue-growth/opportunities?*",route=>{
    record("revenue_growth",new URL(route.request().url()).searchParams)
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      agent:"revenue_growth",status:"ok",executionMode:"read_only",snapshot,
      analysis:{customersAnalyzed:2,opportunitiesFound:1,returned:1},
      opportunities:[{
        customerId:"SF-OLD",customerName:"Client dormance QA",agency:"Sfax",state:"dormant",
        priorityScore:75,reason:"Pas de commande récente",representative:"QA",
        metrics:{currentRevenueTnd:0,previousRevenueTnd:1000,growthPercent:-100,lastPurchase:"2026-01-20",
          currentMargin:{amount:null,coverage:"no_sales"}},
        proposedAction:{type:"prepare_reactivation_call",status:"draft_only",requiresHumanApproval:true},
        evidence:{invoiceIds:["QA-SF-OLD"],invoiceCount:1},warnings:[],
      }],warnings:[],
    })})
  })
  const specialists=[
    {key:"financial_strategy",route:"financial-strategy/analysis",title:"Créance QA échue",
      action:"review_collection",metrics:{outstandingTnd:600,overdueTnd:600}},
    {key:"supply_chain_intelligence",route:"supply-chain/recommendations",title:"Réapprovisionnement QA",
      action:"prepare_purchase_request",metrics:{stockPositions:1,lowStockPositions:1}},
    {key:"business_strategy",route:"business-strategy/scenarios",title:"Performance QA Sfax",
      action:"review_strategic_scenario",metrics:{revenueTnd:4300,agenciesCompared:1}},
  ]
  for(const agent of specialists){
    await page.route("**/api/v1/agentic/"+agent.route+"?*",route=>{
      record(agent.key,new URL(route.request().url()).searchParams)
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        agent:agent.key,status:"ok",executionMode:"read_only",snapshot,
        metrics:agent.metrics,
        findings:[{id:"QA-"+agent.key,title:agent.title,priority:"high",
          explanation:"Constat fictif et preuve associée, validation humaine requise.",
          evidence:[{type:"invoice",id:"QA-SF-DOC",agency:"Sfax"}],
          action:{type:agent.action,status:"draft_only",requiresHumanApproval:true}}],
        scenarios:[],warnings:[],
      })})
    })
  }
  await page.route("**/api/v1/agentic/ai-director/investigate",route=>{
    const input=route.request().postDataJSON() as {agency?:string;from?:string;to?:string;objective:string}
    expect(input.agency).toBe("Sfax")
    expect({from:input.from,to:input.to}).toEqual(year)
    expect(input.objective).toBeTruthy()
    record("director",new URLSearchParams({agency:input.agency??"",from:input.from??"",to:input.to??""}))
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      director:"ai_director",orchestrationMode:"deterministic_read_only",status:"ok",snapshot,
      objective:input.objective,plan:specialists.map((a,i)=>({
        step:i+1,agent:a.key,action:"analyze_and_propose",status:"completed_read_only",
      })),
      sections:specialists.map(a=>({agent:a.key,status:"ok",metrics:a.metrics,findings:[],warnings:[]})),
      highlights:[{id:"DIR-QA",agent:"financial_strategy",title:"Contrôle QA Director",priority:"high",
        explanation:"Vérifier les pièces avant tout traitement.",evidence:[{type:"invoice",id:"QA-DIR-DOC",agency:"Sfax"}],
        action:{type:"review_collection",status:"draft_only",requiresHumanApproval:true}}],
      summary:{agentsInvoked:3,totalFindings:1,requiresHumanReview:true,erpWrites:0},
      warnings:["Aucune écriture ERP"],
    })})
  })
  await page.route("**/api/v1/agentic/workspace/chat/**",route=>{
    const path=new URL(route.request().url())
    const agent=path.pathname.split("/").at(-1)??""
    if(route.request().method()==="POST"){
      const data=route.request().postDataJSON() as {agency:string;from:string;to:string;message:string}
      expect(data.agency).toBe("Sfax")
      expect({from:data.from,to:data.to}).toEqual(year)
      const older=questions.get(agent)??[]
      const user={id:"u-"+agent,role:"user",createdAt:"2026-11-21T10:00:00.000Z",
        content:data.message,sources:[],model:null}
      const answer={id:"a-"+agent,role:"assistant",createdAt:"2026-11-21T10:00:01.000Z",
        content:"Réponse IA QA "+agent,sources:["QA-SF-DOC"],model:"fixture-browser"}
      questions.set(agent,[...older,user,answer])
      return route.fulfill({status:200,contentType:"application/json",
        body:JSON.stringify({message:answer,mode:"llm_grounded",erpWrites:0})})
    }
    return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({agent,messages:questions.get(agent)??[]})})
  })
  await page.goto("/")
  await page.getByRole("combobox",{name:"Agence"}).selectOption("Sfax")
  await page.getByRole("combobox",{name:"Période"}).selectOption("2026")
  await page.getByRole("button",{name:"Plateformes BI / DS"}).click()
  await page.getByRole("button",{name:"Connecter la session sandbox"}).click()
  await page.getByRole("button",{name:"Mes agents"}).click()

  for(const [index,[key,name,needle]] of agentNames.entries()){
    if(index<4){
      await page.getByRole("button",{name:"Parler"}).nth(index).click()
      await expect(page.getByRole("heading",{name:name+" Agent"})).toBeVisible()
      await expect(page.getByText(needle,{exact:true})).toBeVisible()
    }else{
      await page.getByRole("button",{name:"AI Director"}).click()
      await page.getByRole("button",{name:"Analyser avec AI Director"}).click()
      await expect(page.getByText(needle)).toBeVisible()
      await expect(page.getByText("Aucune écriture ERP",{exact:true})).toBeVisible()
    }
    const chatName=key==="supply_chain_intelligence"?"Supply Chain":name
    await expect(page.getByRole("heading",{name:"Conversation — "+chatName})).toBeVisible()
    const draft=page.getByRole("textbox",{name:"Message à "+chatName})
    await draft.fill("Explique le risque et les limites de cette analyse")
    await page.getByRole("button",{name:"Envoyer"}).first().click()
    await expect(page.getByText("Réponse IA QA "+key)).toBeVisible()
    if(index<3)await page.getByRole("button",{name:"Mes agents"}).click()
  }
  for(const [key] of agentNames){
    expect(questions.get(key)?.length,key).toBe(2)
    await expect.poll(()=>requests.get(key)?.some(q=>
      q.get("agency")==="Sfax"&&q.get("from")===year.from&&q.get("to")===year.to
    )).toBe(true)
  }
})
