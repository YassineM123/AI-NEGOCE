import {describe,expect,it} from "vitest"
import {assessDecisionReadiness} from "./decision-gates.js"
import {investigateWithDirector} from "./ai-director.js"
import {finalDemoDataset} from "./final-demo-fixture.js"
import type {Dataset} from "../services.js"

const sample=()=>finalDemoDataset()
describe("CDC decision gates — no ERP certification inferred",()=>{
 it("Director returns non executable gate decisions linked to the same snapshot",()=>{
  const data=sample()
  const director=investigateWithDirector({objective:"Diagnostic global de croissance et trésorerie",dataset:data,scope:["Sfax"]})
  expect(director.decisionReadiness.snapshot.asOf).toBe(data.metadata.asOf)
  expect(director.decisionReadiness.readyForErpExecution).toBe(0)
  expect(director.decisionReadiness.entries.every(x=>x.requiresHumanApproval&&x.erpWrites===0)).toBe(true)
  expect(director.decisionReadiness.entries.every(x=>x.blockers.includes("erp_execution"))).toBe(true)
  expect(JSON.stringify(director.decisionReadiness)).not.toContain("Tunis Centre")
 })
 it("rejects cross-agency evidence rather than exposing a hidden tenant",()=>{
  const data=sample()
  const answer=assessDecisionReadiness({
   dataset:data,scope:["Sfax"],
   proposals:[{agent:"financial_strategy",id:"FIN-TEST",title:"Test",priority:"high",
    explanation:"Test",evidence:[{type:"receivable",id:"private",agency:"Tunis Centre"}],
    action:{type:"review_collection",status:"draft_only",requiresHumanApproval:true}}],
  })
  expect(answer.entries[0].blockers).toContain("evidence_scope")
  expect(answer.entries[0].evidenceIds).toEqual([])
  expect(answer.readyForErpExecution).toBe(0)
 })
 it("missing inputs remain explicit blockers, never zero-valued certified inputs",()=>{
  const d:Dataset={...sample(),sales:[],inventory:[],receivables:[]}
  const r=assessDecisionReadiness({dataset:d,scope:["Sfax"],proposals:[{
   agent:"supply_chain_intelligence",id:"SCA-X",title:"Stock",priority:"medium",
   explanation:"",evidence:[{type:"stock_position",id:"SKU",agency:"Sfax"}],
   action:{type:"prepare_purchase_request",status:"draft_only",requiresHumanApproval:true}
  }]})
  expect(r.entries[0].blockers).toContain("stock_available")
  expect(r.entries[0].blockers).toContain("procurement_budget")
  expect(r.entries[0].status).toBe("blocked_pending_verification")
 })
})
