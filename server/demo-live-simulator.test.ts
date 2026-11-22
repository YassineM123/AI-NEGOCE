import {describe,it,expect} from "vitest"
import {finalDemoDataset} from "./agents/final-demo-fixture.js"
import {applySyntheticDemoEvent} from "./demo-live-simulator.js"
import {buildDataScienceAnalysis} from "./data-science-platform.js"
import {buildAnalyticsInsights} from "./analytics-insights.js"

function base(){
 const d=finalDemoDataset()
 return {...d,inventory:d.inventory.map(i=>({...i,quantity:i.agency==="Sfax"?20:i.quantity}))}
}
describe("Living synthetic company: deterministic and coherent 4-event lifecycle",()=>{
 it("makes an invoice, debt and stock movement; payment reduces only its linked debt",()=>{
  const before=base()
  const start=buildAnalyticsInsights(before,{agencies:["Sfax"]})
  const a=applySyntheticDemoEvent(before,{kind:"sale",sequence:1,agency:"Sfax"})
  expect(a.event).toMatchObject({kind:"sale",agency:"Sfax",units:1,erpWrites:0})
  const newRow=a.dataset.sales.find(x=>x.id===a.event.id)!
  const debt=a.dataset.receivables.find(x=>x.invoiceId===a.event.id)!
  expect(debt.outstanding).toBe(newRow.revenue)
  expect(newRow.productId).toBe("SKU-A")
  expect(newRow.customerId).toBeTruthy()
  expect(a.dataset.inventory.find(x=>x.agency==="Sfax"&&x.reference==="SKU-A")?.quantity).toBe(19)
  expect(buildAnalyticsInsights(a.dataset,{agencies:["Sfax"]}).summary.revenue)
   .toBeGreaterThan(start.summary.revenue)
  const b=applySyntheticDemoEvent(a.dataset,{kind:"collection",sequence:2,agency:"Sfax"})
  expect(b.event.kind).toBe("collection")
  const linked=b.dataset.collections!.find(x=>x.id===b.event.id)!
  const prev=a.dataset.receivables.find(x=>x.invoiceId===linked.invoiceId)!.outstanding
  const after=b.dataset.receivables.find(x=>x.invoiceId===linked.invoiceId)!.outstanding
  expect(after).toBeCloseTo(prev-linked.amountTnd,3)
  expect(buildAnalyticsInsights(b.dataset,{agencies:["Sfax"]}).summary.revenue)
   .toEqual(buildAnalyticsInsights(a.dataset,{agencies:["Sfax"]}).summary.revenue)
  expect(b.event.erpWrites).toBe(0)
 })
 it("publishes restock and supplier milestone but never invents physical delivery from invoice",()=>{
  const d=base()
  const restock=applySyntheticDemoEvent(d,{kind:"restock",sequence:3,agency:"Sfax"})
  expect(restock.event.kind).toBe("restock")
  expect(restock.event.units).toBeGreaterThan(0)
  expect(restock.dataset.inventory.find(s=>s.agency==="Sfax"&&s.reference===restock.event.reference)!.quantity)
   .toBeGreaterThan(d.inventory.find(s=>s.agency==="Sfax"&&s.reference===restock.event.reference)!.quantity)
  const sup=applySyntheticDemoEvent(restock.dataset,{kind:"supplier",sequence:4,agency:"Sfax"})
  const added=sup.dataset.supplierDocuments!.find(s=>s.invoiceId===sup.event.reference)!
  expect(added.lagDays).toBeGreaterThan(0)
  expect(added.orderDate<added.invoiceDate).toBe(true)
  expect(sup.dataset.metadata.demoEvents).toHaveLength(2)
  expect(sup.dataset.metadata.demoLastEvent?.id).toBe(sup.event.id)
  expect(sup.dataset.inventory).toEqual(restock.dataset.inventory)
 })
 it("cycles automatically through four events with deterministic replay and evolving source",()=>{
  let state=base(),other=base()
  for(let n=1;n<=4;n++){
   const left=applySyntheticDemoEvent(state,{kind:"cycle",sequence:n,agency:"Sfax"})
   const right=applySyntheticDemoEvent(other,{kind:"cycle",sequence:n,agency:"Sfax"})
   expect(left).toEqual(right)
   expect(left.event.kind).toBe(["sale","collection","restock","supplier"][n-1])
   expect(left.dataset.metadata.simulationMode).toBe("synthetic_live_demo")
   expect(left.dataset.metadata.snapshotRevision).toBeUndefined()
   state=left.dataset;other=right.dataset
  }
  expect(state.metadata.demoEvents).toHaveLength(4)
  expect(buildDataScienceAnalysis(state,{agencies:["Sfax"]}).advancedModels).toBeDefined()
 })
 it("refuses invalid scope, duplicate event, or impossible sale; does not mutate input",()=>{
  const d=base(),copy=structuredClone(d)
  expect(()=>applySyntheticDemoEvent(d,{kind:"sale",sequence:1,agency:"Unknown"}))
   .toThrow("DEMO_AGENCY_NOT_FOUND")
  expect(()=>applySyntheticDemoEvent(d,{kind:"sale",sequence:-1,agency:"Sfax"}))
   .toThrow("DEMO_INVALID_SEQUENCE")
  const first=applySyntheticDemoEvent(d,{kind:"sale",sequence:1,agency:"Sfax"})
  expect(()=>applySyntheticDemoEvent(first.dataset,{kind:"sale",sequence:1,agency:"Sfax"}))
   .toThrow("DEMO_ALREADY_APPLIED")
  expect(d).toEqual(copy)
  expect(()=>applySyntheticDemoEvent({...d,inventory:[]},{kind:"sale",sequence:1,agency:"Sfax"}))
   .toThrow("DEMO_STOCK_REQUIRED")
 })
 it("preserves agency boundaries and advances synthetic clock only on explicit request",()=>{
  const d=base()
  const e=applySyntheticDemoEvent(d,{kind:"sale",sequence:1,agency:"Sfax",advanceDays:1})
  expect(e.dataset.metadata.asOf).toBe("2026-10-21")
  expect(e.dataset.sales.filter(x=>x.agency==="Tunis Centre")).toEqual(d.sales.filter(x=>x.agency==="Tunis Centre"))
  expect(e.dataset.collections?.filter(x=>x.agency==="Tunis Centre"))
   .toEqual(d.collections?.filter(x=>x.agency==="Tunis Centre"))
 })
})
