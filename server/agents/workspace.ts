import crypto from "node:crypto"
import type { Store } from "../store.js"

export const AGENT_KEYS = [
  "revenue_growth", "financial_strategy", "supply_chain_intelligence",
  "business_strategy", "director",
] as const
export type AgentKey = typeof AGENT_KEYS[number]
export type MissionStatus = "draft" | "in_progress" | "awaiting_approval" | "reviewed" | "cancelled"
export type ApprovalStatus = "pending" | "approved" | "rejected"
export type Actor = { id: string; role: string; agencies: string[] }
export type WorkspaceMission = {
  id: string; agency: string; agent: AgentKey; objective: string; title: string
  createdBy: string; status: MissionStatus; dueAt: string | null
  version: number; createdAt: string; updatedAt: string
  lastRun: null | { asOf: string; source: string; summary: string; findings: number; evidence: string[] }
}
export type WorkspaceApproval = {
  id: string; missionId: string; agency: string; agent: AgentKey
  requestedBy: string; actionType: string; summary: string
  evidence: string[]; status: ApprovalStatus; version: number
  createdAt: string; reviewedAt: string | null; reviewedBy: string | null
  comment: string | null
}
export type WorkspaceNotification = {
  id: string; key: string; recipientId: string | null; audience: "user" | "reviewer"
  agency: string; kind: "mission" | "approval" | "due" | "review"
  title: string; message: string; missionId: string | null
  createdAt: string; readBy: string[]
}
export type WorkspaceMessage = {
  id: string; turnId: string; userId: string; agency: string
  agent: AgentKey; role: "user" | "assistant"; content: string
  sources: string[]; model: string | null; createdAt: string
}
export type AgenticWorkspaceData = {
  missions: WorkspaceMission[]
  approvals: WorkspaceApproval[]
  notifications: WorkspaceNotification[]
  messages: WorkspaceMessage[]
}
export class WorkspaceConflict extends Error {}
export class WorkspaceForbidden extends Error {}
export class WorkspaceMissing extends Error {}
export class WorkspaceFull extends Error {}
const blank = (): AgenticWorkspaceData => ({ missions:[], approvals:[], notifications:[], messages:[] })
const caches = new WeakMap<Store, Map<string, AgenticWorkspaceData>>()
const now = () => new Date().toISOString()
const uuid = () => crypto.randomUUID()
const visibleAgency = (agency: string, actor: Actor) =>
  actor.agencies.includes("*") || actor.agencies.includes(agency)
const reviewer = (actor: Actor) => ["admin", "manager"].includes(actor.role)
const visibleMission = (m: WorkspaceMission, actor: Actor) =>
  visibleAgency(m.agency, actor) && (actor.role !== "commercial" || m.createdBy === actor.id)
const visibleNotification = (n: WorkspaceNotification, actor: Actor) =>
  visibleAgency(n.agency, actor) && (n.audience === "user"
    ? n.recipientId === actor.id : reviewer(actor))
const note = (
  w: AgenticWorkspaceData, key: string, agency: string, audience: "user" | "reviewer",
  recipientId: string | null, kind: WorkspaceNotification["kind"],
  title: string, message: string, missionId: string | null,
) => {
  if (w.notifications.some((x) => x.key === key)) return
  w.notifications.unshift({
    id: uuid(), key, agency, audience, recipientId, kind, title, message,
    missionId, createdAt: now(), readBy: [],
  })
  if (w.notifications.length > 1500) w.notifications.length = 1500
}
function validRecord(w: AgenticWorkspaceData) {
  if (!w || !Array.isArray(w.missions) || !Array.isArray(w.approvals) ||
      !Array.isArray(w.notifications) || !Array.isArray(w.messages))
    throw new Error("Invalid stored agentic workspace")
  return w
}

/**
 * PostgreSQL: transaction() always switches into the tenant RLS role, locks one
 * organization aggregate, then commits the full JSONB update atomically.
 * MemoryStore: isolated in-process test/local fallback, NOT durable on restart.
 */
export class AgenticWorkspace {
  constructor(private readonly store: Store) {}
  private async visit<T>(
    organizationId: string, write: boolean, fn: (value: AgenticWorkspaceData) => T,
  ): Promise<T> {
    const tenant = this.store.forTenant(organizationId)
    if (tenant.transaction) {
      return tenant.transaction(async (client) => {
        await client.query(
          "INSERT INTO agentic_workspaces(organization_id) VALUES($1) ON CONFLICT (organization_id) DO NOTHING",
          [organizationId],
        )
        const response = await client.query(
          "SELECT payload FROM agentic_workspaces WHERE organization_id=$1 FOR UPDATE",
          [organizationId],
        )
        const w = validRecord(response.rows[0]?.payload as AgenticWorkspaceData)
        const result = fn(w)
        if (write) await client.query(
          "UPDATE agentic_workspaces SET payload=$2::jsonb,revision=revision+1,updated_at=now() WHERE organization_id=$1",
          [organizationId, JSON.stringify(w)],
        )
        return result
      })
    }
    let map = caches.get(this.store)
    if (!map) { map = new Map(); caches.set(this.store,map) }
    const w = structuredClone(map.get(organizationId) ?? blank())
    const result = fn(w)
    if (write) map.set(organizationId, w)
    return result
  }
  listMissions(org: string, actor: Actor) {
    return this.visit(org, false, (w) => w.missions
      .filter((m) => visibleMission(m,actor))
      .sort((a,b) => b.createdAt.localeCompare(a.createdAt)))
  }
  createMission(org: string, actor: Actor, input: {
    agency: string; agent: AgentKey; title: string; objective: string; dueAt?: string
  }) {
    if (!visibleAgency(input.agency,actor)) throw new WorkspaceForbidden()
    return this.visit(org, true, (w) => {
      if (w.missions.length >= 500) throw new WorkspaceFull()
      const at=now()
      const mission:WorkspaceMission={
        id:uuid(), agency:input.agency, agent:input.agent,
        title:input.title, objective:input.objective,
        createdBy:actor.id, status:"draft", dueAt:input.dueAt ?? null,
        version:1, createdAt:at, updatedAt:at, lastRun:null,
      }
      w.missions.unshift(mission)
      note(w,"mission.created:"+mission.id,input.agency,"user",actor.id,
        "mission","Mission enregistrée",mission.title,mission.id)
      return mission
    })
  }
  getMission(org: string, actor: Actor, id: string) {
    return this.visit(org,false,(w)=>{
      const m=w.missions.find((x)=>x.id===id && visibleMission(x,actor))
      if (!m) throw new WorkspaceMissing()
      return m
    })
  }
  submitRun(org: string, actor: Actor, id: string, expectedVersion:number, report: {
    asOf: string; source: string; summary: string; findings: number
    evidence: string[]; actionType?: string
  }) {
    return this.visit(org,true,(w)=>{
      const mission=w.missions.find((m)=>m.id===id && visibleMission(m,actor))
      if (!mission) throw new WorkspaceMissing()
      if (mission.version!==expectedVersion || !["draft","in_progress"].includes(mission.status))
        throw new WorkspaceConflict("Mission modifiée ou déjà soumise")
      mission.version++; mission.updatedAt=now()
      mission.lastRun={asOf:report.asOf,source:report.source,summary:report.summary,
        findings:report.findings,evidence:report.evidence.slice(0,25)}
      mission.status=report.findings>0?"awaiting_approval":"reviewed"
      const approval=report.findings>0 ? {
        id:uuid(), missionId:id, agency:mission.agency, agent:mission.agent,
        requestedBy:actor.id, actionType:report.actionType||"review_findings",
        summary:report.summary, evidence:report.evidence.slice(0,25),
        status:"pending" as const, version:1, createdAt:now(),
        reviewedAt:null, reviewedBy:null, comment:null,
      } : null
      if(approval){
        w.approvals.unshift(approval)
        note(w,"approval.requested:"+approval.id,mission.agency,"reviewer",null,"approval",
          "Approbation requise",mission.title,id)
      } else {
        note(w,"mission.completed:"+id+":"+mission.version,mission.agency,"user",
          actor.id,"mission","Analyse terminée sans constat",mission.title,id)
      }
      return {mission,approval}
    })
  }
  listApprovals(org:string,actor:Actor) {
    if (!reviewer(actor)) throw new WorkspaceForbidden()
    return this.visit(org,false,(w)=>w.approvals
      .filter((a)=>visibleAgency(a.agency,actor))
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))
  }
  reviewApproval(org:string,actor:Actor,id:string,
    expectedVersion:number,decision:"approved"|"rejected",comment:string) {
    if (!reviewer(actor)) throw new WorkspaceForbidden()
    return this.visit(org,true,(w)=>{
      const a=w.approvals.find((item)=>item.id===id && visibleAgency(item.agency,actor))
      if (!a) throw new WorkspaceMissing()
      if (a.requestedBy===actor.id) throw new WorkspaceForbidden("Separation des tâches : le demandeur ne peut approuver sa propre recommandation")
      if (a.status!=="pending" || a.version!==expectedVersion)
        throw new WorkspaceConflict("Décision déjà traitée ou version modifiée")
      a.status=decision;a.version++;a.reviewedAt=now();a.reviewedBy=actor.id;a.comment=comment
      const mission=w.missions.find((m)=>m.id===a.missionId)
      if(mission){ mission.status=decision==="approved"?"reviewed":"draft";mission.version++;mission.updatedAt=now() }
      note(w,"approval.reviewed:"+a.id, a.agency,"user",a.requestedBy,"review",
        decision==="approved"?"Recommandation validée (sans exécution ERP)":"Recommandation refusée",
        mission?.title??a.summary,a.missionId)
      return a
    })
  }
  listNotifications(org:string,actor:Actor) {
    return this.visit(org,false,(w)=>w.notifications.filter((n)=>visibleNotification(n,actor))
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))
  }
  markNotificationRead(org:string,actor:Actor,id:string) {
    return this.visit(org,true,(w)=>{
      const item=w.notifications.find((n)=>n.id===id && visibleNotification(n,actor))
      if(!item) throw new WorkspaceMissing()
      if(!item.readBy.includes(actor.id)) item.readBy.push(actor.id)
      return item
    })
  }
  listChat(org:string,actor:Actor,agent:AgentKey,agency:string) {
    if (agency!=="all" && !visibleAgency(agency,actor)) throw new WorkspaceForbidden()
    return this.visit(org,false,(w)=>w.messages.filter((m)=>
      m.userId===actor.id && m.agent===agent && m.agency===agency).slice(-30))
  }
  saveChat(org:string,actor:Actor,agent:AgentKey,agency:string,turnId:string,
    question:string,answer:string,sources:string[],model:string) {
    if(agency!=="all" && !visibleAgency(agency,actor)) throw new WorkspaceForbidden()
    return this.visit(org,true,(w)=>{
      const existing=w.messages.find((m)=>m.turnId===turnId&&m.role==="assistant"&&m.userId===actor.id)
      if(existing) return existing
      const createdAt=now()
      w.messages.push({
        id:uuid(),turnId,userId:actor.id,agency,agent,role:"user",
        content:question,sources:[],model:null,createdAt,
      })
      const assistant:WorkspaceMessage={
        id:uuid(),turnId,userId:actor.id,agency,agent,role:"assistant",
        content:answer,sources:sources.slice(0,40),model,createdAt:now(),
      }
      w.messages.push(assistant)
      if(w.messages.length>3000)w.messages.splice(0,w.messages.length-3000)
      return assistant
    })
  }
  getTurn(org:string,actor:Actor,agent:AgentKey,agency:string,turnId:string) {
    return this.visit(org,false,(w)=>w.messages.find((m)=>
      m.turnId===turnId&&m.userId===actor.id&&m.agent===agent
      &&m.agency===agency&&m.role==="assistant"))
  }
  /**
   * Worker process: due reminders are deduplicated by mission and calendar date.
   * This does not invoke an ERP action or dispatch email/push.
   */
  scanDue(org:string, at = now()) {
    return this.visit(org,true,(w)=>{
      const day=at.slice(0,10)
      let added=0
      for(const m of w.missions){
        if(!m.dueAt || m.dueAt.slice(0,10)>day || !["draft","in_progress","awaiting_approval"].includes(m.status))continue
        const key="mission.due:"+m.id+":"+day
        if(w.notifications.some((n)=>n.key===key))continue
        note(w,key,m.agency,"user",m.createdBy,"due","Mission à traiter",
          m.title+" — échéance "+m.dueAt,m.id)
        added++
      }
      return added
    })
  }
}
