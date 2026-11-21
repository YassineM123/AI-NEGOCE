import type express from "express"
import crypto from "node:crypto"
import { z } from "zod"
import { requireRoles, scopedAgencies, type AgencyScope } from "../auth.js"
import type { Store } from "../store.js"
import type { Dataset } from "../services.js"
import type { LlmProvider } from "../llm/types.js"
import { analyzeRevenueGrowth } from "./revenue-growth.js"
import { evaluateAgenticForecast } from "./predictive.js"
import { buildGroundedPrompt,compactHistory,deterministicBrief } from "./context-budget.js"
import { buildExecutionTrace,type DomainRun } from "./execution-trace.js"
import { previewMissionPlan } from "./mission-plan.js"
import { requirePermission } from "../permissions.js"
import { analyzeFinancialStrategy } from "./financial-strategy.js"
import { analyzeSupplyChain } from "./supply-chain.js"
import { analyzeBusinessStrategy } from "./business-strategy.js"
import { investigateWithDirector } from "./ai-director.js"
import {
  AgenticWorkspace, AGENT_KEYS,
  WorkspaceConflict, WorkspaceForbidden, WorkspaceFull, WorkspaceMissing, WorkspaceBudgetExceeded,
  type AgentKey, type Actor,
} from "./workspace.js"

const uuid=z.string().uuid()
const agentSchema=z.enum(AGENT_KEYS)
const agencySchema=z.string().trim().min(1).max(80)
const allAgents = requireRoles("admin","manager","commercial","accountant")
const MAX_MESSAGE = 1500

/** Fingerprint only permitted agency rows; changed source requires a new mission. */
function scopedFingerprint(dataset:Dataset,scope:AgencyScope){
  const allowed=(agency:string)=>scope==="*"||scope.includes(agency)
  const hash=crypto.createHash("sha256")
  hash.update(JSON.stringify({source:dataset.metadata.source,asOf:dataset.metadata.asOf,
    lastUpdated:dataset.metadata.lastUpdated,scope}))
  for(const r of dataset.sales)if(allowed(r.agency))hash.update(JSON.stringify(r))
  for(const r of dataset.receivables)if(allowed(r.agency))hash.update(JSON.stringify(r))
  for(const r of dataset.inventory)if(allowed(r.agency))hash.update(JSON.stringify(r))
  return hash.digest("hex")
}


function agentAllowed(role:string,agent:AgentKey) {
  if(["admin","manager"].includes(role))return true
  if(role==="commercial")return agent==="revenue_growth"
  if(role==="accountant")return agent==="financial_strategy"
  return false
}
function apiError(res:express.Response,error:unknown) {
  if(error instanceof WorkspaceForbidden)return res.status(403).json({error:{code:"FORBIDDEN",message:error.message||"Hors périmètre"}})
  if(error instanceof WorkspaceMissing)return res.status(404).json({error:{code:"NOT_FOUND",message:"Ressource introuvable"}})
  if(error instanceof WorkspaceConflict)return res.status(409).json({error:{code:"VERSION_CONFLICT",message:error.message}})
  if(error instanceof WorkspaceFull)return res.status(409).json({error:{code:"WORKSPACE_LIMIT",message:"Capacité du dossier atteinte"}})
  if(error instanceof WorkspaceBudgetExceeded)return res.status(429).json({error:{code:"MODEL_BUDGET_EXCEEDED",message:error.message}})
  throw error
}
function extractReport(agent:AgentKey,scope:AgencyScope,dataset:Dataset,objective?:string) {
  if(agent==="revenue_growth"){
    const r=analyzeRevenueGrowth({scope,dataset,limit:10})
    const facts=r.opportunities.map((o)=>({
      title:o.customerName+" · "+o.state, explanation:o.reason,
      actionType:o.proposedAction.type, evidence:o.evidence.invoiceIds,
      score:o.priorityScore,
    }))
    return {
      asOf:r.snapshot.asOf,source:r.snapshot.source,
      facts, findings:r.analysis.opportunitiesFound,
      actionType:facts[0]?.actionType,
      runs:[{agent:"revenue_growth" as const,status:r.status,findings:facts.length,tool:"sales.customer_opportunities"}],
      warnings:r.warnings,
      decisionSupport:r.decisionSupport,
    }
  }
  if(agent==="director"){
    const r=investigateWithDirector({
      objective:objective || "Analyser les opportunités, créances, stocks et stratégie",
      scope,dataset,limit:10,
    })
    return {
      asOf:r.snapshot.asOf,source:r.snapshot.source,
      facts:r.highlights.map((x)=>({title:x.title,explanation:x.explanation,
        actionType:x.action.type,evidence:x.evidence.map((e)=>e.id)})),
      findings:r.summary.totalFindings,actionType:r.highlights[0]?.action.type,
      runs:r.sections.map(x=>({agent:x.agent,status:x.status,findings:x.findings.length,tool:"analytics."+x.agent})),
      warnings:r.warnings,
      decisionSupport:null,
    }
  }
  const r=agent==="financial_strategy"
    ?analyzeFinancialStrategy({scope,dataset,limit:10})
    :agent==="supply_chain_intelligence"
      ?analyzeSupplyChain({scope,dataset,limit:10})
      :analyzeBusinessStrategy({scope,dataset,limit:10})
  return {
    asOf:r.snapshot.asOf,source:r.snapshot.source,
    facts:r.findings.map((f)=>({title:f.title,explanation:f.explanation,
      actionType:f.action.type,evidence:f.evidence.map((e)=>e.id)})),
    findings:r.findings.length,actionType:r.findings[0]?.action.type,
    runs:[{agent:r.agent,status:r.status,findings:r.findings.length,tool:"analytics."+r.agent}],
    warnings:r.warnings,
    decisionSupport:r.decisionSupport??null,
  }
}
type AgentDeps = {
  store:Store
  dataset:()=>Dataset
  llm?:LlmProvider
  requireErpData: express.RequestHandler
}
export function registerAgenticWorkspaceRoutes(app:express.Express,deps:AgentDeps) {
  const workspace=new AgenticWorkspace(deps.store)
  const actor = (req:express.Request):Actor => ({
    id:req.principal!.id, role:req.principal!.role,
    agencies:req.principal!.agencies,
  })
  const org=(req:express.Request)=>req.principal!.organizationId
  const audit=(req:express.Request,action:string,resourceId:string,metadata:Record<string,unknown>)=>
    deps.store.forTenant(org(req)).audit({
      actorId:req.principal!.id,action,resourceType:"agentic_workspace",resourceId,metadata,
    })
  const scope=(req:express.Request,agency:string):AgencyScope|null=>scopedAgencies(req,agency)
  const fail=(res:express.Response)=>res.status(403).json({
    error:{code:"AGENCY_FORBIDDEN",message:"Agence non autorisée"},
  })
  const base="/api/v1/agentic/workspace"

  app.get(base+"/usage",allAgents,async(req,res)=>{
    const usage=await workspace.getLlmUsage(org(req),actor(req))
    const configured=Number(process.env.AGENTIC_DAILY_LLM_CALL_LIMIT||"40")
    const dailyLimit=Number.isInteger(configured)&&configured>=1&&configured<=100?configured:40
    res.setHeader("Cache-Control","no-store")
    return res.json({...usage,dailyLimit,
      warning:"Les tokens non reportés par le fournisseur et les appels échoués ne sont pas estimés comme coût réel."})
  })
  app.get(base+"/status",allAgents,(req,res)=>{
    res.setHeader("Cache-Control","no-store")
    return res.json({
      persistence:deps.store.forTenant(org(req)).transaction?"postgres":"memory",
      llmConfigured:Boolean(deps.llm && deps.llm.isConfigured() && deps.llm.name!=="mock"),
      llmProvider:deps.llm?.name==="mock"?"unconfigured":deps.llm?.name??"unconfigured",
      notifications:"in_app_worker",
      predictionService:"ridge_trend_backtested_pilot",
      proactiveSignals:"deterministic_read_only",
      approvedActions:"manual_handoff_only",
      erpWriteBack:false,
      warning:"Les rappels d'échéance nécessitent le processus agentic:worker et DATABASE_URL.",
    })
  })

  app.get(base+"/missions",allAgents,async(req,res)=>{
    res.setHeader("Cache-Control","no-store")
    return res.json({missions:await workspace.listMissions(org(req),actor(req))})
  })
  app.post(base+"/missions",allAgents,async(req,res)=>{
    const parse=z.object({
      agency:agencySchema, agent:agentSchema,
      title:z.string().trim().min(5).max(160),
      objective:z.string().trim().min(5).max(1200),
      dueAt:z.iso.datetime({offset:true}).optional(),
    }).strict().safeParse(req.body)
    if(!parse.success)return res.status(400).json({error:{code:"INVALID_REQUEST"}})
    if(!agentAllowed(req.principal!.role,parse.data.agent))
      return res.status(403).json({error:{code:"FORBIDDEN"}})
    if(scope(req,parse.data.agency)===null)return fail(res)
    try {
      const mission=await workspace.createMission(org(req),actor(req),parse.data)
      await audit(req,"mission.created",mission.id,{agency:mission.agency,agent:mission.agent})
      return res.status(201).json({mission})
    } catch(error){return apiError(res,error)}
  })
  app.get(base+"/missions/:id/plan",allAgents,deps.requireErpData,async(req,res)=>{
    const id=uuid.safeParse(req.params.id)
    if(!id.success)return res.status(400).json({error:{code:"INVALID_REQUEST"}})
    try{
      const mission=await workspace.getMission(org(req),actor(req),id.data)
      if(!agentAllowed(req.principal!.role,mission.agent))
        return res.status(403).json({error:{code:"FORBIDDEN"}})
      const s=scope(req,mission.agency)
      if(!s)return fail(res)
      const plan=previewMissionPlan({agent:mission.agent,objective:mission.objective,
        scope:s,dataset:deps.dataset()})
      res.setHeader("Cache-Control","no-store")
      return res.json({missionId:mission.id,version:mission.version,plan})
    }catch(error){return apiError(res,error)}
  })
  app.post(base+"/missions/:id/run",allAgents,deps.requireErpData,async(req,res)=>{
    const params=uuid.safeParse(req.params.id)
    const parsed=z.object({expectedVersion:z.number().int().positive()}).strict().safeParse(req.body)
    if(!params.success || !parsed.success)
      return res.status(400).json({error:{code:"INVALID_REQUEST"}})
    try{
      const mission=await workspace.getMission(org(req),actor(req),params.data)
      if(!agentAllowed(req.principal!.role,mission.agent) ||
        (mission.createdBy!==req.principal!.id && req.principal!.role!=="admin"))
        return res.status(403).json({error:{code:"FORBIDDEN"}})
      const s=scope(req,mission.agency)
      if(!s)return fail(res)
      const dataset=deps.dataset()
      const plan=previewMissionPlan({
        agent:mission.agent,objective:mission.objective,scope:s,dataset,
      })
      const session=await workspace.beginExecution(
        org(req),actor(req),mission.id,parsed.data.expectedVersion,{
          source:dataset.metadata.source,asOf:dataset.metadata.asOf,
          sourceFingerprint:scopedFingerprint(dataset,s),
          tools:plan.tools.map(t=>({id:t.id,agent:t.agent,tool:t.tool})),
        })
      const initial=session.execution
      // Each tool is explicitly allowlisted by previewMissionPlan. Persist output
      // after every tool, so a timeout or a process restart cannot erase success.
      for(const task of initial.steps){
        if(task.status==="completed"||task.status==="no_data")continue
        const preflight=plan.tools.find(t=>t.id===task.id)
        if(preflight?.status==="blocked_data"){
          await workspace.checkpointExecution(org(req),actor(req),mission.id,initial.id,
            task.id,{status:"no_data",findings:0,
              warnings:["Données requises indisponibles : aucune valeur inventée."]})
          continue
        }
        try{
          const report=extractReport(task.agent,s,dataset,mission.objective)
          await workspace.checkpointExecution(org(req),actor(req),mission.id,initial.id,
            task.id,{
              status:report.facts.length||report.findings?"completed":"no_data",
              findings:report.findings,facts:report.facts,warnings:report.warnings,
            })
        }catch(error){
          req.log.warn({agent:task.agent,reason:"tool_failed"},"Agentic tool failure")
          await workspace.checkpointExecution(org(req),actor(req),mission.id,initial.id,
            task.id,{status:"failed",findings:0,errorCode:"TOOL_EXECUTION_FAILED",
              warnings:["Moteur métier indisponible. Reprise manuelle possible."]})
        }
      }
      const checkpoint=await workspace.getMission(org(req),actor(req),mission.id)
      const execution=checkpoint.execution!
      if(execution.steps.some(t=>t.status==="failed"||t.status==="pending")){
        const paused=await workspace.pauseExecution(org(req),actor(req),mission.id,execution.id)
        await audit(req,"mission.partial",mission.id,{
          agency:mission.agency,attempts:execution.attempts,
          completedTools:execution.steps.filter(t=>t.status==="completed").length,
          failedTools:execution.steps.filter(t=>t.status==="failed").length,erpWrites:0,
        })
        return res.json({mission:paused,approval:null,partial:true,
          executionMode:"durable_read_only",erpWrites:0})
      }
      const findings=execution.steps.reduce((n,t)=>n+t.findings,0)
      const facts=execution.steps.flatMap(t=>t.facts)
      const runs:DomainRun[]=execution.steps.map(t=>({
        agent:t.agent,tool:t.tool,findings:t.findings,
        status:t.status==="no_data"?"no_data":"ok",
      }))
      const trace=buildExecutionTrace({objective:mission.objective,scope:s,
        startedAt:execution.startedAt,finishedAt:new Date().toISOString(),
        runs,findings,warnings:execution.steps.flatMap(t=>t.warnings)})
      const prediction=evaluateAgenticForecast(dataset,{agencies:s})
      const result=await workspace.submitRun(org(req),actor(req),mission.id,parsed.data.expectedVersion,{
        asOf:dataset.metadata.asOf,source:dataset.metadata.source,
        prediction:{
          status:prediction.status,modelVersion:prediction.model.version,
          month:prediction.predictions[0]?.month??null,
          revenueTnd:prediction.predictions[0]?.revenueTnd??null,wape:prediction.backtest.wape,
        },
        summary:"Analyse "+(execution.steps.some(t=>t.status==="no_data")?"partielle":"terminée")+
          " : "+findings+" constat(s) pour "+mission.title,
        trace,findings,evidence:facts.flatMap(f=>f.evidence).slice(0,25),
        actionType:facts[0]?.actionType,
      },execution.id)
      await audit(req,"mission.investigated",mission.id,{
        agency:mission.agency,agent:mission.agent,findings,
        approvalId:result.approval?.id,erpWrites:0,
        toolCalls:execution.steps.length,attempts:execution.attempts,
        durationMs:trace.durationMs,modelCalls:0,
      })
      return res.json({...result,executionMode:"durable_read_only",erpWrites:0})
    }catch(error){return apiError(res,error)}
  })
  app.get(base+"/approvals",requireRoles("admin","manager"),async(req,res)=>{
    res.setHeader("Cache-Control","no-store")
    return res.json({approvals:await workspace.listApprovals(org(req),actor(req))})
  })
  app.post(base+"/approvals/:id/review",requireRoles("admin","manager"),async(req,res)=>{
    const id=uuid.safeParse(req.params.id)
    const parsed=z.object({
      expectedVersion:z.number().int().positive(),
      decision:z.enum(["approved","rejected"]),
      comment:z.string().trim().max(1500).default(""),
    }).strict().safeParse(req.body)
    if(!id.success||!parsed.success)
      return res.status(400).json({error:{code:"INVALID_REQUEST"}})
    if(parsed.data.decision==="rejected" && parsed.data.comment.length<5)
      return res.status(400).json({error:{code:"COMMENT_REQUIRED"}})
    try{
      const approval=await workspace.reviewApproval(
        org(req),actor(req),id.data,
        parsed.data.expectedVersion,parsed.data.decision,parsed.data.comment,
        parsed.data.decision==="approved"?
          {source:deps.dataset().metadata.source,asOf:deps.dataset().metadata.asOf}:undefined,
      )
      await audit(req,"approval."+parsed.data.decision,approval.id,{
        missionId:approval.missionId,reviewedBy:req.principal!.id,
        requestedBy:approval.requestedBy,erpWrites:0,
      })
      return res.json({approval,erpWriteExecuted:false})
    }catch(error){return apiError(res,error)}
  })

  // Restricted, measured inference gateway. A pilot forecast is NOT a green light
  // for sending messages, posting financial entries or changing ERP records.
  app.get(base+"/predictions",allAgents,requirePermission("analytics.ds.read"),deps.requireErpData,(req,res)=>{
    const parsed=z.object({
      agency:agencySchema.default("all"),
      from:z.iso.date().optional(),to:z.iso.date().optional(),
    }).refine(x=>!x.from||!x.to||x.from<=x.to).safeParse(req.query)
    if(!parsed.success)return res.status(400).json({error:{code:"INVALID_REQUEST"}})
    const allowed=scope(req,parsed.data.agency)
    if(!allowed)return fail(res)
    const forecast=evaluateAgenticForecast(deps.dataset(),{
      agencies:allowed,from:parsed.data.from,to:parsed.data.to,
    })
    res.setHeader("Cache-Control","no-store")
    return res.json(forecast)
  })
  app.get(base+"/signals/policy",requireRoles("admin","manager"),async(req,res)=>{
    res.setHeader("Cache-Control","no-store")
    return res.json({policy:await workspace.getAlertPolicy(org(req),actor(req))})
  })
  app.put(base+"/signals/policy",requireRoles("admin"),async(req,res)=>{
    const parsed=z.object({
      enabled:z.boolean(),revenueDeclinePercent:z.number().min(5).max(90),
      overdueTnd:z.number().min(0).max(100_000_000),
      stockAlertEnabled:z.boolean(),cooldownDays:z.number().int().min(0).max(90),
    }).strict().safeParse(req.body)
    if(!parsed.success)return res.status(400).json({error:{code:"INVALID_REQUEST"}})
    const policy=await workspace.updateAlertPolicy(org(req),actor(req),parsed.data)
    await audit(req,"proactive.policy.updated",org(req),{policy})
    return res.json({policy})
  })
  app.get(base+"/signals",requireRoles("admin","manager"),async(req,res)=>{
    res.setHeader("Cache-Control","no-store")
    return res.json({signals:await workspace.listSignals(org(req),actor(req))})
  })
  app.post(base+"/signals/scan",requireRoles("admin"),deps.requireErpData,async(req,res)=>{
    const result=await workspace.scanSignals(org(req),deps.dataset())
    await audit(req,"proactive.signals.scanned",org(req),{created:result.created,source:deps.dataset().metadata.source})
    return res.json(result)
  })
  app.post(base+"/signals/:id/acknowledge",requireRoles("admin","manager"),async(req,res)=>{
    const id=uuid.safeParse(req.params.id)
    if(!id.success)return res.status(400).json({error:{code:"INVALID_REQUEST"}})
    try{
      const signal=await workspace.acknowledgeSignal(org(req),actor(req),id.data)
      await audit(req,"proactive.signal.acknowledged",id.data,{agency:signal.agency})
      return res.json({signal})
    }catch(error){return apiError(res,error)}
  })
  app.get(base+"/actions",allAgents,async(req,res)=>{
    res.setHeader("Cache-Control","no-store")
    return res.json({actions:await workspace.listActions(org(req),actor(req))})
  })
  app.get(base+"/actions/:id/export",allAgents,async(req,res)=>{
    const id=uuid.safeParse(req.params.id)
    if(!id.success)return res.status(400).json({error:{code:"INVALID_REQUEST"}})
    try{
      const action=await workspace.getApprovedAction(org(req),actor(req),id.data)
      await audit(req,"approved_action.exported",id.data,{
        agency:action.agency,approvalId:action.approvalId,erpWrites:0,
      })
      res.setHeader("Cache-Control","no-store")
      res.setHeader("Content-Disposition",'attachment; filename="agentic-approved-action.json"')
      return res.json({
        schemaVersion:1,kind:"approved_action_packet",action,
        approvalRequired:false,erpWriteExecuted:false,
        instructions:"Dossier à examiner et transmettre manuellement. Aucun connecteur ERP d'écriture n'est actif.",
      })
    }catch(error){return apiError(res,error)}
  })

  app.get(base+"/notifications",allAgents,async(req,res)=>{
    res.setHeader("Cache-Control","no-store")
    const notifications=await workspace.listNotifications(org(req),actor(req))
    return res.json({notifications,unread:notifications.filter((n)=>!n.readBy.includes(req.principal!.id)).length})
  })
  app.post(base+"/notifications/:id/read",allAgents,async(req,res)=>{
    const id=uuid.safeParse(req.params.id)
    if(!id.success)return res.status(400).json({error:{code:"INVALID_REQUEST"}})
    try{
      const notification=await workspace.markNotificationRead(org(req),actor(req),id.data)
      return res.json({notification})
    }catch(error){return apiError(res,error)}
  })

  // No LLM call, zero billed tokens; safe fallback when the provider is absent.
  app.get(base+"/brief/:agent",allAgents,deps.requireErpData,(req,res)=>{
    const agent=agentSchema.safeParse(req.params.agent)
    const parsed=z.object({agency:agencySchema.default("all")}).safeParse(req.query)
    if(!agent.success||!parsed.success)return res.status(400).json({error:{code:"INVALID_REQUEST"}})
    if(!agentAllowed(req.principal!.role,agent.data))return res.status(403).json({error:{code:"FORBIDDEN"}})
    const s=scope(req,parsed.data.agency)
    if(!s)return fail(res)
    const report=extractReport(agent.data,s,deps.dataset())
    res.setHeader("Cache-Control","no-store")
    return res.json({...deterministicBrief({agent:agent.data,source:report.source,asOf:report.asOf,
      facts:report.facts,findings:report.findings}),decisionSupport:report.decisionSupport})
  })

  app.get(base+"/chat/:agent",allAgents,async(req,res)=>{
    const agent=agentSchema.safeParse(req.params.agent)
    const parsed=z.object({agency:agencySchema.default("all")}).safeParse(req.query)
    if(!agent.success||!parsed.success)return res.status(400).json({error:{code:"INVALID_REQUEST"}})
    if(!agentAllowed(req.principal!.role,agent.data))return res.status(403).json({error:{code:"FORBIDDEN"}})
    if(!scope(req,parsed.data.agency))return fail(res)
    const messages=await workspace.listChat(org(req),actor(req),agent.data,parsed.data.agency)
    res.setHeader("Cache-Control","no-store")
    return res.json({agent:agent.data,messages})
  })
  app.post(base+"/chat/:agent",allAgents,deps.requireErpData,async(req,res)=>{
    const agent=agentSchema.safeParse(req.params.agent)
    const parsed=z.object({
      agency:agencySchema.default("all"),
      turnId:uuid, message:z.string().trim().min(2).max(MAX_MESSAGE),
    }).strict().safeParse(req.body)
    if(!agent.success||!parsed.success)return res.status(400).json({error:{code:"INVALID_REQUEST"}})
    if(!agentAllowed(req.principal!.role,agent.data))return res.status(403).json({error:{code:"FORBIDDEN"}})
    const s=scope(req,parsed.data.agency)
    if(!s)return fail(res)
    const llm=deps.llm
    if(!llm || !llm.isConfigured() || llm.name==="mock")
      return res.status(503).json({error:{
        code:"AGENT_LLM_UNCONFIGURED",
        message:"Configurez un fournisseur LLM réel (GEMINI_API_KEY) sur le serveur pour les conversations agentiques.",
      }})
    let previous
    try{
      previous=await workspace.getTurn(org(req),actor(req),agent.data,
        parsed.data.agency,parsed.data.turnId,parsed.data.message)
    }catch(error){return apiError(res,error)}
    if(previous)return res.json({message:previous,reused:true})
    const history=await workspace.listChat(org(req),actor(req),agent.data,parsed.data.agency)
    const report=extractReport(agent.data,s,deps.dataset(),parsed.data.message)
    const compact=buildGroundedPrompt({agent:agent.data,question:parsed.data.message,
      source:report.source,asOf:report.asOf,facts:report.facts,warnings:report.warnings})
    // Security/trace: prompt budget is capped, history is bounded and selected
    // citations are only those actually supplied to the model.
    const system=compact.prompt
    let quota:{callsToday:number;dailyLimit:number;
      organizationCallsToday:number;organizationDailyLimit:number}
    try{
      const configured=Number(process.env.AGENTIC_DAILY_LLM_CALL_LIMIT||"40")
      const dailyLimit=Number.isInteger(configured)&&configured>=1&&configured<=100?configured:40
      const configuredOrg=Number(process.env.AGENTIC_TENANT_DAILY_LLM_CALL_LIMIT||"250")
      const orgDailyLimit=Number.isInteger(configuredOrg)&&configuredOrg>=1&&configuredOrg<=10000?
        configuredOrg:250
      quota=await workspace.reserveLlmCall(org(req),actor(req),dailyLimit,
        new Date().toISOString(),orgDailyLimit,{
          turnId:parsed.data.turnId,agent:agent.data,agency:parsed.data.agency,
          question:parsed.data.message,
        })
    }catch(error){return apiError(res,error)}
    try {
      const response=await llm.chat([
        {role:"system",content:system},
        ...compactHistory(history.map(m=>({role:m.role,content:m.content}))),
        {role:"user",content:parsed.data.message},
      ],{temperature:0.2,maxTokens:compact.maxOutputTokens,timeoutMs:15000})
      const answer=response.content.trim().slice(0,4500)
      if(!answer){await workspace.releaseLlmTurn(org(req),actor(req),parsed.data.turnId)
        return res.status(502).json({error:{code:"LLM_EMPTY_RESPONSE"}})}
      const saved=await workspace.saveChat(org(req),actor(req),agent.data,
        parsed.data.agency,parsed.data.turnId,parsed.data.message,
        answer,compact.references,response.model,{
          promptTokens:response.usage?.promptTokens??null,
          completionTokens:response.usage?.completionTokens??null,
          totalTokens:response.usage?.totalTokens??null,
          estimatedContextTokens:compact.approximatePromptTokens,
          maxOutputTokens:compact.maxOutputTokens,
        })
      await audit(req,"agent.chat",saved.id,{
        agent:agent.data,agency:parsed.data.agency,source:report.source,
        asOf:report.asOf,model:response.model,evidence:compact.references.length,
        promptTokens:response.usage?.promptTokens??null,
        completionTokens:response.usage?.completionTokens??null,
        estimatedContextTokens:compact.approximatePromptTokens,
      })
      res.setHeader("Cache-Control","no-store")
      return res.json({message:saved,mode:"llm_grounded",erpWrites:0,
        budget:{callsToday:quota.callsToday,dailyLimit:quota.dailyLimit,
          organizationCallsToday:quota.organizationCallsToday,
          organizationDailyLimit:quota.organizationDailyLimit},
        context:{factsIncluded:compact.selected.length,characters:compact.contextChars,
          estimatedTokens:compact.approximatePromptTokens}})
    }catch(error){
      await workspace.releaseLlmTurn(org(req),actor(req),parsed.data.turnId)
      if(error instanceof WorkspaceForbidden||error instanceof WorkspaceConflict)return apiError(res,error)
      req.log.warn({reason:"provider_unavailable"}, "agent LLM call failed")
      return res.status(502).json({error:{
        code:"AGENT_LLM_UNAVAILABLE",message:"Modèle conversationnel temporairement indisponible",
      }})
    }
  })
}
