import {describe,expect,it} from "vitest"
import {defaultDataset,type Dataset} from "./services.js"
import {backtestCollections,backtestCustomerInactivity,backtestSupplierDocuments} from "./data-science-advanced.js"
import {buildDataScienceAnalysis} from "./data-science-platform.js"
import {governedDataScienceSchema} from "../shared/contracts/analytics-platform.js"

function advancedFixture():Dataset{
 const d=defaultDataset()
 const sales:Dataset["sales"]=[]
 const collections:NonNullable<Dataset["collections"]>=[]
 const supplierDocuments:NonNullable<Dataset["supplierDocuments"]>=[]
 // 120 fictional customers in two agencies; 2025→2026 observations.
 for(let customer=0;customer<120;customer++){
  const agency=customer<80?"Sfax":"Tunis Centre"
  const cadence=customer%3===0?1:customer%3===1?2:6
  for(let m=0;m<22;m++){
   if(m%cadence!==customer%cadence)continue
   const date=new Date(Date.UTC(2025,m,12)).toISOString().slice(0,10)
   sales.push({id:"sale-"+customer+"-"+m,invoiceId:"INV-"+customer+"-"+m,
    date,agency,customerId:"C-"+customer,customer:"Client "+customer,
    productId:"P1",product:"Référence test",quantity:10,
    family:"Test",representative:"QA",revenue:100+(m%3)*10,cost:50,status:"posted"})
  }
 }
 for(let m=0;m<21;m++){
  const date=new Date(Date.UTC(2025,m,18)).toISOString().slice(0,10)
  collections.push({id:"PAY-S-"+m,invoiceId:"PS-"+m,agency:"Sfax",date,amountTnd:1000+20*m})
  collections.push({id:"PAY-T-"+m,invoiceId:"PT-"+m,agency:"Tunis Centre",date,amountTnd:3000+25*m})
 }
 for(let i=0;i<24;i++){
  const invoiceDate=new Date(Date.UTC(2025,Math.floor(i/2),8+i%2)).toISOString().slice(0,10)
  const orderedDate=new Date(Date.parse(invoiceDate+"T00:00:00Z")-(10+i%3)*86400000).toISOString().slice(0,10)
  supplierDocuments.push({orderId:"PO-"+i,supplierId:"SUP-1",supplier:"Fournisseur test",
   agency:"Sfax",orderDate:orderedDate,invoiceDate,invoiceId:"SI-"+i,
   lagDays:10+i%3,amountTnd:300+i*10})
 }
 return {...d,sales,collections,supplierDocuments,receivables:[],inventory:[],
  metadata:{...d.metadata,source:"Synthétique avancé contrôlé",asOf:"2026-10-20",
    lastUpdated:"2026-10-20T00:00:00Z"}}
}
describe("Advanced DS — temporal model evaluation on same scoped source",()=>{
 it("always validates contract for sparse and legacy dataset",()=>{
  for(const data of [defaultDataset(),advancedFixture()]){
   for(const filters of [{agencies:"*" as const},{agencies:["Sfax"],from:"2026-07-01",to:"2026-09-30"}]){
    const ds=buildDataScienceAnalysis(data,filters)
    const result=governedDataScienceSchema.safeParse(ds)
    expect(result.success,JSON.stringify(result.error?.issues)).toBe(true)
   }
  }
 })

 it("evaluates customer 90-day inactivity against a temporal prevalence baseline",()=>{
  const data=advancedFixture()
  const result=backtestCustomerInactivity(data,{agencies:["Sfax"]})
  expect(result.status).not.toBe("insufficient_history")
  expect(result.trainSamples).toBeGreaterThan(100)
  expect(result.holdoutSamples).toBeGreaterThan(40)
  expect(result.candidates.map(c=>c.name)).toContain("global_prevalence")
  expect(result.candidates.map(c=>c.name)).toContain("recency_frequency")
  expect(result.baselineScore).not.toBeNull()
  expect(result.verifiedProduction).toBe(false)
  expect(result.eligibleForAutonomousActions).toBe(false)
  expect(JSON.stringify(result)).not.toContain("Tunis Centre")
  const replay=backtestCustomerInactivity(data,{agencies:["Sfax"]})
  expect(replay).toEqual(result)
 })
 it("compares collection forecasts to last-month baseline with four unseen months",()=>{
  const data=advancedFixture()
  const out=backtestCollections(data,{agencies:["Sfax"]})
  expect(out.status).toBe("backtested_pilot")
  expect(out.holdoutSamples).toBe(4)
  expect(out.candidates).toHaveLength(3)
  expect(out.baselineScore).not.toBeNull()
  expect(out.selectedScore).toBeLessThanOrEqual(out.baselineScore!)
  expect(out.forecastMonth).toBe("2026-10")
  expect(out.forecast).toBeGreaterThan(0)
  const other=backtestCollections(data,{agencies:["Tunis Centre"]})
  expect(other.forecast).not.toBe(out.forecast)
 })
 it("backtests supplier documentary lag without inventing delivery dates",()=>{
  const data=advancedFixture()
  const out=backtestSupplierDocuments(data,{agencies:["Sfax"]})
  expect(out.eligibleGroups).toBe(1)
  expect(out.events).toBe(24)
  expect(out.results[0].documents).toBe(24)
  expect(out.results[0].baselineMaeDays).toBeGreaterThanOrEqual(0)
  expect(out.results[0].evidenceInvoiceIds).toHaveLength(4)
  expect(out.measure).toBe("days_purchase_order_to_supplier_invoice_not_delivery")
  expect(out.warnings.join(" ")).toContain("réception")
  expect(backtestSupplierDocuments(data,{agencies:["Tunis Centre"]}).events).toBe(0)
 })
 it("runs all pilots on one versioned BI/DS dataset and abstains on missing relations",()=>{
  const data=advancedFixture()
  const ds=buildDataScienceAnalysis(data,{agencies:["Sfax"]})
  const checked=governedDataScienceSchema.safeParse(ds)
  expect(checked.success,JSON.stringify(checked.error?.issues)).toBe(true)
  expect(ds.advancedModels.collections.status).toBe("backtested_pilot")
  expect(ds.advancedModels.suppliers.eligibleGroups).toBe(1)
  expect(ds.advancedModels.inactivity.trainSamples).toBeGreaterThan(0)
  const noRelations={...data,collections:undefined,supplierDocuments:undefined}
  const empty=buildDataScienceAnalysis(noRelations,{agencies:["Sfax"]})
  expect(empty.advancedModels.collections.status).toBe("insufficient_history")
  expect(empty.advancedModels.collections.forecast).toBeNull()
  expect(empty.advancedModels.suppliers.eligibleGroups).toBe(0)
 })
 it("abstains when only a narrow three-month window is authorized",()=>{
  const data=advancedFixture()
  const f={agencies:["Sfax"] as string[],from:"2026-07-01",to:"2026-09-30"}
  const ds=buildDataScienceAnalysis(data,f)
  expect(ds.advancedModels.collections.status).toBe("insufficient_history")
  expect(ds.advancedModels.inactivity.status).toBe("insufficient_history")
  expect(ds.advancedModels.inactivity.forecast).toBeNull()
 })
})
