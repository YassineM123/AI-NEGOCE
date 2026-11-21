# AI-NÉGOCE — Intégration des trois plateformes

## Architecture mise en place (sandbox)

Trois applications indépendantes dans la même branche :
- **Data Analyse** : dashboards/data-analysis/ (HTML/JS, visualisations et CSV locaux).
- **Data Science** : dashboards/data-science/ (HTML/JS ; calculs serveur gouvernés en mode connecté, prévision pilote backtestée, simulations locales isolées en mode non connecté).
- **Agentic AI** : dashboards/agentic-ai/ (React + Vite, 4 agents déterministes et AI Director dans server/agents/).

**Point d'entrée unique** : http://127.0.0.1:8444. Le Command Center sert les deux autres interfaces sur /platform/bi/ et /platform/ds/, les extractions anonymisées sur /data/extractions/ et utilise le proxy /api vers le backend Express localhost:3001. Le build dist-agentic conserve les ressources nécessaires.

## Session commune

En développement, un seul clic « Connecter la session sandbox » crée la session locale. Le jeton reste **en mémoire dans l'application React parente** : il n'est ni stocké dans un navigateur ni transmis aux iframes.

Les sous-applications BI et DS interrogent le parent par des messages strictement limités aux opérations context et overview. Le parent vérifie l'origine, la fenêtre émettrice et les permissions analytics.bi.read / analytics.ds.read avant d'appeler l'API avec son token. La déconnexion parent révoque cet accès au niveau de l'interface.

**Ce flux de développement n'est pas du SSO production.** L'OIDC réel, les politiques CSP et une revue de sécurité des iframes restent obligatoires.

## Données, filtres et cohérence

Le sélecteur central agence + période pilote les trois applications. Périodes disponibles : T3 2026 (2026-07-01 → 2026-09-30), T4 2026 (2026-10-01 → 2026-12-31) et 2026 (2026-01-01 → 2026-12-31).

Le backend fournit un snapshot versionné depuis /api/v1/analytics/overview, avec tenant, agence, dates, source et date d'arrêté. Les trois vues affichent le même snapshotId, CA HT et créances en TND à trois décimales dans leur bandeau « Snapshot partagé ».

**Mode connecté (BI + Data Science)** : le même appel gouverné /api/v1/analytics/overview renvoie maintenant insights, un agrégat descriptif fondé sur les ventes postées TND, filtrées sur les mêmes agences et dates. Il inclut évolution mensuelle, documents uniques, clients distincts, top clients, récence, concentration, indicateur de variation entre mois clos, couverture des coûts et disponibilité des sources. Les pages BI Ventes, Direction et Clients ainsi que les pages DS Direction, Clients, Risques et Prévisions affichent ces chiffres source-backend ; les pages non calculables affichent N/D avec justification. Aucune source CSV locale n'est substituée en silence en mode connecté.

**Limites restantes** : les simulations locales BI et Data Science restent accessibles seulement en mode non connecté. La version connectée Data Science reçoit les calculs serveur du même dataset et des mêmes filtres (portefeuille, récence, tendances, pilote CA si backtest admissible, stocks, créances et scénarios). modelServingVerified=false : aucun modèle n'est homologué en production. Les modules sans données complètes affichent N/D. Les rapports Agentic sont filtrés par agence et calculés à la date d'arrêté mais la période historique de ces rapports n'est pas encore synchronisée. Les coûts par facture, échéances et PMP demeurent indisponibles sur l'extrait IAINEG. L'API repose sur les datasets injectés/sandbox, sans connecteur officiel ERP LAI.

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
    npx vitest run server/analytics-platform.test.ts server/data-science-platform.test.ts
    npx playwright test --config dashboards/agentic-ai/playwright.config.ts

Le test serveur valide les permissions, l'isolation des agences/organisations, les filtres et les KPI. Le test navigateur multi-plateformes utilise explicitement des réponses HTTP mockées pour vérifier la **vraie navigation, la session unique, les mêmes KPI et le même snapshot après changement agence/période**. Aucun test ne prouve encore une connexion à l'ERP LAI réel.

## Reste avant production

1. API ERP LAI réelle, source de vérité et contrôles de rapprochement des KPI.
2. Étendre les analyses Data Science connectées aux données absentes (co-achats, fournisseurs, production, impact) et synchroniser la période historique des rapports Agentic détaillés.
3. Homologuer les modèles prédictifs sur données réelles avec jeux de validation chronologiques, calibration et monitoring MLOps (le ridge actuel reste expérimental).
4. Authentification OIDC/SSO production, CSP et durcissement du portail.
5. Missions, notifications, conversations et approbations persistantes avec audit serveur.
6. Correction de la pipeline qualité générale (OCR, Copilot).

La synchronisation des **KPI partagés** et de la session de développement est opérationnelle ; le système complet n'est pas encore un produit ERP connecté en production.
