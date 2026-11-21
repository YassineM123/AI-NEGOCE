# AI-NÉGOCE — AI Director + quatre agents métier (MVP read-only)

Branche canonique : `feature/unified-ai-analytics-platform`.

## Architecture

- `server/agents/revenue-growth.ts` : croissance et baisse du CA par client, dormance, score **heuristique non probabiliste**, dossiers de relance proposés.
- `server/agents/financial-strategy.ts` : créances ouvertes et échues, exposition client, sensibilité de recouvrement (25/50/75 % des créances échues).
- `server/agents/supply-chain.ts` : positions sous seuil, écarts au point de commande et coût de retour au seuil ; estimation sans réserves, MOQ ni délai fournisseur.
- `server/agents/business-strategy.ts` : comparaison des agences sur CA, coûts connus, créances et alertes stock ; sensibilités hypothétiques +5/+10 % de CA, sans prétendre prédire le marché.
- `server/agents/ai-director.ts` : sélection déterministe ou explicite des spécialistes, délégation bornée (4 max), constitution d'un plan et synthèse priorisée avec preuve.
- `server/agents/common.ts` : contrats typés, agrégations en millimes TND, périmètres d'agence et références sources.
- `dashboards/agentic-ai/src/` : interface React du Centre de commandement, pages dédiées, lecture des quatre rapports, chat guidé (non LLM), démarrage d'une investigation Director.

Les trois plateformes restent séparées : `dashboards/data-analysis/`, `dashboards/data-science/`, `dashboards/agentic-ai/`. Les deux premières sont encore des prototypes HTML/CSV autonomes, et non des consommateurs de ce nouveau backend.

## Routes

| Méthode | Route | Rôles | Opération |
|---|---|---|---|
| GET | `/api/v1/agentic/revenue-growth/opportunities` | admin, manager, commercial | Classement opportunités clients |
| GET | `/api/v1/agentic/financial-strategy/analysis` | admin, manager, accountant | Créances et scénarios prudents |
| GET | `/api/v1/agentic/supply-chain/recommendations` | admin, manager | Alerte stock + proposition brouillon |
| GET | `/api/v1/agentic/business-strategy/scenarios` | admin, manager | Performance agence + sensibilités |
| POST | `/api/v1/agentic/ai-director/investigate` | admin, manager | Délégation entre 1 et 4 agents |

Paramètres GET : `agency` (optionnel), `limit` (1–100, défaut 20). Director POST :

```json
{
  "objective": "Analyser les clients, les impayés et les stocks",
  "agency": "Sfax",
  "agents": ["revenue_growth", "financial_strategy", "supply_chain_intelligence"],
  "limit": 10
}
```

Le champ `agents` est optionnel. Quand il est absent, le Director applique des règles de routage explicables sur l'objectif et, sans domaine détecté, interroge les quatre. **Il ne génère pas du SQL ou des commandes via LLM**.

Les réponses contiennent `snapshot` (source, date d'arrêté, agences), `metrics`, `findings` avec références et `action.status=draft_only`, `scenarios` et `warnings`. Les prévisions de liquidité, probabilités de rupture, ROI d'investissement et estimations d'impact sont explicitement **non certifiées / indisponibles** sans modèles et données valides.

## Sécurité

Les routes exigent JWT authentifié, rôle autorisé, restriction entreprise et périmètre d'agence contrôlés **côté serveur**. Les actions de lecture sont journalisées dans l'audit par organisation. En production, les routes restent bloquées sans connecteur ERP validé. Aucun write-back, appel fournisseur, notification externe ou création d'ordre n'existe dans ces agents.

Le chat des spécialistes n'est **pas** un chatbot autonome : il restitue les constats du dernier rapport autorisé. Les missions, notifications et approbations de l'interface sont encore des maquettes en mémoire. Aucun agent ne peut envoyer une demande d'achat ou approuver une transaction.

## Tests

```bash
npm ci
npm run typecheck
npx vitest run server/agents/revenue-growth.test.ts server/agents/revenue-growth.api.test.ts server/agents/agentic-suite.test.ts server/agents/agentic-suite.api.test.ts
npm run agentic:typecheck
npm run agentic:build
npx playwright test --config dashboards/agentic-ai/playwright.config.ts
```

Les critères principaux : CA signé des avoirs, coûts manquants non valorisés à zéro, créances datées au `asOf`, seuils de stock déjà définis, absence de fuite inter-agences et inter-organisations, absence de mutation ERP, délégation allow-listée.

## Ce qui reste à développer avant une version enterprise

1. API ERP LAI réel avec définitions KPI certifiées, traçabilité SQL et isolation tenant.
2. Services Data Science validés (backtests temporels, modèles/version, dérive, abstention).
3. Persistances des missions, conversations agent, notifications et décisions en PostgreSQL.
4. Workflows d'approbation humaine, règles de séparation des rôles, idempotence, contrôles préconditions ; écritures ERP exclusivement après autorisation.
5. Jobs asynchrones durables, observabilité, alerting, production SSO et gestion des secrets.
6. Recette métier avec LAI, comparaison ERP/BI, budgets d'erreur et campagne de tests de sécurité.

Ce MVP constitue une **fondation réelle et testable en lecture seule**, pas une promesse d'orchestration autonome en production.
