import { useCallback, useEffect, useState, type FormEvent } from "react"

const ROOT=(import.meta.env.VITE_AGENTIC_API_BASE || "").replace(/\/$/, "")+"/api/v1/agentic/workspace"
export const AGENT_DOMAIN={
  revenue:"revenue_growth",finance:"financial_strategy",
  supply:"supply_chain_intelligence",strategy:"business_strategy",
  director:"director",
} as const
export type AgentDomain=typeof AGENT_DOMAIN[keyof typeof AGENT_DOMAIN]
const AGENTS: {key:AgentDomain;label:string}[]=[
  {key:"revenue_growth",label:"Revenue Growth"},
  {key:"financial_strategy",label:"Financial Strategy"},
  {key:"supply_chain_intelligence",label:"Supply Chain"},
  {key:"business_strategy",label:"Business Strategy"},
  {key:"director",label:"AI Director"},
]
type Mission={
  id:string;agency:string;agent:AgentDomain;title:string;objective:string;
  createdBy:string;status:"draft"|"in_progress"|"awaiting_approval"|"reviewed"|"cancelled";
  dueAt:string|null;version:number;createdAt:string;updatedAt:string;
  lastRun:null|{asOf:string;source:string;summary:string;findings:number;evidence:string[]}
}
type Approval={
  id:string;missionId:string;agency:string;agent:AgentDomain;requestedBy:string;
  status:"pending"|"approved"|"rejected";version:number;actionType:string;
  summary:string;evidence:string[];createdAt:string;reviewedBy:string|null;comment:string|null
}
export type Notification={
  id:string;agency:string;kind:string;title:string;message:string;missionId:string|null;
  createdAt:string;readBy:string[];recipientId:string|null;audience:"user"|"reviewer"
}
type ChatMessage={id:string;role:"assistant"|"user";content:string;createdAt:string;model:string|null;sources:string[]}
async function api<T>(token:string,path:string,options?:{method?:string;body?:unknown;signal?:AbortSignal}):Promise<T>{
  const response=await fetch(ROOT+path,{
    method:options?.method??"GET",
    headers:{Authorization:"Bearer "+token,...(options?.body?{"Content-Type":"application/json"}:{})},
    body:options?.body?JSON.stringify(options.body):undefined,
    signal:options?.signal,
  })
  const result=await response.json().catch(()=>({})) as {error?:{code?:string;message?:string}}
  if(!response.ok)throw new Error(result.error?.message||result.error?.code||"API indisponible : "+response.status)
  return result as T
}
const when=(iso:string)=>new Date(iso).toLocaleString("fr-FR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})
const label=(key:AgentDomain)=>AGENTS.find(x=>x.key===key)?.label??key
const status=(s:Mission["status"])=>({
  draft:"Brouillon",in_progress:"En cours",awaiting_approval:"À approuver",
  reviewed:"Analysée / revue",cancelled:"Annulée",
})[s]
function Empty({children}:{children:string}){return <p className="aw-empty">{children}</p>}
function Notice({children}:{children:string}){return <p className="aw-notice" role="status">{children}</p>}

export function AdvancedMissions({token,agency}:{token:string;agency:string}){
  const [missions,setMissions]=useState<Mission[]>([])
  const [error,setError]=useState("")
  const [busy,setBusy]=useState(false)
  const [title,setTitle]=useState("")
  const [objective,setObjective]=useState("")
  const [agent,setAgent]=useState<AgentDomain>("revenue_growth")
  const [targetAgency,setTargetAgency]=useState(agency==="all"?"Sfax":agency)
  const [dueAt,setDueAt]=useState("")
  const load=useCallback(async()=>{
    try{ const x=await api<{missions:Mission[]}>(token,"/missions");setMissions(x.missions);setError("")}
    catch(e){setError(e instanceof Error?e.message:"Missions indisponibles")}
  },[token])
  useEffect(()=>{void load()},[load])
  useEffect(()=>{if(agency!=="all")setTargetAgency(agency)},[agency])
  const create=async(event:FormEvent)=>{
    event.preventDefault()
    setBusy(true);setError("")
    try{
      await api(token,"/missions",{method:"POST",body:{
        agent,title,objective,agency:targetAgency,...(dueAt?{dueAt:new Date(dueAt).toISOString()}:{})
      }})
      setTitle("");setObjective("");setDueAt("");await load()
    }catch(e){setError(e instanceof Error?e.message:"Création impossible")}
    finally{setBusy(false)}
  }
  const run=async(m:Mission)=>{
    setBusy(true);setError("")
    try{
      const r=await api<{mission:Mission}>(token,"/missions/"+m.id+"/run",{
        method:"POST",body:{expectedVersion:m.version}
      })
      setMissions(old=>old.map(x=>x.id===m.id?r.mission:x))
      await load()
    }catch(e){setError(e instanceof Error?e.message:"Analyse indisponible")}
    finally{setBusy(false)}
  }
  return <div className="aw-grid">
    <section className="aw-panel">
      <header className="aw-heading"><div><h3>Centre des missions</h3><p>Enregistrement côté serveur · source et preuves conservées · aucune écriture ERP</p></div>
        <button className="aw-secondary" onClick={()=>{void load()}}>Actualiser</button></header>
      {error&&<Notice>{error}</Notice>}
      {!missions.length?<Empty>Aucune mission enregistrée dans cette organisation.</Empty>:
        <div className="aw-list">{missions.filter(m=>agency==="all"||m.agency===agency).map(m=>
          <article key={m.id} className="aw-mission">
            <div className="aw-inline"><div><strong>{m.title}</strong><small>{label(m.agent)} · {m.agency} · {when(m.createdAt)}</small></div>
              <span className={"aw-status aw-status-"+m.status}>{status(m.status)}</span>
            </div>
            <p>{m.objective}</p>
            {m.lastRun&&<div className="aw-result"><strong>{m.lastRun.summary}</strong>
              <span>Source : {m.lastRun.source} · arrêté au {m.lastRun.asOf}</span>
              {m.lastRun.evidence.length>0&&<small>Preuves : {m.lastRun.evidence.slice(0,7).join(", ")}</small>}</div>}
            <footer><small>Version {m.version} · {m.dueAt?"Échéance : "+when(m.dueAt):"Sans échéance"}</small>
              {["draft","in_progress"].includes(m.status)&&
                <button className="aw-primary" disabled={busy} onClick={()=>{void run(m)}}>Lancer l'analyse read-only</button>}</footer>
          </article>
        )}</div>}
    </section>
    <section className="aw-panel aw-compose"><h3>Nouvelle mission</h3><p className="aw-sub">Un dossier suivi par le backend, pas un brouillon local.</p>
      <form onSubmit={create}>
        <label>Agent responsable<select value={agent} onChange={e=>setAgent(e.target.value as AgentDomain)}>
          {AGENTS.map(x=><option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
        <label>Agence<select value={targetAgency} onChange={e=>setTargetAgency(e.target.value)}>
          {agency!=="all"?<option value={agency}>{agency}</option>:["Sfax","Tunis Centre","Sousse","Bizerte","Nabeul"].map(a=><option key={a}>{a}</option>)}
        </select></label>
        <label>Titre<input required minLength={5} maxLength={160} value={title}
          onChange={e=>setTitle(e.target.value)} placeholder="Relancer les clients stratégiques"/></label>
        <label>Objectif<textarea required minLength={5} maxLength={1200} rows={4} value={objective}
          onChange={e=>setObjective(e.target.value)} placeholder="Décrivez les enjeux et critères de la mission"/></label>
        <label>Échéance (facultatif)<input type="datetime-local" value={dueAt}
          onChange={e=>setDueAt(e.target.value)}/></label>
        <button className="aw-primary" disabled={busy||!title.trim()||!objective.trim()} type="submit">Créer et enregistrer</button>
      </form>
      <div className="aw-hint">Une analyse déclenche un dossier de validation lorsqu'elle produit des recommandations. Une approbation n'exécute jamais d'action ERP.</div>
    </section>
  </div>
}

export function AdvancedApprovals({token,agency,userId}:{token:string;agency:string;userId?:string}){
  const [approvals,setApprovals]=useState<Approval[]>([])
  const [comments,setComments]=useState<Record<string,string>>({})
  const [error,setError]=useState("")
  const [busy,setBusy]=useState("")
  const load=useCallback(async()=>{
    try{const r=await api<{approvals:Approval[]}>(token,"/approvals");setApprovals(r.approvals);setError("")}
    catch(e){setError(e instanceof Error?e.message:"Approbations indisponibles")}
  },[token])
  useEffect(()=>{void load()},[load])
  const review=async(a:Approval,decision:"approved"|"rejected")=>{
    setBusy(a.id);setError("")
    try{
      await api(token,"/approvals/"+a.id+"/review",{method:"POST",body:{
        expectedVersion:a.version,decision,comment:comments[a.id]||"",
      }})
      await load()
    }catch(e){setError(e instanceof Error?e.message:"Validation refusée")}
    finally{setBusy("")}
  }
  return <section className="aw-panel">
    <header className="aw-heading"><div><h3>Décisions & approbations persistantes</h3><p>Double contrôle humain · historique des versions · aucune écriture ERP</p></div>
      <button className="aw-secondary" onClick={()=>{void load()}}>Actualiser</button></header>
    {error&&<Notice>{error}</Notice>}
    {!approvals.length?<Empty>Aucune demande d'approbation dans les agences autorisées.</Empty>:
      <div className="aw-approval-grid">{approvals.filter(a=>agency==="all"||a.agency===agency).map(a=>
        <article className="aw-mission" key={a.id}>
          <div className="aw-inline"><strong>{a.summary}</strong><span className={"aw-status aw-status-"+a.status}>{a.status}</span></div>
          <p>{label(a.agent)} · {a.agency} · {when(a.createdAt)}</p>
          <p className="aw-sub">Action proposée : <strong>{a.actionType}</strong> · demandeur : {a.requestedBy}</p>
          {a.evidence.length>0&&<div className="aw-result">Références : {a.evidence.slice(0,8).join(", ")}</div>}
          {a.status==="pending" && a.requestedBy===userId?<Notice>Double validation obligatoire : vous ne pouvez pas approuver votre propre demande.</Notice>:null}
          {a.status==="pending" && a.requestedBy!==userId?<div className="aw-decision-controls">
            <label>Commentaire de revue<textarea rows={2} value={comments[a.id]||""} maxLength={1500}
              onChange={e=>setComments(old=>({...old,[a.id]:e.target.value}))} placeholder="Justification et observations"/></label>
            <div className="aw-actions"><button className="aw-primary" disabled={Boolean(busy)}
              onClick={()=>{void review(a,"approved")}}>Approuver le brouillon</button>
              <button className="aw-danger" disabled={Boolean(busy)}
                onClick={()=>{void review(a,"rejected")}}>Refuser</button></div>
          </div>:<p className="aw-sub">Revu par : {a.reviewedBy} · {a.comment||"Sans commentaire"}</p>}
          <small>Version {a.version} · interdiction d'auto-validation du demandeur</small>
        </article>
      )}</div>}
  </section>
}

export function AdvancedNotifications({token,agency,userId}:{token:string;agency:string;userId?:string}){
  const [items,setItems]=useState<Notification[]>([])
  const [unread,setUnread]=useState(0)
  const [error,setError]=useState("")
  const refresh=useCallback(async()=>{
    try{
      const x=await api<{notifications:Notification[];unread:number}>(token,"/notifications")
      setItems(x.notifications);setUnread(x.unread);setError("")
    }catch(e){setError(e instanceof Error?e.message:"Notifications indisponibles")}
  },[token])
  useEffect(()=>{
    void refresh()
    const id=setInterval(()=>{if(!document.hidden)void refresh()},15000)
    return ()=>clearInterval(id)
  },[refresh])
  const read=async(item:Notification)=>{
    try{await api(token,"/notifications/"+item.id+"/read",{method:"POST"});await refresh()}
    catch(e){setError(e instanceof Error?e.message:"Erreur de lecture")}
  }
  return <section className="aw-panel">
    <header className="aw-heading"><div><h3>Centre des notifications</h3><p>Événements créés par le serveur · rappels générés par le worker · actualisation automatique toutes les 15 s</p></div>
      <span className="aw-status aw-status-awaiting_approval">{unread} non lues</span></header>
    {error&&<Notice>{error}</Notice>}
    {items.length===0?<Empty>Aucune notification enregistrée.</Empty>:items.filter(n=>agency==="all"||agency===n.agency).map(n=>
      <article className="aw-notification" key={n.id}>
        <div><strong>{n.title}</strong><p>{n.message}</p><small>{n.agency} · {when(n.createdAt)} · {n.kind}</small></div>
        {!userId || !n.readBy.includes(userId)?<button className="aw-secondary" onClick={()=>{void read(n)}}>Marquer lue</button>:
          <span className="aw-status aw-status-reviewed">Lue</span>}
      </article>)}
  </section>
}

export function AdvancedAgentChat({token,agency,agent}:{token:string;agency:string;agent:AgentDomain}){
  const [messages,setMessages]=useState<ChatMessage[]>([])
  const [draft,setDraft]=useState("")
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState("")
  const fetchHistory=useCallback(async()=>{
    try{
      const q=new URLSearchParams({agency})
      const x=await api<{messages:ChatMessage[]}>(token,"/chat/"+agent+"?"+q)
      setMessages(x.messages);setError("")
    }catch(e){setError(e instanceof Error?e.message:"Historique indisponible")}
  },[token,agency,agent])
  useEffect(()=>{void fetchHistory()},[fetchHistory])
  const send=async(e:FormEvent)=>{
    e.preventDefault()
    if(!draft.trim()||busy)return
    setBusy(true);setError("")
    const text=draft.trim()
    try{
      const result=await api<{message:ChatMessage}>(token,"/chat/"+agent,{
        method:"POST",body:{agency,turnId:crypto.randomUUID(),message:text},
      })
      setDraft("");await fetchHistory()
      if(!result.message)throw new Error("Réponse vide")
    }catch(err){setError(err instanceof Error?err.message:"Conversation indisponible")}
    finally{setBusy(false)}
  }
  return <section className="aw-panel aw-chat-panel">
    <header className="aw-heading"><div><h3>Conversation — {label(agent)}</h3>
      <p>LLM réel côté serveur · données ERP autorisées · références source conservées</p></div>
      <button className="aw-secondary" onClick={()=>{void fetchHistory()}}>Historique</button></header>
    <div className="aw-chat-history" aria-live="polite">
      {messages.length===0?<Empty>Aucun échange pour cette agence. La conversation nécessite une configuration LLM serveur.</Empty>:
        messages.map(m=><article className={"aw-chat-bubble "+m.role} key={m.id}>
          <strong>{m.role==="assistant"?label(agent):"Vous"}</strong>
          <p>{m.content}</p>
          {m.sources.length>0&&<small>Sources : {m.sources.slice(0,7).join(", ")}</small>}
          <small>{when(m.createdAt)}{m.model?" · "+m.model:""}</small>
        </article>)}
    </div>
    {error&&<Notice>{error}</Notice>}
    <form className="aw-chat-entry" onSubmit={send}>
      <input required minLength={2} maxLength={1500} value={draft}
        onChange={e=>setDraft(e.target.value)}
        aria-label={"Message à "+label(agent)}
        placeholder="Posez une question basée sur les données et recommandations..."/>
      <button className="aw-primary" disabled={busy||draft.trim().length<2} type="submit">{busy?"Analyse...":"Envoyer"}</button>
    </form>
    <p className="aw-sub">Les échanges ne déclenchent aucun email, achat, paiement ou autre action ERP. Sans fournisseur LLM configuré, le serveur renvoie une erreur explicite.</p>
  </section>
}
