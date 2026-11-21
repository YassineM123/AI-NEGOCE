import { useCallback, useEffect, useState } from "react"

/** Agentic v2 server-backed controls — no browser-side ML and no ERP write APIs. */
const ROOT=(import.meta.env.VITE_AGENTIC_API_BASE || "").replace(/\/$/, "")+"/api/v1/agentic/workspace"
type Forecast = {status:"backtested_pilot"|"insufficient_history"|"rejected_backtest";
  model:{version:string;trainedThrough:string|null};trainingMonths:number;asOf:string;source:string;
  backtest:{wape:number|null;bias:number|null};verifiedProduction:false;
  predictions:Array<{month:string;revenueTnd:number;lowerTnd:number;upperTnd:number}>}
type Signal = {id:string;agency:string;title:string;explanation:string;severity:string;
  acknowledgedAt:string|null;source:string;asOf:string}
type DailyUsage={date:string;callsToday:number;dailyLimit:number;
  organizationCallsToday:number;
  successfulReplies:number;deterministicReplies:number;measuredReplies:number;unreportedReplies:number;
  totalTokensMeasured:number;measurement:string}
type Action = {id:string;agency:string;actionType:string;summary:string;approvedBy:string;
  source:string;status:"approved_for_manual_handoff";erpWriteExecuted:false}
async function getJson<T>(token:string,path:string,method="GET"):Promise<T>{
  const response=await fetch(ROOT+path,{method,headers:{Authorization:"Bearer "+token}})
  const body=await response.json().catch(()=>({}))
  if(!response.ok)throw Error(body.error?.message||body.error?.code||"API inaccessible ("+response.status+")")
  return body as T
}
export default function AgenticV2Panel({token,agency,role,from,to}:{token:string;agency:string;role:string;from?:string;to?:string}){
  const [forecast,setForecast]=useState<Forecast|null>(null)
  const [dailyUsage,setDailyUsage]=useState<DailyUsage|null>(null)
  const [signals,setSignals]=useState<Signal[]>([])
  const [policy,setPolicy]=useState<{enabled:boolean;revenueDeclinePercent:number;
    overdueTnd:number;stockAlertEnabled:boolean;cooldownDays:number}|null>(null)
  const [actions,setActions]=useState<Action[]>([])
  const [error,setError]=useState("")
  const [busy,setBusy]=useState(false)
  const reload=useCallback(async()=>{
    const query=new URLSearchParams()
    if(agency!=="all")query.set("agency",agency)
    if(from)query.set("from",from)
    if(to)query.set("to",to)
    const result=await Promise.allSettled([
      getJson<Forecast>(token,"/predictions"+(query.size?"?"+query:"")),
      getJson<{signals:Signal[]}>(token,"/signals"),
      getJson<{actions:Action[]}>(token,"/actions"),
      getJson<DailyUsage>(token,"/usage"),
      getJson<{policy:{enabled:boolean;revenueDeclinePercent:number;
        overdueTnd:number;stockAlertEnabled:boolean;cooldownDays:number}}>(token,"/signals/policy"),
    ])
    setForecast(result[0].status==="fulfilled"?result[0].value:null)
    setSignals(result[1].status==="fulfilled"?result[1].value.signals:[])
    setActions(result[2].status==="fulfilled"?result[2].value.actions:[])
    setDailyUsage(result[3].status==="fulfilled"?result[3].value:null)
    setPolicy(result[4].status==="fulfilled"?result[4].value.policy:null)
  },[token,agency,from,to])
  useEffect(()=>{
    void reload()
    const interval=setInterval(()=>{if(!document.hidden)void reload()},30000)
    return ()=>clearInterval(interval)
  },[reload])
  const act=async(fn:()=>Promise<unknown>)=>{
    setBusy(true);setError("")
    try{await fn();await reload()}catch(e){setError(e instanceof Error?e.message:"Action non disponible")}
    finally{setBusy(false)}
  }
  const savePolicy=async()=>{
    if(!policy)return
    await act(()=>fetch(ROOT+"/signals/policy",{
      method:"PUT",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
      body:JSON.stringify(policy),
    }).then(async r=>{
      if(!r.ok)throw Error("Modification de politique refusée (HTTP "+r.status+")")
      return r.json()
    }))
  }
  const download=async(item:Action)=>{
    const response=await fetch(ROOT+"/actions/"+encodeURIComponent(item.id)+"/export",{
      headers:{Authorization:"Bearer "+token},
    })
    if(!response.ok)throw Error("Export refusé (HTTP "+response.status+")")
    const url=URL.createObjectURL(new Blob([await response.text()],{type:"application/json"}))
    const link=document.createElement("a")
    link.href=url;link.download="AI-NEGOCE-action-"+item.id+".json"
    document.body.append(link);link.click();link.remove()
    setTimeout(()=>URL.revokeObjectURL(url),500)
  }
  const visibleSignals=signals.filter(s=>agency==="all"||s.agency===agency)
  const visibleActions=actions.filter(a=>agency==="all"||a.agency===agency)
  return <div className="aw-v2-section">
    <div className="aw-v2-grid">
      <section className="aw-panel" data-agentic-v2="usage">
        <h3>Consommation IA de votre session</h3>
        {dailyUsage?<><p><strong>{dailyUsage.callsToday} / {dailyUsage.dailyLimit}</strong> appels LLM aujourd'hui
          <small>Organisation : {dailyUsage.organizationCallsToday} appels aujourd'hui</small></p>
          <p><strong>{dailyUsage.totalTokensMeasured.toLocaleString("fr-FR")}</strong> tokens réellement reportés</p>
          <p className="aw-sub">{dailyUsage.deterministicReplies} réponse(s) à 0 token · {dailyUsage.measuredReplies} réponse(s) LLM mesurée(s) · {dailyUsage.unreportedReplies} sans comptage fournisseur</p>
          <p className="aw-sub">Les réponses déterministes / briefs n'utilisent aucun token. Les appels échoués sont inclus dans le quota, mais pas dans les tokens mesurés.</p>
        </>:<p className="aw-sub">Statistiques de consommation indisponibles.</p>}
      </section>
      <section className="aw-panel" data-agentic-v2="forecast">
        <h3>Prévisions ML · pilote contrôlé</h3>
        {forecast?<><p className="aw-sub">Modèle {forecast.model.version} · {forecast.trainingMonths} mois · arrêté {forecast.asOf}</p>
          <strong>{forecast.status==="backtested_pilot"?"Backtest admissible (pilote)":forecast.status==="rejected_backtest"?"Backtest refusé":"Historique insuffisant"}</strong>
          {forecast.predictions.map(p=><div className="aw-result" key={p.month}>
            <strong>{p.month} : {p.revenueTnd.toFixed(3)} TND HT</strong>
            <small>Fourchette empirique : {p.lowerTnd.toFixed(3)} à {p.upperTnd.toFixed(3)} TND</small>
          </div>)}
          <p className="aw-sub">WAPE : {forecast.backtest.wape===null?"N/D":(forecast.backtest.wape*100).toFixed(1)+" %"} · Non certifié production · Aucune action autonome</p>
        </>:<p className="aw-sub">Modèle indisponible ou permission Data Science absente.</p>}
      </section>
      <section className="aw-panel" data-agentic-v2="signals">
        <div className="aw-inline"><h3>Alertes proactives</h3>
          {role==="admin"&&<button className="aw-secondary" disabled={busy}
            onClick={()=>{void act(()=>getJson(token,"/signals/scan","POST"))}}>Analyser les sources</button>}</div>
        <p className="aw-sub">Surveillance à la date de source · in-app · politiques propres à l'organisation.</p>
        {role==="admin"&&policy&&<div className="aw-alert-settings">
          <label><input type="checkbox" checked={policy.enabled}
            onChange={e=>setPolicy(p=>p?{...p,enabled:e.target.checked}:p)}/> Alertes activées</label>
          <label>Seuil baisse CA (%)<input type="number" min={5} max={90}
            value={policy.revenueDeclinePercent}
            onChange={e=>setPolicy(p=>p?{...p,revenueDeclinePercent:Number(e.target.value)}:p)}/></label>
          <label>Montant créances échues (TND)<input type="number" min={0} step="0.001"
            value={policy.overdueTnd}
            onChange={e=>setPolicy(p=>p?{...p,overdueTnd:Number(e.target.value)}:p)}/></label>
          <label><input type="checkbox" checked={policy.stockAlertEnabled}
            onChange={e=>setPolicy(p=>p?{...p,stockAlertEnabled:e.target.checked}:p)}/> Alertes stock</label>
          <label>Anti-doublon (jours)<input type="number" min={0} max={90}
            value={policy.cooldownDays}
            onChange={e=>setPolicy(p=>p?{...p,cooldownDays:Number(e.target.value)}:p)}/></label>
          <button className="aw-secondary" disabled={busy} onClick={()=>{void savePolicy()}}>Enregistrer règles</button>
        </div>}
        {visibleSignals.slice(0,6).map(s=><div className="aw-notification" key={s.id}>
          <div><strong>{s.title}</strong><p>{s.explanation}</p><small>{s.agency} · arrêté {s.asOf} · {s.severity}</small></div>
          {!s.acknowledgedAt&&<button className="aw-secondary" disabled={busy} onClick={()=>{
            void act(()=>getJson(token,"/signals/"+s.id+"/acknowledge","POST"))
          }}>Acquitter</button>}
        </div>)}
        {!visibleSignals.length&&<p className="aw-sub">Aucun signal visible dans cette agence.</p>}
      </section>
      <section className="aw-panel" data-agentic-v2="actions">
        <h3>Actions approuvées</h3>
        <p className="aw-sub">Dossiers validés, transmission manuelle uniquement, aucune écriture ERP.</p>
        {visibleActions.slice(0,6).map(a=><div className="aw-notification" key={a.id}>
          <div><strong>{a.actionType}</strong><p>{a.summary}</p>
            <small>{a.agency} · approuvé par {a.approvedBy} · {a.source}</small></div>
          <button className="aw-secondary" disabled={busy} onClick={()=>{void act(()=>download(a))}}>Exporter dossier JSON</button>
        </div>)}
        {!visibleActions.length&&<p className="aw-sub">Aucun paquet d'action approuvé à transmettre.</p>}
      </section>
    </div>
    {error&&<p role="status" className="aw-notice">{error}</p>}
  </div>
}
