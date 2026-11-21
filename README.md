# AI-NÉGOCE Intelligence Suite — Plateformes BI, Data Science & Agentic AI

Cette branche regroupe **trois espaces distincts** dans un seul dépôt Git : Data Analyse (BI), Data Science et Agentic AI, ainsi que le backend ERP/Copilot existant. Les deux premiers espaces sont conservés en prototypes HTML/JavaScript et le troisième est une application **React 19 + TypeScript + Vite**. Les services BI/DS ne sont pas encore intégrés au backend agentique ; aucune connexion réelle à l'ERP LAI n'est déclarée.

## Contenu du dépôt

- [`dashboards/data-analysis/`](dashboards/data-analysis/) — centre BI
  opérationnel basé sur les extractions CSV de démonstration.
- [`dashboards/data-science/`](dashboards/data-science/) — prototype autonome
  d’analyse, de simulation et de suivi des actions commerciales.
- [`dashboards/agentic-ai/`](dashboards/agentic-ai/) — fiche de navigation de la troisième plateforme.
- [`apps/agentic-ai/`](apps/agentic-ai/) — **troisième dashboard React**, Centre de commandement Agentic AI (missions, agents, conversation, Director, décisions, alertes, audit et connexions).
- [`server/agents/revenue-growth.ts`](server/agents/revenue-growth.ts) — **premier agent Revenue Growth** (classement explicable, lecture seule). Route API et tests associés dans `server/app.ts` et `server/agents/`.
- [`server/`](server/) et [`migrations/`](migrations/) — backend Express, règles d'authentification, stockage et routes API.
- [`docs/`](docs/) — audit, rapport, plans fonctionnels et plan de l’application.
- [`data/`](data/) — dictionnaires, catalogues, mappings et extractions.
- [`evidence/`](evidence/) — preuves d’audit, captures d’exploration et revues
  visuelles.
- [`tools/`](tools/) — scripts PowerShell utilisés pour les captures et la
  maintenance du prototype.

## Démarrer les prototypes

Un serveur HTTP local est nécessaire pour permettre au navigateur de charger
les fichiers CSV.

Depuis la racine du dépôt :

```powershell
python -m http.server 8000
```

Puis ouvrir :

- [Centre BI Data Analysis](http://localhost:8000/dashboards/data-analysis/)
- [Prototype Data Science](http://localhost:8000/dashboards/data-science/)

Aucune installation JavaScript ni connexion à la base de production n’est
nécessaire pour consulter ces prototypes.

## Lancer les trois plateformes

Le code de chaque plateforme est indépendant. Exécuter les commandes depuis la **racine** du dépôt.

**Plateformes 1 et 2 — previews HTML/CSV** :

```bash
python -m http.server 8000
```

- Data Analyse : http://localhost:8000/dashboards/data-analysis/
- Data Science : http://localhost:8000/dashboards/data-science/

**Plateforme 3 — React Agentic Command Center** (dans un deuxième terminal) :

```bash
npm ci
npm run agentic:dev
```

- Agentic AI : http://127.0.0.1:8444/
- Code : [apps/agentic-ai](apps/agentic-ai/)

**Premier agent — backend sandbox facultatif** : configurer `.env` en local selon [le guide backend](apps/agentic-ai/README.md), puis démarrer `npm run dev:api` (API sur 127.0.0.1:3001). Dans le Dashboard Agentic, ouvrir « Connexions BI / Data Science », puis « Connecter sandbox local ».

```bash
npm run agentic:typecheck
npm run agentic:build
npx vitest run server/agents/revenue-growth.test.ts server/agents/revenue-growth.api.test.ts
npx playwright test --config apps/agentic-ai/playwright.config.ts
```

Le mode sandbox utilise des fixtures de test, pas des chiffres de l'entreprise. **Les opérations d'approbation et les notifications sont des simulations UI, sans écriture dans l'ERP**. Les autres agents, AI Director autonome, et le lien API BI/Data Science restent à développer.

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
