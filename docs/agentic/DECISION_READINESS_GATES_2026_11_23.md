# Agentic — Director decision readiness gates (23/11/2026)

## What is implemented
The AI Director now emits `decisionReadiness` alongside `decisionDossier`.
Each recommendation returned by the four specialists is evaluated against the
authorized agency scope and the same selected dataset/period/snapshot:
- In-scope invoice, receivable and current stock-position evidence is checked
  against actual source rows, not a label alone.
- Missing or off-scope proof is flagged without exposing unauthorized IDs.
- Revenue Growth: identity/CRM permissions, offer-specific price and incremental
  margin, available stock and outbound-contact permissions remain unverified.
- Financial Strategy: invoice settlement, disputes/credit notes and bank liquidity
  remain unverified.
- Supply Chain: current availability, reservations, supplier terms/MOQ/lead time
  and purchasing budget remain unverified.
- Business Strategy: CAPEX/BFR, external demand, geographic feasibility, resources
  and initiative timetable remain unverified.
- All recommendations stay **blocked_pending_verification**; there is no action
  executor, payment, quotation, transfer, purchasing order or ERP write-back.

## API integration
Existing Director invocation now includes:
```json
{
  "decisionReadiness": {
    "policyVersion":"agentic-gates-v1",
    "status":"human_validation_required",
    "readyForErpExecution":0,
    "entries":[
      {"agent":"supply_chain_intelligence","status":"blocked_pending_verification",
       "blockers":["supplier_terms","procurement_budget","erp_execution"],
       "requiresHumanApproval":true,"erpWrites":0}
    ]
  }
}
```
This is an illustrative response shape, **not a captured production response**.
The existing `decisionDossier` remains unchanged for compatibility.

## QA
Added `server/agents/decision-gates.test.ts` for:
1. Director integration with matching snapshot;
2. agency isolation / no unauthorized evidence leakage;
3. no ERP execution even when document inputs are missing.

Run in a complete local checkout:
```sh
npm ci
npm run typecheck
npx vitest run server/agents/decision-gates.test.ts server/agents/agentic-suite.test.ts server/agents/specialist-action-plans.api.test.ts
npm run agentic:typecheck
npm run agentic:build
```
These commands are **not claimed as passed** in this change. Hosted GitHub
checkout was inaccessible from the execution environment and no CI status had
been reported for the newest commit at the time of this update.

## Contractual status
The 253-row CDC catalogue remains **not homologated**.
The gate is a new traceability/guardrail layer, not evidence of full DIR, REV,
FIN, SCA or BSA acceptance. Keep `CDC_CAPABILITY_MATRIX_253.csv` conservative
until each requirement has verified source mappings, functional & negative tests,
RBAC, owner sign-off and an agreed LAI ERP interface.
