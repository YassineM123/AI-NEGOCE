# AI-NÉGOCE — Intégration des trois plateformes

## Architecture mise en place (sandbox)

Trois applications indépendantes dans la même branche :
- **Data Analyse** : dashboards/data-analysis/ (HTML/JS, visualisations et CSV locaux).
- **Data Science** : dashboards/data-science/ (HTML/JS, calculs et simulations locales ; pas de modèle ML servi par API).
- **Agentic AI** : dashboards/agentic-ai/ (React + Vite, 4 agents déterministes et AI Director dans server/agents/).

**Point d'entrée unique** : http://127.0.0.1:8444. Le Command Center sert les deux autres interfaces sur /platform/bi/ et /platform/ds/, les extractions anonymisées sur /data/extractions/ et utilise le proxy /api vers le backend Express localhost:3001. Le build dist-agentic conserve les ressources nécessaires.

## Session commune

En développement, un seul clic « Connecter la session sandbox » crée la session locale. Le jeton reste **en mémoire dans l'application React parente** : il n'est ni stocké dans un navigateur ni transmis aux iframes.

Les sous-applications BI et DS interrogent le parent par des messages strictement limités aux opérations context et overview. Le parent vérifie l'origine, la fenêtre émettrice et les permissions analytics.bi.read / analytics.ds.read avant d'appeler l'API avec son token. La déconnexion parent révoque cet accès au niveau de l'interface.

**Ce flux de développement n'est pas du SSO production.** L'OIDC réel, les politiques CSP et une revue de sécurité des iframes restent obligatoires.

## Données, filtres et cohérence

Le sélecteur central agence + période pilote les trois applications. Périodes disponibles : T3 2026 (2026-07-01 → 2026-09-30), T4 2026 (2026-10-01 → 2026-12-31) et 2026 (2026-01-01 → 2026-12-31).

Le backend fournit un snapshot versionné depuis /api/v1/analytics/overview, avec tenant, agence, dates, source et date d'arrêté. Les trois vues affichent le même snapshotId, CA HT et créances en TND à trois décimales dans leur bandeau « Snapshot partagé ».

**Limites** : les graphiques détaillés BI restent des restitutions CSV locales ; Data Science conserve ses propres scénarios locaux et annonce modelServingVerified=false. Les rapports Agentic sont filtrés par agence et calculés à la date d'arrêté, mais leur filtrage historique par période n'est pas encore synchronisé. Les stocks sont des positions à date, pas des séries historiques. Les KPI communs ne doivent pas être confondus avec toutes les vues métier.

## Démarrage

Depuis la racine du dépôt :

    npm ci
    # Configurer le sandbox local avec AUTH_MODE=local-dev et HOST=127.0.0.1
    npm run dev:api

Dans un second terminal :

    npm run agentic:dev

Ouvrir http://127.0.0.1:8444, choisir « Plateformes BI / DS » puis « Connecter la session sandbox ».

## Validation

    npm run typecheck
    npm run agentic:typecheck
    npm run agentic:build
    npx vitest run server/analytics-platform.test.ts
    npx playwright test --config dashboards/agentic-ai/playwright.config.ts

Le test serveur valide les permissions, l'isolation des agences/organisations, les filtres et les KPI. Le test navigateur multi-plateformes utilise explicitement des réponses HTTP mockées pour vérifier la **vraie navigation, la session unique, les mêmes KPI et le même snapshot après changement agence/période**. Aucun test ne prouve encore une connexion à l'ERP LAI réel.

## Reste avant production

1. API ERP LAI réelle, source de vérité et contrôles de rapprochement des KPI.
2. Migration des calculs CSV/DS locaux vers des services validés ; période historique également dans les 4 Agents.
3. Modèles Data Science versionnés et backtests démontrés.
4. Authentification OIDC/SSO production, CSP et durcissement du portail.
5. Missions, notifications, conversations et approbations persistantes avec audit serveur.
6. Correction de la pipeline qualité générale (OCR, Copilot).

La synchronisation des **KPI partagés** et de la session de développement est opérationnelle ; le système complet n'est pas encore un produit ERP connecté en production.
