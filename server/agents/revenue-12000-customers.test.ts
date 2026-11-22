import {describe,it,expect} from "vitest"
import {defaultDataset,type Dataset} from "../services.js"
import {analyzeRevenueGrowth} from "./revenue-growth.js"
import {buildAnalyticsInsights} from "../analytics-insights.js"

/** Reference R03: precisely 12,000 distinct synthetic customers, frozen inputs. */
function volumeFixture():Dataset{
 const base=defaultDataset()
 const sales:Dataset["sales"]=Array.from({length:12000},(_,i)=>({
  id:"VL-"+i,invoiceId:"VL-"+i,
  agency:"Sfax",date:i%2?"2026-09-20":"2026-05-20",
  customerId:"CL-"+String(i).padStart(5,"0"),
  customer:"Client "+String(i).padStart(5,"0"),
  product:"SKU-PILOT",family:"Démo",representative:"Commercial QA",
  revenue:100+(i%73)*10,cost:50+(i%37)*4,status:"posted" as const,
 }))
 sales.push({...sales[1],id:"VL-GROWTH",invoiceId:"VL-GROWTH",
  date:"2026-05-22",revenue:200,cost:100})
 return {...base,
  sales,receivables:[],inventory:[],
  metadata:{...base.metadata,source:"R03-synthetic-12000-fixed",asOf:"2026-10-20",
   lastUpdated:"2026-10-20T10:00:00.000Z"},
 }
}
describe("R03 — 12k customers, tenant-safe deterministic ranking",()=>{
 it("compares 12k distinct customers without duplicating invoice-line grain",()=>{
  const d=volumeFixture()
  const filters={agencies:["Sfax"],from:"2026-01-01",to:"2026-10-20"}
  const bi=buildAnalyticsInsights(d,filters)
  expect(bi.summary.customerCount).toBe(12000)
  expect(bi.summary.documentCount).toBe(12001)
  expect(bi.summary.salesRows).toBe(12001)
  expect(bi.summary.revenue).toBeGreaterThan(0)
  expect(bi.topCustomers).toHaveLength(10)
  const report=analyzeRevenueGrowth({scope:["Sfax"],dataset:d,
   period:{from:filters.from,to:filters.to},limit:20})
  expect(report.analysis.customersAnalyzed).toBe(12000)
  expect(report.analysis.postedLinesAnalyzed).toBe(12001)
  expect(report.analysis.returned).toBeLessThanOrEqual(20)
  expect(report.opportunities.every(o=>o.proposedAction.status==="draft_only")).toBe(true)
  expect(report.opportunities.every(o=>o.priorityMethod==="heuristic_v1_not_a_probability")).toBe(true)
  expect(report.opportunities.every(o=>o.evidence.invoiceIds.length>0)).toBe(true)
  const replay=analyzeRevenueGrowth({scope:["Sfax"],dataset:d,
   period:{from:filters.from,to:filters.to},limit:20})
  expect(replay.opportunities).toEqual(report.opportunities)
 })
 it("never leaks 12k Sfax clients into a different agency query",()=>{
  const d=volumeFixture()
  const other=analyzeRevenueGrowth({scope:["Tunis Centre"],dataset:d})
  expect(other.status).toBe("no_data")
  expect(other.analysis.customersAnalyzed).toBe(0)
  expect(other.opportunities).toEqual([])
 })
})
