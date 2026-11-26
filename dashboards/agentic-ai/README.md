# AI-NÉGOCE — Troisième plateforme React : Agentic Command Center

Standalone React 19 + TypeScript + Vite 8 app implementing the approved **C (Minimal Premium) + B (Mission Control)** direction. The existing React BI/OCR application remains untouched.

## Run

From the repository root:

```bash
npm ci
npm run agentic:dev
```

URL: http://127.0.0.1:8444

This runs the shared-origin portal independently of the existing frontend (port 8443), and also hosts Data Analyse at /platform/bi/ and Data Science at /platform/ds/. To enable the four read-only agent APIs and the shared analytics snapshot:

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

Use **Plateformes BI / DS → Connecter la session sandbox** to log into the Command Center once, then navigate across all three interfaces without sending bearer tokens to the embedded dashboards. Tokens are memory-only. This local-dev endpoint must never be exposed externally.

The app has an optional `VITE_AGENTIC_API_BASE` for a separately hosted authorized API. Never include API keys in `VITE_*` env variables. Production OIDC login and SSO are **not yet implemented in this app**.

## Screens

- Vue d'ensemble — command-center executive layout
- Centre de missions — server-backed missions when authenticated; fixture Kanban only while disconnected
- Mes agents — four specialist profiles, governed reports, and authenticated in-app signals
- Agent detail — conversation panel, follow-up, source-backed read-only Revenue Growth, Financial, Supply Chain, and Business Strategy findings
- AI Director — bounded read-only multi-specialist investigation and evidence assembly
- Décisions & approbations — server-backed maker/checker review in the authenticated workspace; local simulation while disconnected
- Connexions BI / Data Science — real connection status when available, no fabricated health data
- Historique & audit — clearly labelled local UI trace; authenticated workspace mutations are also audited by the server
- Paramètres — safe local preferences

## Run validation

```bash
npm run agentic:typecheck
npm run agentic:build
npx playwright test --config dashboards/agentic-ai/playwright.config.ts
```

## Connected workspace and demonstration views

The UI has two deliberately different modes:

- **Authenticated workspace:** `AdvancedWorkspace.tsx` uses the guarded `/api/v1/agentic/workspace/*` API for persisted missions, deterministic read-only investigations, maker/checker approvals, in-app notifications, bounded action-package exports, and agent chat. PostgreSQL persistence requires `DATABASE_URL`; without it, the server reports its temporary in-memory mode. The due-reminder worker is started separately with `npm run agentic:worker`.
- **Disconnected demonstration:** legacy mission, alert, decision, and audit screens use labelled fixtures and ephemeral browser state. They are previews only and do not prove persistence or external delivery.

The Revenue Growth and specialist engines remain deterministic and read-only. Agent chat requires an explicitly configured real LLM provider; the built-in mock is rejected by the advanced chat API. Predictions are experimental and are not certified production models.

Approving, starting, or marking an item never writes to the ERP. The authenticated workflow persists and audits a reviewed dossier only. Real LAI ERP integration, idempotent write-back, production SSO, supervised/HA workers, external email/push/WhatsApp delivery, load validation, and production observability are still required.

See [Advanced Agentic workflows](../../docs/agentic/ADVANCED_WORKFLOWS.md) for endpoint contracts, persistence modes, worker behavior, and current limitations.

## Les deux autres dashboards (conservés)

- [Data Analyse — HTML/CSV](../data-analysis/)
- [Data Science — prototype HTML](../data-science/)

Ils restent indépendants dans leurs fichiers, mais sont aussi accessibles depuis le Command Center via un broker de session et le même snapshot BI gouverné. Les calculs CSV et les simulations locales ne sont pas encore migrés vers le backend.

## AI Director et trois nouveaux spécialistes

Consultez [la documentation des quatre Agents](../../docs/agentic/ai-director-specialists-mvp.md), les endpoints sécurisés et les règles d'approbation. Le Director choisit des spécialistes via règles métier déterministes, sans écriture ERP. Les pages React chargent les rapports après connexion sandbox ; les scénarios sont des hypothèses explicites et non des prévisions certifiées.

## Portail et contrat commun

Le Command Center est le **seul gestionnaire du jeton de développement** ; les iframes BI/DS utilisent un broker postMessage avec vérification d'origine, de fenêtre source, de permissions et d'opérations autorisées. Le filtre agence/période de la barre centrale pilote les KPI CA et créances des trois applications. Les rapports spécialisés restent à date d'arrêté (pas filtrés historiquement). Voir [documentation d'intégration](../../docs/PLATFORM_INTEGRATION.md).
