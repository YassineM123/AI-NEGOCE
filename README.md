# Audit et centre BI AI-NÉGOCE

Ce dépôt regroupe le livrable d'audit AI-NÉGOCE, les extractions BI
anonymisées, les preuves de contrôle et un prototype statique du centre BI.

## Structure

- `app/` : prototype web statique du centre BI.
- `docs/` : audit, rapport, plans fonctionnels et plan de l'application BI.
- `data/` : catalogues, dictionnaires, mappings et extractions anonymisées.
- `evidence/audit/` : preuves retenues dans le rapport d'audit.
- `evidence/exploration/` : captures de travail et de validation du prototype.
- `tools/` : scripts PowerShell utilisés pour les captures et la maintenance.

## Lancer le prototype

Ouvrir `app/index.html` dans un navigateur moderne. Le prototype est autonome
et ne nécessite ni installation de dépendances ni accès à la base de production.

## Documents de départ

1. `docs/RAPPORT_AUDIT_BI_NEGOCE.md`
2. `docs/PLAN_WEB_APP_BI.md`
3. `docs/PLAN_DASHBOARDS_NEGOCE.md`
4. `data/DICTIONNAIRE_DONNEES_BI.csv`

## Confidentialité

Les jeux de démonstration et les aperçus publiés ici sont anonymisés. Aucun
secret de connexion, fichier d'environnement ou export brut nominatif ne doit
être ajouté au dépôt.
