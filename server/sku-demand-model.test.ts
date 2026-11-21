import {describe,it,expect} from "vitest"
import {defaultDataset,type Dataset} from "./services.js"
import {forecastSkuDemand} from "./sku-demand-model.js"
import {buildDataScienceAnalysis} from "./data-science-platform.js"

function history():Dataset{
  const base=defaultDataset()
  const sales=Array.from({length:16},(_,i)=>({
    id:"qa-sku-"+i,invoiceId:"qa-sku-"+i,
    date:new Date(Date.UTC(2025,6+i,12)).toISOString().slice(0,10),
    agency:"Sfax",customer:"Client QA",customerId:"qa-c",
    product:"Test SKU",productId:"sku-a",quantity:10,
    family:"Tests",representative:"QA",revenue:100,cost:60,
    kind:"invoice" as const,status:"posted" as const,
  }))
  sales.push({...sales[0],id:"cancelled",invoiceId:"cancelled",quantity:1000,status:"cancelled"})
  return {...base,sales,receivables:[],inventory:[],
    metadata:{...base.metadata,source:"synthetic-sku-qa",asOf:"2026-11-21"}}
}
describe("Chronological SKU demand is calculated from the shared scoped dataset",()=>{
  it("backtests and never uses canceled invoices",()=>{
    const data=history(),output=forecastSkuDemand(data,{agencies:["Sfax"]})
    expect(output.quantityCoverage.withQuantity).toBe(16)
    expect(output.results).toHaveLength(1)
    expect(output.results[0].status).toBe("backtested_pilot")
    expect(output.results[0].backtest.wape).toBe(0)
    expect(output.results[0].forecast).toEqual({month:"2026-11",quantity:10})
    expect(output.eligibleForAutonomousActions).toBe(false)
    expect(buildDataScienceAnalysis(data,{agencies:["Sfax"]}).skuDemand.backtested).toBe(1)
  })
  it("enforces agency scope and historical period",()=>{
    const data=history()
    expect(forecastSkuDemand(data,{agencies:["Tunis Centre"]}).results).toEqual([])
    const historical=forecastSkuDemand(data,{agencies:["Sfax"],from:"2025-07-01",to:"2026-03-31"})
    expect(historical.results[0].status).toBe("insufficient_history")
    expect(historical.results[0].forecast).toBeNull()
  })
  it("abstains if quantities are not provided",()=>{
    const data=history()
    data.sales=data.sales.map(r=>({...r,quantity:null}))
    const output=forecastSkuDemand(data,{agencies:["Sfax"]})
    expect(output.quantityCoverage.withQuantity).toBe(0)
    expect(output.results).toHaveLength(0)
    expect(output.backtested).toBe(0)
  })
  it("subtracts credit-note quantities, not their revenue",()=>{
    const data=history()
    data.sales.push({
      ...data.sales[0],id:"credit",invoiceId:"credit",kind:"credit_note",
      quantity:2,revenue:-20,cost:-12,
    })
    const output=forecastSkuDemand(data,{agencies:["Sfax"]})
    expect(output.quantityCoverage.withQuantity).toBe(17)
    expect(output.results[0].backtest.holdoutMonths).toBe(4)
  })
})
