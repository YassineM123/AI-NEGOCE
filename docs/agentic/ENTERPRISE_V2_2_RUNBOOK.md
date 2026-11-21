# AI-NÉGOCE — Agentic Enterprise v2.2 (21 novembre 2026)

## Périmètre vérifiable
Cinq agents : AI Director, Revenue Growth, Financial Strategy, Supply Chain, Business Strategy.
Le cahier des charges V1 (18/11/2026) contient 9 exigences Director et 244 capacités spécialistes.
Le catalogue représente la cible de conception, **et non 253 fonctionnalités homologuées**.

## Architecture technique et exécution

1. Création de mission : POST /api/v1/agentic/workspace/missions.
   Organisation et agence bornées par le token ; version et auteur conservés dans
   le JSONB agentic_workspaces, protégé par RLS PostgreSQL. Le stockage mémoire
   est uniquement un fallback non durable de test/démo.
2. Préplanification : GET /missions/:id/plan, choisit les spécialistes autorisés,
   jusqu'à quatre outils, vérifie la présence des données et expose les limites
   des outils. Aucun appel LLM nécessaire pour calculer le plan.
3. Exécution : POST /missions/:id/run, verrou de 120 secondes par mission,
   empreinte SHA-256 des lignes du périmètre et de l'édition de la source.
   Chaque sortie d'outil est persistée après son exécution (checkpoint).
   En cas d'échec, les autres résultats sont conservés. Un second appel reprend
   les étapes incomplètes seulement si l'empreinte des données est identique.
   Une reprise renouvelle l'ID de session, invalidant tout ancien worker.
   Le mode reste read_only ; aucun achat, paiement, relance ou mouvement ERP.
4. Approbation : POST /approvals/:id/review ; acteur différent du demandeur,
   comparaison de version, empreinte de proposition et expiration à 72 heures,
   avec revalidation du snapshot lors de l'accord.
5. Export : GET /actions/:id/export : JSON de transmission MANUELLE uniquement,
   vérification de l'expiration et de l'empreinte source ; clé d'idempotence
   fournie pour une future intégration, pas pour une écriture active.

## Stratégie d'économie de tokens

- GET /brief/:agent : constats déterministes, tableaux métier, zéro token LLM.
- POST /chat/:agent : questions factuelles simples dirigées vers les calculateurs
  serveur BI / finance / stock / scénarios, sans appel à un modèle. Questions
  complexes : LLM configuré seulement, réponse brève et avec sources.
- Contexte plafonné : 4 faits, 4 messages d'historique et 320 tokens de sortie
  par spécialiste (440 pour Director). Les plafonds ne prédisent pas la
  consommation réelle facturée.
- Quota : AGENTIC_DAILY_LLM_CALL_LIMIT (1..100, défaut 40) par utilisateur ;
  AGENTIC_TENANT_DAILY_LLM_CALL_LIMIT (1..10000, défaut 250) par organisation.
  Les appels tentés échoués sont comptés, pour limiter les boucles.
- GET /usage : consommations reportées par le fournisseur séparées des
  réponses 0-token. Aucun prix fournisseur n'est inventé.
- Tours idempotents : même turnId / même question retourne la réponse déjà
  enregistrée ; toute question différente sur le même ID est rejetée.
- Rétention : AGENTIC_CHAT_RETENTION_DAYS (7..365, défaut 90), traitée
  quotidiennement par le worker. Valider RGPD et rétention des audits avec LAI.

## Alertes proactives

- GET /signals/policy : règles tenant visibles des reviewers.
- PUT /signals/policy : administration des seuils CA, créances, stock et délai
  anti-doublon ; autorisation admin + audit de toute modification.
- POST /signals/scan : lecture seule des données du tenant autorisé,
  sourcées et datées, création de notifications in-app. Aucune action ERP.
- Worker automatique d'alertes : uniquement organisation synthétique hors
  production avec AGENTIC_PROACTIVE_DEMO=1. En production, la surveillance
  métier exige un adaptateur ERP réel par tenant ; seuls les rappels de mission
  persistants sont activés sans ce connecteur.

## Critères de recette automatisés

Exécuter sur la branche :
- npm run typecheck
- npm run agentic:typecheck
- npm run agentic:build
- npx vitest run server/agents/mission-execution.api.test.ts server/agents/agentic-governance.api.test.ts server/agents/agent-router.api.test.ts server/agents/workspace.api.test.ts
- npx vitest run server/agents/workspace.pg.test.ts (si TEST_DATABASE_URL)
- npx playwright test --config dashboards/agentic-ai/playwright.config.ts
- npm run test:e2e -- --project=desktop

## Cahier des charges : dépendances non réalisées

- Contrats de lecture et identité de LAI : clés stables, avoirs, coûts datés,
  stock réservé, commandes, réceptions, règlements, soldes et budgets.
- Mutations ERP : interface officielle, contrôle rôles, revalidation pré-écriture,
  idempotence, reprises après timeout, réconciliation avec pièce ERP existante.
- ML : modèles de churn, stock et cash réellement backtestés et approuvés sur
  données pilotes, promotion MLOps, supervision dérive, rollback.
- Supervision SLA, logs/audit, test de charge, backup/restore et gouvernance de
  conservation validés par LAI.
- R01 à R10 : les critères de recette du cahier exigent une validation métiers,
  une comparaison aux éditions ERP et un essai en environnement client.

**Décision :** démo analytique contrôlée après CI, non une mise en production
d'agents transactionnels. Ne jamais présenter des recommandations ou
simulations comme des écritures ou prévisions ERP officielles.


## Optimisation de persistance du worker
Le worker de rappels ne parcourt maintenant que les organisations actives possédant
déjà un dossier dans agentic_workspaces. Cela évite les insertions JSONB vides dans
les sociétés qui n'utilisent pas Agentic. Le scan proactif de démonstration vérifie
séparément que l'organisation sandbox ciblée est active avant d'écrire les alertes.

## Vérification sur le dernier commit
Les workflows GitHub Actions sont la source de vérité pour le typage, les tests
des métiers, la persistance PostgreSQL, l'interface et la qualité générale. Ne pas
considérer une modification déployable tant que la CI du **SHA de tête** n'est pas verte.
La recette de production exige en outre des preuves LAI pour R01–R10.
