# AI-NÉGOCE — Data Science sur snapshot BI/Agentic commun

Ce lot cible la démonstration sandbox, sans écriture ni connexion transactionnelle LAI.

## Architecture

1. Le Command Center gère la session unique et les filtres agence/période.
2. GET /api/v1/analytics/overview vérifie tenant, permissions et agences.
3. Le backend server/data-science-platform.ts calcule sur le même Dataset filtré que BI, en utilisant filteredSales, buildAnalyticsInsights et evaluateAgenticForecast.
4. Le contrat shared/contracts/analytics-platform.ts transporte les calculs sous dataScience.analysis (version ds-scoped-v1), avec le snapshotId partagé.
5. Le fichier dashboards/data-science/governed-ds.js restitue ces calculs dans les pages connectées, sans remplacer silencieusement l'API par des CSV locaux.
6. Les sessions et tokens restent dans le portail parent. Les iframes reçoivent uniquement une réponse filtrée du broker.

## Couverture

| Module | Calcul backend | Limite |
|---|---|---|
| Direction | CA, clients, mois, documents | Source sandbox, non ERP homologué |
| Clients / Churn | Récence 0–29 / 30–89 / ≥90 jours, top clients | Churn observé descriptif, aucune probabilité ML |
| Prévisions | Ridge expérimental sur mois clos, backtest chronologique | Minimum 10 mois consécutifs ; sinon N/D |
| Stocks | Nombre de positions sous seuil et références | Snapshot courant ; pas de stock historique |
| Finance | Balance âgée sur factures émises pendant la période | Pas de cash-flow bancaire |
| Stratégie | CA sous hypothèses -10 %, 0 %, +15 % | Simulation arithmétique, pas prévision ML |
| Qualité / Modèles | Données manquantes et état du modèle | Aucun modèle certifié production |
| Affinité / Fournisseurs / Production / Impact | N/D explicite | Sources additionnelles requises |

## Sécurité et qualité

- TND (3 décimales), aucun mélange EUR/USD.
- Pas de dataScience.analysis pour les utilisateurs sans analytics.ds.read.
- Données IAINEG pseudonymisées : stock et créances détaillés indisponibles.
- modelServingVerified=false même si une prévision pilote est calculable.
- Les erreurs de modèle bloquent les prévisions ; elles ne fabriquent pas des résultats et ne déclenchent aucune écriture ERP.
- Les données locales de simulation ne sont jamais associées en mode connecté au snapshot du client.

## Validation

npm ci
npm run typecheck
npm run agentic:typecheck
npm run agentic:build
npx vitest run server/analytics-platform.test.ts server/data-science-platform.test.ts
npx playwright test --config dashboards/agentic-ai/playwright.config.ts

Pour la démonstration : ouvrir le Command Center sur localhost:8444, connecter la session sandbox, comparer les trois valeurs de CA avec la même agence et période, vérifier le même snapshotId, puis ouvrir les pages Data Science Clients, Prévisions, Stocks, Cash et Scénarios. Les prévisions doivent afficher la version et l'état du backtest.
