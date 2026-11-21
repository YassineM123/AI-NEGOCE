# AI-NÉGOCE — Repository Instructions

## Canonical working branch

**`feature/unified-ai-analytics-platform`** is the agreed integration branch for subsequent project work. Never push features directly to `main` unless explicitly requested. Preserve the existing Data Analyse and Data Science dashboards; do not replace their files with another branch's root tree.

## The three independent platforms

1. `dashboards/data-analysis/`: current BI HTML/CSS/JavaScript prototype, using anonymized CSV exports under `data/extractions/`.
2. `dashboards/data-science/`: existing standalone HTML-based 16-page Data Science prototype; do not claim it has verified ML model serving.
3. `dashboards/agentic-ai/`: React + TypeScript + Vite Agentic Command Center, located at `dashboards/agentic-ai/`. Start via `npm run agentic:dev` (port 8444).

All three live in one branch. A shared-origin portal on port 8444 and an allow-listed session broker expose the same scoped BI overview to the three frontends; **BI's detailed CSV charts, Data Science models and historical period filtering of specialist reports remain unfinished**. No unverified ERP data or model outputs may be presented as genuine.

## Backend & first agent

`server/agents/revenue-growth.ts`: read-only deterministic Revenue Growth MVP; additional specialists `server/agents/financial-strategy.ts`, `server/agents/supply-chain.ts`, `server/agents/business-strategy.ts` and `server/agents/ai-director.ts` are available in this branch. route `GET /api/v1/agentic/revenue-growth/opportunities` in `server/app.ts`. Existing backend handles authorization, tenant scope, audit and source availability. Do not bypass those guards.

`src/` hosts the existing React ERP/BI/Copilot app on port 8443; `dashboards/agentic-ai/` is a separate React frontend.

## Checks after changes

```bash
npm ci
npm run typecheck
npm run agentic:typecheck
npm run agentic:build
npx vitest run server/analytics-platform.test.ts server/agents/revenue-growth.test.ts server/agents/revenue-growth.api.test.ts server/agents/agentic-suite.test.ts server/agents/agentic-suite.api.test.ts
npx playwright test --config dashboards/agentic-ai/playwright.config.ts
```

Keep all generated files, browser profiles, tokens and company records out of Git. Do not merge automatically when CI fails. Keep write-back functionality disabled until permissions, human approval and real ERP integration are verified.

## Portal integration rules

See [docs/PLATFORM_INTEGRATION.md](docs/PLATFORM_INTEGRATION.md). Keep BI/DS and Agentic behind one origin when testing shared sessions. Never copy bearer tokens into URLs or postMessages, and do not replace the scoped analytics contract with unaudited CSV totals. Use both server API tests and browser filter-change reconciliation tests when editing agency/period behavior.

## Advanced Agentic workflows

- The new durable workflow lives in `server/agents/workspace.ts` and `server/agents/workspace-api.ts`, mounted in `server/app.ts`. Database migration: `008_agentic_workspace.sql` (PostgreSQL RLS).
- Run `npm run agentic:worker` with `DATABASE_URL` to schedule persisted in-app due reminders; never claim email/push delivery.
- Connected UI: `dashboards/agentic-ai/src/AdvancedWorkspace.tsx`. Older disconnected screens remain demos only.
- Real conversations require an explicitly configured LLM provider. Never treat the built-in mock as a real conversation, persist credentials in the browser, or allow the LLM to invoke arbitrary ERP actions.
- Reviews enforce maker/checker separation and expected-version compare-and-set. An approved recommendation remains a reviewed dossier only; ERP write-back is disabled.
- Validate with `npx vitest run server/agents/workspace.api.test.ts` and `npx playwright test --config dashboards/agentic-ai/playwright.config.ts`. With `TEST_DATABASE_URL` pointing to a disposable PostgreSQL database, also run `npx vitest run server/agents/workspace.pg.test.ts`.
- See `docs/agentic/ADVANCED_WORKFLOWS.md` for operational setup, caveats and test accounts.
