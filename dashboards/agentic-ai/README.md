# AI-NÉGOCE — Troisième plateforme React : Agentic Command Center

Standalone React 19 + TypeScript + Vite 8 app implementing the approved **C (Minimal Premium) + B (Mission Control)** direction. The existing React BI/OCR application remains untouched.

## Run

From the repository root:

```bash
npm ci
npm run agentic:dev
```

URL: http://127.0.0.1:8444

This runs the UI independently of the existing frontend (port 8443). To enable the Revenue Growth sandbox API:

```bash
# terminal 1 — follow root README to configure the local-dev backend
npm run db:dev:up
npm run migrate
npm run dataset:generate
npm run db:seed
npm run dev:api
# terminal 2
npm run agentic:dev
```

Use **Connexions BI / Data Science → Connecter sandbox local** to obtain a short-lived local-dev token and call the governed Revenue Growth endpoint. Tokens are memory-only. This local-dev endpoint must never be exposed externally.

The app has an optional `VITE_AGENTIC_API_BASE` for a separately hosted authorized API. Never include API keys in `VITE_*` env variables. Production OIDC login and SSO are **not yet implemented in this app**.

## Screens

- Vue d'ensemble — command-center executive layout
- Centre de missions — interactive Kanban and drill-down
- Mes agents — four specialist profiles and proactive notification **UI preview**
- Agent detail — conversation panel, follow-up, source-backed read-only Revenue Growth, Financial, Supply Chain, and Business Strategy findings
- AI Director — bounded read-only multi-specialist investigation and evidence assembly
- Décisions & approbations — local-only approval simulation and evidence
- Connexions BI / Data Science — real connection status when available, no fabricated health data
- Historique & audit — clearly labelled local UI trace; server audit is separate
- Paramètres — safe local preferences

## Run validation

```bash
npm run agentic:typecheck
npm run agentic:build
npx playwright test --config dashboards/agentic-ai/playwright.config.ts
```

## Safety and production gap

**All example missions, alerts and decisions are fixtures.** Operations on them are ephemeral interface state, not persistent CRM/ERP actions. The Revenue Growth engine is a deterministic read-only MVP (no calibrated ML probabilities). Autonomous LLM conversations, durable orchestration, BI/Data Science contracts, real LAI ERP API integration, server-persisted case management, approvals, email/push dispatch, production SSO, background workers and observability are not implemented here.

Never claim that clicking Approve, Start or Mark as Read writes to an ERP. Real actions require authenticated server endpoints, isolation, human authorization, signed evidence and idempotency.

## Les deux autres dashboards (conservés)

- [Data Analyse — HTML/CSV](../data-analysis/)
- [Data Science — prototype HTML](../data-science/)

Ils restent indépendants et accessibles sur un serveur statique (port 8000). Les APIs de synchronisation inter-plateformes ne sont pas encore intégrées.

## AI Director et trois nouveaux spécialistes

Consultez [la documentation des quatre Agents](../../docs/agentic/ai-director-specialists-mvp.md), les endpoints sécurisés et les règles d'approbation. Le Director choisit des spécialistes via règles métier déterministes, sans écriture ERP. Les pages React chargent les rapports après connexion sandbox ; les scénarios sont des hypothèses explicites et non des prévisions certifiées.
