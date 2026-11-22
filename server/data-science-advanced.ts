/**
 * Governed advanced Data Science pilots. Every candidate is evaluated against
 * chronological held-out facts; no ERP, banking or delivery outcome is invented.
 */
import type {Dataset,Filters} from "./services.js"
import {filteredSales} from "./services.js"

export const ADVANCED_DS_VERSION="ds-temporal-evaluation-v1"
const r3=(x:number)=>Math.round(x*1000)/1000
const day=(date:string)=>Date.parse(date+"T00:00:00Z")/86400000
const add=(date:string,n:number)=>new Date((day(date)+n)*86400000).toISOString().slice(0,10)
const month=(s:string)=>Number(s.slice(0,4))*12+Number(s.slice(5,7))-1
const stamp=(n:number)=>`${Math.floor(n/12)}-${String(n%12+1).padStart(2,"0")}`
const permits=(agency:string,f:Filters)=>!f.agencies||f.agencies==="*"||f.agencies.includes(agency)
const start=(d:string,f:Filters)=>!f.from||d>=f.from
const stop=(d:string,f:Filters,end:string)=>d<=end&&(!f.to||d<=f.to)
const brier=(p:number[],y:number[])=>p.reduce((s,v,i)=>s+(v-y[i])**2,0)/p.length
const mae=(p:number[],y:number[])=>p.reduce((s,v,i)=>s+Math.abs(v-y[i]),0)/p.length
const wape=(p:number[],y:number[])=>{
 const denom=y.reduce((a,b)=>a+Math.abs(b),0)
 return denom>0?p.reduce((s,v,i)=>s+Math.abs(v-y[i]),0)/denom:null
}
type Evaluation={name:string;metric:"brier"|"wape"|"mae_days";score:number|null}
const unavailable=(reason:string)=>({
 status:"insufficient_history" as const,model:null as string|null,
 version:ADVANCED_DS_VERSION,verifiedProduction:false as const,
 eligibleForAutonomousActions:false as const,
 trainSamples:0,holdoutSamples:0,
 candidates:[] as Evaluation[],baselineScore:null as number|null,
 selectedScore:null as number|null,forecast:null as number|null,
 forecastMonth:null as string|null,
 reason,
})

/** Historical, strictly observed "no next invoice in 90 days" label.
 *  Does not prove contractual customer churn, only purchase inactivity.
 */
export function backtestCustomerInactivity(dataset:Dataset,filters:Filters={}){
 const end=filters.to&&filters.to<dataset.metadata.asOf?filters.to:dataset.metadata.asOf
 const rows=filteredSales({agencies:filters.agencies,from:filters.from},dataset)
  .filter(s=>s.date<=end&&s.revenue>0&&!((s.kind??"invoice")==="credit_note"))
 const byCustomer=new Map<string,string[]>()
 for(const s of rows){
  const key=JSON.stringify([s.agency,s.customerId??s.customer])
  const dates=byCustomer.get(key)??[];dates.push(s.date);byCustomer.set(key,dates)
 }
 for(const dates of byCustomer.values())dates.sort()
 const latestM=month(add(end,-91))
 const fromM=month(filters.from??"2024-01-01")
 const cutoffs:string[]=[]
 for(let i=Math.max(fromM,latestM-11);i<=latestM;i++){
  const d=new Date(Date.UTC(Math.floor(i/12),i%12+1,0)).toISOString().slice(0,10)
  if(day(add(d,90))<=day(end))cutoffs.push(d)
 }
 type Sample={date:string;key:string;recency:number;frequency:number;label:number}
 const samples:Sample[]=[]
 for(const cutoff of cutoffs){
  for(const [key,dates] of byCustomer){
   const history=dates.filter(d=>d<=cutoff)
   if(!history.length)continue
   const last=history[history.length-1]
   const next=dates.some(d=>d>cutoff&&d<=add(cutoff,90))
   samples.push({date:cutoff,key,recency:Math.min(3,Math.floor((day(cutoff)-day(last))/30)),
    frequency:Math.min(3,history.filter(d=>d>add(cutoff,-90)).length),
    label:next?0:1})
  }
 }
 const out=unavailable("Labels de non-réachat à 90 jours non observables ou échantillon insuffisant.")
 if(cutoffs.length<8)return out
 const held=new Set(cutoffs.slice(-3))
 const train=samples.filter(s=>!held.has(s.date))
 const test=samples.filter(s=>held.has(s.date))
 if(train.length<100||test.length<40||
    train.filter(s=>s.label===0).length<10||train.filter(s=>s.label===1).length<10||
    test.filter(s=>s.label===0).length<3||test.filter(s=>s.label===1).length<3)return out
 const prevalence=(train.reduce((n,s)=>n+s.label,0)+1)/(train.length+2)
 const baseline=test.map(()=>prevalence),truth=test.map(s=>s.label)
 const candidate=(key:(s:Sample)=>string)=>{
  const buckets=new Map<string,{yes:number;count:number}>()
  for(const s of train){const k=key(s),v=buckets.get(k)??{yes:0,count:0};v.yes+=s.label;v.count++;buckets.set(k,v)}
  return test.map(s=>{const v=buckets.get(key(s));return v?(v.yes+prevalence*8)/(v.count+8):prevalence})
 }
 const preds=[
  {name:"global_prevalence",pred:baseline},
  {name:"recency_buckets",pred:candidate(s=>String(s.recency))},
  {name:"frequency_buckets",pred:candidate(s=>String(s.frequency))},
  {name:"recency_frequency",pred:candidate(s=>s.recency+":"+s.frequency)},
 ]
 const ranked=preds.map(x=>({name:x.name,metric:"brier" as const,score:r3(brier(x.pred,truth))}))
  .sort((a,b)=>a.score-b.score||a.name.localeCompare(b.name))
 const baselineScore=r3(brier(baseline,truth))
 const best=ranked[0]
 const improved=best.name!=="global_prevalence"&&best.score<baselineScore-0.002
 return {...out,status:improved?"backtested_pilot" as const:"rejected_backtest" as const,
  model:best.name,trainSamples:train.length,holdoutSamples:test.length,
  candidates:ranked,baselineScore,selectedScore:best.score,
  reason:improved?"Amélioration Brier chronologique par rapport au taux historique.":
   "Aucun modèle n'améliore suffisamment la prévalence historique en test temporel.",
  note:"Churn proxy = absence d'une facture positive dans les 90 jours suivants. Pas de résiliation contractuelle.",
  holdoutCutoffs:cutoffs.slice(-3),
 }
}

/** Monthly actual collections only — zero is a missing-history hazard,
 * so require at least 80% active months and an uninterrupted known date span.
 */
export function backtestCollections(dataset:Dataset,filters:Filters={}){
 const end=filters.to&&filters.to<dataset.metadata.asOf?filters.to:dataset.metadata.asOf
 const observed=(dataset.collections??[]).filter(r=>
  permits(r.agency,filters)&&start(r.date,filters)&&stop(r.date,filters,end))
 const out=unavailable("Historique daté de paiements clients absent ou trop discontinu.")
 if(!observed.length)return out
 const lastClosed=month(end.slice(0,7))-1
 const ms=observed.map(r=>month(r.date.slice(0,7))).filter(m=>m<=lastClosed)
 if(!ms.length)return out
 const first=Math.min(...ms)
 if(lastClosed-first+1<10)return out
 const sums=new Map<number,number>()
 for(const r of observed){const m=month(r.date.slice(0,7));if(m<=lastClosed)sums.set(m,(sums.get(m)??0)+Math.round(r.amountTnd*1000))}
 const ys=Array.from({length:lastClosed-first+1},(_,i)=>(sums.get(first+i)??0)/1000)
 if(sums.size/ys.length<.8)return out
 const n=ys.length,hold=4
 const candidates=[
  {name:"last_month",pred:(h:number[])=>h[h.length-1]},
  {name:"moving_average_3",pred:(h:number[])=>h.slice(-3).reduce((s,v)=>s+v,0)/3},
  {name:"moving_average_6",pred:(h:number[])=>h.slice(-6).reduce((s,v)=>s+v,0)/6},
 ]
 const actual=ys.slice(-hold),scores=candidates.map(c=>{
  const predicted=actual.map((_,i)=>c.pred(ys.slice(0,n-hold+i)))
  return {...c,score:wape(predicted,actual)}
 })
 const baseline=scores[0].score
 const ranked=scores.filter(c=>c.score!==null).sort((a,b)=>a.score!-b.score!||a.name.localeCompare(b.name))
 if(!ranked.length)return out
 const best=ranked[0],passed=best.score!<=.45
 return {...out,status:passed?"backtested_pilot" as const:"rejected_backtest" as const,
  model:best.name,trainSamples:n-hold,holdoutSamples:hold,
  candidates:ranked.map(x=>({name:x.name,metric:"wape" as const,score:r3(x.score!)})),
  baselineScore:baseline===null?null:r3(baseline),selectedScore:r3(best.score!),
  forecast:passed?r3(Math.max(0,best.pred(ys))):null,
  forecastMonth:stamp(lastClosed+1),
  reason:passed?"Prévision de paiements clients documentés, pas de trésorerie bancaire.":
   "WAPE chronologique hors tolérance, prévision de recouvrement non diffusée.",
 }
}

/** Supplier invoice lag is NOT receipt lead time or OTIF. */
export function backtestSupplierDocuments(dataset:Dataset,filters:Filters={},limit=10){
 const end=filters.to&&filters.to<dataset.metadata.asOf?filters.to:dataset.metadata.asOf
 const rows=(dataset.supplierDocuments??[]).filter(r=>
  permits(r.agency,filters)&&start(r.invoiceDate,filters)&&stop(r.invoiceDate,filters,end)&&
  r.lagDays>=0&&r.lagDays<=3650)
 const buckets=new Map<string,typeof rows>()
 for(const r of rows){
  const key=JSON.stringify([r.agency,r.supplierId])
  const b=buckets.get(key)??[];b.push(r);buckets.set(key,b)
 }
 const results=[]
 for(const [key,events] of buckets){
  const ordered=[...events].sort((a,b)=>a.invoiceDate.localeCompare(b.invoiceDate)||a.invoiceId.localeCompare(b.invoiceId))
  if(ordered.length<12)continue
  const lag=ordered.map(r=>r.lagDays),hold=4
  const candidates=[
   {name:"historical_mean",calc:(x:number[])=>x.reduce((a,b)=>a+b,0)/x.length},
   {name:"rolling_mean_6",calc:(x:number[])=>x.slice(-6).reduce((a,b)=>a+b,0)/Math.min(6,x.length)},
   {name:"rolling_median_6",calc:(x:number[])=>{const y=x.slice(-6).sort((a,b)=>a-b);return (y[Math.floor((y.length-1)/2)]+y[Math.floor(y.length/2)])/2}},
  ]
  const scored=candidates.map(c=>{
   const pred=Array.from({length:hold},(_,i)=>c.calc(lag.slice(0,lag.length-hold+i)))
   return {name:c.name,metric:"mae_days" as const,score:r3(mae(pred,lag.slice(-hold))),forecast:r3(c.calc(lag))}
  }).sort((a,b)=>a.score-b.score||a.name.localeCompare(b.name))
  const base=scored.find(s=>s.name==="historical_mean")!
  const winner=scored[0],accept=winner.score<=30
  results.push({agency:ordered[0].agency,supplierId:ordered[0].supplierId,
   supplier:ordered[0].supplier,documents:ordered.length,
   status:accept?"backtested_pilot" as const:"rejected_backtest" as const,
   model:winner.name,maeDays:winner.score,baselineMaeDays:base.score,
   predictedDocumentLagDays:accept?winner.forecast:null,
   evidenceInvoiceIds:ordered.slice(-4).map(x=>x.invoiceId),
   candidates:scored.map(x=>({name:x.name,metric:x.metric,score:x.score})),
  })
 }
 results.sort((a,b)=>a.agency.localeCompare(b.agency)||a.supplierId.localeCompare(b.supplierId))
 return {status:"pilot_not_certified" as const,verifiedProduction:false as const,
  measure:"days_purchase_order_to_supplier_invoice_not_delivery" as const,
  events:rows.length,eligibleGroups:results.length,
  backtested:results.filter(r=>r.status==="backtested_pilot").length,
  results:results.slice(0,Math.max(1,Math.min(limit,30))),
  warnings:["Facture fournisseur ≠ réception physique : OTIF et délais réels non mesurés.",
    "Calculs historiques limités à l'agence et la période; pas d'achat automatique."],
 }
}
