# Phase 2 — Démonstration client contrôlée à partir de `Database/extractions`

> **Mode démonstration, lecture seule — données IAINEG pseudonymisées, calculs SQL non rapprochés avec les éditions officielles de NÉGOCE.** Ne pas présenter les chiffres comme un CA certifié ou un ERP de production connecté. Aucun fichier source n'a été modifié.

## 1. Les sources

Le jeu IAINEG (extraction documentée le 19/11/2026) comprend :

| Source | Grain | Couverture observable | Utilisation |
| --- | --- | --- | --- |
| `ventes/journal_ventes_2026_demo.csv` | document | 3 158 documents, 693 clients, 01/01–20/10/2026 | **KPI partagés et Revenue Growth : 3 101 documents TND uniquement** |
| `ventes/ca_clients_2026.csv` | client pseudonymisé | 693 lignes | Source de rapprochement, pas de CA TND fiable sans la devise du journal |
| `ventes/ventes_quotidiennes_2026.csv` | jour | 233 lignes | Contrôle de volumétrie, sommes multidevises non consolidables |
| `ventes/ventes_articles_2026.csv` | article | 1 371 lignes | Volumes/portefeuille, *pas* une jointure article ↔ facture certifiée |
| `marge/marge_mensuelle_2026.csv` | mois × dépôt | 29 lignes | Indicateurs à rapprocher ; ne pas ventiler la marge par client/facture |
| `recouvrement/creances_agees_demo.csv` | client × tranche | 563 lignes, 425 clients | Analyse agrégée, mais sans date d'échéance par facture |
| `recouvrement/encaissements_mensuels_2026.csv` | mois × type × état | 10 lignes | Flux à rapprocher, devise non explicitée |
| `stock/stock_disponible_demo.csv` | dépôt × article | 4 619 lignes | Quantités ; valorisation indisponible sur 4 618 lignes |
| `demonstration/*.csv` | scénarios | Fichiers distincts | **100 % fictifs, aucun rapprochement aux identifiants IAINEG** |

### Séparation des devises — obligatoire

Les 3 158 documents contiennent **3 101 TND (41 223 328,922 TND HT), 56 EUR (8 054 293,099 EUR HT) et 1 USD (152 049,180 USD HT)**. Chaque montant reste dans sa devise ; il est interdit de totaliser les trois colonnes en « TND » sans taux de conversion et validation métier. Les données par jour/client/article sans devise ne sont pas directement réutilisées comme CA TND.

### Données manquantes

La couche analytique **n'invente pas** de coût par facture, de PMP, de dates d'échéance, de dépôt/agence de vente ou de mapping ligne facture ↔ article. Les KPI concernés sont signalés « non disponible / non rapproché ». Le snapshot commun expose une agence « Non ventilée (extraction) » ; une sélection d'agence ne signifie pas que les ventes ont été attribuées à ce dépôt.

Les deux compléments suivants ont été ajoutés uniquement pour les scénarios de démonstration :
- `demonstration/fournisseurs_livraisons_demo_synthetique.csv` : commandes et retards fictifs pour illustrer Supply Chain ;
- `demonstration/plan_tresorerie_demo_synthetique.csv` : flux et soldes hypothétiques pour illustrer Financial Strategy.

Ils ne rentrent **jamais** dans le CA ni dans les alertes des agents gouvernés sans connexion d'une source officielle.

## 2. Démarrage Windows (PowerShell)

Dans un terminal, depuis la racine du dépôt :

```powershell
git switch feature/unified-ai-analytics-platform
npm ci
$env:AUTH_MODE = "local-dev"
$env:HOST = "127.0.0.1"
$env:NODE_ENV = "development"
$env:DEMO_DATA_SOURCE = "extractions"
npm run demo:database:audit
npm run dev:api
```

Dans un second terminal :

```powershell
npm run agentic:dev
```

Ouvrir **http://127.0.0.1:8444** et connecter la session sandbox. Data Analyse et Data Science sont accessibles depuis le centre Agentic, avec une session locale et un snapshot KPI commun via `/api/v1/analytics/overview`. Le centre d'analytique partage les données **TND** issues du journal ; les maquettes/rapports hérités qui ne disposent pas d'une devise par ligne restent distincts et non certifiés.

Pour l'audit : `GET /api/v1/demo/database/quality` (Bearer de la session **admin** ; retourne uniquement des agrégats et indicateurs de qualité, pas les identifiants clients).

## 3. Contrôles avant la réunion

```powershell
npm run demo:database:audit
npm run typecheck
npm test
npm run agentic:typecheck
npm run agentic:build
npm run test:e2e -- --project=desktop
```

La CI vérifie aussi le build de production, la sécurité npm, le package Docker et les parcours d'intégration. Vérifier le statut du dernier commit dans GitHub Actions avant la réunion.

## 4. Scénario de démonstration

1. Montrer le journal anonymisé, les **3 devises séparées** et le rapport de couverture.
2. Choisir « Toutes agences », filtrer la période et vérifier le snapshot identique BI / DS / Agentic (aucune ventilation géographique inventée).
3. Ouvrir Revenue Growth : opportunités classées et justificatifs dérivés du journal TND ; aucune action ERP automatique.
4. Illustrer Financial Strategy et Supply Chain avec les **fichiers fictifs nommément présentés comme tels** ; expliquer pourquoi les indicateurs officiels nécessitent dates d'échéance et coûts/PMP validés.
5. Montrer missions, approbations, audit et actions proposées : **brouillons/lecture seule**, aucune écriture ERP réelle.

## 5. Blocages pour une recette réelle LAI

- Export officiel de CA par devise et par agence, avec rapprochement du journal et des avoirs ;
- Définition de l'état comptable/statistique des documents, annulations et devise de facturation ;
- Données de coût document/ligne, PMP et mouvements, règles de valorisation ;
- Créances *par facture* avec date d'échéance, paiements, statut des litiges ;
- Connecteur ERP officiel, OIDC/permissions, isolation multi-organisation, source DS entraînée et surveillée ;
- Validation des règles commerciales et fiscales tunisiennes par LAI.

**Interdiction de déployer `DEMO_DATA_SOURCE=extractions` en production.** Le backend refuse explicitement ce paramètre avec `NODE_ENV=production`. 