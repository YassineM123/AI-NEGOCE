# Plateforme 3 — Agentic AI Command Center (React)

Le **troisième dashboard** existe et son code React est maintenu dans [../../apps/agentic-ai/](../../apps/agentic-ai/). Ce dossier sert de point de repère pour les trois plateformes sans créer une copie désynchronisée de l'application.

## Démarrage

À la racine du dépôt :

```bash
npm ci
npm run agentic:dev
```

Ouvrir **http://127.0.0.1:8444/**. Les deux autres espaces peuvent être lancés séparément avec `python -m http.server 8000` :

- [Data Analyse](../data-analysis/)
- [Data Science](../data-science/)

## Fonctionnalités

L'application React comporte les pages **Vue d'ensemble**, **Centre de missions**, **Mes agents**, **AI Director**, **Décisions et approbations**, **Connexions BI / Data Science**, **Historique & audit** et **Paramètres** ; chaque agent possède un espace dédié pour suivre des missions et un panneau de conversation.

Le premier spécialiste est **Revenue Growth** : source `server/agents/revenue-growth.ts`, route `GET /api/v1/agentic/revenue-growth/opportunities`, tests unitaires et tests de sécurité HTTP dans `server/agents/`.

## Limitations actuelles

- Revenue Growth est un moteur déterministe **read-only** utilisable avec la base sandbox de développement ; aucun ERP LAI réel n'est encore connecté.
- Les chiffres de démonstration, notifications, statuts de mission et validations locales **ne constituent pas des preuves d'opérations ERP**.
- Le conversationnel agentique réel, les trois autres spécialistes, l'AI Director autonome et les APIs des deux dashboards restent à intégrer.
- Ne jamais activer d'écriture ERP avant contrôles d'autorisation, approbation humaine et idempotence.

Voir [README global](../../README.md) et [documentation agent](../../docs/agentic/revenue-growth-mvp.md).
