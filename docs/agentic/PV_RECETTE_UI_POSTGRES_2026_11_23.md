# AI-NÉGOCE — procès-verbal de recette UI et décisions PostgreSQL

**Branche** : `feature/ai-negoce-complete-demo`
**Périmètre** : sandbox synthétique, aucun connecteur transactionnel LAI.
**Date de préparation** : 2026-11-23
**Statut global** : **À EXÉCUTER / NON HOMOLOGUÉ**.
Ce document ne prétend pas que les tests ont réussi : le checkout complet, les
navigateurs et PostgreSQL 17 ne sont pas accessibles depuis la session de
préparation. Les fichiers ont été déposés sur GitHub pour exécution CI.

## Couverture UI

| Ensemble | Navigation inspectée dans le code | Recette ajoutée |
|---|---:|---|
| Agentic | 10 pages | `recette-all-pages.spec.ts` + suites fonctionnelles existantes |
| BI | 19 pages | Vérification de la navigation, du titre et du chargement |
| Data Science | 16 pages | Navigation, contenu visible, exceptions navigateur |
| Responsive | trois applications | Fumée mobile 390 × 844 |
| Total | 45 pages | Screenshots de chaque page + traces sur échec |

La recette *smoke* ne suffit pas, à elle seule, à homologuer chaque bouton,
export, privilège, responsive breakpoint ou interaction métier. Les tests
fonctionnels Playwright existants (navigation, spécialistes, commandes,
intégration API mockée) sont donc tous lancés dans la même tâche UI.

## Scénarios décisionnels PostgreSQL 17

Fichier existant : `server/agents/final-demo-recipe.pg.test.ts`.

| Recette | Preuve attendue | Verdict actuel |
|---|---|---|
| Croissance clients | Client en croissance, CA, factures liées, données agence | NON EXÉCUTÉ |
| Crise trésorerie | 650 000 + 300 000 − 800 000 = 150 000 TND ; manque 100 000 face au plancher 250 000 | NON EXÉCUTÉ |
| Rupture stock | 120 unités / 20 par jour = 6 jours, délai 10 jours ; besoin 80 unités | NON EXÉCUTÉ |
| Expansion | Benchmark deux agences, hypothèses chiffrées, pas de faux score d'ouverture | NON EXÉCUTÉ |
| CEO +15 % | Base 6 500 TND ; sensibilité 7 475 TND ; 4 spécialistes et approbation | NON EXÉCUTÉ |

Contrôles supplémentaires : id de snapshot commun aux BI/DS/Agentic,
révision PostgreSQL après nouvelle facture, rejet HTTP 409 d'une approbation
basée sur l'ancienne source, isolation des organisations, refus de write-back
ERP et nouveaux contrôles Director `decisionReadiness`.

## Exécution automatisée

Workflow : `.github/workflows/recette-complete.yml`.
Deux jobs indépendants :
1. `ui-45-pages` — install, typecheck, tous tests Playwright Agentic,
   parcours 45 pages, responsive, captures et traces ;
2. `five-decisions-postgres` — service PostgreSQL 17, migrations dans
   schéma éphémère, tests PostgreSQL/agents, typage et build.

Commandes pour reproduire :
```bash
npm ci
npx playwright install --with-deps chromium
npx playwright test --config dashboards/agentic-ai/playwright.config.ts
# TEST_DATABASE_URL doit pointer vers une base PostgreSQL 17 de test isolée.
TEST_DATABASE_URL=postgres://postgres:PASS@127.0.0.1:5432/agentic_recette \
  npx vitest run server/agents/final-demo-recipe.pg.test.ts \
    server/agents/workspace.pg.test.ts server/analytics-database.pg.test.ts
npx vitest run server/agents/decision-gates.test.ts \
  server/agents/agentic-suite.test.ts \
  server/agents/specialist-action-plans.api.test.ts
```

## Critères de clôture

La recette n'est `PASS` qu'après :
- deux jobs verts pour le **même SHA** de tête ;
- fichiers de screenshots/traces consultables ;
- absence de défaut bloquant, données des cinq scénarios conformes aux asserts ;
- aucune sortie ne présente les calculs fictifs comme valeurs ERP LAI ;
- pas de fuite tenant/agence ni de confirmation d'action ERP fictive ;
- validation humaine des exigences R01–R10, distincte du test automatisé.

En cas de défaut, joindre la trace, le test, la capture, la page, le SHA,
l'agence/période et le résultat observé. Le statut contractuel des 253
exigences Agentic reste **non homologué**.
