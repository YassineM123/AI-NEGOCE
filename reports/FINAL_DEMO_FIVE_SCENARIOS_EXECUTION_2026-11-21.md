# RAPPORT D'EXÉCUTION — RECETTE FINALE AI-NÉGOCE

**Date de l'exécution GitHub Actions :** 21 novembre 2026 (UTC)  
**Branche :** `feature/final-five-scenario-demo-recipe-20261121`  
**Commit de code testé :** `d13a8983be8844309120cfd3d63c1b2db48a8e0b`  
**Run :** https://github.com/YassineM123/AI-NEGOCE/actions/runs/44926169593  
**Job API :** `agentic-api` — conclusion **success**  
**Job PostgreSQL :** `agentic-postgres` — conclusion **success**  

## Exécution vérifiée dans les journaux GitHub

Commande :
```bash
npx vitest run server/agents/final-demo-recipe.api.test.ts --reporter=verbose
```

**Résultat : `Test Files 1 passed (1); Tests 6 passed (6)`.**
Les six intitulés ci-dessous sont confirmés chacun par un `✓` dans les journaux du job `agentic-api` :

| Cas | Statut GitHub | Oracle métier |
|---|---|---|
| 01 customer growth | PASS | 1 000 → 1 500 TND, +50 %, pièces F-SF-PREV/F-SF-CUR |
| 02 liquidity stress | PASS | 9 000 échus sur 10 000 TND, exposition 90 %, pièce D-SF-LATE |
| 03 stockout | PASS | SKU-A : stock Sfax 0, seuil 10 ; candidat transfert Tunis Centre → Sfax 10 unités |
| 04 geographic expansion | PASS | Agences existantes : Tunis Centre 4 000 TND ; Sfax 2 500 TND ; marché/ROI/CAPEX non disponibles |
| 05 CEO +15% | PASS | Base 6 500 TND ; +975 TND de sensibilité ; 7 475 TND de cible hypothétique ; 4 délégations, mission persistante, double validation |
| guardrail | PASS | Accès hors périmètre renvoie HTTP 403 |

### Autres contrôles exécutés dans le même run

- `agentic-api` : `npm run typecheck`, batteries Agentic existantes, `npm run agentic:typecheck`, `npm run agentic:build` — success.
- `agentic-postgres` : `npx vitest run server/agents/workspace.pg.test.ts server/analytics-database.pg.test.ts` sur service PostgreSQL 17 — success.
- Les tests Agentic existants ont produit `35 passed` sur six fichiers lors du job API avant la nouvelle recette.

## Portée des résultats

Le scénario à cinq cas est exécuté contre une instance Express créée par `makeApp({data:dataset()})`, avec un **store isolé en mémoire** et une source déterministe. Il prouve les règles API, le calcul des agents, la traçabilité, l'approbation manuelle, la sécurité de périmètre et la reproductibilité d'une réponse.

Le job PostgreSQL prouve **séparément** la persistance des missions et le fonctionnement du snapshot analytique commun, notamment la version et les invalidations d'approbation.

**Non encore validé dans ce run :** la chaîne visuelle complète des cinq cas sur les trois dashboards alimentés par une **même instance PostgreSQL** et les exports PDF de présentation; données et API réelle LAI, disponibilité bancaire, modèle de churn certifié, CAPEX/ROI et scénarios d'expansion sont également exclus.

## Interprétation de décision

1. Les cinq **oracles synthétiques** de recette sont validés et reproductibles.
2. Il serait incorrect de conclure que l'ERP LAI est homologué ou que les prédictions métier sont fiables en production.
3. Pour la démonstration client, introduire les valeurs comme **scénarios fictifs**, afficher les références de pièces et annoncer les limitations avant de demander une approbation.
4. Reprendre la même recette avec `TEST_DATABASE_URL` et vérifier visuellement BI/DS/Agentic sur une instance de staging réelle avant la validation intégrale du parcours client.

Le jeu, les assertions et les méthodes de calcul sont documentés dans `docs/FINAL_FIVE_SCENARIOS_DEMO_RECIPE.md` et définis par le code `server/agents/final-demo-recipe.api.test.ts`.
