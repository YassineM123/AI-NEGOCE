# AI-NÉGOCE — PostgreSQL commun pour les trois dashboards

## Architecture de démonstration
BI / Data Analyse, Data Science et Agentic (4 spécialistes + AI Director) utilisent un même snapshot versionné dans PostgreSQL. Les missions, validations et chats sont persistés dans la même base, dans une table différente. Aucune connexion ERP LAI.

Portail : http://127.0.0.1:8444 → backend : http://127.0.0.1:3001 → PostgreSQL local. Les applications embarquées BI/DS passent par le broker de session ; les agents lisent le même dataset au niveau de chaque requête.

## Démarrage Windows / PowerShell
- Mettre à jour la branche `feature/unified-ai-analytics-platform` et exécuter `npm ci`.
- Dans `.env` (non commité), définir `NODE_ENV=development`, `AUTH_MODE=local-dev`, `HOST=127.0.0.1`, `UNIFIED_ANALYTICS_SOURCE=postgres` et `DATABASE_URL=postgresql://ai_negoce:<password>@127.0.0.1:5432/ai_negoce`. Définir aussi `POSTGRES_PASSWORD` pour Docker (même valeur). Changer le mot de passe d'exemple.
- Dans le terminal 1, exécuter successivement : `npm run db:dev:up`, `npm run migrate`, `npm run dataset:generate`, `npm run db:seed`, `npm run analytics:seed -- --source=synthetic` et `npm run dev:api`.
- Terminal 2 : `npm run agentic:dev`. Terminal 3 facultatif pour rappels : `npm run agentic:worker`.
- Ouvrir `http://127.0.0.1:8444` → « Plateformes BI / DS » → « Connecter la session sandbox ».

ATTENTION : `db:seed` reconstruit la SQLite de démonstration existante (sauvegardez-la si nécessaire). `analytics:seed` n'écrase pas la base PostgreSQL analytique existante sans `--replace`. Aucun script ne modifie LAI ERP.

## Source de démonstration
1. `--source=synthetic` (conseillé) : import des factures, clients, stocks et créances de la SQLite fictive dans PostgreSQL. Les cinq agents produisent des constats calculés.
2. `--source=extractions` : journal pseudonymisé TND uniquement ; les montants EUR/USD ne sont pas convertis, les coûts/PMP et échéances détaillées manquants ne sont pas inventés. Certains agents affichent N/D et ne prétendent pas agir.
3. Pour changer une base déjà importée : `npm run analytics:seed -- --source=extractions --replace` (ou synthetic). Import autorisé uniquement sur PostgreSQL local et tenant synthétique.

## Sécurité et cohérence
- Migration 009 : `analytics_datasets`, avec RLS PostgreSQL tenant, contenu validé, révision et empreinte SHA-256. Un snapshot atomique est chargé pour BI, DS et Agentic sur chaque requête.
- Sans dataset PostgreSQL importé, l'API renvoie 503. Jamais de substitution silencieuse par le dataset local.
- Le bandeau du portail montre « PostgreSQL partagé · révision N ». Le `snapshotId` change avec les données ou le périmètre. Les cinq agents ont les mêmes filtres agence/période.
- Les approbations et exports relisent le snapshot PostgreSQL. En cas de changement de version, nouvelle validation obligatoire.
- Les actions proposées sont des **paquets manuels** uniquement. Aucun mouvement dans LAI ERP.

## Tests
1. Comparer CA et clients entre BI, DS et Agentic sur Sfax / T3, puis Sfax / T4. Vérifier le même snapshotId.
2. Ouvrir successivement Revenue Growth, Financial Strategy, Supply Chain, Business Strategy et AI Director. Lancer une mission Director, lire ses preuves, faire approuver par un second utilisateur et exporter le paquet sans écriture.
3. Vérifier la persistance après redémarrage et l'isolation des tenants. Réimporter un dataset test avec `--replace` : vérifier révision et KPI changés, et approbations périmées bloquées.
4. Commandes : `npm run typecheck`, `npm run agentic:typecheck`, `npm run agentic:build`, `npx vitest run server/analytics-platform.test.ts server/data-science-platform.test.ts server/agents/five-agents-journey.api.test.ts` et `npx playwright test --config dashboards/agentic-ai/playwright.config.ts`.
5. Avec `TEST_DATABASE_URL` sur une base de test distincte : `npx vitest run server/analytics-database.pg.test.ts server/agents/workspace.pg.test.ts`.

## Limites
La table JSONB atomique suffit pour la démo (24 Mo max), mais n'est pas un entrepôt analytique normalisé pour grandes volumétries. Les modèles ML restent pilotes non homologués. Les conversations LLM approfondies exigent une vraie clé serveur et ne doivent pas être confondues avec le mock. Les anciennes pages de simulation locale restent séparées du mode connecté.
