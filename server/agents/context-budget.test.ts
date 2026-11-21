import { describe,expect,it } from "vitest"
import { buildGroundedPrompt,chooseRelevantFacts,compactHistory,deterministicBrief } from "./context-budget.js"
const facts=Array.from({length:15},(_,i)=>({
  title:"Client "+i,explanation:("Analyse de vente "+i+" ").repeat(100),
  actionType:"prepare_review",evidence:Array.from({length:100},(_,k)=>"INV-"+i+"-"+k),
}))
describe("Agentic context policy",()=>{
  it("limits selected facts, evidence, history and prompt size",()=>{
    const c=buildGroundedPrompt({
      agent:"revenue_growth",question:"Quels clients relancer ?",
      source:"Synthetic",asOf:"2026-11-21",facts,
    })
    expect(c.selected).toHaveLength(4)
    expect(c.prompt.length).toBeLessThanOrEqual(4200)
    expect(c.references.length).toBeLessThanOrEqual(16)
    expect(c.maxOutputTokens).toBe(320)
    expect(c.approximatePromptTokens).toBeGreaterThan(0)
    expect(compactHistory(Array.from({length:12},()=>({
      role:"user" as const,content:"x".repeat(900),
    })))).toHaveLength(4)
    expect(compactHistory([{role:"assistant",content:"y".repeat(2000)}])[0].content.length)
      .toBeLessThanOrEqual(320)
  })
  it("picks relevant facts rather than serializing all customers",()=>{
    const selected=chooseRelevantFacts("clients Sfax",[
      {title:"Stock Nabeul",explanation:"rupture",actionType:"review",evidence:[]},
      {title:"Client Sfax",explanation:"croissance",actionType:"review",evidence:["INV-123"]},
    ])
    expect(selected[0].title).toBe("Client Sfax")
  })
  it("offers a no-token deterministic response",()=>{
    const d=deterministicBrief({agent:"finance",source:"synthetic",asOf:"2026-11-21",facts,findings:15})
    expect(d.modelCalls).toBe(0)
    expect(d.estimatedTokens).toBe(0)
    expect(d.top).toHaveLength(3)
    expect(d.remainingFindings).toBe(12)
  })
})
