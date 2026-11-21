/**
 * Read-only, chronological SKU x agency demand pilot.
 * Learns only from posted invoice-line quantities; credits reverse quantity.
 * Missing quantity is NOT inferred from revenue or unit price.
 * No production certification or ERP write permissions.
 */
import type { Dataset, Filters } from "./services.js"

export const SKU_DEMAND_MODEL_VERSION = "sku-demand-walkforward-v1"
type Point = {month:string;quantity:number}
type ModelName = "last_observation"|"moving_average_3"|"seasonal_12"
const monthNumber=(s:string)=>Number(s.slice(0,4))*12+Number(s.slice(5,7))-1
const monthString=(n:number)=>`${Math.floor(n/12)}-${String(n%12+1).padStart(2,"0")}`
const allowed=(agency:string,f:Filters)=>!f.agencies||f.agencies==="*"||f.agencies.includes(agency)
const predict=(name:ModelName,values:number[]):number=>{
  if(name==="last_observation")return values[values.length-1]
  if(name==="moving_average_3")return values.slice(-3).reduce((s,n)=>s+n,0)/3
  return values[values.length-12]
}
const round=(n:number)=>Math.round(n*1000)/1000
export type SkuDemandResult={
  status:"backtested_pilot"|"insufficient_history"|"rejected_backtest"
  agency:string;productId:string;product:string;modelVersion:string;model:ModelName|null
  trainedThrough:string|null;historyMonths:number
  backtest:{holdoutMonths:number;wape:number|null;baselineWape:number|null;bias:number|null}
  forecast:{month:string;quantity:number}|null
  reason:string
}
export function forecastSkuDemand(dataset:Dataset,filters:Filters={},limit=10):{
  status:"pilot_not_certified";eligibleForAutonomousActions:false
  quantityCoverage:{salesRows:number;withQuantity:number}
  evaluated:number;backtested:number;results:SkuDemandResult[]
  warnings:string[]
}{
  const end=filters.to && filters.to<dataset.metadata.asOf?filters.to:dataset.metadata.asOf
  const lastClosed=new Date(Date.UTC(Number(end.slice(0,4)),Number(end.slice(5,7))-1,1))
  const cutoff=monthNumber(lastClosed.toISOString().slice(0,7))-1
  const values=new Map<string,{agency:string;productId:string;product:string;months:Map<number,number>}>()
  let salesRows=0,withQuantity=0
  for(const sale of dataset.sales){
    if(sale.status==="cancelled"||sale.date>end||sale.date<(filters.from??"0000-01-01")||!allowed(sale.agency,filters))continue
    // The data model contains one row per posted invoice line.
    salesRows++
    const quantity=(sale as typeof sale & {quantity?:number}).quantity
    if(typeof quantity!=="number"||!Number.isFinite(quantity))continue
    withQuantity++
    const m=monthNumber(sale.date.slice(0,7))
    if(m>cutoff)continue
    const productId=sale.productId||sale.product
    const key=JSON.stringify([sale.agency,productId])
    const record=values.get(key)??{agency:sale.agency,productId,product:sale.product,months:new Map<number,number>()}
    const signed=(sale.kind==="credit_note"?-Math.abs(quantity):quantity)
    record.months.set(m,(record.months.get(m)??0)+signed)
    values.set(key,record)
  }
  const results:SkuDemandResult[]=[]
  for(const record of values.values()){
    const months=[...record.months.keys()].sort((a,b)=>a-b)
    const first=months[0]
    const quantities=first===undefined?[]:Array.from({length:cutoff-first+1},(_,i)=>record.months.get(first+i)??0)
    const base={
      agency:record.agency,productId:record.productId,product:record.product,
      modelVersion:SKU_DEMAND_MODEL_VERSION,trainedThrough:months.length?monthString(cutoff):null,
      historyMonths:quantities.length,
    }
    if(quantities.length<10||quantities.filter(n=>n>0).length<8||quantities.some(n=>n<0)){
      results.push({...base,status:"insufficient_history",model:null,
        backtest:{holdoutMonths:0,wape:null,baselineWape:null,bias:null},forecast:null,
        reason:"10 mois complets, au moins 8 mois de demande positive et aucune demande nette négative requis"})
      continue
    }
    const models:ModelName[]=["last_observation","moving_average_3",...(quantities.length>=16?["seasonal_12" as const]:[])]
    const scored=models.map(name=>{
      let abs=0,actual=0,signed=0
      for(let i=quantities.length-4;i<quantities.length;i++){
        const predicted=predict(name,quantities.slice(0,i))
        abs+=Math.abs(predicted-quantities[i])
        signed+=predicted-quantities[i]
        actual+=quantities[i]
      }
      return {name,wape:actual>0?abs/actual:Infinity,bias:actual>0?signed/actual:Infinity}
    }).sort((a,b)=>a.wape-b.wape||a.name.localeCompare(b.name))
    const best=scored[0],baseline=scored.find(x=>x.name==="last_observation")!
    const accepted=Number.isFinite(best.wape)&&best.wape<=0.45&&Math.abs(best.bias)<=0.30
    results.push({...base,status:accepted?"backtested_pilot":"rejected_backtest",
      model:best.name,backtest:{holdoutMonths:4,wape:round(best.wape),baselineWape:round(baseline.wape),bias:round(best.bias)},
      forecast:accepted?{month:monthString(cutoff+1),quantity:round(Math.max(0,predict(best.name,quantities)))}:null,
      reason:accepted?"Prévision pilote; WAPE et biais mesurés sur quatre mois chronologiques":
        "Backtest rejeté: WAPE > 45 %, biais > 30 % ou série de référence nulle"})
  }
  results.sort((a,b)=>(a.status==="backtested_pilot"?0:1)-(b.status==="backtested_pilot"?0:1)
    ||a.agency.localeCompare(b.agency)||a.productId.localeCompare(b.productId))
  return {
    status:"pilot_not_certified",eligibleForAutonomousActions:false,
    quantityCoverage:{salesRows,withQuantity},evaluated:results.length,
    backtested:results.filter(r=>r.status==="backtested_pilot").length,results:results.slice(0,Math.max(1,Math.min(limit,50))),
    warnings:[
      "Quantités issues des lignes de ventes postées et avoirs; aucun stock historique reconstitué.",
      "Mois sans ligne traités comme zéro demande, seulement dans une série déjà commencée; vérifier la complétude des exports.",
      "Comparaison walk-forward de 4 mois; modèle pilote, non homologué ERP et interdit d'écriture autonome.",
    ],
  }
}
