# AI-NÉGOCE — synchronisation BI / Data Science / Agentic et transparence des données
## Implémentation du 23 novembre 2026

**Statut : développement intégré sur la branche de démonstration, non homologation ERP LAI.**
Les modules des quatre spécialistes existent côté serveur et utilisent déjà des calculs réels
sur un dataset synthétique versionné. Cette livraison corrige la perception de quatre
modules indépendants et facilite le passage des données aux recommandations.

### Améliorations livrées
1. **Cockpit partagé** sur les pages Vue d'ensemble et Mes agents du Command Center.
   Les KPI BI, la couverture des données et le statut des quatre spécialistes
   utilisent le contrat `/api/v1/analytics/overview` et les rapports API Agentic.
2. **Contrôle de cohérence** : aucun rapport spécialiste n'est montré comme
   `ready` si sa date d'arrêté, sa source, son périmètre d'agences ou sa période
   diffère du snapshot analytique partagé. Les erreurs et absences de données
   demeurent visibles, jamais interprétées comme zéro risque.
3. **Liens BI→Revenue Growth et Data Science→Business Strategy** dans le
   même thème ERP bleu. Les pages embarquées demandent seulement une navigation
   via le pont `postMessage`, jamais le bearer token. Le parent vérifie
   origine, iframe et type d'agent.
4. **AI Director** : présentation des `decisionReadiness` et blocages
   métier des propositions ; ouverture du workspace persistant pour de
   nouvelles missions lorsque la session est connectée. Aucune proposition
   n'est assimilée à un ordre ERP.
5. **Recette** : génération déterministe des données ERP synthétiques avant
   les parcours UI contre le backend local, ajout d'un scénario de navigation
   inter-dashboards sans API simulée.

### Base de données et provenance
- `npm run dataset:generate` puis `npm run db:seed` créent le sandbox ERP
  **SQLite fictif** pour le parcours UI.
- `npm run analytics:seed -- --source=synthetic` importe une copie dans un
  **PostgreSQL local** avec révision. Une deuxième importation exige `--replace`.
- `npm run analytics:demo:live -- --agency=Sfax --ticks=4 --interval-seconds=5`
  illustre quatre événements successifs sur ce snapshot PostgreSQL : vente,
  encaissement, stock et facture fournisseur. Ceci ne simule PAS une transaction
  ERP LAI, seulement un scénario fictif traçable.
- Les scripts de seed interdisent la production ou le tenant non-synthétique.
  **Aucune donnée LAI manquante ne doit être inventée comme réelle.**

### Exigences données encore à fournir / certifier auprès de LAI
- Contrat d'API et clés de référence officielles pour clients, produits,
  facture, avoir, prix/cout, stock par dépôt et réservations ;
- Journal complet de paiement, règlement bancaire, échéance, litige, BFR ;
- MOQ, calendrier des fournisseurs, disponibilité réelle, accusés de réception,
  livraison et coûts de transport ;
- Capacité industrielle / ressources, données de marché et coût immobiliers,
  CAPEX et frais d'ouverture pour expansion ;
- Historique labellisé pour validation de churn, forecast demande,
  comportements fournisseurs et validation chronologique des modèles.
La présence d'une donnée synthétique dans le portail n'est pas sa certification.
Les 253 exigences du cahier des charges restent non homologuées.

### Vérification
Les tests incluent :
- `dashboards/agentic-ai/tests/connected-decisions.spec.ts` (API réelle locale) ;
- `dashboards/agentic-ai/tests/recette-all-pages.spec.ts` (45 pages) ;
- `server/agents/final-demo-recipe.pg.test.ts` (décisions PostgreSQL) ;
- `server/agents/decision-gates.test.ts` (isolation et blocages).

N'annoncer la recette du dernier commit comme réussie que si les deux jobs
`ui-45-pages` et `five-decisions-postgres` du même SHA sont verts.
Le workflow `quality` reste indépendant ; vérifier aussi son statut.
