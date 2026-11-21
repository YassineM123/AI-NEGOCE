# Parcours bout-en-bout — révision PostgreSQL → BI → Data Science → Agentic

## Périmètre
Pilote **entièrement synthétique**. La source PostgreSQL est l'unique snapshot partagé par BI, DS et les quatre agents + AI Director, sans connecteur transactionnel LAI et sans aucune écriture ERP.

1. Une donnée change : exécuter `npm run analytics:demo:change` dans l'environnement `local-dev`; le script modifie **une seule ligne de vente fictive**, conserve son identifiant/agence/date/coût, ajoute un montant HT fixé en millimes et incrémente la révision PostgreSQL.
2. BI : `/api/v1/analytics/overview` recalcule son CA, sa marge brute et le snapshotId sur les ventes autorisées.
3. Data Science : la même requête recalcule portefeuille, scénarios de CA, tendance et modèles pilote admissibles sur le même dataset. Toute prévision sans historique reste N/D.
4. Agentic : les spécialistes et Director réinterrogent la même version après rafraîchissement. Le portail compare les identifiants de snapshot pour la même agence et période, toutes les **30 secondes** lorsque l'onglet est visible; bouton « Rafraîchir » disponible immédiatement.
5. Changement détecté : le Command Center présente « Créer nouveau dossier AI Director ». **Sur clic explicite**, il vérifie à nouveau la version source, crée une nouvelle mission Director persistante et déclenche l'exécution des spécialistes en mode lecture seule, avec preuves/checkpoints et dossier soumis à revue humaine si des constats sont produits.
6. Sécurité : toute approbation d'un ancien dossier réinterroge l'empreinte des données avant acceptation. Une approbation périmée doit donner HTTP 409; une nouvelle mission n'autorise aucune action ERP.
7. Isolation : aucun accès à une autre agence ou société, et aucun mélange de périodes. Le déclencheur du nouveau dossier exige une agence **spécifique**, non « Toutes les agences ».

## Installation du jeu de démonstration (PowerShell)

```powershell
git checkout feature/analytics-change-decision-journey-20261121
npm ci
# .env : NODE_ENV=development, AUTH_MODE=local-dev,
#        HOST=127.0.0.1, UNIFIED_ANALYTICS_SOURCE=postgres,
#        DATABASE_URL=postgresql://...@127.0.0.1:5432/ai_negoce
npm run db:dev:up
npm run migrate
$env:SYNTHETIC_PERIOD_END = "2026-10-20"
npm run dataset:generate
Remove-Item Env:SYNTHETIC_PERIOD_END
npm run db:seed
npm run analytics:seed -- --source=synthetic --replace
```

Puis deux terminaux : `npm run dev:api` et `npm run agentic:dev`. Ouvrir `http://127.0.0.1:8444`, se connecter en sandbox, sélectionner **Sfax** et **T4 2026**, noter le CA et le snapshotId BI/DS/Agentic.

## Déclenchement de changement traçable

```powershell
npm run analytics:demo:change -- --agency=Sfax --from=2026-10-01 --to=2026-10-20 --increase-tnd=150.000
```

Le script produit le numéro de ligne, le montant HT avant/après, la révision avant/après et les SHA source, plus `erpWrites:0`. Le changement est un scénario fictif de correction de prix d'une ligne, **pas** une procédure de modification légale de facture existante.

Cliquer « Rafraîchir » ou laisser le portail détecter la nouvelle révision. Le CA Sfax doit augmenter de **150.000 TND** sur la période incluant cette ligne, la marge brute également si son coût est inchangé, et Data Science doit recalculer ses scénarios sur la nouvelle base. Le snapshotId change dans les trois vues.

Cliquer « Créer nouveau dossier AI Director » puis vérifier dans Centre de missions : nouvelle mission, trace datée, analyses, références, approbation éventuelle. La même mission n'est pas créée sans action explicite de l'utilisateur.

## Tests

```powershell
npm run typecheck
npm run agentic:typecheck
npx vitest run server/analytics-platform.test.ts server/data-science-platform.test.ts
npx playwright test --config dashboards/agentic-ai/playwright.config.ts
# TEST_DATABASE_URL doit viser une base de TEST distincte
npx vitest run server/analytics-database.pg.test.ts
```

Le test PostgreSQL simule une révision sur un dataset de test, vérifie les chiffres BI/DS et la nouvelle mission, refuse l'ancienne approbation, confirme une nouvelle décision manuelle et interdit les fuites inter-tenant. Le test navigateur utilise des réponses API simulées (pas de vraie DB) pour vérifier l'alerte de révision, le changement des KPI et le clic créateur.

## Limites
- Aucune connexion à LAI ERP, aucun write-back, aucune homologation de modèles.
- Surveillance du snapshot par **polling 30 s** seulement avec une session connectée et un onglet visible; le bouton de rafraîchissement force la requête.
- Le changement de prix synthétique affecte des KPI de vente, pas l'historique de stock ou les règlements bancaires. Les modèles sans données adéquates doivent s'abstenir.
- La validation métier et la campagne PostgreSQL réelle en staging nécessitent un accès à une instance de test et des références de recette LAI.
