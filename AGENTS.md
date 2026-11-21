# AI-NÉGOCE — Repository Instructions

## Canonical working branch

**`feature/unified-ai-analytics-platform`** is the agreed integration branch for subsequent project work. Never push features directly to `main` unless explicitly requested. Preserve the existing Data Analyse and Data Science dashboards; do not replace their files with another branch's root tree.

## The three independent platforms

1. `dashboards/data-analysis/`: current BI HTML/CSS/JavaScript prototype, using anonymized CSV exports under `data/extractions/`.
2. `dashboards/data-science/`: existing standalone HTML-based 16-page Data Science prototype; do not claim it has verified ML model serving.
3. `dashboards/agentic-ai/`: React + TypeScript + Vite Agentic Command Center, located at `dashboards/agentic-ai/`. Start via `npm run agentic:dev` (port 8444).

All three live in the same branch, while the backend is shared in `server/`; **live BI/DS service-to-service integration is a separate, unfinished task**. No unverified ERP data or model outputs may be presented as genuine.

## Backend & first agent

`server/agents/revenue-growth.ts`: read-only deterministic Revenue Growth MVP; route `GET /api/v1/agentic/revenue-growth/opportunities` in `server/app.ts`. Existing backend handles authorization, tenant scope, audit and source availability. Do not bypass those guards.

`src/` hosts the existing React ERP/BI/Copilot app on port 8443; `dashboards/agentic-ai/` is a separate React frontend.

## Checks after changes

```bash
npm ci
npm run typecheck
npm run agentic:typecheck
npm run agentic:build
npx vitest run server/agents/revenue-growth.test.ts server/agents/revenue-growth.api.test.ts
npx playwright test --config dashboards/agentic-ai/playwright.config.ts
```

Keep all generated files, browser profiles, tokens and company records out of Git. Do not merge automatically when CI fails. Keep write-back functionality disabled until permissions, human approval and real ERP integration are verified.
