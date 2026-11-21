import { describe, expect, it } from "vitest"
import { evaluateAgenticForecast } from "./predictive.js"
import { defaultDataset, type Dataset } from "../services.js"
import { overview } from "../services.js"
function continuousFixture():Dataset {
  const source=defaultDataset()
  const sales=Array.from({length:16},(_,i)=>({
    id:"forecast-"+i,invoiceId:"forecast-"+i,
    date:new Date(Date.UTC(2025,i,15)).toISOString().slice(0,10),
    agency:i%2===0?"Sfax":"Tunis Centre",
    customer:"Client "+i,product:"Test",family:"Test",representative:"QA",
    revenue:10000+300*i,cost:null,status:"posted" as const,
  }))
  return {...source,sales,receivables:[],inventory:[],
    metadata:{...source.metadata,asOf:"2026-06-15",source:"synthetic-forecast-QA"}}
}
describe("agentic model gateway — closed months and no lookahead",()=>{
  it("holds predictions when no valid history exists",()=>{
    const result=evaluateAgenticForecast(defaultDataset(),{agencies:["Sfax"]})
    expect(result.status).toBe("insufficient_history")
    expect(result.predictions).toEqual([])
    expect(result.eligibleForAutonomousActions).toBe(false)
  })
  it("backtests strictly prior closed periods with recorded model version",()=>{
    const data=continuousFixture()
    const f=evaluateAgenticForecast(data,{agencies:"*"})
    expect(f.status).toBe("backtested_pilot")
    expect(f.model.trainedThrough).toBe("2026-05")
    expect(f.backtest.holdoutMonths).toBe(4)
    expect(f.predictions[0].month).toBe("2026-06")
    expect(f.predictions[0].revenueTnd).toBeGreaterThan(0)
    expect(f.verifiedProduction).toBe(false)
    expect(f.eligibleForAutonomousActions).toBe(false)
  })
  it("respects agency/period restrictions and never predicts using another agency",()=>{
    const data=continuousFixture()
    const a=evaluateAgenticForecast(data,{agencies:["Sfax"]})
    expect(a.predictions).toEqual([]) // gaps must not be interpolated as zero
    const b=evaluateAgenticForecast(data,{agencies:"*",from:"2026-01-01",to:"2026-05-31"})
    expect(b.predictions).toEqual([])
    expect(overview({agencies:["Sfax"]},data).revenue).toBeGreaterThan(0)
  })
  it("rejects untrustworthy backtests instead of manufacturing good scores",()=>{
    const data=continuousFixture()
    data.sales=data.sales.map((r,i)=>({...r,revenue:i>=12?10000000:r.revenue}))
    const f=evaluateAgenticForecast(data,{agencies:"*"})
    expect(f.status).toBe("rejected_backtest")
    expect(f.predictions).toEqual([])
  })
})
