# AI-NEGOCE — Audit et centre BI

Ce dépôt contient le livrable d’audit BI d’AI-NEGOCE, des extractions
anonymisées, les preuves de contrôle associées et des prototypes statiques
pour le centre BI.

## Contenu du dépôt

- [`dashboards/data-analysis/`](dashboards/data-analysis/) — centre BI
  opérationnel basé sur les extractions CSV de démonstration.
- [`dashboards/data-science/`](dashboards/data-science/) — prototype autonome
  d’analyse, de simulation et de suivi des actions commerciales.
- [`dashboards/agentic-ai/`](dashboards/agentic-ai/) — cadrage de l’orchestrateur
  Agentic AI prévu pour relier les espaces Data Analysis et Data Science.
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
