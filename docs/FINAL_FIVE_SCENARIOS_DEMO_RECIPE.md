# RECETTE FINALE — 5 scénarios métier AI-NÉGOCE

**Date :** 21 novembre 2026  
**Référentiel :** `FINAL-DEMO-2026-FICTIF-V1` (100 % synthétique, aucun ERP LAI connecté)  
**Arrêté :** 20 octobre 2026 — `2026-10-20T10:00:00Z`  
**Période :** 1 janvier – 31 décembre 2026 (l'arrêté exclut les opérations postérieures)  
**Fichiers :** `server/agents/final-demo-recipe.api.test.ts` (source des assertions), `.github/workflows/agentic-specialists.yml` (exécution GitHub Actions).

## Données fixées — résultat vérifiable

| Document | Agence | Client | Date | CA HT TND |
|---|---|---|---|---:|
| F-SF-PREV | Sfax | CL-GROW | 15/05/2026 | 1 000,000 |
| F-SF-CUR | Sfax | CL-GROW | 15/09/2026 | 1 500,000 |
| F-TUN | Tunis Centre | CL-TUN | 22/09/2026 | 4 000,000 |
| F-SF-CANCELLED | Sfax | CL-CANCEL | 01/10/2026 | 999 999,000 — **annulé, exclu** |

**CA observé total : 6 500,000 TND.** Créances documentaires Sfax : 9 000,000 TND échus (D-SF-LATE, 01/06/2026), 1 000,000 non échus. Stock SKU-A Sfax : 0 / seuil 10 ; Tunis Centre : 30 / seuil 10.

## Critères et résultats attendus

| # | Scénario | Oracle de vérification | Preuve et décision |
|---|---|---|---|
| 01 | Croissance clients | CA client CL-GROW : 1 000 → 1 500 TND ; **+50 %** sur deux fenêtres comparables de 90 jours | F-SF-PREV et F-SF-CUR ; score *heuristique*, aucune probabilité de churn inventée ; proposition brouillon soumise à validation |
| 02 | Tension de trésorerie | 10 000 TND de créances Sfax, 9 000 échues (**90 %**) ; sensibilité 50 % du recouvrement = 4 500 TND | D-SF-LATE ; **aucun solde bancaire, DSO calculé ou prévision cash** ; diagnostic de recouvrement seulement |
| 03 | Rupture stock | SKU-A : **0 disponible, seuil 10**, manque 10 unités ; valorisation indicative 600 TND | Position Sfax ; candidat transfert Tunis Centre → Sfax de 10 unités, sous réserve des réservations, transport et permissions |
| 04 | Expansion géographique | **Comparaison de deux agences existantes** : Tunis 4 000 TND, Sfax 2 500 TND ; 6 500 TND au total | Factures F-TUN, F-SF-PREV, F-SF-CUR ; **ROI, marché, CAPEX et faisabilité N/D** — pas une recommandation certifiée d'ouverture de site |
| 05 | CEO +15 % | Base 6 500,000 TND, sensibilité arithmétique **+975,000**, cible illustrative **7 475,000 TND** ; quatre agents appelés | Délégation Revenue, Finance, Supply Chain, Business Strategy. Mission persistante, preuves, validation par second utilisateur, paquet **manuel** uniquement |
| 06 | Garde-fou | Interdiction d'accéder à l'agence non autorisée et à une autre organisation | Réponses HTTP 403 |

### Attention à l'interprétation

- **Croissance** : constat historique sur deux fenêtres comparables, pas une prévision causale.
- **Crise de trésorerie** : les créances échues peuvent signaler une exposition, mais **ne prouvent pas** une crise de liquidité bancaire.
- **Rupture de stock** : stock comptable instantané de la démo, disponibilité réelle et mouvements non rapprochés.
- **Expansion** : comparaison de performance entre agences présentes ; pas de chiffrage d'ouverture d'une nouvelle agence sans coûts, marché et capacité.
- **Objectif +15 %** : scénario `what-if`, pas une prédiction validée ni une promesse de croissance.

## Reproduction

```bash
git checkout feature/final-five-scenario-demo-recipe-20261121
npm ci
npx vitest run server/agents/final-demo-recipe.api.test.ts --reporter=verbose
```

Ce test est également exécuté dans le job `agentic-api` du workflow GitHub Actions `agentic-specialists-and-director`. Contrôler la **dernière exécution sur le commit exact** avant de déclarer la recette validée.

```bash
npm run typecheck
npm run agentic:typecheck
npm run agentic:build
```

### Test complémentaire sur PostgreSQL

Les assertions précédentes exercent le serveur REST réel avec un store **en mémoire** et un jeu synthétique fixé. Pour déclarer la recette *PostgreSQL réellement validée*, lancer aussi :

```bash
TEST_DATABASE_URL=postgres://... npx vitest run server/analytics-database.pg.test.ts server/agents/workspace.pg.test.ts
```

Ces tests PostgreSQL vérifient notamment snapshots et approbations, mais ne remplacent pas une **recette intégrale des cinq histoires sur une instance PostgreSQL réelle**. Cette dernière reste à exécuter sur la base de démonstration, avec captures de la restitution BI, DS et Agentic.

## Décision de recette

- `PASS` : cas attendu et preuves contrôlés par GitHub Actions.
- `FAIL` : assertion ou compilation en erreur.
- `NON VERIFIÉ` : domaine non exécuté ou source manquante.
- `N/D` : information impossible à conclure (notamment cash bancaire, CAPEX, ROI, ML certifié).

**Aucun chiffre de ce document n'est une observation de l'ERP LAI.**
