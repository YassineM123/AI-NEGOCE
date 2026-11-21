/**
 * Agentic v2 experimental model gateway.
 * Backtested ridge-regularised trend baseline, trained solely on CLOSED monthly
 * revenue from the tenant/agency/date-scoped analytics dataset.
 * Not a certified LAI model and NEVER an authorization for ERP writes.
 */
import type { Dataset, Filters } from "../services.js"
import { buildAnalyticsInsights } from "../analytics-insights.js"
export const FORECAST_MODEL_VERSION = "ridge-trend-v1.0.0"
export type PilotForecast = {
  status: "backtested_pilot" | "insufficient_history" | "rejected_backtest"
  verifiedProduction: false
  eligibleForAutonomousActions: false
  model: { name: "ridge_trend"; version: typeof FORECAST_MODEL_VERSION; trainedThrough: string | null }
  scope: Filters
  source: string
  asOf: string
  currency: "TND"
  trainingMonths: number
  backtest: { holdoutMonths: number; wape: number | null; bias: number | null; thresholdWape: 0.35 }
  predictions: Array<{ month: string; revenueTnd: number; lowerTnd: number; upperTnd: number }>
  warnings: string[]
}
const nextMonth=(month:string,n=1)=>{
  const y=Number(month.slice(0,4)),m=Number(month.slice(5,7))
  return new Date(Date.UTC(y,m-1+n,1)).toISOString().slice(0,7)
}
const round = (x:number) => Math.round(x*1000)/1000
function estimate(y:number[],horizon=1) {
  const n=y.length
  if(n<6)throw new Error("Insufficient training history")
  const mean=y.reduce((a,v)=>a+v,0)/n
  const centre=(n-1)/2
  let numerator=0,denominator=0
  for(let i=0;i<n;i++){numerator+=(i-centre)*(y[i]-mean);denominator+=(i-centre)**2}
  const slope=numerator/(denominator+3) // ridge shrinkage
  const capped=Math.max(-mean*.25,Math.min(mean*.25,slope))
  return Math.max(0,mean+capped*(centre+horizon))
}
export function evaluateAgenticForecast(dataset:Dataset, filters:Filters={}):PilotForecast {
  const insights=buildAnalyticsInsights(dataset,filters)
  const base: PilotForecast={
    status:"insufficient_history",
    verifiedProduction:false,eligibleForAutonomousActions:false,
    model:{name:"ridge_trend",version:FORECAST_MODEL_VERSION,trainedThrough:null},
    scope:filters,source:dataset.metadata.source,asOf:insights.referenceDate,currency:"TND",
    trainingMonths:0,
    backtest:{holdoutMonths:0,wape:null,bias:null,thresholdWape:.35},
    predictions:[],
    warnings:["Modèle expérimental, non certifié LAI. Aucun effet automatique ni écriture ERP."],
  }
  // Only a contiguous sequence of complete, nonnegative observations is allowed.
  const all=insights.months.filter(m=>m.closed && Number.isFinite(m.revenue) && m.revenue>=0)
  const trailing:typeof all=[]
  for(let i=all.length-1;i>=0;i--){
    if(trailing.length && nextMonth(all[i].month)!==trailing[0].month)break
    trailing.unshift(all[i])
  }
  base.trainingMonths=trailing.length
  base.model.trainedThrough=trailing.at(-1)?.month??null
  if(trailing.length<10){
    base.warnings.push("Prévision bloquée : 10 mois complets et consécutifs requis, dont 4 de backtest.")
    return base
  }
  const y=trailing.map(m=>m.revenue)
  const errors:number[]=[]
  let totalAbsoluteError=0,totalActual=0,totalSignedError=0
  for(let i=y.length-4;i<y.length;i++){
    const predicted=estimate(y.slice(0,i))
    const delta=predicted-y[i]
    errors.push(Math.abs(delta))
    totalAbsoluteError+=Math.abs(delta)
    totalActual+=Math.abs(y[i])
    totalSignedError+=delta
  }
  const wape=totalActual>0?totalAbsoluteError/totalActual:null
  const bias=totalActual>0?totalSignedError/totalActual:null
  base.backtest={holdoutMonths:4,wape:wape===null?null:round(wape),
    bias:bias===null?null:round(bias),thresholdWape:.35}
  if(wape===null||bias===null||wape>.35||Math.abs(bias)>.30){
    base.status="rejected_backtest"
    base.warnings.push("Backtest hors tolérance (WAPE ≤ 35 %, biais absolu ≤ 30 %) ou référence nulle.")
    return base
  }
  base.status="backtested_pilot"
  const width=[...errors].sort((a,b)=>a-b)[Math.ceil(errors.length*.8)-1]??0
  const prediction=estimate(y)
  base.predictions=[{month:nextMonth(trailing[trailing.length-1].month),
    revenueTnd:round(prediction),lowerTnd:round(Math.max(0,prediction-width)),
    upperTnd:round(prediction+width)}]
  base.warnings.push("Backtest 1 mois en walk-forward ; intervalle empirique descriptif, pas un intervalle de confiance calibré.")
  return base
}
