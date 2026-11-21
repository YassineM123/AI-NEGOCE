import crypto from "node:crypto"
import type { ExecutionTrace } from "./execution-trace.js"
import type { Store } from "../store.js"
import type { Dataset } from "../services.js"
import { buildAnalyticsInsights } from "../analytics-insights.js"

export const AGENT_KEYS = [
  "revenue_growth", "financial_strategy", "supply_chain_intelligence",
  "business_strategy", "director",
] as const
export type AgentKey = typeof AGENT_KEYS[number]
export type MissionStatus = "draft" | "in_progress" | "awaiting_approval" | "reviewed" | "cancelled"
export type ApprovalStatus = "pending" | "approved" | "rejected"
export type Actor = { id: string; role: string; agencies: string[] }
export type MissionStepKey = "scope" | "analysis" | "approval" | "handoff"
export type WorkspaceStep = {
  key: MissionStepKey; label: string; status: "completed" | "active" | "pending" | "blocked"
  completedAt: string | null; completedBy: string | null
}
export type ApprovedAction = {
  id: string; approvalId: string; missionId: string; agency: string; agent: AgentKey
  from?:string;to?:string
  actionType: string; summary: string; evidence: string[]; source: string
  asOf: string; preparedBy: string; approvedBy: string; createdAt: string
  status: "approved_for_manual_handoff"; erpWriteExecuted: false
  proposalHash?:string;idempotencyKey?:string;approvedUntil?:string
}
export type WorkspaceSignal = {
  id: string; key: string; agency: string
  kind: "revenue_decline" | "overdue_receivables" | "stock_below_reorder"
  severity: "medium" | "high"; title: string; explanation: string
  source: string; asOf: string; evidence: string[]; createdAt: string
  acknowledgedAt: string | null; acknowledgedBy: string | null
}
const createSteps = (time: string, actorId: string): WorkspaceStep[] => [
  {key:"scope",label:"01 · Cadrage et périmètre",status:"completed",completedAt:time,completedBy:actorId},
  {key:"analysis",label:"02 · Analyse des données",status:"active",completedAt:null,completedBy:null},
  {key:"approval",label:"03 · Validation humaine",status:"pending",completedAt:null,completedBy:null},
  {key:"handoff",label:"04 · Dossier d'action approuvée",status:"pending",completedAt:null,completedBy:null},
]
function step(m:WorkspaceMission,key:MissionStepKey,status:WorkspaceStep["status"],by?:string) {
  m.steps ??= createSteps(m.createdAt,m.createdBy) // compatibility with existing JSONB records
  const entry=m.steps.find(s=>s.key===key)
  if(entry){
    entry.status=status
    entry.completedAt=status==="completed"?now():null
    entry.completedBy=status==="completed"?(by??null):null
  }
}

export type MissionToolFact={
  title:string;explanation:string;actionType:string;evidence:string[];score?:number
}
export type MissionExecutionStep={
  id:string;agent:Exclude<AgentKey,"director">;tool:string
  status:"pending"|"completed"|"no_data"|"failed"
  findings:number;facts:MissionToolFact[];warnings:string[]
  attemptedAt:string|null;completedAt:string|null;errorCode:string|null
}
export type MissionExecution={
  id:string;status:"running"|"partial"|"completed"|"cancelled"
  sourceFingerprint:string;source:string;asOf:string
  startedAt:string;updatedAt:string;completedAt:string|null
  leaseUntil:string|null;attempts:number;maxToolCalls:4
  steps:MissionExecutionStep[]
}

export type WorkspaceMission = {
  id: string; agency: string; agent: AgentKey; objective: string; title: string
  from?:string;to?:string
  createdBy: string; status: MissionStatus; dueAt: string | null
  version: number; createdAt: string; updatedAt: string
  steps?: WorkspaceStep[]
  execution?: MissionExecution
  lastRun: null | { asOf: string; source: string; summary: string; findings: number; evidence: string[];
    trace?: ExecutionTrace;
    prediction?: {status:string;modelVersion:string;month:string|null;revenueTnd:number|null;wape:number|null} }
}
export type WorkspaceApproval = {
  id: string; missionId: string; agency: string; agent: AgentKey
  from?:string;to?:string
  requestedBy: string; actionType: string; summary: string
  evidence: string[]; status: ApprovalStatus; version: number
  createdAt: string; reviewedAt: string | null; reviewedBy: string | null
  comment: string | null
  expiresAt?:string;proposalHash?:string
}
export type WorkspaceNotification = {
  id: string; key: string; recipientId: string | null; audience: "user" | "reviewer"
  agency: string; kind: "mission" | "approval" | "due" | "review" | "signal"
  title: string; message: string; missionId: string | null
  createdAt: string; readBy: string[]
}
export type WorkspaceMessage = {
  id: string; turnId: string; userId: string; agency: string
  from?:string;to?:string
  agent: AgentKey; role: "user" | "assistant"; content: string
  sources: string[]; model: string | null; createdAt: string
  usage?: {promptTokens:number|null;completionTokens:number|null;totalTokens:number|null;
    estimatedContextTokens:number;maxOutputTokens:number}
}
export type AgenticWorkspaceData = {
  missions: WorkspaceMission[]
  approvals: WorkspaceApproval[]
  notifications: WorkspaceNotification[]
  messages: WorkspaceMessage[]
  actions: ApprovedAction[]
  signals: WorkspaceSignal[]
  llmQuota?: Record<string,{date:string;calls:number}>
  activeTurns?: Record<string,{expiresAt:string;agent:AgentKey;agency:string;questionHash:string}>
  alertPolicy?: {enabled:boolean;revenueDeclinePercent:number;overdueTnd:number;
    stockAlertEnabled:boolean;cooldownDays:number}
}
export class WorkspaceConflict extends Error {}
export class WorkspaceForbidden extends Error {}
export class WorkspaceMissing extends Error {}
export class WorkspaceFull extends Error {}
export class WorkspaceBudgetExceeded extends Error {}
const blank = (): AgenticWorkspaceData => ({ missions:[], approvals:[], notifications:[], messages:[], actions:[], signals:[] })
const caches = new WeakMap<Store, Map<string, AgenticWorkspaceData>>()
const now = () => new Date().toISOString()
const hash = (data:unknown)=>crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex")
const ALERT_DEFAULTS={enabled:true,revenueDeclinePercent:20,overdueTnd:1000,
  stockAlertEnabled:true,cooldownDays:7} as const
export type AlertPolicy={enabled:boolean;revenueDeclinePercent:number;overdueTnd:number;
  stockAlertEnabled:boolean;cooldownDays:number}
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
  // JSONB workspaces created with migration 008 predate Agentic v2.
  if (!Array.isArray(w.actions)) w.actions=[]
  if (!Array.isArray(w.signals)) w.signals=[]
  if (!w.llmQuota || typeof w.llmQuota!=="object") w.llmQuota={}
  if (!w.activeTurns || typeof w.activeTurns!=="object") w.activeTurns={}
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
        if (write) await client.query(
          "INSERT INTO agentic_workspaces(organization_id) VALUES($1) ON CONFLICT (organization_id) DO NOTHING",
          [organizationId],
        )
        const response = await client.query(
          "SELECT payload FROM agentic_workspaces WHERE organization_id=$1" + (write ? " FOR UPDATE" : ""),
          [organizationId],
        )
        const w = validRecord((response.rows[0]?.payload ?? blank()) as AgenticWorkspaceData)
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
    agency: string; agent: AgentKey; title: string; objective: string; dueAt?: string;
    from?:string;to?:string
  }) {
    if (!visibleAgency(input.agency,actor)) throw new WorkspaceForbidden()
    return this.visit(org, true, (w) => {
      if (w.missions.length >= 500) throw new WorkspaceFull()
      const at=now()
      const mission:WorkspaceMission={
        id:uuid(), agency:input.agency, agent:input.agent,
        title:input.title, objective:input.objective,from:input.from,to:input.to,
        createdBy:actor.id, status:"draft", dueAt:input.dueAt ?? null,
        version:1, createdAt:at, updatedAt:at, lastRun:null,
        steps:createSteps(at,actor.id),
      }
      w.missions.unshift(mission)
      note(w,"mission.created:"+mission.id,input.agency,"user",actor.id,
        "mission","Mission enregistrée",mission.title,mission.id)
      return mission
    })
  }
  cancelMission(org:string,actor:Actor,id:string,expectedVersion:number,reason:string) {
    return this.visit(org,true,w=>{
      const mission=w.missions.find(m=>m.id===id&&visibleMission(m,actor))
      if(!mission)throw new WorkspaceMissing()
      if(mission.createdBy!==actor.id&&actor.role!=="admin")
        throw new WorkspaceForbidden("Seul le créateur ou un admin peut annuler cette mission")
      if(mission.version!==expectedVersion ||
          !["draft","in_progress","awaiting_approval"].includes(mission.status))
        throw new WorkspaceConflict("Mission déjà traitée ou version modifiée")
      const at=now()
      mission.status="cancelled";mission.version++;mission.updatedAt=at
      if(mission.execution){
        mission.execution.status="cancelled"
        mission.execution.leaseUntil=null;mission.execution.updatedAt=at
      }
      mission.steps ??=createSteps(mission.createdAt,mission.createdBy)
      for(const part of mission.steps)
        if(part.status!=="completed"){
          part.status="blocked";part.completedAt=null;part.completedBy=null
        }
      for(const approval of w.approvals){
        if(approval.missionId!==id||approval.status!=="pending")continue
        approval.status="rejected";approval.version++
        approval.reviewedAt=at;approval.reviewedBy=actor.id
        approval.comment="Annulation de mission : "+reason.slice(0,400)
      }
      note(w,"mission.cancelled:"+id,mission.agency,"user",
        mission.createdBy,"mission","Mission annulée",reason.slice(0,200),id)
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
  /**
   * A durable four-tool checkpointed runner. The lease prevents two workers
   * from executing the same mission concurrently; after expiry the exact same
   * dataset fingerprint is required to resume its unfinished steps.
   */
  beginExecution(org:string,actor:Actor,id:string,expectedVersion:number,input:{
    source:string;asOf:string;sourceFingerprint:string;
    tools:Array<{id:string;agent:Exclude<AgentKey,"director">;tool:string}>
  },at=now()) {
    return this.visit(org,true,(w)=>{
      const mission=w.missions.find(m=>m.id===id&&visibleMission(m,actor))
      if(!mission)throw new WorkspaceMissing()
      if(mission.version!==expectedVersion ||
          !["draft","in_progress"].includes(mission.status))
        throw new WorkspaceConflict("Version de mission modifiée ou déjà terminée")
      if(input.tools.length<1||input.tools.length>4 ||
          new Set(input.tools.map(t=>t.id)).size!==input.tools.length)
        throw new WorkspaceConflict("Plan d'outils invalide ou hors budget")
      const previous=mission.execution
      if(previous){
        if(previous.status==="completed")throw new WorkspaceConflict("Mission déjà terminée")
        if(previous.sourceFingerprint!==input.sourceFingerprint ||
           previous.asOf!==input.asOf || previous.source!==input.source)
          throw new WorkspaceConflict("Source modifiée : créer un nouveau dossier pour éviter de réutiliser des preuves obsolètes")
        if(previous.status==="running"&&previous.leaseUntil&&previous.leaseUntil>at)
          throw new WorkspaceConflict("Analyse déjà en cours")
        if(previous.steps.length!==input.tools.length ||
           previous.steps.some((step,index)=>step.agent!==input.tools[index].agent||
             step.id!==input.tools[index].id||step.tool!==input.tools[index].tool))
          throw new WorkspaceConflict("Plan modifié depuis la dernière exécution")
        previous.status="running"
        previous.id=uuid() // invalidate any stale worker lease before retry
        previous.leaseUntil=new Date(Date.parse(at)+120000).toISOString()
        previous.updatedAt=at;previous.attempts++
        mission.status="in_progress";mission.updatedAt=at
        return {mission,execution:previous,resumed:true}
      }
      const execution:MissionExecution={
        id:uuid(),status:"running",sourceFingerprint:input.sourceFingerprint,
        source:input.source,asOf:input.asOf,startedAt:at,updatedAt:at,
        completedAt:null,leaseUntil:new Date(Date.parse(at)+120000).toISOString(),
        attempts:1,maxToolCalls:4,
        steps:input.tools.map(t=>({id:t.id,agent:t.agent,tool:t.tool,
          status:"pending",findings:0,facts:[],warnings:[],
          attemptedAt:null,completedAt:null,errorCode:null})),
      }
      mission.execution=execution;mission.status="in_progress";mission.updatedAt=at
      return {mission,execution,resumed:false}
    })
  }
  checkpointExecution(org:string,actor:Actor,id:string,executionId:string,
    stepId:string,output:{
      status:"completed"|"no_data"|"failed";findings:number
      facts?:MissionToolFact[];warnings?:string[];errorCode?:string
    },at=now()) {
    return this.visit(org,true,(w)=>{
      const mission=w.missions.find(m=>m.id===id&&visibleMission(m,actor))
      if(!mission)throw new WorkspaceMissing()
      const execution=mission.execution
      if(!execution||execution.id!==executionId||execution.status!=="running")
        throw new WorkspaceConflict("Session d'exécution expirée ou différente")
      const step=execution.steps.find(s=>s.id===stepId)
      if(!step||!["pending","failed"].includes(step.status))
        throw new WorkspaceConflict("Étape inconnue ou déjà terminée")
      step.status=output.status
      step.findings=Math.max(0,output.findings)
      step.facts=(output.facts??[]).slice(0,10).map(f=>({
        title:f.title.slice(0,150),explanation:f.explanation.slice(0,850),
        actionType:f.actionType.slice(0,100),evidence:f.evidence.slice(0,15),
        ...(typeof f.score==="number"?{score:f.score}:{}),
      }))
      step.warnings=(output.warnings??[]).slice(0,8).map(w=>w.slice(0,250))
      step.errorCode=output.errorCode??null;step.attemptedAt=at
      step.completedAt=output.status==="failed"?null:at
      execution.updatedAt=at
      return {step,execution}
    })
  }
  pauseExecution(org:string,actor:Actor,id:string,executionId:string,at=now()){
    return this.visit(org,true,(w)=>{
      const mission=w.missions.find(m=>m.id===id&&visibleMission(m,actor))
      if(!mission)throw new WorkspaceMissing()
      if(!mission.execution||mission.execution.id!==executionId||
        mission.execution.status!=="running")throw new WorkspaceConflict()
      mission.execution.status="partial";mission.execution.leaseUntil=null
      mission.execution.updatedAt=at;mission.status="in_progress";mission.updatedAt=at
      note(w,"mission.partial:"+id+":"+mission.execution.attempts,mission.agency,
        "user",mission.createdBy,"mission","Analyse partielle",
        "Au moins une étape a échoué. Reprenez la mission : seules les étapes incomplètes seront relancées.",id)
      return mission
    })
  }

  submitRun(org: string, actor: Actor, id: string, expectedVersion:number, report: {
    asOf: string; source: string; summary: string; findings: number
    evidence: string[]; actionType?: string; trace?: ExecutionTrace
    prediction?: {status:string;modelVersion:string;month:string|null;revenueTnd:number|null;wape:number|null}
  }, executionId?:string) {
    return this.visit(org,true,(w)=>{
      const mission=w.missions.find((m)=>m.id===id && visibleMission(m,actor))
      if (!mission) throw new WorkspaceMissing()
      if (mission.version!==expectedVersion || !["draft","in_progress"].includes(mission.status))
        throw new WorkspaceConflict("Mission modifiée ou déjà soumise")
      if(executionId){
        const execution=mission.execution
        if(!execution||execution.id!==executionId||execution.status!=="running"||
          execution.steps.some(s=>s.status!=="completed"&&s.status!=="no_data"))
          throw new WorkspaceConflict("Des étapes n'ont pas été exécutées ou la session a expiré")
        execution.status="completed";execution.completedAt=now()
        execution.updatedAt=execution.completedAt;execution.leaseUntil=null
      }
      mission.version++; mission.updatedAt=now()
      mission.lastRun={asOf:report.asOf,source:report.source,summary:report.summary,
        findings:report.findings,evidence:report.evidence.slice(0,25),
        ...(report.trace?{trace:report.trace}:{}),
        ...(report.prediction ? {prediction:report.prediction} : {})}
      step(mission,"analysis","completed",actor.id)
      step(mission,"approval",report.findings>0?"active":"blocked")
      step(mission,"handoff",report.findings>0?"pending":"blocked")
      mission.status=report.findings>0?"awaiting_approval":"reviewed"
      const createdAt=now()
      const proposalHash=hash({
        org,missionId:id,agency:mission.agency,agent:mission.agent,
        source:report.source,asOf:report.asOf,
        summary:report.summary,evidence:report.evidence.slice(0,25),
        actionType:report.actionType||"review_findings",
      })
      const approval=report.findings>0 ? {
        id:uuid(), missionId:id, agency:mission.agency, agent:mission.agent,
        from:mission.from,to:mission.to,
        requestedBy:actor.id, actionType:report.actionType||"review_findings",
        summary:report.summary, evidence:report.evidence.slice(0,25),
        status:"pending" as const, version:1, createdAt,
        expiresAt:new Date(Date.parse(createdAt)+72*3600*1000).toISOString(),
        proposalHash,
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
    expectedVersion:number,decision:"approved"|"rejected",comment:string,
    currentSource?:{source:string;asOf:string}) {
    if (!reviewer(actor)) throw new WorkspaceForbidden()
    return this.visit(org,true,(w)=>{
      const a=w.approvals.find((item)=>item.id===id && visibleAgency(item.agency,actor))
      if (!a) throw new WorkspaceMissing()
      if (a.requestedBy===actor.id) throw new WorkspaceForbidden("Separation des tâches : le demandeur ne peut approuver sa propre recommandation")
      if (a.status!=="pending" || a.version!==expectedVersion)
        throw new WorkspaceConflict("Décision déjà traitée ou version modifiée")
      const mission=w.missions.find((m)=>m.id===a.missionId)
      if(decision==="approved"){
        if(!mission?.lastRun)throw new WorkspaceConflict("Analyse absente ou non vérifiable")
        if(!a.expiresAt||a.expiresAt<now())
          throw new WorkspaceConflict("Approbation expirée : ouvrir une nouvelle mission")
        if(currentSource&&
          (currentSource.source!==mission.lastRun.source||
            currentSource.asOf!==mission.lastRun.asOf))
          throw new WorkspaceConflict("Source ERP modifiée : revue et calculs à renouveler")
        const expectedHash=hash({
          org,missionId:a.missionId,agency:a.agency,agent:a.agent,
          source:mission.lastRun.source,asOf:mission.lastRun.asOf,
          summary:a.summary,evidence:a.evidence,
          actionType:a.actionType,
        })
        if(a.proposalHash!==expectedHash)
          throw new WorkspaceConflict("Empreinte de proposition invalide : réapprobation impossible")
      }
      a.status=decision;a.version++;a.reviewedAt=now();a.reviewedBy=actor.id;a.comment=comment
      if(mission){
        mission.status=decision==="approved"?"reviewed":"draft"
        mission.version++;mission.updatedAt=now()
        step(mission,"approval",decision==="approved"?"completed":"blocked",actor.id)
        step(mission,"handoff",decision==="approved"?"completed":"blocked",actor.id)
        if(decision==="approved"&&!w.actions.some(x=>x.approvalId===a.id)){
          w.actions.unshift({
            id:uuid(),approvalId:a.id,missionId:mission.id,
            agency:a.agency,agent:a.agent,actionType:a.actionType,
            summary:a.summary,evidence:[...a.evidence],
            source:mission.lastRun?.source??"Source indisponible",
            asOf:mission.lastRun?.asOf??"",
            preparedBy:a.requestedBy,approvedBy:actor.id,createdAt:now(),
            status:"approved_for_manual_handoff",erpWriteExecuted:false,
            from:mission.from,to:mission.to,
            proposalHash:a.proposalHash,
            idempotencyKey:hash({org,approvalId:a.id,proposalHash:a.proposalHash}),
            approvedUntil:a.expiresAt,
          })
          note(w,"action.prepared:"+a.id,a.agency,"user",a.requestedBy,"review",
            "Dossier d'action approuvé",mission.title+" · prêt pour transmission MANUELLE",mission.id)
        }
      }
      note(w,"approval.reviewed:"+a.id, a.agency,"user",a.requestedBy,"review",
        decision==="approved"?"Recommandation validée (sans exécution ERP)":"Recommandation refusée",
        mission?.title??a.summary,a.missionId)
      return a
    })
  }

  listActions(org:string,actor:Actor) {
    return this.visit(org,false,(w)=>w.actions.filter(a=>
      visibleAgency(a.agency,actor) &&
      (reviewer(actor)||w.missions.some(m=>m.id===a.missionId && m.createdBy===actor.id)))
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))
  }
  getApprovedAction(org:string,actor:Actor,id:string) {
    return this.visit(org,false,(w)=>{
      const action=w.actions.find(a=>a.id===id && visibleAgency(a.agency,actor) &&
        (reviewer(actor)||w.missions.some(m=>m.id===a.missionId && m.createdBy===actor.id)))
      if(!action)throw new WorkspaceMissing()
      if(!action.approvedUntil||action.approvedUntil<now())
        throw new WorkspaceConflict("Dossier approuvé expiré : nouvelle revue nécessaire")
      return action
    })
  }
  getAlertPolicy(org:string,actor:Actor){
    if(!reviewer(actor))throw new WorkspaceForbidden()
    return this.visit(org,false,w=>({...ALERT_DEFAULTS,...w.alertPolicy}))
  }
  updateAlertPolicy(org:string,actor:Actor,policy:AlertPolicy){
    if(actor.role!=="admin")throw new WorkspaceForbidden()
    return this.visit(org,true,w=>{
      if(!Number.isFinite(policy.revenueDeclinePercent)||
        policy.revenueDeclinePercent<5||policy.revenueDeclinePercent>90||
        !Number.isFinite(policy.overdueTnd)||policy.overdueTnd<0||
        policy.overdueTnd>100_000_000||
        !Number.isInteger(policy.cooldownDays)||policy.cooldownDays<0||
        policy.cooldownDays>90)throw new WorkspaceConflict("Seuils d'alerte non valides")
      w.alertPolicy={...policy}
      return w.alertPolicy
    })
  }
  listSignals(org:string,actor:Actor) {
    if(!reviewer(actor))throw new WorkspaceForbidden()
    return this.visit(org,false,(w)=>w.signals.filter(s=>visibleAgency(s.agency,actor))
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))
  }
  acknowledgeSignal(org:string,actor:Actor,id:string) {
    if(!reviewer(actor))throw new WorkspaceForbidden()
    return this.visit(org,true,(w)=>{
      const signal=w.signals.find(s=>s.id===id && visibleAgency(s.agency,actor))
      if(!signal)throw new WorkspaceMissing()
      if(!signal.acknowledgedAt){
        signal.acknowledgedAt=now();signal.acknowledgedBy=actor.id
      }
      return signal
    })
  }
  /**
   * Deterministic daily scanner — one alert per source/agency/rule/date of data
   * (not per polling cycle). No data copied between organizations.
   * The caller must only pass a dataset authorised for this tenant.
   */
  scanSignals(org:string,data:Dataset,at=now()) {
    return this.visit(org,true,(w)=>{
      const policy={...ALERT_DEFAULTS,...w.alertPolicy}
      if(!policy.enabled)return {created:0,reason:"disabled" as const}
      const asOf=data.metadata.asOf??at.slice(0,10)
      if(Date.parse(at)-Date.parse(asOf+"T00:00:00Z")>90*86400000)
        return {created:0,reason:"stale_source" as const}
      const agencies=new Set([
        ...data.sales.map(r=>r.agency),...data.receivables.map(r=>r.agency),
        ...data.inventory.map(r=>r.agency),
      ])
      let created=0
      const publish=(agency:string,kind:WorkspaceSignal["kind"],
        title:string,explanation:string,evidence:string[],severity:WorkspaceSignal["severity"])=>{
        const key=[kind,agency,asOf,data.metadata.source].join("|")
        if(w.signals.some(s=>s.key===key))return
        if(policy.cooldownDays>0 && w.signals.some(s=>s.agency===agency&&s.kind===kind&&
          Date.parse(at)-Date.parse(s.createdAt)<policy.cooldownDays*86400000))return
        const signal:WorkspaceSignal={
          id:uuid(),key,agency,kind,severity,title,explanation,
          source:data.metadata.source,asOf,evidence:evidence.slice(0,15),
          createdAt:at,acknowledgedAt:null,acknowledgedBy:null,
        }
        w.signals.unshift(signal)
        note(w,"proactive:"+key,agency,"reviewer",null,"signal",
          title,explanation+" · source arrêtée "+asOf,null)
        created++
      }
      for(const agency of agencies){
        const analysis=buildAnalyticsInsights(data,{agencies:[agency],to:asOf})
        const change=analysis.summary.monthlyChangePercent
        if(change!==null && change<=-policy.revenueDeclinePercent){
          publish(agency,"revenue_decline","Baisse du CA entre mois clos",
            "Variation "+change.toFixed(2)+" % sur les deux derniers mois complets.",
            analysis.topCustomers.slice(0,5).map(c=>c.id),"medium")
        }
        const late=data.receivables.filter(r=>r.agency===agency &&
          r.dueDate<asOf && r.outstanding>0)
        const overdueMillimes=late.reduce((n,r)=>n+Math.round(r.outstanding*1000),0)
        if(overdueMillimes>=Math.round(policy.overdueTnd*1000) && overdueMillimes>0){
          publish(agency,"overdue_receivables","Créances échues à vérifier",
            (overdueMillimes/1000).toFixed(3)+" TND échus ; vérifier litiges et règlements.",
            late.map(r=>r.invoiceId),"high")
        }
        const low=data.inventory.filter(r=>r.agency===agency&&r.quantity<=r.reorderPoint)
        if(policy.stockAlertEnabled&&low.length){
          publish(agency,"stock_below_reorder","Stock sous seuil de réapprovisionnement",
            low.length+" référence(s) à revoir ; ne pas déclencher d'achat automatique.",
            low.map(r=>r.reference),"medium")
        }
      }
      if(w.signals.length>1000)w.signals.length=1000
      return {created,reason:"scanned" as const}
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
  listChat(org:string,actor:Actor,agent:AgentKey,agency:string,period:{from?:string;to?:string}={}) {
    if (agency!=="all" && !visibleAgency(agency,actor)) throw new WorkspaceForbidden()
    return this.visit(org,false,(w)=>w.messages.filter((m)=>
      m.userId===actor.id && m.agent===agent && m.agency===agency&&
      m.from===period.from&&m.to===period.to).slice(-30))
  }
  releaseLlmTurn(org:string,actor:Actor,turnId:string){
    return this.visit(org,true,w=>{
      const key=actor.id+":"+turnId
      if(w.activeTurns)delete w.activeTurns[key]
    })
  }
  pruneChat(org:string,at=now(),retentionDays=90){
    return this.visit(org,true,w=>{
      const cutoff=new Date(Date.parse(at)-retentionDays*86400000).toISOString()
      const before=w.messages.length
      w.messages=w.messages.filter(m=>m.createdAt>=cutoff)
      for(const [key,value] of Object.entries(w.activeTurns??{}))
        if(value.expiresAt<at)delete w.activeTurns![key]
      return before-w.messages.length
    })
  }
  saveChat(org:string,actor:Actor,agent:AgentKey,agency:string,turnId:string,
    question:string,answer:string,sources:string[],model:string,usage?:WorkspaceMessage["usage"],
    period:{from?:string;to?:string}={}) {
    if(agency!=="all" && !visibleAgency(agency,actor)) throw new WorkspaceForbidden()
    return this.visit(org,true,(w)=>{
      const existing=w.messages.find((m)=>m.turnId===turnId&&m.role==="assistant"&&m.userId===actor.id)
      if(existing){
        const user=w.messages.find(m=>m.turnId===turnId&&m.role==="user"&&m.userId===actor.id)
        if(existing.agent!==agent||existing.agency!==agency||user?.content!==question||
          existing.from!==period.from||existing.to!==period.to)
          throw new WorkspaceConflict("Identifiant de conversation déjà utilisé pour un autre contenu")
        return existing
      }
      const createdAt=now()
      w.messages.push({
        id:uuid(),turnId,userId:actor.id,agency,from:period.from,to:period.to,agent,role:"user",
        content:question,sources:[],model:null,createdAt,
      })
      const assistant:WorkspaceMessage={
        id:uuid(),turnId,userId:actor.id,agency,from:period.from,to:period.to,agent,role:"assistant",
        content:answer,sources:sources.slice(0,40),model,createdAt:now(),
        ...(usage?{usage}:{}),
      }
      w.messages.push(assistant)
      if(w.activeTurns)delete w.activeTurns[actor.id+":"+turnId]
      if(w.messages.length>3000)w.messages.splice(0,w.messages.length-3000)
      return assistant
    })
  }
  /**
   * Atomic server-side call quota: prevents runaway model loops, including
   * concurrent requests. Counts attempted provider calls, not estimated costs.
   * A failed call remains counted so a faulty provider cannot be hammered.
   */
  getLlmUsage(org:string,actor:Actor,at=now()){
    return this.visit(org,false,(w)=>{
      const date=at.slice(0,10)
      const replies=w.messages.filter(m=>m.userId===actor.id&&m.role==="assistant"&&m.createdAt.startsWith(date))
      const llmReplies=replies.filter(m=>m.model!=="rules-engine-v1")
      const measured=llmReplies.filter(m=>m.usage?.totalTokens!=null)
      return {
        date,callsToday:w.llmQuota?.[date+":"+actor.id]?.calls??0,
        organizationCallsToday:w.llmQuota?.[date+":__organization__"]?.calls??0,
        successfulReplies:llmReplies.length,
        deterministicReplies:replies.length-llmReplies.length,
        measuredReplies:measured.length,
        promptTokensMeasured:measured.reduce((n,m)=>n+(m.usage?.promptTokens??0),0),
        completionTokensMeasured:measured.reduce((n,m)=>n+(m.usage?.completionTokens??0),0),
        totalTokensMeasured:measured.reduce((n,m)=>n+(m.usage?.totalTokens??0),0),
        unreportedReplies:llmReplies.length-measured.length,
        measurement:"actual_if_provided_else_unknown" as const,
      }
    })
  }
  reserveLlmCall(org:string,actor:Actor,dailyLimit:number,at=now(),
    tenantDailyLimit=250,turn?:{turnId:string;agent:AgentKey;agency:string;question:string}) {
    return this.visit(org,true,(w)=>{
      const date=at.slice(0,10)
      w.llmQuota ??={};w.activeTurns ??={}
      const key=date+":"+actor.id
      const orgKey=date+":__organization__"
      const previous=w.llmQuota[key]?.calls??0
      const orgPrevious=w.llmQuota[orgKey]?.calls??0
      if(previous>=dailyLimit)throw new WorkspaceBudgetExceeded("Quota quotidien utilisateur de conversations IA atteint")
      if(orgPrevious>=tenantDailyLimit)throw new WorkspaceBudgetExceeded("Quota quotidien organisation de conversations IA atteint")
      if(turn){
        const turnKey=actor.id+":"+turn.turnId
        const existing=w.activeTurns[turnKey]
        if(existing&&existing.expiresAt>at)
          throw new WorkspaceConflict("Une réponse existe déjà pour ce tour et est en cours")
        w.activeTurns[turnKey]={
          expiresAt:new Date(Date.parse(at)+30000).toISOString(),
          agent:turn.agent,agency:turn.agency,questionHash:hash(turn.question),
        }
      }
      w.llmQuota[key]={date,calls:previous+1}
      w.llmQuota[orgKey]={date,calls:orgPrevious+1}
      for(const k of Object.keys(w.llmQuota))
        if(k.slice(0,10)<date)delete w.llmQuota[k]
      return {callsToday:previous+1,dailyLimit,
        organizationCallsToday:orgPrevious+1,organizationDailyLimit:tenantDailyLimit}
    })
  }
  getTurn(org:string,actor:Actor,agent:AgentKey,agency:string,turnId:string,question?:string,
    period:{from?:string;to?:string}={}) {
    return this.visit(org,false,w=>{
      const assistant=w.messages.find(m=>m.turnId===turnId&&m.userId===actor.id&&
        m.agent===agent&&m.agency===agency&&m.role==="assistant")
      if(assistant&&(assistant.from!==period.from||assistant.to!==period.to))
        throw new WorkspaceConflict("Tour déjà associé à une autre période")
      if(assistant&&question!==undefined){
        const user=w.messages.find(m=>m.turnId===turnId&&m.userId===actor.id&&
          m.agent===agent&&m.agency===agency&&m.role==="user"&&
          m.from===period.from&&m.to===period.to)
        if(!user||user.content!==question)throw new WorkspaceConflict("Tour de conversation réutilisé avec une question différente")
      }
      return assistant
    })
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
