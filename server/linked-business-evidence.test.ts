import {describe,it,expect} from "vitest"
import {defaultDataset,type Dataset} from "./services.js"
import {analyzeLinkedBusinessEvidence} from "./linked-business-evidence.js"
import {buildDataScienceAnalysis} from "./data-science-platform.js"
import {governedDataScienceSchema} from "../shared/contracts/analytics-platform.js"
import {replenishmentReviewPlan,commercialAccountPlans} from "./agents/specialist-action-plans.js"
import {applySyntheticDemoEvent} from "./demo-live-simulator.js"
function fixture():Dataset{
 const base=defaultDataset()
 return {...base,
  metadata:{...base.metadata,source:"Synthétique lié QA",asOf:"2026-10-20"},
  sales:[
   {id:"SF-1",invoiceId:"SF-1",date:"2026-09-12",agency:"Sfax",
    customerId:"C1",customer:"Client SF",productId:"PRD1",product:"Article A",
    family:"Papeterie",representative:"QA",revenue:40,cost:20,quantity:2,status:"posted"},
   {id:"SF-2",invoiceId:"SF-2",date:"2026-09-12",agency:"Sfax",
    customerId:"C2",customer:"Client 2",productId:"PRD1",product:"Article A",
    family:"Papeterie",representative:"QA",revenue:30,cost:15,quantity:2,status:"posted"},
   {id:"SF-3",invoiceId:"SF-3",date:"2026-09-12",agency:"Sfax",
    customerId:"C3",customer:"Client 3",productId:"PRD2",product:"Article B",
    family:"Papeterie",representative:"QA",revenue:25,cost:10,quantity:2,status:"posted"},
   {id:"TN-1",invoiceId:"TN-1",date:"2026-09-10",agency:"Tunis Centre",
    customerId:"C1",customer:"Private Tunis",productId:"PRD9",product:"Secret",
    family:"Secret",representative:"QA",revenue:900,cost:500,quantity:1,status:"posted"},
  ],
  inventory:[
   {reference:"SKU-A",product:"Article A",agency:"Sfax",quantity:4,
    reorderPoint:10,unitCost:10,openingDate:"2026-01-01",openingQuantity:10},
   {reference:"SKU-T",product:"Secret",agency:"Tunis Centre",quantity:99,
    reorderPoint:20,unitCost:8,openingDate:"2026-01-01",openingQuantity:99},
  ],
  stockMovements:[
   {id:"MOV-1",date:"2026-07-01",agency:"Sfax",productId:"PRD1",sku:"SKU-A",
    type:"receipt",quantity:5,reference:"SI-1"},
   {id:"MOV-2",date:"2026-09-12",agency:"Sfax",productId:"PRD1",sku:"SKU-A",
    type:"sale",quantity:-11,reference:"SF-1"},
   {id:"MOV-T",date:"2026-08-01",agency:"Tunis Centre",productId:"PRD9",sku:"SKU-T",
    type:"adjustment",quantity:0,reference:"SECRET-TN"},
  ],
  receivables:[
   {invoiceId:"SF-1",customer:"Client SF",customerId:"C1",agency:"Sfax",
    date:"2026-09-12",dueDate:"2026-10-12",outstanding:20},
   {invoiceId:"TN-1",customer:"Private Tunis",customerId:"C1",agency:"Tunis Centre",
    date:"2026-09-10",dueDate:"2026-09-30",outstanding:100},
  ],
  customerProfiles:[
   {id:"C1",name:"Client SF",agency:"Sfax",segment:"PME",creditLimitTnd:200,
    paymentTermsDays:30,representativeId:"R1"},
   {id:"C2",name:"Client 2",agency:"Sfax",segment:"PME",creditLimitTnd:100,
    paymentTermsDays:30,representativeId:"R1"},
   {id:"C1",name:"Private Tunis",agency:"Tunis Centre",segment:"Entreprise",
    creditLimitTnd:300, paymentTermsDays:30,representativeId:null},
  ],
  procurementLines:[
   {orderLineId:"PO-L1",orderId:"PO-1",agency:"Sfax",sku:"SKU-A",
    productId:"PRD1",supplierId:"SUP-1",supplier:"Fournisseur Sfax",
    orderDate:"2026-07-01",orderedUnits:20,invoicedUnits:15,unitCostTnd:10,
    status:"open",supplierInvoiceIds:["SI-1"]},
   {orderLineId:"PO-T1",orderId:"PO-T",agency:"Tunis Centre",sku:"SKU-T",
    productId:"PRD9",supplierId:"SUP-T",supplier:"Fournisseur SECRET",
    orderDate:"2026-07-01",orderedUnits:10,invoicedUnits:10,unitCostTnd:5,
    status:"invoiced",supplierInvoiceIds:["SECRET-TN"]},
  ],
 }}
describe("Synthetic linked ERP provenance and historical inventory",()=>{
 it("reconstructs a historical SKU only when opening + complete movement ledger matches current",()=>{
  const d=fixture()
  const report=analyzeLinkedBusinessEvidence(d,{agencies:["Sfax"],from:"2026-07-01",to:"2026-08-31"})
  expect(report.stock.status).toBe("reconciled")
  expect(report.stock.reconciledPositions).toBe(1)
  expect(report.stock.historicalExamples[0]).toMatchObject({
   agency:"Sfax",sku:"SKU-A",stockNow:4,stockLedgerNow:4,historicalAtEnd:15,reconciled:true})
  expect(report.stock.movementRows).toBe(2)
  expect(report.procurement).toMatchObject({
   status:"linked_invoices_not_receipts",orders:1,orderLines:1,
   incompleteLines:1,overInvoicedLines:0,invoiceDocuments:1})
  expect(report.procurement.evidenceSample[0].invoiceIds).toEqual(["SI-1"])
  expect(report.customers).toMatchObject({
   masterProfiles:2,profilesWithOpenReceivables:1})
  expect(report.customers.segments).toEqual([{
   agency:"Sfax",segment:"PME",clients:2,creditLimitsTnd:300,outstandingTnd:20}])
  expect(JSON.stringify(report)).not.toContain("SECRET-TN")
  expect(JSON.stringify(report)).not.toContain("Private Tunis")
 })
 it("rejects historical inference on any inconsistent stock position",()=>{
  const d=fixture()
  d.stockMovements=d.stockMovements!.filter(x=>x.id!=="MOV-2")
  const result=analyzeLinkedBusinessEvidence(d,{agencies:["Sfax"],to:"2026-08-31"})
  expect(result.stock).toMatchObject({
   status:"unverified",reconciledPositions:0,historicalEligible:0})
  expect(result.stock.historicalExamples).toHaveLength(0)
  expect(result.stock.mismatches[0]).toMatchObject({stockNow:4,stockLedgerNow:15})
 })
 it("keeps existing DS contract valid and exposes the source evidence only within agency",()=>{
  const d=fixture()
  const f={agencies:["Sfax"] as string[],from:"2026-07-01",to:"2026-08-31"}
  const ds=buildDataScienceAnalysis(d,f)
  expect(ds.inventory.status).toBe("not_available") // current snapshot is not historical
  expect(ds.linkedEvidence.stock.historicalExamples[0].historicalAtEnd).toBe(15)
  const parsed=governedDataScienceSchema.safeParse(ds)
  expect(parsed.success,JSON.stringify(parsed.error?.issues)).toBe(true)
  expect(JSON.stringify(ds.linkedEvidence)).not.toContain("Tunis Centre")
 })
 it("enriches replenishment using previous PO only as a reviewed supplier candidate",()=>{
  const d=fixture()
  const plan=replenishmentReviewPlan(d,["Sfax"],{from:"2026-10-01",to:"2026-10-31"})
  expect(plan.proposals[0]).toMatchObject({
   sku:"SKU-A",minimumUnits:6,supplier:"Fournisseur Sfax",
   supplierSource:"previous_purchase_order_not_validated",lastOrderId:"PO-1",
   documentaryOrderedUnits:20,documentaryInvoicedUnits:15,
   expectedDeliveryDate:null,proposedAction:{requiresHumanApproval:true}})
  expect(JSON.stringify(plan)).not.toContain("Fournisseur SECRET")
 })
 it("live simulation appends stock ledger and keeps reconstructed current stock in balance",()=>{
  const d=fixture()
  const sold=applySyntheticDemoEvent(d,{agency:"Sfax",kind:"sale",sequence:1})
  expect(sold.dataset.stockMovements!.at(-1)).toMatchObject({
   sku:"SKU-A",quantity:-1,type:"sale",reference:"SIM-0000001"})
  expect(analyzeLinkedBusinessEvidence(sold.dataset,{agencies:["Sfax"]}).stock.status).toBe("reconciled")
  const restocked=applySyntheticDemoEvent(sold.dataset,{agency:"Sfax",kind:"restock",sequence:2})
  expect(analyzeLinkedBusinessEvidence(restocked.dataset,{agencies:["Sfax"]}).stock.status).toBe("reconciled")
  const supplier=applySyntheticDemoEvent(restocked.dataset,{agency:"Sfax",kind:"supplier",sequence:3})
  expect(supplier.dataset.procurementLines!.at(-1)).toMatchObject({
   orderId:"PO-SIM-0000003",invoicedUnits:5,supplierInvoiceIds:["SI-SIM-0000003"]})
  expect(d.stockMovements).toHaveLength(3)
 })
})
