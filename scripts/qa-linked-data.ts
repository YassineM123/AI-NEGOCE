/** Source-backed QA: after db:seed, prove linked synthetic ERP histories are
 * actually present and reconciled, not just represented in mocked tests.
 * npm run qa:linked-data
 */
import {ErpDatabase} from "../server/erp-db.js"
import {datasetFrom} from "../server/erp-bi.js"
import {analyzeLinkedBusinessEvidence} from "../server/linked-business-evidence.js"
import {governedDataScienceSchema} from "../shared/contracts/analytics-platform.js"
import {buildDataScienceAnalysis} from "../server/data-science-platform.js"
const db=ErpDatabase.open()
if(!db)throw new Error("QA_SYNTHETIC_SQLITE_MISSING: run dataset:generate and db:seed")
try{
 const data=datasetFrom(db)
 if(!data.metadata.source.includes("synthétique"))
  throw new Error("QA_MUST_USE_FICTIONAL_SOURCE")
 const ledger=data.stockMovements??[],p=data.procurementLines??[],crm=data.customerProfiles??[]
 const collectionCount=data.collections?.length??0
 const supplierCount=data.supplierDocuments?.length??0
 const audit=analyzeLinkedBusinessEvidence(data,{agencies:"*"})
 const issues:string[]=[]
 if(ledger.length<1000)issues.push("Missing stock movement history")
 if(p.length<100)issues.push("Missing linked purchase order lines")
 if(crm.length<100)issues.push("Missing customer CRM masters")
 if(collectionCount<100)issues.push("Missing customer payments")
 if(supplierCount<100)issues.push("Missing supplier invoices linked to purchase orders")
 if(audit.stock.status!=="reconciled")
  issues.push("Current stock balance does not reconcile with stock movements")
 if(audit.stock.reconciledPositions!==audit.stock.positions)
  issues.push("Missing opening stock or broken movement ledger")
 if(audit.procurement.overInvoicedLines!==0)
  issues.push("Supplier invoice quantity exceeds ordered quantity")
 const agentAgencies=[...new Set(data.customerProfiles!.map(x=>x.agency))].sort()
 for(const agency of agentAgencies){
  const local=analyzeLinkedBusinessEvidence(data,{agencies:[agency]})
  if(local.customers.segments.some(x=>x.agency!==agency)||
   local.procurement.supplierExamples.some(x=>x.agency!==agency)||
   local.stock.historicalExamples.some(x=>x.agency!==agency))
   issues.push("Cross-agency evidence leak: "+agency)
 }
 const ds=buildDataScienceAnalysis(data,{agencies:"*"})
 const valid=governedDataScienceSchema.safeParse(ds)
 if(!valid.success)issues.push("Invalid advanced Data Science response schema: "+valid.error.issues[0]?.path.join("."))
 if(ds.linkedEvidence.procurement.orderLines!==p.length)
  issues.push("Lost procurement records in Data Science")
 const report={
  classification:"100% synthetic, no ERP LAI",
  source:data.metadata.source,asOf:data.metadata.asOf,
  counts:{salesLines:data.sales.length,receivables:data.receivables.length,
   stockPositions:data.inventory.length,stockMovements:ledger.length,
   purchaseLines:p.length,customerProfiles:crm.length,
   customerPayments:collectionCount,supplierDocuments:supplierCount},
  status:{stock:audit.stock.status,stockReconciled:audit.stock.reconciledPositions,
   stockPositions:audit.stock.positions,underInvoicedLines:audit.procurement.incompleteLines,
   overInvoicedLines:audit.procurement.overInvoicedLines,
   regions:agentAgencies,notes:"Invoice quantity is not warehouse delivery"},
  warnings:issues,
 }
 console.log(JSON.stringify(report,null,2))
 if(issues.length)throw new Error("QA_LINKED_SOURCE_FAILED: "+issues.join("; "))
}finally{db.close()}
