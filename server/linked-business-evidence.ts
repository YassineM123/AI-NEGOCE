/**
 * Read-only, scope-preserving provenance for the enriched synthetic ERP.
 * Full stock reconstitution is allowed ONLY after every opening balance
 * reconciles against every documented movement through the source asOf.
 */
import type {Dataset,Filters} from "./services.js"
const allowed=(agency:string,filters:Filters)=>
 !filters.agencies||filters.agencies==="*"||filters.agencies.includes(agency)
const r3=(v:number)=>Math.round(v*1000)/1000
const money=(xs:number[])=>r3(xs.reduce((a,x)=>a+Math.round(x*1000),0)/1000)
const key=(agency:string,sku:string)=>JSON.stringify([agency,sku])
export function analyzeLinkedBusinessEvidence(data:Dataset,filters:Filters={}){
 const asOf=data.metadata.asOf
 const end=filters.to&&filters.to<asOf?filters.to:asOf
 const ledger=(data.stockMovements??[]).filter(m=>allowed(m.agency,filters)&&m.date<=asOf)
 const positions=data.inventory.filter(i=>allowed(i.agency,filters))
 const allByKey=new Map<string,typeof ledger>()
 for(const row of ledger){
  const k=key(row.agency,row.sku)
  const b=allByKey.get(k)??[];b.push(row);allByKey.set(k,b)
 }
 const stockRows=positions.map(i=>{
  const movements=allByKey.get(key(i.agency,i.reference))??[]
  const openingDate=i.openingDate??null,opening=i.openingQuantity??null
  const eligible=opening!==null&&openingDate!==null&&openingDate<=asOf
  const predicted=eligible?r3(opening+movements.filter(m=>m.date>=openingDate)
    .reduce((s,m)=>s+m.quantity,0)):null
  const matches=eligible&&predicted!==null&&Math.abs(predicted-i.quantity)<=0.001
  const historical=matches&&openingDate<=end?r3(opening+movements
    .filter(m=>m.date>=openingDate&&m.date<=end)
    .reduce((s,m)=>s+m.quantity,0)):null
  return {agency:i.agency,sku:i.reference,openingDate,
   movementCount:movements.length,stockNow:i.quantity,stockLedgerNow:predicted,
   historicalAtEnd:historical,reconciled:matches}
 })
 const covered=stockRows.filter(r=>r.reconciled).length
 const historicalEligible=stockRows.filter(r=>r.historicalAtEnd!==null).length
 const stockStatus=positions.length===0?"no_positions":
  covered===positions.length?"reconciled":"unverified"
 const p=(data.procurementLines??[]).filter(x=>allowed(x.agency,filters)&&
  x.orderDate<=end&&(!filters.from||x.orderDate>=filters.from))
 const orders=new Set(p.map(x=>key(x.agency,x.orderId)))
 const invoiceLinks=new Set(p.flatMap(x=>x.supplierInvoiceIds.map(id=>key(x.agency,id))))
 const beyond=p.filter(x=>x.invoicedUnits>x.orderedUnits+0.001)
 const incomplete=p.filter(x=>x.invoicedUnits+0.001<x.orderedUnits)
 const supplierTotals=new Map<string,{
  agency:string;supplierId:string;supplier:string;orders:Set<string>;
  orderedUnits:number;invoicedUnits:number;invoiceIds:Set<string>
 }>()
 for(const line of p){
  const k=key(line.agency,line.supplierId)
  const g=supplierTotals.get(k)??{
   agency:line.agency,supplierId:line.supplierId,supplier:line.supplier,
   orders:new Set<string>(),orderedUnits:0,invoicedUnits:0,invoiceIds:new Set<string>()}
  g.orders.add(line.orderId);g.orderedUnits+=line.orderedUnits;g.invoicedUnits+=line.invoicedUnits
  for(const id of line.supplierInvoiceIds)g.invoiceIds.add(id)
  supplierTotals.set(k,g)
 }
 const bySupplier=[...supplierTotals.values()].map(g=>({
  agency:g.agency,supplierId:g.supplierId,supplier:g.supplier,
  documentedOrders:g.orders.size,orderedUnits:r3(g.orderedUnits),
  invoicedUnits:r3(g.invoicedUnits),
  documentaryFillPercent:g.orderedUnits>0?r3(g.invoicedUnits/g.orderedUnits*100):null,
  invoiceIds:[...g.invoiceIds].sort().slice(0,8),
 })).sort((a,b)=>b.documentedOrders-a.documentedOrders||a.agency.localeCompare(b.agency)||a.supplierId.localeCompare(b.supplierId))
 const customerMasters=(data.customerProfiles??[]).filter(x=>allowed(x.agency,filters))
 const balances=new Map<string,number>()
 for(const inv of data.receivables.filter(r=>allowed(r.agency,filters))){
  if(!inv.customerId)continue
  const k=key(inv.agency,inv.customerId)
  balances.set(k,(balances.get(k)??0)+Math.round(inv.outstanding*1000))
 }
 const bySegment=new Map<string,{clients:number;limit:number;balance:number}>()
 let profilesWithBalance=0
 for(const row of customerMasters){
  const k=key(row.agency,row.id)
  const outstanding=balances.get(k)
  if(outstanding!==undefined)profilesWithBalance++
  const segment=key(row.agency,row.segment)
  const g=bySegment.get(segment)??{clients:0,limit:0,balance:0}
  g.clients++;g.limit+=Math.round(row.creditLimitTnd*1000)
  if(outstanding!==undefined)g.balance+=outstanding
  bySegment.set(segment,g)
 }
 const creditSegments=[...bySegment.entries()].map(([k,g])=>{
  const [agency,segment]=JSON.parse(k) as [string,string]
  return {agency,segment,clients:g.clients,
   creditLimitsTnd:r3(g.limit/1000),outstandingTnd:r3(g.balance/1000)}
 }).sort((a,b)=>a.agency.localeCompare(b.agency)||a.segment.localeCompare(b.segment))
 return {
  source:"synthetic_linked_erp_history" as const,
  status:"not_certified" as const,scope:{agencies:filters.agencies??"*",from:filters.from??null,to:filters.to??null},
  stock:{
   status:stockStatus,sourceAsOf:asOf,evaluatedAt:end,
   positions:positions.length,reconciledPositions:covered,historicalEligible,
   movementRows:ledger.length,
   inflowUnits:r3(ledger.filter(x=>x.quantity>0&&x.date<=end).reduce((a,x)=>a+x.quantity,0)),
   outflowUnits:r3(ledger.filter(x=>x.quantity<0&&x.date<=end).reduce((a,x)=>a-Math.abs(x.quantity),0)),
   mismatches:stockRows.filter(x=>!x.reconciled).slice(0,10),
   historicalExamples:stockRows.filter(x=>x.historicalAtEnd!==null)
    .sort((a,b)=>a.agency.localeCompare(b.agency)||a.sku.localeCompare(b.sku)).slice(0,10),
  },
  procurement:{
   status:p.length?"linked_invoices_not_receipts" as const:"no_order_lines" as const,
   orderLines:p.length,orders:orders.size,invoiceDocuments:invoiceLinks.size,
   incompleteLines:incomplete.length,overInvoicedLines:beyond.length,
   supplierExamples:bySupplier.slice(0,10),
   evidenceSample:p.slice(0,8).map(x=>({agency:x.agency,orderId:x.orderId,
    orderLineId:x.orderLineId,sku:x.sku,supplierId:x.supplierId,
    invoiceIds:x.supplierInvoiceIds})),
  },
  customers:{
   status:customerMasters.length?"crm_master_data" as const:"no_customer_master" as const,
   masterProfiles:customerMasters.length,profilesWithOpenReceivables:profilesWithBalance,
   segments:creditSegments,
   warning:"Plafonds de crédit fictifs, sans score bancaire ni preuve de risque contractuel.",
  },
  warnings:[
   "Mouvements de stock du générateur synthétique, y compris réceptions fictives; ne prouvent pas une livraison ERP.",
   "Stock historique disponible seulement si ouverture et mouvements réconcilient le stock actuel par SKU/agence.",
   "Quantités facturées fournisseur ≠ quantités livrées; pas de mesure OTIF.",
   "Plafonds de crédit et segmentation sont des attributs CRM fictifs.",
  ],
 }
}
