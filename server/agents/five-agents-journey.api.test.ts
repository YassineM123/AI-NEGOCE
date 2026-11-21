import {describe,expect,it} from "vitest"
import request from "supertest"
import {bearer,makeApp} from "../../tests/qa/support/harness.js"
import {defaultDataset,type Dataset} from "../services.js"
import type {LlmProvider} from "../llm/types.js"

const root="/api/v1/agentic", workspace=root+"/workspace"
const year={from:"2026-01-01",to:"2026-12-31"}
const t3={from:"2026-07-01",to:"2026-09-30"}
const t4={from:"2026-10-01",to:"2026-12-31"}
const agents=[
  {key:"revenue_growth",route:"/revenue-growth/opportunities",metric:"opportunities"},
  {key:"financial_strategy",route:"/financial-strategy/analysis",metric:"findings"},
  {key:"supply_chain_intelligence",route:"/supply-chain/recommendations",metric:"findings"},
  {key:"business_strategy",route:"/business-strategy/scenarios",metric:"findings"},
] as const

function synthetic():Dataset{
  const base=defaultDataset()
  return {
    metadata:{...base.metadata,source:"QA-5-AGENTS-SYNTHETIQUE",asOf:"2026-10-15",
      lastUpdated:"2026-10-15T12:00:00.000Z"},
    sales:[
      {id:"SF-OLD",invoiceId:"SF-OLD",date:"2026-01-20",agency:"Sfax",
        customer:"Client dormant",customerId:"CL-OLD",product:"P1",family:"BTP",
        representative:"QA",revenue:2000,cost:1100,status:"posted"},
      {id:"SF-SEPT",invoiceId:"SF-SEPT",date:"2026-09-10",agency:"Sfax",
        customer:"Client actif",customerId:"CL-ACT",product:"P2",family:"BTP",
        representative:"QA",revenue:3000,cost:2000,status:"posted"},
      {id:"SF-OCT",invoiceId:"SF-OCT",date:"2026-10-10",agency:"Sfax",
        customer:"Client actif",customerId:"CL-ACT",product:"P2",family:"BTP",
        representative:"QA",revenue:1800,cost:1000,status:"posted"},
      {id:"TUN-PRIVATE",invoiceId:"TUN-PRIVATE",date:"2026-10-10",agency:"Tunis Centre",
        customer:"SECRET-TUNIS",customerId:"TUN-SECRET",product:"P2",family:"BTP",
        representative:"QA",revenue:990000,cost:100,status:"posted"},
      {id:"SF-CANCEL",invoiceId:"SF-CANCEL",date:"2026-10-10",agency:"Sfax",
        customer:"Annulé",product:"P2",family:"BTP",representative:"QA",
        revenue:900000,cost:100,status:"cancelled"},
    ],
    receivables:[
      {invoiceId:"SF-DEBT-JAN",agency:"Sfax",customer:"Client dormant",
        date:"2026-01-20",dueDate:"2026-02-20",outstanding:1200},
      {invoiceId:"SF-DEBT-OCT",agency:"Sfax",customer:"Client actif",
        date:"2026-10-10",dueDate:"2026-10-11",outstanding:400},
      {invoiceId:"TUN-DEBT-PRIVATE",agency:"Tunis Centre",customer:"SECRET-TUNIS",
        date:"2026-10-10",dueDate:"2026-10-11",outstanding:999999},
    ],
    inventory:[
      {reference:"SF-LOW",product:"Stock critique",agency:"Sfax",
        quantity:1,reorderPoint:10,unitCost:150},
      {reference:"TUN-PRIVATE-SKU",product:"SECRET-TUNIS",agency:"Tunis Centre",
        quantity:500,reorderPoint:10,unitCost:100},
    ],
  }
}

describe("PARCOURS COMPLET — 5 agents, même source et contrôles métier",()=>{
  it("all five produce scoped reports with dated evidence and zero ERP writes",async()=>{
    const {app}=makeApp({data:synthetic()})
    for(const agent of agents){
      const res=await request(app).get(root+agent.route).query({agency:"Sfax",...year})
        .set(bearer("dev-admin"))
      expect(res.status,agent.key).toBe(200)
      expect(res.body.snapshot.scope,agent.key).toEqual(["Sfax"])
      expect(res.body.snapshot.period,agent.key).toEqual(year)
      expect(res.body.executionMode,agent.key).toBe("read_only")
      expect(res.body.status,agent.key).toBe("ok")
      expect(res.body[agent.metric].length,agent.key).toBeGreaterThan(0)
      expect(JSON.stringify(res.body),agent.key).not.toContain("SECRET-TUNIS")
      expect(JSON.stringify(res.body),agent.key).not.toContain("TUN-PRIVATE")
      if(agent.key!=="revenue_growth"){
        expect(res.body.findings.every((f:{evidence:{agency:string}[]})=>
          f.evidence.every(e=>e.agency==="Sfax")),agent.key).toBe(true)
      }else{
        expect(res.body.opportunities.some((op:{state:string})=>op.state==="dormant")).toBe(true)
        expect(res.body.opportunities.every((op:{proposedAction:{status:string;requiresHumanApproval:boolean}})=>
          op.proposedAction.status==="draft_only"&&op.proposedAction.requiresHumanApproval)).toBe(true)
      }
    }
    const director=await request(app).post(root+"/ai-director/investigate")
      .set(bearer("dev-admin")).send({
        objective:"Objectif +10% de CA sur un an, finance, stocks et stratégie pour Sfax",
        agency:"Sfax",...year,
      })
    expect(director.status).toBe(200)
    expect(director.body.orchestrationMode).toBe("deterministic_read_only")
    expect(director.body.snapshot.period).toEqual(year)
    expect(director.body.plan.map((p:{agent:string})=>p.agent)).toEqual(agents.map(x=>x.key))
    expect(director.body.sections).toHaveLength(4)
    expect(director.body.summary.agentsInvoked).toBe(4)
    expect(director.body.summary.erpWrites).toBe(0)
    expect(JSON.stringify(director.body)).not.toContain("SECRET-TUNIS")
  })

  it("runs 5 missions end to end: plan, checkpoints, human approval, notification and export",async()=>{
    const {app}=makeApp({data:synthetic()})
    const creator=bearer("dev-admin")
    const reviewer=bearer("dev-manager-sfax")
    const keys=[...agents.map(x=>x.key),"director"]
    const IDs:string[]=[],approvals:string[]=[]
    for(const [index,key] of keys.entries()){
      const created=await request(app).post(workspace+"/missions").set(creator).send({
        agency:"Sfax",agent:key,from:year.from,to:year.to,
        title:"QA mission complète numéro "+(index+1),
        objective:key==="director"
          ?"Objectif +10% de croissance CA sur un an, finances, stocks et stratégie"
          :"Examiner les risques vérifiables et les preuves pour une décision humaine",
      })
      expect(created.status,key).toBe(201)
      const mission=created.body.mission
      IDs.push(mission.id)
      expect(mission.status).toBe("draft")
      expect({from:mission.from,to:mission.to}).toEqual(year)
      const plan=await request(app).get(workspace+"/missions/"+mission.id+"/plan").set(creator)
      expect(plan.status,key).toBe(200)
      expect(plan.body.plan.period,key).toEqual(year)
      expect(plan.body.plan.erpWriteBudget,key).toBe(0)
      expect(plan.body.plan.plannedTools,key).toBe(key==="director"?4:1)
      expect(plan.body.plan.tools.every((t:{status:string})=>t.status==="ready"),key).toBe(true)
      const run=await request(app).post(workspace+"/missions/"+mission.id+"/run")
        .set(creator).send({expectedVersion:1})
      expect(run.status,key).toBe(200)
      expect(run.body.erpWrites,key).toBe(0)
      expect(run.body.mission.execution.status,key).toBe("completed")
      expect(run.body.mission.lastRun.findings,key).toBeGreaterThan(0)
      expect(run.body.mission.status,key).toBe("awaiting_approval")
      expect(run.body.mission.lastRun.trace.period,key).toEqual(year)
      expect(run.body.mission.lastRun.trace.modelCalls,key).toBe(0)
      expect(run.body.mission.lastRun.trace.erpWrites,key).toBe(0)
      expect(run.body.mission.execution.steps.length,key).toBe(key==="director"?4:1)
      expect(run.body.mission.execution.steps.every((step:{status:string})=>step.status==="completed"),key).toBe(true)
      expect(run.body.approval,key).toBeTruthy()
      expect({from:run.body.approval.from,to:run.body.approval.to}).toEqual(year)
      approvals.push(run.body.approval.id)
      const self=await request(app).post(workspace+"/approvals/"+run.body.approval.id+"/review")
        .set(creator).send({expectedVersion:1,decision:"approved",comment:"Auto-approbation refusée"})
      expect(self.status,key).toBe(403)
      const accepted=await request(app).post(workspace+"/approvals/"+run.body.approval.id+"/review")
        .set(reviewer).send({expectedVersion:1,decision:"approved",
          comment:"Pièces revues, accord pour traitement MANUEL uniquement"})
      expect(accepted.status,key).toBe(200)
      expect(accepted.body.approval.status,key).toBe("approved")
      expect(accepted.body.erpWriteExecuted,key).toBe(false)
      const replay=await request(app).post(workspace+"/approvals/"+run.body.approval.id+"/review")
        .set(reviewer).send({expectedVersion:1,decision:"approved"})
      expect(replay.status,key).toBe(409)
      const duplicate=await request(app).post(workspace+"/missions/"+mission.id+"/run")
        .set(creator).send({expectedVersion:1})
      expect(duplicate.status,key).toBe(409)
    }
    const missions=await request(app).get(workspace+"/missions").set(creator)
    expect(missions.status).toBe(200)
    expect(missions.body.missions).toHaveLength(5)
    expect(missions.body.missions.every((m:{status:string})=>m.status==="reviewed")).toBe(true)
    const packets=await request(app).get(workspace+"/actions").set(reviewer)
    expect(packets.status).toBe(200)
    expect(packets.body.actions).toHaveLength(5)
    for(const action of packets.body.actions){
      expect(action.erpWriteExecuted).toBe(false)
      expect(action.status).toBe("approved_for_manual_handoff")
      expect({from:action.from,to:action.to}).toEqual(year)
      const exported=await request(app).get(workspace+"/actions/"+action.id+"/export").set(reviewer)
      expect(exported.status).toBe(200)
      expect(exported.body.kind).toBe("approved_action_packet")
      expect(exported.body.erpWriteExecuted).toBe(false)
      expect(exported.body.action.id).toBe(action.id)
    }
    const notifications=await request(app).get(workspace+"/notifications").set(creator)
    expect(notifications.status).toBe(200)
    expect(notifications.body.unread).toBeGreaterThan(0)
    const pending=notifications.body.notifications.find((n:{readBy:string[]})=>!n.readBy.includes("usr-admin"))
    expect(pending).toBeTruthy()
    const read=await request(app).post(workspace+"/notifications/"+pending.id+"/read").set(creator)
    expect(read.status).toBe(200)
    expect(read.body.notification.readBy).toContain("usr-admin")
    const other=await request(app).get(workspace+"/actions").set(bearer("dev-admin-org-b"))
    expect(other.body.actions).toHaveLength(0)
    expect(IDs).toHaveLength(5)
    expect(new Set(approvals).size).toBe(5)
  })

  it("opens five independent grounded chats, checks historical switching and metered usage",async()=>{
    const calls:string[]=[]
    const llm:LlmProvider={
      name:"qa-stub-five-agents",isConfigured:()=>true,
      async chat(messages){
        calls.push(messages[0].content)
        return {model:"five-agent-fixture",content:"Contrôler les preuves et demander une validation humaine.",
          usage:{promptTokens:50,completionTokens:11,totalTokens:61}}
      },
    }
    const {app}=makeApp({data:synthetic(),llm})
    const token=bearer("dev-admin")
    for(const key of [...agents.map(x=>x.key),"director"]){
      const brief=await request(app).get(workspace+"/brief/"+key)
        .set(token).query({agency:"Sfax",...year})
      expect(brief.status,key).toBe(200)
      expect(brief.body.modelCalls,key).toBe(0)
      expect(brief.body.period,key).toEqual(year)
      const turnId=crypto.randomUUID()
      const body={agency:"Sfax",...year,turnId,
        message:"Explique les risques métier en détaillant les contrôles humains."}
      const response=await request(app).post(workspace+"/chat/"+key)
        .set(token).send(body)
      expect(response.status,key).toBe(200)
      expect(response.body.mode,key).toBe("llm_grounded")
      expect(response.body.message.model,key).toBe("five-agent-fixture")
      expect(response.body.message.usage.totalTokens,key).toBe(61)
      expect(response.body.message.from,key).toBe(year.from)
      const history=await request(app).get(workspace+"/chat/"+key)
        .set(token).query({agency:"Sfax",...year})
      expect(history.status,key).toBe(200)
      expect(history.body.messages).toHaveLength(2)
      const switched=await request(app).get(workspace+"/chat/"+key)
        .set(token).query({agency:"Sfax",...t4})
      expect(switched.body.messages,key).toEqual([])
      const repeated=await request(app).post(workspace+"/chat/"+key)
        .set(token).send(body)
      expect(repeated.status,key).toBe(200)
      expect(repeated.body.reused,key).toBe(true)
      const conflict=await request(app).post(workspace+"/chat/"+key)
        .set(token).send({...body,from:t4.from,to:t4.to})
      expect(conflict.status,key).toBe(409)
    }
    expect(calls).toHaveLength(5)
    const usage=await request(app).get(workspace+"/usage").set(token)
    expect(usage.status).toBe(200)
    expect(usage.body.callsToday).toBe(5)
    expect(usage.body.totalTokensMeasured).toBe(305)
    expect(usage.body.measuredReplies).toBe(5)
    const other=await request(app).get(workspace+"/usage").set(bearer("dev-admin-org-b"))
    expect(other.body.callsToday).toBe(0)
  })

  it("prevents out-of-agency, wrong-role and unavailable historic-stock claims",async()=>{
    const {app}=makeApp({data:synthetic()})
    for(const a of agents){
      expect((await request(app).get(root+a.route).query({agency:"Tunis Centre",...year})
        .set(bearer("dev-manager-sfax"))).status,a.key).toBe(403)
      expect((await request(app).get(root+a.route).query({agency:"Sfax",from:year.to,to:year.from})
        .set(bearer("dev-admin"))).status,a.key).toBe(400)
    }
    expect((await request(app).post(root+"/ai-director/investigate")
      .set(bearer("dev-commercial-tunis")).send({
        agency:"Tunis Centre",...year,objective:"Analyser tous les spécialistes",
      })).status).toBe(403)
    expect((await request(app).get(workspace+"/brief/director")
      .set(bearer("dev-commercial-tunis")).query({agency:"Sfax",...year})).status).toBe(403)
    const historic=await request(app).get(root+"/supply-chain/recommendations")
      .set(bearer("dev-admin")).query({agency:"Sfax",...t3})
    expect(historic.status).toBe(200)
    expect(historic.body.status).toBe("no_data")
    expect(historic.body.metrics.stockPositions).toBe(null)
    expect(historic.body.scenarios[0].valueTnd).toBe(null)
    expect(historic.body.warnings.join(" ")).toContain("Stock historique non disponible")
    const historicPlan=await request(app).post(workspace+"/missions").set(bearer("dev-admin"))
      .send({agency:"Sfax",agent:"supply_chain_intelligence",...t3,
        title:"Stock T3 sans historique",objective:"Vérifier une position stock historique"})
    expect(historicPlan.status).toBe(201)
    const plan=await request(app).get(workspace+"/missions/"+historicPlan.body.mission.id+"/plan")
      .set(bearer("dev-admin"))
    expect(plan.body.plan.tools[0].status).toBe("blocked_data")
    const run=await request(app).post(workspace+"/missions/"+historicPlan.body.mission.id+"/run")
      .set(bearer("dev-admin")).send({expectedVersion:1})
    expect(run.status).toBe(200)
    expect(run.body.mission.lastRun.findings).toBe(0)
    expect(run.body.approval).toBe(null)
    expect(run.body.mission.status).toBe("reviewed")
    expect(run.body.erpWrites).toBe(0)
  })
})
