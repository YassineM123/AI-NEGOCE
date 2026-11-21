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

**Limites restantes** : les simulations locales BI et Data Science restent accessibles seulement en mode non connecté. La version connectée Data Science reçoit les calculs serveur du même dataset et des mêmes filtres (portefeuille, récence, tendances, pilote CA si backtest admissible, stocks, créances et scénarios). modelServingVerified=false : aucun modèle n'est homologué en production. Les modules sans données complètes affichent N/D. Les rapports des quatre spécialistes Agentic et d'AI Director utilisent désormais les mêmes agences et les mêmes dates from/to que BI/DS. La date d'arrêté du dataset reste distincte de la période sélectionnée ; aucune série historique de stock n'est reconstruite. Les coûts par facture, échéances et PMP demeurent indisponibles sur l'extrait IAINEG. L'API repose sur les datasets injectés/sandbox, sans connecteur officiel ERP LAI.

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
    npx vitest run server/analytics-platform.test.ts server/data-science-platform.test.ts server/agents/period-sync.api.test.ts
    npx playwright test --config dashboards/agentic-ai/playwright.config.ts

Le test serveur valide les permissions, l'isolation des agences/organisations, les filtres agence/période BI, Data Science et Agentic, les missions datées et les conversations sans fuite entre périodes. Le test navigateur multi-plateformes utilise explicitement des réponses HTTP mockées pour vérifier la **vraie navigation, la session unique, les mêmes KPI et le même snapshot après changement agence/période**. Aucun test ne prouve encore une connexion à l'ERP LAI réel.

## Reste avant production

1. API ERP LAI réelle, source de vérité et contrôles de rapprochement des KPI.
2. Étendre les analyses Data Science connectées aux champs absents (co-achats, fournisseurs, production, impact), homologuer les comparaisons métier et vérifier les périodes sur données ERP LAI.
3. Homologuer les modèles prédictifs sur données réelles avec jeux de validation chronologiques, calibration et monitoring MLOps (le ridge actuel reste expérimental).
4. Authentification OIDC/SSO production, CSP et durcissement du portail.
5. Exploiter PostgreSQL durablement et homologuer les workflows Agentic existants : missions datées, conversations datées, approbations séparées, notifications in-app et audit serveur. Les missions créées avant l'ajout des périodes sont des dossiers legacy « toutes dates » et n'apparaissent pas dans les trois sélections datées du portail.
6. Correction de la pipeline qualité générale (OCR, Copilot).

La synchronisation des **KPI partagés** et de la session de développement est opérationnelle ; le système complet n'est pas encore un produit ERP connecté en production.


## Convention de filtrage Agentic — démonstration

- **Ventes, clients et CA** : uniquement les lignes postées appartenant à la période sélectionnée, à la source autorisée et à l'agence autorisée. Les scénarios Business Strategy partent de cette même base.
- **Revenue Growth** : fenêtres d'observation bornées par la date de fin sélectionnée et l'arrêté. Lorsqu'un historique antérieur complet de 90 jours est inaccessible, aucune classification « nouveau / croissance / décroissance » ne peut être affirmée.
- **Financial Strategy** : factures *émises* durant la période et solde encore ouvert à la date d'arrêté de la source. Ce montant n'est pas une photographie historique des encaissements à la fin de T3.
- **Supply Chain** : les stocks n'ont qu'une position à la date du snapshot. T3 n'affiche donc pas un faux stock historique si l'arrêté est en T4, et renvoie **N/D**.
- **AI Director** : communique les filtres aux spécialistes. Le plan, la trace d'exécution, les constats, les sources et la prédiction pilote utilisent les mêmes filtres.
- **Mission persistée** : chaque nouveau dossier mémorise l'agence, les bornes from/to et leur empreinte ; le changement de filtre du portail ne réécrit jamais une mission déjà enregistrée.
- **Conversation / brief** : le résumé sans tokens, les questions factuelles et l'historique sont liés à l'agence ET à la période. Un turnId réutilisé avec une autre période est refusé.
- **Revue humaine** : les approbations et paquets d'action héritent de la période de leur mission.
- **Alertes proactives** : distinctes des rapports analytiques ; basées sur l'arrêté de la source, non rétro-calculables pour une période antérieure.

Pour la démo : connecter le sandbox, choisir **Sfax / T3 2026**, ouvrir BI puis Data Science puis un agent. Vérifier que les ventes et créances utilisent T3 et que le stock affiche N/D si l'arrêté est plus récent. Basculer sur **Sfax / T4 2026** et constater les nouveaux rapports, puis sur Tunis Centre pour contrôler l'isolation d'agence. Ne pas assimiler « aucun résultat » à un chiffre zéro sans preuve.
