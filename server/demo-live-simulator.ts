/**
 * Single-step synthetic company activity: 4 deterministic, explainable events.
 * This is an offline demo mutation, not a production transaction engine.
 * Each event changes the source snapshot; consumers recompute BI/DS/Agentic.
 */
import type {Dataset} from "./services.js"
export type DemoEventType="sale"|"collection"|"restock"|"supplier"
export type DemoKind=DemoEventType|"cycle"
export type DemoEvent={
 id:string;kind:DemoEventType;agency:string;date:string;reference:string;
 amountTnd:number|null;units:number|null;description:string;erpWrites:0
}
export const DEMO_SEQUENCE:readonly DemoEventType[]=["sale","collection","restock","supplier"]
const tnd=(v:number)=>Math.round(v*1000)/1000
const addDays=(iso:string,n:number)=>new Date(Date.parse(iso+"T00:00:00.000Z")+n*86400000)
 .toISOString().slice(0,10)
const asOfIsValid=(x:string)=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 !Number.isNaN(Date.parse(x+"T00:00:00.000Z"))&&
 new Date(x+"T00:00:00.000Z").toISOString().slice(0,10)===x
export function applySyntheticDemoEvent(data:Dataset,args:{
 sequence:number;kind:DemoKind;agency?:string;advanceDays?:number
}):{dataset:Dataset;event:DemoEvent}{
 const {sequence,kind}=args
 if(!Number.isSafeInteger(sequence)||sequence<1||sequence>999999)
  throw new Error("DEMO_INVALID_SEQUENCE")
 if(args.advanceDays!==undefined&&(!Number.isInteger(args.advanceDays)||
   args.advanceDays<0||args.advanceDays>30))throw new Error("DEMO_INVALID_ADVANCE_DAYS")
 if(!asOfIsValid(data.metadata.asOf))throw new Error("DEMO_INVALID_SOURCE_DATE")
 const date=addDays(data.metadata.asOf,args.advanceDays??0)
 if(date>"2028-12-31")throw new Error("DEMO_CLOCK_LIMIT: reset or re-seed the demonstration")
 const eventType=kind==="cycle"?DEMO_SEQUENCE[(sequence-1)%DEMO_SEQUENCE.length]:kind
 if(!DEMO_SEQUENCE.includes(eventType))throw new Error("DEMO_UNKNOWN_EVENT")
 const agencies=[...new Set([
  ...data.inventory.map(x=>x.agency),...data.sales.map(x=>x.agency),
  ...data.receivables.map(x=>x.agency),
 ])].sort()
 const selected=args.agency??agencies[(sequence-1)%agencies.length]
 if(!selected||!agencies.includes(selected))throw new Error("DEMO_AGENCY_NOT_FOUND")
 const identifier="SIM-"+sequence.toString().padStart(7,"0")
 const lines=data.sales.map(x=>({...x}))
 const stock=data.inventory.map(x=>({...x}))
 const debts=data.receivables.map(x=>({...x}))
 const collections=(data.collections??[]).map(x=>({...x}))
 const supplierDocuments=(data.supplierDocuments??[]).map(x=>({...x}))
 const stockMovements=data.stockMovements?.map(x=>({...x}))
 const procurementLines=data.procurementLines?.map(x=>({...x,supplierInvoiceIds:[...x.supplierInvoiceIds]}))
 if(data.metadata.demoEvents?.some(x=>x.id===identifier)||
   lines.some(x=>x.id===identifier||x.invoiceId===identifier)||
   collections.some(x=>x.id===identifier)||
   supplierDocuments.some(x=>x.orderId==="PO-"+identifier||x.invoiceId==="SI-"+identifier))
  throw new Error("DEMO_ALREADY_APPLIED")
 const choose=(xs:typeof stock)=>xs.slice().sort((a,b)=>a.reference.localeCompare(b.reference))[sequence%xs.length]
 const fallbackStock=stock.filter(x=>x.agency===selected)
 if(eventType==="sale"||eventType==="restock"){
  if(!fallbackStock.length)throw new Error("DEMO_STOCK_REQUIRED")
 }
 let event:DemoEvent
 if(eventType==="sale"){
  const available=stock.filter(x=>x.agency===selected&&x.quantity>=1)
  if(!available.length)throw new Error("DEMO_NO_STOCK: restock before sale")
  const s=choose(available),quantity=1
  const existing=lines.find(x=>x.agency===selected&&x.customerId)
    ??lines.find(x=>x.agency===selected)
  const productLine=lines.find(x=>x.agency===selected&&
    (x.productId===s.reference||x.product===s.product))
  if(!existing)throw new Error("DEMO_CUSTOMER_REQUIRED")
  const value=tnd(Math.max(.001,s.unitCost*1.4)*quantity)
  const cost=tnd(s.unitCost*quantity)
  lines.push({id:identifier,invoiceId:identifier,date,agency:selected,
   customer:existing.customer,customerId:existing.customerId,
   product:s.product,productId:s.reference,quantity,family:productLine?.family||"Autres",
   representative:"Simulateur (fictif)",revenue:value,cost,
   kind:"invoice",status:"posted"})
  s.quantity=tnd(s.quantity-quantity)
  if(stockMovements){
   const productId=productLine?.productId??s.reference
   stockMovements.push({id:"MOVE-"+identifier,date,agency:selected,
    productId,sku:s.reference,type:"sale",quantity:-quantity,reference:identifier})
  }
  debts.push({invoiceId:identifier,agency:selected,customer:existing.customer,
   date,dueDate:addDays(date,30),outstanding:value})
  event={id:identifier,kind:eventType,agency:selected,date,reference:identifier,
   amountTnd:value,units:quantity,
   description:"Vente fictive : facture, créance et sortie de stock synchronisées",erpWrites:0}
 }else if(eventType==="collection"){
  const eligible=debts.filter(x=>x.agency===selected&&x.outstanding>0)
   .sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.invoiceId.localeCompare(b.invoiceId))
  if(!eligible.length)throw new Error("DEMO_OPEN_RECEIVABLE_REQUIRED")
  const target=eligible[sequence%eligible.length]
  const amount=tnd(Math.min(target.outstanding,Math.max(.001,target.outstanding*.35)))
  if(amount<=0)throw new Error("DEMO_COLLECTION_AMOUNT_INVALID")
  target.outstanding=tnd(target.outstanding-amount)
  const sale=lines.find(x=>x.agency===selected&&x.invoiceId===target.invoiceId)
  collections.push({id:identifier,agency:selected,invoiceId:target.invoiceId,
   customerId:sale?.customerId,date,amountTnd:amount})
  event={id:identifier,kind:eventType,agency:selected,date,reference:target.invoiceId,
   amountTnd:amount,units:null,
   description:"Encaissement fictif appliqué une seule fois à une créance existante",erpWrites:0}
 }else if(eventType==="restock"){
  const sorted=fallbackStock.slice().sort((a,b)=>a.quantity-a.reorderPoint-(b.quantity-b.reorderPoint)||
   a.reference.localeCompare(b.reference))
  const target=sorted[0]
  const units=Math.max(5,Math.ceil(target.reorderPoint-target.quantity)+5)
  target.quantity=tnd(target.quantity+units)
  if(stockMovements){
   const productId=lines.find(x=>x.agency===selected&&
     (x.productId===target.reference||x.product===target.product))?.productId??target.reference
   stockMovements.push({id:"MOVE-"+identifier,date,agency:selected,
    productId,sku:target.reference,type:"receipt",quantity:units,reference:identifier})
  }
  event={id:identifier,kind:eventType,agency:selected,date,reference:target.reference,
   amountTnd:tnd(units*target.unitCost),units,
   description:"Réception de stock fictive (sans prétendre à une réception ERP réelle)",erpWrites:0}
 }else{
  const id=identifier
  const matching=supplierDocuments.filter(x=>x.agency===selected)
  const supplier=matching[0]?.supplier??"Fournisseur fictif de démonstration"
  const supplierId=matching[0]?.supplierId??("SUP-SIM-"+selected.replace(/[^A-Za-z0-9]/g,"").slice(0,20))
  const days=7+sequence%4
  const from=addDays(date,-days)
  const amount=tnd(250+sequence%17*25)
  supplierDocuments.push({orderId:"PO-"+id,invoiceId:"SI-"+id,
   agency:selected,supplier,supplierId,orderDate:from,invoiceDate:date,
   lagDays:days,amountTnd:amount})
  if(procurementLines){
   const product=stock.find(x=>x.agency===selected)??stock[0]
   if(product){
    const qty=5
    procurementLines.push({
     orderLineId:"POL-"+id,orderId:"PO-"+id,agency:selected,
     sku:product.reference,productId:lines.find(x=>
       x.agency===selected&&(x.productId===product.reference||x.product===product.product)
     )?.productId??product.reference,
     supplierId,supplier,orderDate:from,orderedUnits:qty,
     invoicedUnits:qty,unitCostTnd:tnd(amount/qty),status:"invoiced",
     supplierInvoiceIds:["SI-"+id],
    })
   }
  }
  event={id,kind:eventType,agency:selected,date,reference:"SI-"+id,
   amountTnd:amount,units:null,
   description:"Jalon commande → facture fournisseur fictif (pas une livraison)",erpWrites:0}
 }
 const previous=Array.isArray(data.metadata.demoEvents)?
   (data.metadata.demoEvents as DemoEvent[]):[]
 const demoEvents=[...previous,event].slice(-100)
 return {
  event,
  dataset:{
   ...data,sales:lines,inventory:stock,receivables:debts,collections,supplierDocuments,
   ...(stockMovements?{stockMovements}:{}),
   ...(procurementLines?{procurementLines}:{}),
   metadata:{...data.metadata,asOf:date,lastUpdated:date+"T12:00:00.000Z",
    demoEvents,demoLastEvent:event,simulationMode:"synthetic_live_demo",
    // Revision is supplied by the DB; don't persist an obsolete read revision.
    snapshotRevision:undefined},
  },
 }
}
