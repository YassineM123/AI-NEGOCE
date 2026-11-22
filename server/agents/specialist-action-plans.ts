/**
 * CDC decision aids: observational cross-sell, collections, stock replenishment,
 * and agency-expansion readiness. Never turns a hypothesis into ERP facts.
 */
import type {AgencyScope} from "../auth.js"
import type {Dataset} from "../services.js"
import {salesInScope,receivablesInScope,inventoryInScope,
  daysBetween,reportEnd,type ReportPeriod,amount,sumMoney} from "./common.js"
import {forecastSkuDemand} from "../sku-demand-model.js"

const key=(...x:string[])=>JSON.stringify(x)
const allow=(s:AgencyScope,agency:string)=>s==="*"||s.includes(agency)

/** REV-01/05/06/07, FIN-01 (partial): category gap against documented peers.
 *  Evidence is purchase invoices, never a claim that the stock or product
 *  compatibility is sufficient to sell anything.
 */
export function commercialAccountPlans(dataset:Dataset,scope:AgencyScope,period:ReportPeriod={},limit=10){
 const sales=salesInScope(dataset,scope,period)
 const groups=new Map<string,typeof sales>()
 for(const r of sales){
  const id=r.customerId??"name:"+r.customer
  const k=key(r.agency,id)
  groups.set(k,[...(groups.get(k)??[]),r])
 }
 const byAgency=new Map<string,Array<{id:string;agency:string;name:string;categories:Set<string>;
    invoices:string[];revenue:number;grossMargin:number|null;lastDate:string}>>()
 for(const [k,rows] of groups){
  const revenue=sumMoney(rows.map(x=>x.revenue))
  const costComplete=rows.every(x=>x.cost!==null&&x.cost!==undefined)
  const grossMargin=costComplete?amount(revenue-sumMoney(rows.map(x=>x.cost??0))):null
  const customer={id:rows[0].customerId??"name:"+rows[0].customer,
   agency:rows[0].agency,name:rows[0].customer,
   categories:new Set(rows.filter(x=>x.revenue>0).map(x=>x.family).filter(Boolean)),
   invoices:[...new Set(rows.map(x=>x.invoiceId))].sort(),
   revenue,grossMargin,lastDate:rows.map(x=>x.date).sort().at(-1)!}
  byAgency.set(customer.agency,[...(byAgency.get(customer.agency)??[]),customer])
 }
 const plans=[]
 for(const [agency,customers] of byAgency){
  if(customers.length<3)continue
  const frequency=new Map<string,{customers:Set<string>;invoices:Set<string>}>()
  for(const c of customers)for(const family of c.categories){
   const value=frequency.get(family)??{customers:new Set<string>(),invoices:new Set<string>()}
   value.customers.add(c.id)
   for(const s of sales.filter(x=>x.agency===agency&&(x.customerId??"name:"+x.customer)===c.id&&x.family===family)){
    value.invoices.add(s.invoiceId)
   }
   frequency.set(family,value)
  }
  for(const c of customers){
   const opportunities=[...frequency.entries()]
    .filter(([family,v])=>!c.categories.has(family)&&v.customers.size>=2)
    .map(([family,v])=>({family,peerCustomers:v.customers.size,
      peerSharePercent:amount(100*v.customers.size/customers.length),
      sampleInvoiceIds:[...v.invoices].sort().slice(0,8),
      status:"investigate_only" as const}))
    .sort((a,b)=>b.peerCustomers-a.peerCustomers||a.family.localeCompare(b.family))
   if(opportunities.length===0)continue
   plans.push({customerId:c.id,customerName:c.name,agency:c.agency,
    revenueTnd:c.revenue,grossMarginTnd:c.grossMargin,
    marginCoverage:c.grossMargin===null?"incomplete" as const:"complete" as const,
    peerBase:customers.length,ownedCategories:[...c.categories].sort(),
    crossSellCandidates:opportunities.slice(0,3),invoiceIds:c.invoices.slice(0,12),
    proposedAction:{type:"review_category_fit",status:"draft_only" as const,requiresHumanApproval:true as const},
    warnings:["Co-achat entre pairs de l'agence, pas une prévision de conversion.",
      "Compatibilité, consentement commercial, prix, stock et marge additionnelle non vérifiés."]})
  }
 }
 plans.sort((a,b)=>b.revenueTnd-a.revenueTnd||a.agency.localeCompare(b.agency)||a.customerId.localeCompare(b.customerId))
 return {status:plans.length?"observed_peer_gap" as const:"insufficient_peer_history" as const,
  customersCompared:groups.size,method:"observed_category_peer_penetration_not_affinity_ml" as const,
  plans:plans.slice(0,Math.max(1,Math.min(limit,30))),
  warnings:["Absence d'achat documenté d'une catégorie ne prouve pas l'absence de besoin. Aucun devis/CRM généré."]}
}

/** FIN-14/16/40 (partial): link posted client payments to invoice refs, rank
 *  overdue invoices for verification, never presume disputes are resolved.
 */
export function collectionReviewQueue(dataset:Dataset,scope:AgencyScope,period:ReportPeriod={},limit=15){
 const asOf=dataset.metadata.asOf
 const invoices=receivablesInScope(dataset,scope,period)
 const payments=(dataset.collections??[]).filter(x=>allow(scope,x.agency)&&x.date<=asOf)
 const byInvoice=new Map<string,typeof payments>()
 for(const p of payments){
  const k=key(p.agency,p.invoiceId)
  byInvoice.set(k,[...(byInvoice.get(k)??[]),p])
 }
 const plans=invoices.map(r=>{
  const linked=byInvoice.get(key(r.agency,r.invoiceId))??[]
  const daysLate=Math.max(0,daysBetween(r.dueDate,asOf))
  const collected=sumMoney(linked.map(x=>x.amountTnd))
  const isOverdue=daysLate>0
  return {invoiceId:r.invoiceId,agency:r.agency,customer:r.customer,
   dueDate:r.dueDate,overdueDays:daysLate,outstandingTnd:amount(r.outstanding),
   linkedCollectionsTnd:linked.length?collected:null,
   linkedPaymentIds:linked.map(x=>x.id).sort().slice(0,20),
   classification:(isOverdue?(daysLate>90?"critical_overdue":"overdue"):"not_due") as "critical_overdue"|"overdue"|"not_due",
   priority:isOverdue?(daysLate>90?"high":"medium"):"low",
   proposedAction:isOverdue?"verify_and_prepare_collection":"monitor_due_date",
   status:"draft_only" as const,requiresHumanApproval:true as const,
   // No invoice original amount here: never infer outstanding from cash journal.
   unverified:["invoice_total","disputes","credit_notes","bank_reconciliation"] }
 }).sort((a,b)=>{
  const order={critical_overdue:2,overdue:1,not_due:0}
  return order[b.classification]-order[a.classification]||
   b.outstandingTnd-a.outstandingTnd||a.invoiceId.localeCompare(b.invoiceId)
 })
 return {status:invoices.length?"observed_receivables" as const:"not_available" as const,
  referenceDate:asOf,openInvoices:invoices.length,
  overdueInvoices:plans.filter(x=>x.overdueDays>0).length,
  totalOutstandingTnd:invoices.length?sumMoney(invoices.map(x=>x.outstanding)):null,
  plans:plans.slice(0,Math.max(1,Math.min(limit,30))),
  warnings:["Les paiements liés ne valident ni solde bancaire ni absence de litige.",
    "Période filtrée sur date d'émission des factures; encours arrêté au snapshot.",
    "Vérification humaine préalable à toute relance ou imputation."]}
}

/** SCA-01/07/10 partial: use validated SKU demand pilot when possible,
 *  otherwise fall back to observed reorder threshold with NO lead-time claim.
 */
export function replenishmentReviewPlan(dataset:Dataset,scope:AgencyScope,period:ReportPeriod={},limit=20){
 const positions=inventoryInScope(dataset,scope,period)
 const skuPilot=forecastSkuDemand(dataset,{agencies:scope,from:period.from,to:period.to},50)
 const forecasts=new Map(skuPilot.results.filter(x=>x.status==="backtested_pilot"&&x.forecast)
  .map(x=>[key(x.agency,x.productId),x]))
 const proposals=positions.filter(x=>x.reorderPoint>0&&x.quantity<x.reorderPoint)
  .map(x=>{
   const forecast=forecasts.get(key(x.agency,x.reference))
   const minimumUnits=Math.max(0,Math.ceil(x.reorderPoint-x.quantity))
   const cost=Number.isFinite(x.unitCost)&&x.unitCost>=0?amount(minimumUnits*x.unitCost):null
   return {agency:x.agency,sku:x.reference,product:x.product,
    availableUnits:x.quantity,reorderPointUnits:x.reorderPoint,minimumUnits,
    purchaseBudgetEstimateTnd:cost,forecastQuantityNextMonth:forecast?.forecast?.quantity??null,
    forecastWape:forecast?.backtest.wape??null,
    forecastVersion:forecast?.modelVersion??null,
    supplier:null as null,expectedDeliveryDate:null as null,moqUnits:null as null,
    reservationsVerified:false as const,
    proposedAction:{type:"prepare_purchase_request",status:"draft_only" as const,requiresHumanApproval:true as const},
    evidence:[{type:"stock_position" as const,id:x.reference,agency:x.agency}],
    warnings:["Quantité minimale = seuil - disponible, pas quantité d'achat optimisée.",
      "Fournisseur, MOQ, délai, réservations, transit et budget approuvé inconnus."]}
  }).sort((a,b)=>a.availableUnits-b.availableUnits||a.agency.localeCompare(b.agency)||a.sku.localeCompare(b.sku))
 return {status:positions.length?"observed_current_snapshot" as const:"not_available" as const,
  stockAsOf:dataset.metadata.asOf,positionsAnalyzed:positions.length,
  thresholdShortages:proposals.length,
  proposals:proposals.slice(0,Math.max(1,Math.min(limit,30))),
  warnings:["Aucune commande ni transfert ERP créé; prévision pilote affichée seulement lorsqu'elle est backtestée.",
    "Le stock d'un mois historique ne peut être déduit de la position courante."]}
}

/** BSA-01/04/07 partial: compare actual agencies, flag evidence coverage.
 *  No recommendation to OPEN a new location without geographic market data.
 */
export function expansionReadinessReview(dataset:Dataset,scope:AgencyScope,period:ReportPeriod={}){
 const sales=salesInScope(dataset,scope,period),debts=receivablesInScope(dataset,scope,period)
 const stock=inventoryInScope(dataset,scope,period)
 const agencies=[...new Set([...sales.map(x=>x.agency),...debts.map(x=>x.agency),...stock.map(x=>x.agency)])].sort()
 const rows=agencies.map(agency=>{
  const ss=sales.filter(x=>x.agency===agency),dd=debts.filter(x=>x.agency===agency)
  const revenue=sumMoney(ss.map(x=>x.revenue))
  const complete=ss.length>0&&ss.every(x=>x.cost!==null&&x.cost!==undefined)
  const margin=complete?amount(revenue-sumMoney(ss.map(x=>x.cost??0))):null
  const receipts=sumMoney(dd.map(x=>x.outstanding))
  return {agency,revenueTnd:ss.length?revenue:null,
   grossMarginTnd:margin,grossMarginPercent:margin!==null&&revenue>0?amount(margin/revenue*100):null,
   outstandingTnd:dd.length?receipts:null,
   overdueTnd:dd.length?sumMoney(dd.filter(x=>x.dueDate<dataset.metadata.asOf).map(x=>x.outstanding)):null,
   documentedInvoices:[...new Set(ss.map(x=>x.invoiceId))].sort().slice(0,12),
   stockPositions:stock.filter(x=>x.agency===agency).length,
   blockers:["market_demand_missing","site_capex_missing","operating_cost_missing",
    "available_capacity_missing","bank_cash_missing"],
   decision:"investigate_only" as const}
 })
 rows.sort((a,b)=>(b.revenueTnd??-Infinity)-(a.revenueTnd??-Infinity)||a.agency.localeCompare(b.agency))
 return {status:rows.length?"existing_agency_benchmark" as const:"no_data" as const,
  asOf:dataset.metadata.asOf,period,scope,
  agencies:rows,openingNewAgencyValidated:false as const,
  requiredInputs:["addressable_market","competitive_landscape","site_capex",
    "incremental_revenue_evidence","operating_cost","cash_capacity","launch_timeline"],
  warnings:["Comparaison de points de vente existants, pas une étude d'expansion ni un ROI.",
    "Aucun score géographique ou plan d'ouverture n'est calculé sans coûts et demande validés."]}
}
