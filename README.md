# AI-NÉGOCE Intelligence Suite — Plateformes BI, Data Science & Agentic AI

Cette branche regroupe **trois espaces distincts** dans un seul dépôt Git : Data Analyse (BI), Data Science et Agentic AI, ainsi que le backend ERP/Copilot existant. Les deux premiers espaces sont conservés en prototypes HTML/JavaScript et le troisième est une application **React 19 + TypeScript + Vite**. Les trois plateformes partagent désormais une session sandbox et des KPI gouvernés (CA, créances, période et agence) depuis un backend commun. Les calculs détaillés historiques BI/DS restent locaux et aucune connexion à l'ERP LAI réel n'est déclarée.

## Contenu du dépôt

- [`dashboards/data-analysis/`](dashboards/data-analysis/) — centre BI
  opérationnel basé sur les extractions CSV de démonstration.
- [`dashboards/data-science/`](dashboards/data-science/) — prototype autonome
  d’analyse, de simulation et de suivi des actions commerciales.
- [`dashboards/agentic-ai/`](dashboards/agentic-ai/) — **troisième dashboard React**, Centre de commandement Agentic AI (missions, agents, conversation, Director, décisions, alertes, audit et connexions).
- [`server/agents/revenue-growth.ts`](server/agents/revenue-growth.ts) — premier moteur Revenue Growth ; autres moteurs métier et AI Director dans `server/agents/`, avec APIs gouvernées dans `server/app.ts`.
- [`server/`](server/) et [`migrations/`](migrations/) — backend Express, règles d'authentification, stockage et routes API.
- [`docs/`](docs/) — audit, rapport, plans fonctionnels et plan de l’application.
- [`data/`](data/) — dictionnaires, catalogues, mappings et extractions.
- [`evidence/`](evidence/) — preuves d’audit, captures d’exploration et revues
  visuelles.
- [`tools/`](tools/) — scripts PowerShell utilisés pour les captures et la
  maintenance du prototype.

## Lancer les trois applications avec une session et des filtres partagés

**Point d'entrée recommandé : http://127.0.0.1:8444**. Le portail React sert aussi les deux dashboards historiques sur /platform/bi/ et /platform/ds/, sous la même origine. Le frontend utilise le proxy /api vers Express localhost:3001.

Depuis la racine du dépôt (sandbox local seulement) :

~~~bash
npm ci
# Configurer AUTH_MODE=local-dev et HOST=127.0.0.1 dans l'environnement local
npm run dev:api
~~~

Dans un autre terminal :

~~~bash
npm run agentic:dev
~~~

Ouvrir le Command Center, cliquer **Plateformes BI / DS**, puis **Connecter la session sandbox**. Le sélecteur agence/période est unique. Les trois bandes de KPI partagées affichent le même snapshotId, CA et créances ; le jeton reste uniquement en mémoire dans le parent React. Les outils historiques des dashboards BI et DS restent distincts du snapshot commun.

**Consultation des maquettes sans session partagée** : un serveur statique permet toujours d'ouvrir séparément les prototypes HTML/CSV sur port 8000, mais n'assure ni authentification commune ni synchronisation des filtres.

Tests :

~~~bash
npm run typecheck
npm run agentic:typecheck
npm run agentic:build
npx vitest run server/analytics-platform.test.ts
npx playwright test --config dashboards/agentic-ai/playwright.config.ts
~~~

La session locale n'est pas un SSO production ; Data Science n'a aucun modèle serveur validé ; les rapports des 4 Agents sont encore indépendants du filtre historique de période, et l'ERP LAI réel reste à intégrer. Les décisions et notifications de démonstration n'écrivent aucune donnée ERP.

Voir [le guide d'intégration technique](docs/PLATFORM_INTEGRATION.md) et [les Agents read-only](docs/agentic/ai-director-specialists-mvp.md).

## Règles de développement — branche canonique

- Branche de travail : `feature/unified-ai-analytics-platform` ; ne pas travailler sur `main` par défaut.
- Conserver les trois plateformes séparées et les relier par contrats API, jamais par duplication silencieuse de données.
- Respecter les permissions agence et organisation et la traçabilité des résultats.
- Ne pas committer d'exports réels, secrets, bases locales ou dossiers temporaires navigateur.

## Documents de référence

Pour comprendre le périmètre et les limites des données, commencer par :

1. [`docs/RAPPORT_AUDIT_BI_NEGOCE.md`](docs/RAPPORT_AUDIT_BI_NEGOCE.md)
2. [`docs/AUDIT_NEGOCE.md`](docs/AUDIT_NEGOCE.md)
3. [`docs/PLAN_WEB_APP_BI.md`](docs/PLAN_WEB_APP_BI.md)
4. [`docs/PLAN_DASHBOARDS_NEGOCE.md`](docs/PLAN_DASHBOARDS_NEGOCE.md)
5. [`data/DICTIONNAIRE_DONNEES_BI.csv`](data/DICTIONNAIRE_DONNEES_BI.csv)
6. [`data/extractions/README.md`](data/extractions/README.md)

## Données et statut des calculs

Les fichiers du dossier [`data/extractions/`](data/extractions/) sont des
extractions de démonstration anonymisées. Les indicateurs et simulations du
prototype ne doivent pas être interprétés comme des résultats certifiés tant
qu’ils n’ont pas été rapprochés avec les sources ERP et validés par LAI.

Les identifiants pseudonymisés servent uniquement aux jointures et à la
démonstration. Les opérations automatiques et les écritures dans l’ERP ne
sont pas activées dans ce dépôt.

## Confidentialité

Ne jamais ajouter au dépôt :

- des secrets, mots de passe, jetons ou fichiers d’environnement ;
- des exports bruts contenant des données nominatives ;
- des identifiants réels de clients, articles, documents ou bases de données.

Avant tout partage, vérifier les fichiers ajoutés et conserver les données de
démonstration anonymisées.
