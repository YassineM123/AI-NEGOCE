import {describe,expect,it} from "vitest"
import {buildDataScienceAnalysis} from "./data-science-platform.js"
import {buildAnalyticsInsights} from "./analytics-insights.js"
import {defaultDataset,filteredSales,overview,type Dataset} from "./services.js"

function continuous():Dataset{
  const base=defaultDataset()
  const sales=Array.from({length:17},(_,i)=>({
    id:"DS-"+i,invoiceId:"DS-"+i,
    date:new Date(Date.UTC(2025,i,15)).toISOString().slice(0,10),
    agency:i%2?"Tunis Centre":"Sfax",customerId:"C"+(i%3),
    customer:"Client "+(i%3),product:"Test",family:"Test",representative:"QA",
    revenue:10000+300*i,cost:null,status:"posted" as const,
  }))
  return {...base,sales,receivables:[],inventory:[],
    metadata:{...base.metadata,asOf:"2026-06-15",source:"synthetic-ds-qa"}}
}
describe("Data Science governed by exact same BI dataset, agency and period",()=>{
  it("reuses BI revenue in scenarios and descriptive monthly totals",()=>{
    const data=defaultDataset()
    const filters={agencies:["Sfax"],from:"2025-01-01",to:"2025-12-31"}
    const ds=buildDataScienceAnalysis(data,filters)
    const bi=overview(filters,data)
    const insights=buildAnalyticsInsights(data,filters)
    expect(ds.version).toBe("ds-scoped-v1")
    expect(ds.mode).toBe("governed_read_only")
    expect(ds.scenarios.basisRevenueTnd).toBe(bi.revenue)
    expect(ds.trend.months).toEqual(insights.months)
    expect(ds.portfolio.customers).toBe(insights.summary.customerCount)
    expect(ds.forecast.verifiedProduction).toBe(false)
    expect(ds.portfolio.top.reduce((n,c)=>n+c.revenueTnd,0)).toBeCloseTo(bi.revenue,3)
    expect(filteredSales(filters,data).every(r=>r.agency==="Sfax")).toBe(true)
    expect(JSON.stringify(ds.portfolio)).not.toContain("SOTUVER SA")
  })
  it("does not leak financial/stock figures from pseudonymized extract labels",()=>{
    const source=defaultDataset()
    const dataset:Dataset={...source,
      metadata:{...source.metadata,source:"Database/extractions/IAINEG_pseudonymized_csv"}}
    const ds=buildDataScienceAnalysis(dataset,{agencies:["Sfax"]})
    expect(ds.inventory.status).toBe("not_available")
    expect(ds.cash.status).toBe("not_available")
    expect(ds.cash.outstandingTnd).toBe(0)
    expect(ds.warnings.join(" ")).toContain("non validés")
    expect(ds.forecast.verifiedProduction).toBe(false)
  })
  it("backtests a pilot only with sufficient contiguous CLOSED observations",()=>{
    const data=continuous()
    const complete=buildDataScienceAnalysis(data,{agencies:"*"})
    expect(complete.forecast.status).toBe("backtested_pilot")
    expect(complete.forecast.predictions).toHaveLength(1)
    expect(complete.forecast.predictions[0].month).toBe("2026-06")
    expect(complete.forecast.verifiedProduction).toBe(false)
    expect(complete.forecast.backtest.holdoutMonths).toBe(4)
    const perAgency=buildDataScienceAnalysis(data,{agencies:["Sfax"]})
    expect(perAgency.forecast.status).toBe("insufficient_history")
    expect(perAgency.forecast.predictions).toEqual([])
    const short=buildDataScienceAnalysis(data,{
      agencies:"*",from:"2026-01-01",to:"2026-05-31"})
    expect(short.forecast.predictions).toEqual([])
  })
  it("does not combine equal customer IDs across agencies in BI or Data Science",()=>{
    const baseline=defaultDataset()
    const fixture:Dataset={...baseline,
      metadata:{...baseline.metadata,asOf:"2026-10-20",source:"Synthetic collision QA"},
      sales:[
        {id:"SF-C1",invoiceId:"SF-C1",date:"2026-09-01",agency:"Sfax",
          customer:"Client SF",customerId:"CLIENT-001",product:"Item",family:"Demo",
          representative:"QA",revenue:100,cost:60,status:"posted"},
        {id:"TU-C1",invoiceId:"TU-C1",date:"2026-09-02",agency:"Tunis Centre",
          customer:"Client TU",customerId:"CLIENT-001",product:"Item",family:"Demo",
          representative:"QA",revenue:900,cost:500,status:"posted"},
      ],receivables:[],inventory:[]}
    const allDs=buildDataScienceAnalysis(fixture,{agencies:"*"})
    const allBi=buildAnalyticsInsights(fixture,{agencies:"*"})
    expect(allDs.portfolio.customers).toBe(2)
    expect(allBi.summary.customerCount).toBe(2)
    expect(allBi.topCustomers.map(c=>c.revenue)).toEqual([900,100])
    expect(allDs.portfolio.top.map(c=>c.revenueTnd)).toEqual([900,100])
    const sf=buildDataScienceAnalysis(fixture,{agencies:["Sfax"]})
    expect(sf.portfolio.customers).toBe(1)
    expect(sf.portfolio.top[0].revenueTnd).toBe(100)
    expect(JSON.stringify(sf.portfolio)).not.toContain("Client TU")
  })
  it("does not pretend a filtered historical period includes the present stock snapshot",()=>{
    const data=defaultDataset()
    const ds=buildDataScienceAnalysis(data,{agencies:"*",from:"2024-01-01",to:"2024-12-31"})
    expect(ds.inventory.periodApplicable).toBe(false)
    expect(ds.inventory.status).toBe("observed_current_snapshot")
    expect(ds.scenarios.basisRevenueTnd).toBe(overview({
      agencies:"*",from:"2024-01-01",to:"2024-12-31"},data).revenue)
    expect(ds.cash.basis).toBe("outstanding_for_invoices_issued_in_selected_period")
  })
  it("uses an explicit no-data state instead of fabricating client or scenario figures",()=>{
    const ds=buildDataScienceAnalysis(defaultDataset(),{
      agencies:["Unknown"],from:"2028-01-01",to:"2028-12-31"})
    expect(ds.portfolio.status).toBe("no_data")
    expect(ds.portfolio.customers).toBe(0)
    expect(ds.scenarios.status).toBe("not_available")
    expect(ds.scenarios.basisRevenueTnd).toBeNull()
    expect(ds.scenarios.options.every(s=>s.revenueTnd===null)).toBe(true)
  })
})
