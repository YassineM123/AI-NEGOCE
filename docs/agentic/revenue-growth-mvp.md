# Revenue Growth Agent — MVP (read-only)

This initial pilot implements a deterministic Revenue Growth investigation on the existing backend. It is **not** the full AI Director, a trained churn model, a connected LAI ERP, or a CRM automation.

## Endpoint

`GET /api/v1/agentic/revenue-growth/opportunities?agency=Sfax&windowDays=90&dormantDays=90&limit=20`

Requires an authenticated `admin`, `manager`, or `commercial`; the existing tenant sandbox boundary and server-side agency access controls are applied. In production, the existing `requireErpData` guard blocks the endpoint without a validated ERP adapter. No ERP or CRM writing is performed, and the investigation access is logged through the existing tenant audit service.

## Data lineage and decision rules

- Source: existing governed `Dataset` service (`datasetFrom(erpDb)` in synthetic ERP sandbox or explicit test fixtures).
- Grain: posted sales lines, signed credit notes included; cancelled rows and future-dated records excluded.
- Grouping: agency plus stable customer ID; if absent, name is used *within the agency*, with a visible warning.
- Comparison: two contiguous, non-overlapping windows of `windowDays` ending at the dataset's `asOf`.
- Categories: `growing`, `declining`, `dormant`, `new`.
- Priority: **heuristic score**, based on status, historic sales volume, and purchase recency. This is **not a probability, model confidence, uplift estimate, or verified commercial ROI**.
- Margin: withheld when any cost is missing; no cost is silently assumed equal to zero.
- Evidence: a bounded number of invoice references, original source label, timestamps and scope.
- Proposed action: **draft only**, human review mandatory. Stock, margin completeness, disputes, credit exposure and business constraints should be checked before acting.
- Scoring happens in deterministic business code, not in a language-model prompt.

## Quick checks

```bash
npm ci
npm run typecheck
npx vitest run server/agents/revenue-growth.test.ts server/agents/revenue-growth.api.test.ts
npm test
npm run build
```

GitHub Actions quality pipeline runs on PR and branch pushes. These checks must actually pass before merging.

## Known blockers / next iteration

1. **Real LAI API contract** remains unavailable; synthetic data must never be represented as real company analytics.
2. **Data Science integration** is absent from this repository branch. Future `predictions.read` needs verified snapshot, version, method and confidence calibration; never fabricate ML scores.
3. **MVP uses current data adapter**, not a separately persisted agent dossier. Add tenant-scoped PostgreSQL cases, review status, and evidence snapshots before enabling the Decision Center workflow.
4. Expand Revenue Growth with cross-sell matching, churn and CLV only after sufficient historical data and valid temporal evaluation.
5. Add AI Director orchestration after tool contracts and the first specialist are validated.
6. Present workflow as human-reviewed recommendations. Automatic ERP/CRM writing and unapproved sales actions are explicitly out of scope.

See AI-NÉGOCE Intelligence Suite specification (REV-02/03/04/29/32/39; rollout L2).