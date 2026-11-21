# AI-NÉGOCE — Agentic avancé (MVP contrôlé)

## Ce qui fonctionne

Le Centre de commandement React utilise désormais les endpoints du serveur **lorsqu'une session est connectée** : missions, demandes d'approbation, notifications et conversation spécialisée avec chacun des 4 Agents + AI Director. Sans session, les anciennes vues de démonstration restent explicitement identifiées comme maquettes.

La persistance repose sur la migration `migrations/008_agentic_workspace.sql`, stockée dans PostgreSQL avec contrôle d'accès par organisation (RLS et transaction avec verrou de ligne). Chaque transition conserve sa version pour empêcher les approbations concurrentes. Si `DATABASE_URL` manque, le serveur utilise **la mémoire temporaire** et perd ces données au redémarrage ; le dashboard affiche cet état.

## Installation locale

Dans `.env` uniquement (ne jamais committer les secrets) :

```dotenv
NODE_ENV=development
AUTH_MODE=local-dev
HOST=127.0.0.1
# DATABASE_URL à configurer selon docker-compose.dev.yml
# GEMINI_API_KEY=clé privée facultative pour utiliser le chat LLM réellement
# GEMINI_MODEL=modèle compatible disponible sur votre compte, facultatif
```

Depuis la racine :

```bash
npm ci
npm run db:dev:up
npm run migrate
npm run dev:api
```

Deux autres terminaux :

```bash
npm run agentic:worker
npm run agentic:dev
```

Ouvrir `http://127.0.0.1:8444`, se connecter au sandbox depuis **Plateformes BI / DS**, puis utiliser **Centre de missions**, **Décisions et approbations**, **Notifications** ou le **chat dans chaque Agent**.

Le worker crée des rappels d'échéance **dans l'application** (idempotents par mission/jour, toutes les 60 secondes). Les écrans de notifications se mettent à jour toutes les 15 à 20 secondes. Il n'y a pas encore d'envoi WhatsApp, email ni push, ni programmation automatique d'actions ERP.

## API

| Opération | Méthode | Endpoint |
|---|---|---|
| Mode PostgreSQL / mémoire et configuration LLM | GET | `/api/v1/agentic/workspace/status` |
| Missions enregistrées / créer | GET / POST | `/api/v1/agentic/workspace/missions` |
| Analyser une mission (lecture seule) | POST | `/api/v1/agentic/workspace/missions/:id/run` |
| Liste des approbations | GET | `/api/v1/agentic/workspace/approvals` |
| Approuver / refuser | POST | `/api/v1/agentic/workspace/approvals/:id/review` |
| Notifications | GET | `/api/v1/agentic/workspace/notifications` |
| Marquer une notification lue | POST | `/api/v1/agentic/workspace/notifications/:id/read` |
| Historique du chat par utilisateur, Agent et agence | GET | `/api/v1/agentic/workspace/chat/:agent?agency=Sfax` |
| Envoyer un message au LLM configuré | POST | `/api/v1/agentic/workspace/chat/:agent` |

Agents possibles : `revenue_growth`, `financial_strategy`, `supply_chain_intelligence`, `business_strategy` et `director`.

Une mission est créée en `draft`. L'exécution appelle uniquement les **moteurs déterministes déjà présents** et enregistre les références des constats. Une recommandation crée un dossier d'approbation `pending`. Un autre acteur autorisé (admin ou manager, jamais le créateur) peut approuver ou refuser avec `expectedVersion` pour empêcher les doubles validations. **Une approbation ne lance aucune transaction ERP.**

## Conversation réelle, pas une simulation

Le backend utilise le fournisseur LLM configuré dans `server/llm/` ; les requêtes contiennent les constats autorisés par tenant, agence et rôle, ainsi que l'historique de cette conversation. Un résultat comporte le texte, le nom du modèle et les références des pièces. Les messages sont sauvegardés si le fournisseur répond.

En absence de fournisseur réel, l'API renvoie `503 AGENT_LLM_UNCONFIGURED`. Le provider de démonstration `mock` n'est **pas accepté** pour les conversations Agentic avancées. Les modèles et clés de production ne sont pas inclus dans le dépôt et aucune disponibilité du service externe n'a été vérifiée automatiquement.

## Gouvernance et limitations

- Tous les endpoints utilisent les principaux JWT vérifiés par le backend ; les accès par organisation et agence sont contrôlés côté serveur.
- Les actions sont en lecture seule ; les recommandations et approbations ne peuvent pas écrire dans l'ERP.
- Les agents restent déterministes dans leurs calculs. LLM = interface conversationnelle **groundée**, pas orchestration autonome de transactions.
- L'audit serveur enregistre créations, investigations, approbations et appels au chat, avec les références et décisions, mais pas de secrets.
- La migration 008 centralise le workflow tenant dans un JSONB verrouillé : correct pour un **MVP borné**, à normaliser en tables métier à plus grande échelle.
- Pas encore de garanties d'un worker actif sans supervision, de file de messages externe, de canaux email/push ni de gestion HA.
- Connexion ERP LAI réelle, SSO production, modes d'approbation multi-niveaux, permissions métier finalisées et tests de charge restent requis avant production.

## Tests

```bash
npm run typecheck
npm run agentic:typecheck
npm run agentic:build
npx vitest run server/agents/workspace.api.test.ts
npx playwright test --config dashboards/agentic-ai/playwright.config.ts
```

Les tests API couvrent les organisations, les agences, la concurrence des versions, le double contrôle humain, la lecture des notifications et le refus de fausse IA. Le test chat injecte un modèle **stub** (ne démontre pas qu'un appel Gemini réel fonctionne). Les tests navigateur simulent explicitement la réponse API pour vérifier que les pages React utilisent le backend et non l'état de démonstration.

La CI générale OCR / Copilot doit toujours être réparée indépendamment.


## Agentic v2 — intégration contrôlée

Les vues Agentic v2 réutilisent la même source de données et le périmètre agence que les API
BI/Data Science. Endpoints ajoutés :

- GET /api/v1/agentic/workspace/predictions?agency=Sfax : prévisions pilotes issues du modèle
  ridge-trend-v1.0.0, uniquement si 10 mois complets consécutifs et quatre validations
  chronologiques réussissent (WAPE <= 35 %, biais <= 30 %). Le résultat porte sa version,
  la date de clôture et son statut. NON CERTIFIÉ POUR PRODUCTION.
- GET /api/v1/agentic/workspace/signals : alertes métier pour les reviewers, avec agence,
  source, date d'arrêté et acquittement. POST /signals/scan est réservé à l'admin et
  n'utilise que les sources locales autorisées. POST /signals/:id/acknowledge trace l'accusé.
- GET /api/v1/agentic/workspace/actions : paquets d'actions issus d'une recommandation
  réellement approuvée par un autre acteur autorisé. GET /actions/:id/export fournit un
  dossier JSON de transmission manuelle et trace l'export. Aucun ERP write-back.
- Missions quatre étapes persistantes : cadrage, analyse, validation humaine, préparation
  du paquet approuvé, avec statut par étape. Les anciennes missions JSONB restent lisibles.

Pour activer le scanner automatique uniquement sur l'organisation de démonstration hors
production, définir AGENTIC_PROACTIVE_DEMO=1 sur le processus agentic:worker.
La source peut être DEMO_DATA_SOURCE=extractions; les fichiers historiques restent non
rapprochés ERP. En production, il faut encore un connecteur ERP LAI validé par tenant,
un scheduler surveillé, de l'observabilité, et l'homologation des modèles et des droits.

Exécution QA :
  npm run typecheck
  npm run agentic:typecheck
  npm run agentic:build
  npx vitest run server/agents/predictive.test.ts server/agents/agentic-v2.api.test.ts server/agents/workspace.api.test.ts

Les prédictions expérimentales ne sont jamais des autorisations d'action et ne créent
pas de demandes d'approbation. Les alertes et dossiers restent read-only, aucun email,
WhatsApp, règlement, mouvement de stock ou commande ne sont envoyés automatiquement.
